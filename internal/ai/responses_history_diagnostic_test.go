package ai

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestResponsesHistoryDiagnosticRetainsSafeStructuralCause(t *testing.T) {
	zero, position, expected, available := 0, 7, 2, 1
	cause := &flprovider.ResponsesHistoryError{Code: "visible_mismatch", RecordIndex: &zero, CanonicalIndex: &position, ExpectedItems: &expected, AvailableItems: &available, Fields: []string{"content", "sk-secret", "arguments", "content"}}
	for _, code := range []providerValidationCode{responseHistoryPreparationFailed, responseHistoryCommitFailed} {
		wrapped := &providerValidationError{code: code, cause: fmt.Errorf("private conversation sk-secret: %w", cause)}
		err := providerTransportFailure(wrapped, "openai")
		d, ok := parseProviderFailure(err.Error())
		if !ok || d.HistoryDetail == nil || d.HistoryDetail.Reason != "visible_mismatch" || *d.HistoryDetail.RecordIndex != 0 || *d.HistoryDetail.CanonicalIndex != 7 || *d.HistoryDetail.ExpectedItems != 2 || *d.HistoryDetail.AvailableItems != 1 || strings.Join(d.HistoryDetail.Fields, ",") != "arguments,content" {
			t.Fatalf("lost typed evidence: %s", err)
		}
		if !errors.Is(err, cause) || strings.Contains(safeFailureJSON(t, err.Error()), "sk-secret") || strings.Contains(safeFailureJSON(t, err.Error()), "private conversation") {
			t.Fatalf("cause classification or redaction changed: %s", err)
		}
		if d.Original == nil || !strings.Contains(strings.Join(d.Original.Causes, "\n"), "private conversation sk-secret") {
			t.Fatal("hidden original cause was not retained")
		}
		if advice := flprovider.RetryAdviceForError(err); advice.Category != "" {
			t.Fatalf("history validation must not authorize automatic retry: %+v", advice)
		}
	}
	if got := responsesHistoryFailureDetail(errors.New("private raw cause")); got != nil {
		t.Fatalf("untyped cause became public evidence: %+v", got)
	}
}

func TestResponsesHistoryDiagnosticRejectsUntrustedDetails(t *testing.T) {
	negative, huge := -1, 1<<31
	detail := &responsesHistoryDiagnostic{Reason: "visible_mismatch", RecordIndex: &negative, AvailableItems: &huge, Fields: []string{"private prompt"}}
	got := detail.sanitized()
	if got.RecordIndex != nil || got.AvailableItems != nil || len(got.Fields) != 0 {
		t.Fatalf("unsafe fields survived: %+v", got)
	}
	if (&responsesHistoryDiagnostic{Reason: "sk-secret"}).sanitized() != nil {
		t.Fatal("unknown reason survived")
	}
	for _, d := range []providerFailureDiagnostic{
		{Stage: "response_validation", Code: "response_output_conflict", HistoryDetail: detail},
		{Stage: "history_preparation", Code: "request_failed", HistoryDetail: detail},
	} {
		if d.sanitized().HistoryDetail != nil {
			t.Fatal("history evidence survived the wrong failure boundary")
		}
	}
}

func TestResponsesHistoryDiagnosticSurvivesDesktopRPC(t *testing.T) {
	index := 0
	cause := &providerValidationError{code: responseHistoryPreparationFailed, cause: &flprovider.ResponsesHistoryError{Code: "visible_mismatch", RecordIndex: &index, Fields: []string{"content"}}}
	advice := flprovider.RetryAdvice{}
	source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: newProviderFailure(cause.diagnostic("openai"), cause, advice).Error(), RetryAdvice: &advice}}
	})
	defer cleanup()
	_, err := source.StreamTurn(t.Context(), ModelGatewayRequest{Model: "desktop:model_test"}, nil)
	got, ok := parseProviderFailure(providerTransportFailure(err, DesktopModelSourceProviderType).Error())
	if !ok || got.HistoryDetail == nil || got.HistoryDetail.RecordIndex == nil || *got.HistoryDetail.RecordIndex != 0 || got.HistoryDetail.Reason != "visible_mismatch" || strings.Join(got.HistoryDetail.Fields, ",") != "content" {
		t.Fatalf("RPC lost history detail: %v", err)
	}
}

func TestStructuredHistoryFailureDoesNotUseLegacyMessageHeuristics(t *testing.T) {
	d := providerFailureDiagnostic{Provider: "openai", Code: "response_history_commit_failed", Stage: "history_commit", Shape: "local_validation", Message: "The model responded, but history contains unsupported output.", HistoryDetail: &responsesHistoryDiagnostic{Reason: "unsupported_output"}}
	raw := newProviderFailure(d, nil, flprovider.RetryAdvice{}).Error()
	for _, fallback := range []string{runErrorCodeProviderRequestFailed, runErrorCodeFloretEngineFailed} {
		code, _ := projectRunFailure(raw, fallback)
		if code != runErrorCodeProviderRequestFailed {
			t.Fatalf("structured history failure reclassified: %s", code)
		}
	}
}

package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	oresponses "github.com/openai/openai-go/v3/responses"
)

const conflictingCompletedResponseStream = `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_fixture","role":"assistant","content":[{"type":"output_text","text":"private prompt"}]}}

data: {"type":"response.completed","response":{"id":"resp_fixture","status":"completed","output":[{"type":"message","id":"msg_fixture","role":"assistant","content":[{"type":"output_text","text":"private replacement"}]}]}}

`

func TestProviderAttemptPreservesLocalValidationDetails(t *testing.T) {
	var item oresponses.ResponseOutputItemUnion
	if err := json.Unmarshal([]byte(`{"type":"message","id":"msg_fixture","role":"assistant","content":[]}`), &item); err != nil {
		t.Fatal(err)
	}
	var completed responsesCompletedItems
	if err := completed.add(0, item); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"type":"message","id":"msg_conflict","role":"assistant","content":[]}`), &item); err != nil {
		t.Fatal(err)
	}
	cause := completed.add(0, item)
	if cause == nil {
		t.Fatal("conflict was accepted")
	}
	originalAdvice := flprovider.RetryAdviceForError(cause)
	for _, explicit := range []bool{false, true} {
		err := cause
		if explicit {
			err = flprovider.WithRetryAdvice(cause, flprovider.RetryAdvice{Forbidden: true})
		}
		pool := newOpenAIResponsesPool()
		defer pool.Close()
		diag := newProviderAttemptDiagnostic(t.Context(), testOpenAISocketRequest("thread"), []byte("private prompt"), &openAIProvider{responsesPool: pool}, nil)
		diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportReceiving, "", "")
		diag.firstEvent(true)
		result := ModelGatewayResult{}
		failure := diag.finish(t.Context(), &http.Response{StatusCode: 200, Header: http.Header{"X-Request-Id": []string{"req-fixture"}}}, &result, err, "openai")
		parsed, ok := parseProviderFailure(failure.Error())
		if !ok || parsed.Code != "response_output_conflict" || parsed.Stage != "response_validation" || parsed.Message != "Conflicting completed response output item. Conflicting fields: id." || parsed.Shape != "local_validation" {
			t.Fatalf("local diagnostic lost: %v", failure)
		}
		if parsed.Attempt == nil || parsed.Attempt.HTTPStatus != 200 || parsed.Attempt.RequestID != "req-fixture" || !parsed.Attempt.Terminal || parsed.Attempt.Phase != flprovider.TransportReceiving {
			t.Fatalf("attempt facts lost: %+v", parsed.Attempt)
		}
		if !errors.Is(failure, cause) {
			t.Fatal("cause lost")
		}
		wantAdvice := originalAdvice
		if explicit {
			wantAdvice = flprovider.RetryAdvice{Forbidden: true}
		}
		if got := flprovider.RetryAdviceForError(failure); got != wantAdvice {
			t.Fatalf("retry policy changed: got=%+v want=%+v", got, wantAdvice)
		}
		if len(parsed.OutputFields) != 1 || parsed.OutputFields[0] != "id" {
			t.Fatalf("conflict fields lost: %+v", parsed)
		}
		if strings.Contains(failure.Error(), "private prompt") {
			t.Fatal("request content leaked")
		}
	}
}

func TestProviderAttemptPreservesUnknownFailureFacts(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	diag := newProviderAttemptDiagnostic(t.Context(), testOpenAISocketRequest("thread"), nil, &openAIProvider{responsesPool: pool}, nil)
	diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportReceiving, "", "")
	result := ModelGatewayResult{}
	cause := errors.New("private prompt and raw peer prose sk-secret")
	err := diag.finish(t.Context(), &http.Response{StatusCode: 200}, &result, cause, "openai")
	d, ok := parseProviderFailure(err.Error())
	if !ok || d.Attempt == nil || d.Attempt.HTTPStatus != 200 {
		t.Fatalf("unclassified attempt lost: %v", err)
	}
	if !errors.Is(err, cause) || strings.Contains(err.Error(), "private prompt") || strings.Contains(err.Error(), "sk-secret") {
		t.Fatalf("unsafe diagnostic: %v", err)
	}
}

func TestProviderValidationDiagnosticSurvivesDesktopRPC(t *testing.T) {
	for _, advice := range []flprovider.RetryAdvice{{}, {Forbidden: true}, {Category: flprovider.RetryTransient}} {
		cause := &providerValidationError{code: responseHistoryCommitFailed, cause: errors.New("private provider body sk-secret")}
		d := cause.diagnostic("openai")
		d.Attempt = &providerAttemptDiagnostic{HTTPStatus: 200, ResponseID: "resp_fixture", Terminal: true, TerminalEvent: "response.completed", AttemptID: "attempt:1"}
		failure := newProviderFailure(d, cause, advice)
		source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
			return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: failure.Error(), RetryAdvice: &advice}}
		})
		_, err := source.StreamTurn(t.Context(), ModelGatewayRequest{Model: "desktop:model_test"}, nil)
		cleanup()
		normalized := providerTransportFailure(err, DesktopModelSourceProviderType)
		got, ok := parseProviderFailure(normalized.Error())
		if !ok || got.Code != string(responseHistoryCommitFailed) || got.Message != d.Message || got.Stage != "history_commit" || got.Attempt == nil || got.Attempt.ResponseID != "resp_fixture" || got.Attempt.TerminalEvent != "response.completed" || flprovider.RetryAdviceForError(normalized) != advice {
			t.Fatalf("RPC lost diagnostic or changed retry advice: %v", normalized)
		}
		if strings.Contains(normalized.Error(), "private provider body") || strings.Contains(normalized.Error(), "sk-secret") {
			t.Fatal("private cause leaked")
		}
	}
}

func TestProviderAttemptKeepsCancellationAndContract(t *testing.T) {
	contract := &modelGatewayContractError{Cause: errors.New("private contract")}
	for _, cause := range []error{context.Canceled, contract} {
		pool := newOpenAIResponsesPool()
		diag := newProviderAttemptDiagnostic(t.Context(), testOpenAISocketRequest("thread"), nil, &openAIProvider{responsesPool: pool}, nil)
		diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportReceiving, "", "")
		result := ModelGatewayResult{}
		err := diag.finish(t.Context(), nil, &result, cause, "openai")
		pool.Close()
		if !errors.Is(err, cause) || flprovider.RetryAdviceForError(err) != flprovider.RetryAdviceForError(cause) {
			t.Fatalf("classification changed: %v", err)
		}
		if cause == contract && err != contract {
			t.Fatal("contract was replaced by a provider failure")
		}
	}
}

func TestOutputConflictFieldsSurviveDesktopRPC(t *testing.T) {
	index := int64(0)
	advice := flprovider.RetryAdvice{}
	cause := &providerValidationError{code: responseOutputConflict, outputIndex: &index, outputFields: []string{"content", "arguments"}}
	d := cause.diagnostic("openai")
	source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: newProviderFailure(d, cause, advice).Error(), RetryAdvice: &advice}}
	})
	defer cleanup()
	_, err := source.StreamTurn(t.Context(), ModelGatewayRequest{Model: "desktop:model_test"}, nil)
	got, ok := parseProviderFailure(providerTransportFailure(err, DesktopModelSourceProviderType).Error())
	if !ok || got.OutputIndex == nil || *got.OutputIndex != 0 || strings.Join(got.OutputFields, ",") != "arguments,content" || got.Message != d.Message {
		t.Fatalf("RPC lost structural conflict evidence: %v", err)
	}
}

func TestProviderAttemptLogRetainsSafeFailureFacts(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	diag := newProviderAttemptDiagnostic(t.Context(), testOpenAISocketRequest("thread"), []byte("private prompt"), &openAIProvider{responsesPool: pool}, nil)
	diag.observe(flprovider.TransportHTTPSSE, flprovider.TransportReceiving, "", "")
	diag.responseEvent("response.completed", "resp_fixture")
	result := ModelGatewayResult{}
	_ = diag.finish(t.Context(), &http.Response{StatusCode: 200}, &result, &providerValidationError{code: responseHistoryCommitFailed, cause: errors.New("private cause sk-secret")}, "openai")
	for _, want := range []string{"history_commit", "response_history_commit_failed", "first_event_ms", "resp_fixture", "response.completed"} {
		if !strings.Contains(output.String(), want) {
			t.Fatalf("log missing %s: %s", want, output.String())
		}
	}
	for _, forbidden := range []string{"private cause", "private prompt", "sk-secret", "0x"} {
		if strings.Contains(output.String(), forbidden) {
			t.Fatalf("unsafe or unreadable log: %s", output.String())
		}
	}
	d := (&providerAttemptDiagnostic{ResponseID: "resp_sk-secret", TerminalEvent: "private event"}).sanitized()
	if d.ResponseID != "" || d.TerminalEvent != "" {
		t.Fatalf("unsafe event identity: %+v", d)
	}
}

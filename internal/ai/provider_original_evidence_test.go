package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
)

// Raw evidence belongs to authorized details; banner/log assertions use this
// explicit projection, while evidence assertions compare the complete source.
func safeFailureJSON(t *testing.T, encoded string) string {
	t.Helper()
	d, ok := parseProviderFailure(encoded)
	if !ok {
		if err := json.Unmarshal([]byte(encoded), &d); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := json.Marshal(d.safeSummary())
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestProviderOriginalEvidenceAcrossDesktopAndRestart(t *testing.T) {
	message := "  original provider failure\r\n\t" + strings.Repeat("完整 detail\n", 15000) + " https://provider.example/error sk-returned-value <script>untrusted</script> tail  "
	raw, _ := json.Marshal(map[string]any{"type": "response.failed", "response": map[string]any{"id": "response-exact", "error": map[string]any{"code": "invalid_request_error", "message": message}}, "metadata": map[string]any{"unknown_field": "retained"}})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("X-Request-Id", "DeepSeek-native-identifier")
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	gateway, err := flprovider.NewDeepSeek(flprovider.DeepSeekOptions{Model: "deepseek-flash", BaseURL: server.URL, APIKey: "request-key-never-captured", StateCompatibilityKey: "test"})
	if err != nil {
		t.Fatal(err)
	}
	stream, err := gateway.Stream(t.Context(), flprovider.Request{RunID: "run", PromptScopeID: "scope", Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "request-prompt-never-captured"}}})
	if err != nil {
		t.Fatal(err)
	}
	for event := range stream {
		if event.Err != nil {
			err = event.Err
		}
	}
	if err == nil {
		t.Fatal("missing upstream failure")
	}
	normalized := providerRequestFailure(err, nil, "deepseek")
	advice := flprovider.RetryAdviceForError(normalized)
	source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
		return DesktopModelSourceRPCFrame{Type: "error", ID: frame.ID, Error: &DesktopModelSourceRPCError{Code: "TURN_STREAM_FAILED", Message: normalized.Error(), RetryAdvice: &advice}}
	})
	defer cleanup()
	_, rpcErr := source.StreamTurn(t.Context(), ModelGatewayRequest{Model: "desktop:model_test"}, nil)
	final := providerTransportFailure(rpcErr, DesktopModelSourceProviderType)
	assertEvidence := func(encoded string) {
		t.Helper()
		d, ok := parseProviderFailure(encoded)
		if !ok || d.Original == nil || d.Original.Message != message || !bytes.Equal(d.Original.Body, raw) || d.Original.RequestID != "DeepSeek-native-identifier" || d.Original.ResponseID != "response-exact" || !d.Original.BodyComplete {
			t.Fatal("original evidence lost")
		}
		if strings.Contains(safeFailureJSON(t, encoded), "sk-returned-value") {
			t.Fatal("unsafe summary")
		}
		if strings.Contains(encoded, "request-key-never-captured") || strings.Contains(encoded, "request-prompt-never-captured") {
			t.Fatal("request content collected")
		}
	}
	assertEvidence(final.Error())
	if flprovider.RetryAdviceForError(final) != advice {
		t.Fatal("RPC changed advice")
	}
	runtimeGateway := desktopContinuationGateway(t, "deepseek", "deepseek-flash", server.URL, false)
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Reply briefly.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000, CompactedContextTargetTokens: 2000, RecentTailTokens: 100, RecentUserTokens: 100, ReservedSummaryTokens: 1000}}, runtimeGateway)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "threads.sqlite")
	open := func() (*flruntime.Host, flruntime.ThreadService) {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: flstorage.SQLite(path)})
		if err != nil {
			t.Fatal(err)
		}
		service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
		if err != nil {
			t.Fatal(err)
		}
		return host, service
	}
	host, service := open()
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "hi"}})
	if err != nil {
		t.Fatal(err)
	}
	first := waitDesktopContinuation(t, service, created.ThreadID)
	if first.Failure == nil {
		t.Fatal("missing canonical failure")
	}
	assertEvidence(first.Failure.Message)
	detail := canonicalFailureDetail(first.Failure)
	var displayed struct {
		Original *flprovider.FailureDetails
		BodyText string `json:"original_body_text"`
	}
	if json.Unmarshal([]byte(detail), &displayed) != nil || displayed.Original == nil || displayed.Original.Message != message || displayed.BodyText != string(raw) {
		t.Fatal("display projection lost original")
	}
	if err := host.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	defer host.Shutdown(context.Background())
	restored, err := service.View(t.Context(), created.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Failure == nil || restored.Failure.Message != first.Failure.Message || canonicalFailureDetail(restored.Failure) != detail {
		t.Fatal("restart altered evidence")
	}
	if requests.Load() != 2 {
		t.Fatalf("unexpected automatic replay: %d requests", requests.Load())
	}
}

func TestProviderOriginalLocalAndPartialEvidence(t *testing.T) {
	cause := errors.New("  exact local failure\r\n" + strings.Repeat("X", 20000) + " sk-returned-tail ")
	failure := providerTransportFailure(cause, "deepseek")
	d, ok := parseProviderFailure(failure.Error())
	if !ok || d.Original == nil || d.Original.Cause != cause.Error() || !errors.Is(failure, cause) {
		t.Fatal("local cause lost")
	}
	raw := []byte{0xff, 0, 0x10, 'x'}
	response := &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(&failedProviderBody{data: string(raw)})}
	failure = providerRequestFailure(cause, response, "openai")
	d, ok = parseProviderFailure(failure.Error())
	if !ok || d.Original == nil || !bytes.Equal(d.Original.Body, raw) || d.Original.BodyComplete || !errors.Is(failure, io.ErrUnexpectedEOF) {
		t.Fatal("partial binary evidence lost")
	}
	original := *d.Original
	serialized := failure.Error()
	d.Original.Body[0] = 0
	again, _ := parseProviderFailure(serialized)
	if !reflect.DeepEqual(again.Original.Body, raw) {
		t.Fatal("evidence aliases caller")
	}
	if original.Cause == "" {
		t.Fatal("missing partial read cause")
	}
	historical := providerFailurePrefix + "{\"provider\":\"deepseek\",\"code\":\"provider_request_failed\",\"response_shape\":\"unknown\"}"
	old, ok := parseProviderFailure(historical)
	if !ok || old.Original != nil {
		t.Fatal("fabricated historical evidence")
	}
}

func TestProviderOriginalEvidenceRemainsWithTimeoutDetails(t *testing.T) {
	now := time.Now()
	message := "original timeout cause\n exact tail "
	failure := &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureProvider, Message: providerTransportFailure(errors.New(message), "deepseek").Error(), ProviderTimeout: &flprovider.RequestTimeoutDetails{Stage: "output_idle", StartedAt: now, LastProgressAt: &now, TimedOutAt: now.Add(time.Minute), LogicalRequestID: "logical", AttemptID: "attempt", AttemptEpoch: 1}}
	var detail struct {
		Original *flprovider.FailureDetails
		Timeout  *flprovider.RequestTimeoutDetails
	}
	if json.Unmarshal([]byte(canonicalFailureDetail(failure)), &detail) != nil || detail.Original == nil || detail.Original.Cause != message || detail.Timeout == nil {
		t.Fatal("timeout projection dropped original cause")
	}
}

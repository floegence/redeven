package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func anthropicWireForTest(t *testing.T, req ModelGatewayRequest) (map[string]any, error) {
	t.Helper()
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"fixture","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	defer server.Close()
	p, err := newProviderAdapter("anthropic", server.URL+"/v1", "test", nil)
	if err != nil {
		return nil, err
	}
	if req.Model == "" {
		req.Model = "fixture"
	}
	if len(req.Messages) == 0 {
		req.Messages = []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}
	}
	_, err = p.StreamTurn(t.Context(), req, nil)
	return body, err
}

func TestAnthropicHostFrozenReplayBindsAttemptAndAccount(t *testing.T) {
	var bodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, raw)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"fixture","content":[{"type":"text","text":"answer"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":0,"output_tokens":1}}`)
	}))
	defer server.Close()
	adapter, err := newProviderAdapter("anthropic", server.URL, "first-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	req := ModelGatewayRequest{RunID: "run", PromptScopeID: "scope", AttemptID: "first", AttemptEpoch: 1, Model: "fixture", ReusePolicy: &flprovider.RequestReusePolicy{PromptCacheEnabled: true, PromptCacheNamespace: "scope", ProviderStateAllowed: true}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "frozen input"}}}}}
	prepared, err := adapter.(modelGatewayRequestPreparer).prepareTurn(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	req.Messages[0].Content[0].Text = "mutated after preparation"
	first, err := prepared.StreamTurn(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := prepared.(interface {
		replay(context.Context, flprovider.Request) (preparedModelGatewayTurn, error)
	}).replay(t.Context(), flprovider.Request{RunID: "run", PromptScopeID: "scope", AttemptID: "second", AttemptEpoch: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer replay.Close()
	second, err := replay.StreamTurn(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 || !bytes.Equal(bodies[0], bodies[1]) || bytes.Contains(bodies[0], []byte("mutated")) || prepared.RenderedPayloadFingerprint() != replay.RenderedPayloadFingerprint() {
		t.Fatal("transport retry changed frozen input")
	}
	if first.Measurement == nil || second.Measurement == nil || first.Measurement.AttemptID != "first" || second.Measurement.AttemptID != "second" {
		t.Fatal("native input measurement lost physical attempt identity")
	}
	req.PreviousState = first.ProviderState
	req.Messages[0].Content[0].Text = "frozen input"
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}})
	other, err := newProviderAdapter("anthropic", server.URL, "different-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.StreamTurn(t.Context(), req, nil); err == nil || len(bodies) != 2 {
		t.Fatal("native history crossed credential identity")
	}
}

func TestAnthropicHostCacheUsageAndNativeHistoryRoundTrip(t *testing.T) {
	var bodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		bodies = append(bodies, raw)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"msg","content":[{"type":"thinking","thinking":"reason","signature":"signed-native"},{"type":"text","text":"answer"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"cache_read_input_tokens":70,"cache_creation_input_tokens":20,"output_tokens":20}}`)
	}))
	defer server.Close()
	adapter, err := newProviderAdapter("anthropic", server.URL+"/v1", "key", nil)
	if err != nil {
		t.Fatal(err)
	}
	req := ModelGatewayRequest{RunID: "run", PromptScopeID: "scope", AttemptID: "first", Model: "fixture", ReusePolicy: &flprovider.RequestReusePolicy{PromptCacheEnabled: true, PromptCacheNamespace: "scope", ProviderStateAllowed: true}, Messages: []Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "stable"}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: "question"}}}}}
	result, err := adapter.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderState == nil || result.ProviderState.ReusePolicy != flprovider.StateReuseCanonicalHistory || result.Measurement == nil || result.Measurement.AttemptID != "first" || result.ResponseID != "msg" || result.Reasoning != "reason" {
		t.Fatalf("result=%+v", result)
	}
	if result.Usage.InputTokens != 10 || result.Usage.CacheReadTokens != 70 || result.Usage.CacheWriteTokens != 20 || result.Usage.OutputTokens != 20 || !result.Usage.InputTokensReported || result.Usage.InputTokenScope != "provider_execution" {
		t.Fatalf("usage=%+v", result.Usage)
	}
	if bytes.Count(bodies[0], []byte("cache_control")) != 2 {
		t.Fatalf("missing effective cache markers: %s", bodies[0])
	}
	raw, _ := json.Marshal(result.ProviderState)
	var restored ModelGatewayState
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	req.PreviousState = &restored
	req.ReusePolicy.PromptCacheEnabled = false
	req.AttemptID = "second"
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: result.Reasoning}, {Type: "text", Text: result.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "next"}}})
	adapter, err = newProviderAdapter("anthropic", server.URL, "key", nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err = adapter.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(bodies[1], []byte("signed-native")) || bytes.Contains(bodies[1], []byte("cache_control")) {
		t.Fatalf("cache-off native replay=%s", bodies[1])
	}
	if result.Measurement != nil {
		t.Fatal("signed input cannot claim complete measured context")
	}
	req.ReusePolicy.ProviderStateAllowed = false
	if _, err = adapter.StreamTurn(t.Context(), req, nil); err == nil || len(bodies) != 2 {
		t.Fatal("forbidden supplied state must fail before dispatch")
	}
	req.PreviousState = nil
	result, err = adapter.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.ProviderState != nil || bytes.Contains(bodies[2], []byte("signed-native")) || bytes.Contains(bodies[2], []byte("cache_control")) {
		t.Fatal("state/secret policy bypassed")
	}
}

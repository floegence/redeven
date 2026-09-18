package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestProviderPreparationFreezesDispatchedWireAndEstimate(t *testing.T) {
	cases := []struct{ provider, model, protocol, source string }{
		{"openai", "gpt-4o", "openai-responses", "o200k_base"},
		{"openai", "gpt-4o", "openai-chat-completions", "o200k_base"},
		{"anthropic", "claude-sonnet", "", "proxy_bpe"},
		{"moonshot", "kimi-k2.6", "", "proxy_bpe"},
		{"google", "gemini-model", "", "proxy_bpe"},
		{"openrouter", "openai/gpt-4o", "", "o200k_base"},
		{"ollama", "local-model", "", "proxy_bpe"},
		{"qwen", "qwen-model", "", "proxy_bpe"},
		{"openai_compatible", "gpt-4o", "", "proxy_bpe"},
	}
	for _, tc := range cases {
		t.Run(tc.provider+tc.protocol, func(t *testing.T) {
			var calls atomic.Int32
			wire := make(chan []byte, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				wire <- raw
				if tc.provider == "anthropic" {
					r.Body = io.NopCloser(bytes.NewReader(raw))
					(&anthropicMock{token: "ok"}).handle(w, r)
					return
				}
				if strings.HasSuffix(r.URL.Path, "/responses") {
					writeOpenAIResponsesSSE(w, r, tc.model, "resp_test", "ok")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"id\":\"chat-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"ok\",\"reasoning_content\":\"reasoning\"},\"finish_reason\":null}]}\n\n")
				fmt.Fprint(w, "data: {\"id\":\"chat-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer server.Close()
			key := "sk-test"
			if tc.provider == "anthropic" {
				key = "sk-ant-test"
			}
			gateway, err := newProviderAdapter(tc.provider, server.URL+"/v1", key, nil)
			if err != nil {
				t.Fatal(err)
			}
			request := ModelGatewayRequest{Model: tc.model, Protocol: tc.protocol, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: strings.Repeat("Review the source code and explain the changes.\n", 100)}}}}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}}
			request.ProviderControls.ReasoningCapability.Kind = "toggle"
			request.ProviderControls.ReasoningCapability.ResponseReasoningFields = []string{"reasoning_content"}
			prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			if calls.Load() != 0 {
				t.Fatal("preparation dispatched network work")
			}
			raw := bytes.Clone(prepared.(*preparedModelWire).payload)
			estimate := prepared.TokenEstimate()
			if !strings.Contains(estimate.Source, tc.source) || estimate.EstimatedInputTokens >= 2500 {
				t.Fatalf("estimate not optimized: %+v", estimate)
			}
			request.Messages[0].Content[0].Text = "MUTATED"
			request.Tools[0].InputSchema[0] = '!'
			request.ProviderControls.ReasoningCapability.ResponseReasoningFields[0] = "mutated"
			result, err := prepared.StreamTurn(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			actual := <-wire
			if !bytes.Equal(raw, actual) || prepared.RenderedPayloadFingerprint() != fmt.Sprintf("sha256:%x", sha256.Sum256(actual)) {
				t.Fatal("dispatched bytes differ from prepared fingerprint")
			}
			if strings.Contains(string(actual), "MUTATED") || result.Text != "ok" {
				t.Fatalf("request/result changed: %q", result.Text)
			}
			if tc.provider != "anthropic" && tc.protocol != "openai-responses" && result.Reasoning != "reasoning" {
				t.Fatalf("caller mutation changed response parsing: %q", result.Reasoning)
			}
			if calls.Load() != 1 {
				t.Fatalf("dispatch count=%d", calls.Load())
			}
			if _, err := prepared.StreamTurn(context.Background(), nil); err == nil {
				t.Fatal("prepared request reused")
			}
			t.Logf("wire bytes=%d, estimated input tokens=%d, source=%s", len(actual), estimate.EstimatedInputTokens, estimate.Source)
		})
	}
}

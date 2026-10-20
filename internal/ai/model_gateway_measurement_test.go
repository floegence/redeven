package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/gorilla/websocket"
	responses "github.com/openai/openai-go/v3/responses"
)

func TestResponsesHTTPMeasurementUsesCurrentResponseEvidence(t *testing.T) {
	for _, known := range []bool{false, true} {
		for _, included := range []bool{false, true} {
			t.Run(fmt.Sprintf("known_%t_included_%t", known, included), func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					w.Header().Set("Content-Type", "text/event-stream")
					if included && calls == 1 {
						w.Header().Set("x-reasoning-included", "true")
					}
					encoded, _ := json.Marshal(testOpenAICompleted(fmt.Sprintf("response_%d", calls)))
					fmt.Fprintf(w, "event: response.completed\ndata: %s\n\n", encoded)
				}))
				defer server.Close()
				p := testOpenAISocketProvider(t, server, nil)
				p.officialOpenAI = known
				req := testOpenAISocketRequest("http")
				prepared, err := p.prepareTurn(t.Context(), req)
				if err != nil {
					t.Fatal(err)
				}
				first, err := prepared.StreamTurn(t.Context(), nil)
				if err != nil {
					t.Fatal(err)
				}
				evidence := first.Measurement
				if (evidence != nil) != known {
					t.Fatalf("qualification=%+v", evidence)
				}
				if known {
					if !evidence.CompleteInput || evidence.OpaqueInput != included || (evidence.ResponseEnd.Fingerprint != "") != included {
						t.Fatalf("wrong evidence: %+v", evidence)
					}
					next, err := p.prepareTurn(t.Context(), nextSocketRequest(req, first))
					if err != nil {
						t.Fatal(err)
					}
					if included {
						suffix, ok := next.(flprovider.PreparedRequestMeasurement).MeasurementSuffix(evidence.ResponseEnd)
						if !ok || strings.Contains(string(suffix), "opaque_response_1") || !strings.Contains(string(suffix), "next input") {
							t.Fatalf("wrong frozen suffix: %s %t", suffix, ok)
						}
					}
					second, err := next.StreamTurn(t.Context(), nil)
					if err != nil {
						t.Fatal(err)
					}
					if second.Measurement != nil {
						t.Fatal("prior HTTP inclusion proof leaked into opaque request")
					}
				}
			})
		}
	}
}

func TestResponsesWebSocketMeasurementIsConnectionBound(t *testing.T) {
	pool := newOpenAIResponsesPool()
	defer pool.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, http.Header{"X-Reasoning-Included": []string{"true"}})
		if err != nil {
			return
		}
		defer conn.Close()
		for i := 1; ; i++ {
			var body map[string]json.RawMessage
			if conn.ReadJSON(&body) != nil {
				return
			}
			if conn.WriteJSON(testOpenAICompleted(fmt.Sprintf("response_%d", i))) != nil {
				return
			}
		}
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, pool)
	req := testOpenAISocketRequest("ws")
	firstPrepared, err := p.prepareTurn(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	first, err := firstPrepared.StreamTurn(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Measurement == nil || first.Measurement.Input == firstPrepared.(flprovider.PreparedRequestMeasurement).InputMeasurementPrefix() {
		t.Fatal("new connection retroactively changed frozen execution identity")
	}
	nextReq := nextSocketRequest(req, first)
	next, err := p.prepareTurn(t.Context(), nextReq)
	if err != nil {
		t.Fatal(err)
	}
	prefix := next.(flprovider.PreparedRequestMeasurement).InputMeasurementPrefix()
	second, err := next.StreamTurn(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if second.Measurement == nil || second.Measurement.Input != prefix || !second.Measurement.OpaqueInput {
		t.Fatalf("connection evidence=%+v", second.Measurement)
	}
	key := openAIConnectionKey{p.transportIdentity, req.Model, string(req.PromptScopeID)}
	pool.invalidate(key)
	changed, err := p.prepareTurn(context.Background(), nextSocketRequest(nextReq, second))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := changed.(flprovider.PreparedRequestMeasurement).MeasurementSuffix(second.Measurement.ResponseEnd); ok {
		t.Fatal("closed connection evidence reused")
	}
}

func TestResponseMeasurementRejectsHiddenExecutionAndUnknownInput(t *testing.T) {
	var completed responses.Response
	raw, _ := json.Marshal(testOpenAICompleted("response")["response"])
	if err := json.Unmarshal(raw, &completed); err != nil {
		t.Fatal(err)
	}
	p := &openAIProvider{officialOpenAI: true, providerType: "openai", transportIdentity: openAIConnectionIdentity{"provider", "endpoint", "account"}}
	usage, err := turnUsageFromOpenAIResponse(completed.Usage)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, payload string
		qualified     bool
	}{
		{"complete", `{"model":"gpt-5.5","input":[{"role":"user","content":"hi"}]}`, true},
		{"hosted", `{"model":"gpt-5.5","input":[],"tools":[{"type":"web_search"}]}`, false},
		{"truncated", `{"model":"gpt-5.5","input":[],"truncation":"auto"}`, false},
		{"hidden_continuation", `{"model":"gpt-5.5","input":[],"previous_response_id":"old"}`, false},
		{"opaque", `{"model":"gpt-5.5","input":[{"type":"reasoning","encrypted_content":"opaque"}]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			evidence := p.responseMeasurement([]byte(tc.payload), completed, ModelGatewayResult{Usage: usage}, nil, nil)
			if (evidence != nil) != tc.qualified {
				t.Fatalf("evidence=%+v", evidence)
			}
		})
	}
}

func TestMeasurementOutputPresencePreservesExplicitZero(t *testing.T) {
	for _, sample := range []struct {
		raw     string
		present bool
	}{{`{"input_tokens":1,"output_tokens":0}`, true}, {`{"input_tokens":1}`, false}} {
		var raw responses.ResponseUsage
		if err := json.Unmarshal([]byte(sample.raw), &raw); err != nil {
			t.Fatal(err)
		}
		usage, err := turnUsageFromOpenAIResponse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if usage.OutputTokensReported != sample.present || floretUsageFromFlower(usage).OutputTokensReported != sample.present {
			t.Fatalf("presence lost: %+v", usage)
		}
	}
}

func TestFloretPreparedMeasurementBindsActualAttemptAndTerminal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("x-reasoning-included", "true")
		raw, _ := json.Marshal(testOpenAICompleted("response"))
		fmt.Fprintf(w, "data: %s\n\n", raw)
	}))
	defer server.Close()
	p := testOpenAISocketProvider(t, server, nil)
	adapter := newFloretProviderAdapter(p, "openai", "gpt-5.5", ProviderControls{}, TurnBudgets{}, "")
	req := flprovider.Request{RunID: "run", PromptScopeID: "scope", AttemptID: "attempt-1", Step: 1, Messages: []flprovider.Message{{Role: "user", Text: "first"}}}
	prepared, err := adapter.Prepare(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	prefix := prepared.(flprovider.PreparedRequestMeasurement).InputMeasurementPrefix()
	refit, err := prepared.(flprovider.PreparedRequestOutputLimiter).WithMaxOutputTokens(t.Context(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	if refit.(flprovider.PreparedRequestMeasurement).InputMeasurementPrefix() != prefix {
		t.Fatal("output refit changed input measurement")
	}
	stream, err := refit.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	var usage flprovider.Usage
	var terminal flprovider.Event
	for ev := range stream {
		if ev.Type == flprovider.EventError {
			t.Fatal(ev.Err)
		}
		if ev.Type == flprovider.EventUsage {
			usage = ev.Usage
		}
		if ev.Type == flprovider.EventDone {
			terminal = ev
		}
	}
	if usage.Measurement == nil || usage.Measurement.AttemptID != "attempt-1" || usage.Measurement.Input != prefix || usage.Measurement.ResponseEnd.Fingerprint == "" || terminal.ResponseID != "response" || !usage.OutputTokensReported {
		t.Fatalf("bridge lost evidence: usage=%+v terminal=%+v", usage, terminal)
	}
}

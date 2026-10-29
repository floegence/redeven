package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	flstorage "github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

// A local tool ends the provider request, but must not erase hosted evidence.
func TestResponsesSearchSurvivesLocalToolBoundary(t *testing.T) {
	for _, typ := range []string{"openai", "openai_compatible", "qwen"} {
		t.Run(typ, func(t *testing.T) {
			var bodies []map[string]json.RawMessage
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				bodies = append(bodies, body)
				output := `[{"type":"web_search_call","id":"search1","status":"completed","opaque_results":"search-evidence-123","action":{"type":"search","query":"product films"}},{"type":"function_call","id":"item1","call_id":"call1","name":"inspect","arguments":"{}","status":"completed"}]`
				if len(bodies) > 1 {
					output = `[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]`
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp%d\",\"status\":\"completed\",\"output\":%s}}\n\n", len(bodies), output)
			}))
			defer server.Close()
			base, err := newProviderAdapter(typ, server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			req := ModelGatewayRequest{Model: "fixture-model", Protocol: "openai-responses", WebSearchMode: providerWebSearchModeOpenAIResponsesBuiltin, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "find films"}}}}}
			first, err := base.StreamTurn(t.Context(), req, nil)
			if err != nil {
				t.Fatal(err)
			}
			if first.ProviderState == nil {
				t.Fatal("missing provider state")
			}
			// Serialization models the durable boundary; no process-local cache is used.
			raw, _ := json.Marshal(first.ProviderState)
			var state ModelGatewayState
			if err = json.Unmarshal(raw, &state); err != nil {
				t.Fatal(err)
			}
			req.PreviousState = &state
			req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "call1", ToolName: "inspect", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call1", Text: "review complete"}}})
			// Recreate the adapter and disable new searches; old evidence must survive.
			base, err = newProviderAdapter(typ, server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.WebSearchMode = providerWebSearchModeDisabled
			if _, err = base.StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(bodies[1]["input"]), "search-evidence-123") {
				t.Fatalf("lost native search evidence: %s", bodies[1]["input"])
			}
			if bodies[1]["previous_response_id"] != nil {
				t.Fatal("used unsupported server continuation")
			}
		})
	}
}

func TestFlowerResponsesSearchSurvivesGoalReviewRestartAndFork(t *testing.T) {
	var mu sync.Mutex
	var inputs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if len(extractOpenAIToolNames(request)) == 0 {
			writeOpenAIResponsesSSE(w, r, "gpt-5-mini", "title", "Search test")
			return
		}
		raw, _ := json.Marshal(request["input"])
		mu.Lock()
		inputs = append(inputs, string(raw))
		step := len(inputs)
		mu.Unlock()
		var output []any
		if step == 1 {
			output = []any{
				map[string]any{"type": "web_search_call", "id": "search", "status": "completed", "opaque_results": "durable-search-receipt", "action": map[string]any{"type": "search", "query": "product films"}},
				map[string]any{"type": "function_call", "id": "review", "call_id": "review", "name": "goal", "arguments": `{"operation":"review","expected_version":1,"outcome":"completed","evidence":"Verified official product films."}`},
			}
		} else {
			if step < 4 && !strings.Contains(string(raw), "durable-search-receipt") {
				t.Errorf("request %d lost search receipt", step)
			}
			if step == 4 {
				// Fork retains canonical conversation, but does not inherit the
				// source thread's opaque provider continuation authority.
				if !strings.Contains(string(raw), "Verified product films.") || request["previous_response_id"] != nil {
					t.Error("fork lost canonical facts or reused source continuation")
				}
			}
			output = []any{map[string]any{"type": "message", "id": fmt.Sprintf("message-%d", step), "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Verified product films.", "annotations": []any{}}}}}
		}
		event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("search-response-%d", step), "status": "completed", "output": output}})
		fmt.Fprintf(w, "data: %s\n\n", event)
	}))
	defer server.Close()
	stateDir := t.TempDir()
	svc := openRealtimeTestService(t, stateDir, server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	_, initial, err := svc.ManageThreadGoal(t.Context(), meta, ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "search-goal", Operation: "set", Text: "Find official product films", NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini"}})
	if err != nil {
		t.Fatal(err)
	}
	threadID := initial.ThreadID.String()
	view, err := runTypedTurnForTest(t, t.Context(), svc, meta, "search-send", RunStartRequest{ThreadID: threadID, Input: RunInput{Text: "Find product films"}})
	if err != nil {
		t.Fatal(err)
	}
	if view.Goal.Status != "completed" {
		t.Fatalf("Goal review did not complete: %+v", view.Goal)
	}
	mu.Lock()
	count := len(inputs)
	mu.Unlock()
	if count != 2 {
		t.Fatalf("provider requests=%d, want search then final", count)
	}
	if err = svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = openRealtimeTestService(t, stateDir, server.URL)
	if _, err = runTypedTurnForTest(t, t.Context(), svc, meta, "search-after-restart", RunStartRequest{ThreadID: threadID, Input: RunInput{Text: "Use the same evidence again"}}); err != nil {
		t.Fatal(err)
	}
	fork, err := svc.ForkThread(t.Context(), meta, threadID, "Search evidence fork")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = runTypedTurnForTest(t, t.Context(), svc, meta, "search-after-fork", RunStartRequest{ThreadID: fork.ThreadID, Input: RunInput{Text: "Use the inherited evidence"}}); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(inputs) != 4 {
		t.Fatalf("unexpected requests after restart and fork: %d", len(inputs))
	}
}

func TestResponsesContinuationAndReplayKeepCompleteEvidence(t *testing.T) {
	for _, continuation := range []bool{false, true} {
		t.Run(fmt.Sprint(continuation), func(t *testing.T) {
			var bodies []map[string]json.RawMessage
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				bodies = append(bodies, body)
				output := `[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]`
				if len(bodies) == 1 {
					output = `[{"type":"reasoning","encrypted_content":"encrypted-evidence"},{"type":"web_search_call","id":"s","status":"completed","opaque_results":"search-evidence","action":{"type":"search","query":"docs"}},{"type":"function_call","call_id":"c","name":"inspect","arguments":"{}"}]`
					var items []json.RawMessage
					if err := json.Unmarshal([]byte(output), &items); err != nil {
						t.Fatal(err)
					}
					for i, item := range items {
						event, _ := json.Marshal(map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
						fmt.Fprintf(w, "data: %s\n\n", event)
					}
					output = "[]"
				}
				event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("resp%d", len(bodies)), "status": "completed", "output": json.RawMessage(output)}})
				fmt.Fprintf(w, "data: %s\n\n", event)
			}))
			defer srv.Close()
			base, err := newProviderAdapter("openai", srv.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			p := base.(*openAIProvider)
			p.responsesContinuation = continuation
			req := ModelGatewayRequest{Model: "fixture-model", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "find docs"}}}}}
			first, err := p.StreamTurn(t.Context(), req, nil)
			if err != nil {
				t.Fatal(err)
			}
			req.PreviousState = first.ProviderState
			req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolCallID: "c", ToolName: "inspect", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "c", Text: "review done"}}})
			prepared, err := p.prepareTurn(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			frozen := prepared.(*preparedModelWire)
			for _, evidence := range []string{"find docs", "search-evidence", "encrypted-evidence", "review done"} {
				if !strings.Contains(string(frozen.payload), evidence) {
					t.Fatalf("estimation lost %s", evidence)
				}
			}
			p.responsesContinuation = !continuation
			if _, err = prepared.StreamTurn(t.Context(), nil); err != nil {
				t.Fatal(err)
			}
			if continuation {
				if string(bodies[1]["previous_response_id"]) != `"resp1"` {
					t.Fatal("missing server continuation")
				}
				var delta []map[string]any
				json.Unmarshal(bodies[1]["input"], &delta)
				if len(delta) != 1 || delta[0]["type"] != "function_call_output" {
					t.Fatalf("duplicated previous response: %s", bodies[1]["input"])
				}
			} else if !strings.Contains(string(bodies[1]["input"]), "search-evidence") || bodies[1]["previous_response_id"] != nil {
				t.Fatal("stateless replay lost evidence")
			}
			replay, err := frozen.replay(t.Context(), flprovider.Request{})
			if err != nil {
				t.Fatal(err)
			}
			defer replay.Close()
			if _, err = replay.StreamTurn(t.Context(), nil); err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(bodies[1])
			b, _ := json.Marshal(bodies[2])
			if string(a) != string(b) {
				t.Fatal("transport retry changed input")
			}
			p.responsesContinuation = true
			req.Messages = []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "compacted summary"}}}}
			if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			if bodies[3]["previous_response_id"] != nil || strings.Contains(string(bodies[3]["input"]), "search-evidence") {
				t.Fatal("stale search crossed compaction")
			}
			req.PreviousState = nil
			req.ReusePolicy = &flprovider.RequestReusePolicy{ProviderStateAllowed: false}
			secret, err := p.StreamTurn(t.Context(), req, nil)
			if err != nil {
				t.Fatal(err)
			}
			if secret.ProviderState != nil {
				t.Fatal("supplemental request retained state")
			}
		})
	}
}

func TestResponsesTruncationPreservesSearchForContinuation(t *testing.T) {
	for _, continuation := range []bool{false, true} {
		t.Run(fmt.Sprint(continuation), func(t *testing.T) {
			var bodies []map[string]json.RawMessage
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				bodies = append(bodies, body)
				w.Header().Set("Content-Type", "text/event-stream")
				status := "completed"
				output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "done"}}}}
				if len(bodies) == 1 {
					status = "incomplete"
					output = []any{
						map[string]any{"type": "web_search_call", "id": "search", "status": "completed", "opaque_results": "truncated-search-evidence", "action": map[string]any{"type": "search", "query": "docs"}},
						map[string]any{"type": "message", "id": "partial-message", "status": "incomplete", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "partial"}}},
					}
				}
				event, _ := json.Marshal(map[string]any{"type": "response." + status, "response": map[string]any{"id": fmt.Sprintf("resp%d", len(bodies)), "status": status, "incomplete_details": map[string]any{"reason": "max_output_tokens"}, "output": output}})
				fmt.Fprintf(w, "data: %s\n\n", event)
			}))
			defer server.Close()
			base, err := newProviderAdapter("openai", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			p := base.(*openAIProvider)
			p.responsesContinuation = continuation
			req := ModelGatewayRequest{Model: "fixture-model", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "find docs"}}}}}
			first, err := p.StreamTurn(t.Context(), req, nil)
			if err != nil {
				t.Fatal(err)
			}
			if first.FinishReason != "length" || first.Text != "partial" || first.ProviderState == nil {
				t.Fatalf("lost terminal truncation: %+v", first)
			}
			req.PreviousState = first.ProviderState
			req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}}})
			if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			if continuation {
				if string(bodies[1]["previous_response_id"]) != "\"resp1\"" || string(bodies[1]["input"]) != "[]" {
					t.Fatalf("invalid continuation: %s", bodies[1])
				}
			} else if !strings.Contains(string(bodies[1]["input"]), "truncated-search-evidence") || !strings.Contains(string(bodies[1]["input"]), "incomplete") {
				t.Fatal("truncation lost native evidence")
			}
		})
	}
}

func TestResponsesRejectedContinuationCanUseRetainedReplay(t *testing.T) {
	var bodies []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		bodies = append(bodies, body)
		if body["previous_response_id"] != nil {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, "{\"error\":{\"message\":\"previous_response_id unsupported\",\"type\":\"invalid_request_error\"}}")
			return
		}
		output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "answer"}}}}
		if len(bodies) == 1 {
			output = append([]any{map[string]any{"type": "web_search_call", "id": "s", "status": "completed", "opaque_results": "saved-receipt", "action": map[string]any{"type": "search", "query": "docs"}}}, output...)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": "response", "status": "completed", "output": output}})
		fmt.Fprintf(w, "data: %s\n\n", event)
	}))
	defer server.Close()
	base, err := newProviderAdapter("openai", server.URL, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	p := base.(*openAIProvider)
	p.responsesContinuation = true
	req := ModelGatewayRequest{Model: "fixture-model", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "find docs"}}}}}
	first, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.PreviousState = first.ProviderState
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: "answer"}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}})
	before, _ := json.Marshal(req.PreviousState)
	if _, err = p.StreamTurn(t.Context(), req, nil); err == nil || len(bodies) != 2 {
		t.Fatalf("rejection silently retried: calls=%d err=%v", len(bodies), err)
	}
	after, _ := json.Marshal(req.PreviousState)
	if string(before) != string(after) {
		t.Fatal("failed continuation mutated retained state")
	}
	p.responsesContinuation = false
	if _, err = p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(bodies[2]["input"]), "saved-receipt") || bodies[2]["previous_response_id"] != nil {
		t.Fatal("explicit replay lost retained evidence")
	}
}

func TestResponsesMalformedOrInterruptedNativeOutputNeverPublishesState(t *testing.T) {
	cases := map[string]string{
		"disconnect":  "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"web_search_call\",\"id\":\"s\",\"status\":\"completed\"}}\n\n",
		"failed":      "data: {\"type\":\"response.failed\",\"response\":{\"id\":\"r\",\"status\":\"failed\",\"output\":[{\"type\":\"web_search_call\",\"id\":\"s\"}]}}\n\n",
		"missing":     "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[]}}\n\n",
		"conflicting": "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"web_search_call\",\"id\":\"s\",\"opaque_results\":\"original\"}}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[{\"type\":\"web_search_call\",\"id\":\"s\",\"opaque_results\":\"changed\"}]}}\n\n",
	}
	for name, stream := range cases {
		t.Run(name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, stream)
			}))
			defer server.Close()
			p, err := newProviderAdapter("openai", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			result, err := p.StreamTurn(t.Context(), ModelGatewayRequest{Model: "fixture-model"}, nil)
			if err == nil || result.ProviderState != nil || calls != 1 {
				t.Fatalf("invalid stream retained or retried: result=%+v calls=%d err=%v", result, calls, err)
			}
		})
	}
}

func TestResponsesManualRetryRetainsCanonicalToolsAndResetsNativeState(t *testing.T) {
	var requests, effects atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		step := requests.Add(1)
		if step == 2 && (!strings.Contains(string(body["input"]), "committed-search-receipt") || !strings.Contains(string(body["input"]), "Observed once.")) {
			t.Error("local tool continuation lost confirmed search or tool output")
		}
		if step == 3 {
			// Manual Retry establishes a new canonical render lineage. Preserve
			// confirmed tool facts without reusing the failed execution state.
			if !strings.Contains(string(body["input"]), "Observed once.") || strings.Contains(string(body["input"]), "committed-search-receipt") || body["previous_response_id"] != nil {
				t.Error("manual retry changed canonical facts or reused old native state")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if step == 2 {
			fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Unconfirmed draft\"}\n\n")
			return
		}
		output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "done"}}}}
		if step == 1 {
			output = []any{
				map[string]any{"type": "web_search_call", "id": "search", "status": "completed", "opaque_results": "committed-search-receipt", "action": map[string]any{"type": "search", "query": "docs"}},
				map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "inspect", "arguments": "{}", "status": "completed"},
			}
		}
		event, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", step), "status": "completed", "output": output}})
		fmt.Fprintf(w, "data: %s\n\n", event)
	}))
	defer server.Close()
	raw, err := newProviderAdapter("openai", server.URL, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	gateway := newFloretProviderAdapter(raw, "openai", "fixture-model", ProviderControls{}, TurnBudgets{}, providerWebSearchModeOpenAIResponsesBuiltin)
	gateway.identity, err = redevenFloretGatewayIdentity("openai", "openai", server.URL, "fixture-model", "responses", "api_key", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	tool := fltools.Define[map[string]any](fltools.Definition{Name: "inspect", ReadOnly: true, InputSchema: fltools.StrictObject(nil, nil), Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
		effects.Add(1)
		return fltools.Result{Text: "Observed once."}, nil
	})
	agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Inspect once.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentHostedTools(flprovider.HostedToolDefinition{Name: "web_search", Type: "web_search"}), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect), flruntime.WithAgentProviderRetryPolicy(flruntime.ProviderRetryPolicy{Disabled: true}))
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
	defer func() { _ = host.Shutdown(context.Background()) }()
	created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Find and inspect docs."}}); err != nil {
		t.Fatal(err)
	}
	first := waitDesktopContinuation(t, service, created.ThreadID)
	if first.Failure == nil || requests.Load() != 2 || effects.Load() != 1 {
		t.Fatalf("expected failure after confirmed tool: failure=%+v requests=%d effects=%d", first.Failure, requests.Load(), effects.Load())
	}
	if err = host.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	host, service = open()
	if _, err = service.Retry(t.Context(), flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: first.TurnID, RequestKey: "retry"}); err != nil {
		t.Fatal(err)
	}
	recovered := waitDesktopContinuation(t, service, created.ThreadID)
	if recovered.Failure != nil || requests.Load() != 3 || effects.Load() != 1 {
		t.Fatalf("retry changed evidence/effects: failure=%+v requests=%d effects=%d", recovered.Failure, requests.Load(), effects.Load())
	}
}

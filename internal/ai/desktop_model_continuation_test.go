package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
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
	flidentity "github.com/floegence/floret/v7/identity"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
	"github.com/gorilla/websocket"
)

func TestDesktopPreparedRequestFreezesProviderWireAcrossRefitAndRetry(t *testing.T) {
	for _, tc := range []struct {
		name, provider, model string
	}{
		{"openai", "openai", "gpt-4o"},
		{"deepseek", "deepseek", "deepseek-flash"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wires := make(chan []byte, 2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				wires <- raw
				if tc.provider == "deepseek" {
					writeDeepSeekIntegrationTextResponse(w, w.(http.Flusher), "resp_fixture", "done")
				} else {
					writeOpenAIResponsesSSE(w, r, tc.model, "resp_fixture", "done")
				}
			}))
			defer server.Close()
			adapter := desktopContinuationGateway(t, tc.provider, tc.model, server.URL, false)
			adapter.outputControl = flprovider.OutputControlClient
			req := flprovider.Request{RunID: "run-freeze", PromptScopeID: "scope-freeze", LogicalRequestID: "logical-freeze", AttemptID: "attempt-1", AttemptEpoch: 1, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "inspect", Attachments: []flprovider.Attachment{{ResourceRef: "image-1", MIMEType: "image/png"}}}}}
			prepared, err := adapter.Prepare(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			if prepared.TokenEstimate().Method != "provider_rendered_payload_estimate" || prepared.TokenEstimate().AttachmentTokens <= 0 {
				t.Fatalf("expected provider-rendered media estimate: %+v", prepared.TokenEstimate())
			}
			fitted, err := prepared.(flprovider.PreparedRequestOutputLimiter).WithMaxOutputTokens(t.Context(), 128)
			if err != nil {
				t.Fatal(err)
			}
			if err := prepared.Close(); err != nil {
				t.Fatal(err)
			}
			stream, err := fitted.Stream(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
			}
			first := <-wires
			if got := fmt.Sprintf("sha256:%x", sha256.Sum256(first)); got != fitted.RenderedPayloadFingerprint() {
				t.Fatalf("wire fingerprint %s differs from frozen %s", got, fitted.RenderedPayloadFingerprint())
			}
			if err := fitted.Close(); err != nil {
				t.Fatal(err)
			}
			req.MaxOutputTokens, req.AttemptID, req.AttemptEpoch = 128, "attempt-2", 2
			retry, err := fitted.(flprovider.PreparedRequestReplay).PrepareRetry(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer retry.Close()
			stream, err = retry.Stream(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
			}
			if second := <-wires; string(first) != string(second) || retry.RenderedPayloadFingerprint() != fitted.RenderedPayloadFingerprint() {
				t.Fatal("retry changed the frozen provider wire")
			}
		})
	}
}

func TestDesktopDeepSeekImageEstimateExcludesTransportEncoding(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("preparation must not dispatch a model request")
	}))
	defer server.Close()
	adapter := desktopContinuationGateway(t, "deepseek", "deepseek-flash", server.URL, false)
	_, attachment, image := screenshotPreparationFixture(t)
	adapter.attachmentResolver = func(context.Context, flprovider.Attachment) (ContentPart, error) {
		return image, nil
	}
	req := flprovider.Request{RunID: "run-image-budget", PromptScopeID: "scope-image-budget", Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "inspect", Attachments: []flprovider.Attachment{attachment, attachment, attachment, attachment}}}}
	projected, err := adapter.turnRequest(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	old, err := estimateGatewayInput(DesktopModelSourceProviderType, projected)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	prepared, err := adapter.Prepare(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	actual := prepared.TokenEstimate()
	if actual.Method != "provider_rendered_payload_estimate" || actual.AttachmentTokens < 4*1024 || old.EstimatedInputTokens < 5*actual.EstimatedInputTokens {
		t.Fatalf("old estimate=%d actual=%+v", old.EstimatedInputTokens, actual)
	}
}

func TestDesktopStreamFlowControlsSlowRequestAndFragmentsLargeResult(t *testing.T) {
	var sent atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for range 100 {
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": "x"})
			sent.Add(1)
		}
		writeOpenAIResponsesSSE(w, r, "gpt-4o", "resp_large", strings.Repeat("z", 100<<10))
	}))
	defer server.Close()
	adapter := desktopContinuationGateway(t, "openai", "gpt-4o", server.URL, false)
	start := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		result, err := adapter.base.StreamTurn(t.Context(), ModelGatewayRequest{Model: adapter.modelName, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "fixture"}}}}}, func(ev StreamEvent) {
			if ev.Type == StreamEventTextDelta {
				select {
				case <-start:
				default:
					close(start)
					<-release
				}
			}
		})
		if err == nil && len(result.Text) < 100<<10 {
			err = fmt.Errorf("large terminal result lost: %d bytes", len(result.Text))
		}
		done <- err
	}()
	select {
	case <-start:
	case <-time.After(3 * time.Second):
		t.Fatal("stream did not start")
	}
	deadline := time.Now().Add(2 * time.Second)
	for sent.Load() < 100 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if sent.Load() != 100 {
		close(release)
		t.Fatal("provider did not produce the burst while the consumer was blocked")
	}
	provider := adapter.base.(*desktopModelSourceProvider)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	_, err := provider.client.ListModels(ctx)
	cancel()
	close(release)
	if err != nil {
		t.Fatalf("slow stream blocked unrelated request: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not complete after consumer resumed")
	}
}

func TestDesktopPreparedRetryOutlivesAttemptContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIResponsesSSE(w, r, "gpt-4o", "resp_retry", "done")
	}))
	defer server.Close()
	adapter := desktopContinuationGateway(t, "openai", "gpt-4o", server.URL, false)
	req := flprovider.Request{RunID: "run-attempt", PromptScopeID: "scope-attempt", LogicalRequestID: "logical-attempt", AttemptID: "attempt-1", AttemptEpoch: 1, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "fixture"}}}
	prepared, err := adapter.Prepare(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if err = prepared.Close(); err != nil {
		t.Fatal(err)
	}
	attemptCtx, cancelAttempt := context.WithCancel(t.Context())
	req.AttemptID, req.AttemptEpoch = "attempt-2", 2
	retry, err := prepared.(flprovider.PreparedRequestReplay).PrepareRetry(attemptCtx, req)
	if err != nil {
		t.Fatal(err)
	}
	cancelAttempt()
	defer retry.Close()
	stream, err := retry.Stream(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for event := range stream {
		if event.Err != nil {
			t.Fatal(event.Err)
		}
	}
}

func TestDesktopPreparedUnusedHandlesReleaseCapacity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unused preparation must not call the provider")
	}))
	defer server.Close()
	adapter := desktopContinuationGateway(t, "openai", "gpt-4o", server.URL, false)
	req := flprovider.Request{RunID: "run-candidates", PromptScopeID: "scope-candidates", LogicalRequestID: "logical-candidates", AttemptID: "attempt-1", AttemptEpoch: 1, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "fixture"}}}
	for i := 0; i < 80; i++ {
		ctx, cancel := context.WithCancel(t.Context())
		prepared, err := adapter.Prepare(ctx, req)
		if err != nil {
			cancel()
			t.Fatalf("candidate %d: %v", i, err)
		}
		if err := prepared.Close(); err != nil {
			cancel()
			t.Fatalf("close candidate %d: %v", i, err)
		}
		cancel()
	}
}

type desktopPreparedHandoffFixture struct {
	closed *atomic.Int32
}

func (p *desktopPreparedHandoffFixture) StreamTurn(context.Context, func(StreamEvent)) (ModelGatewayResult, error) {
	return ModelGatewayResult{}, nil
}

func (p *desktopPreparedHandoffFixture) TokenEstimate() flprovider.TokenEstimate {
	return flprovider.TokenEstimate{EstimatedInputTokens: 1}
}

func (p *desktopPreparedHandoffFixture) RenderedPayloadFingerprint() string { return "fixture" }
func (p *desktopPreparedHandoffFixture) Close() error {
	p.closed.Add(1)
	return nil
}

func (p *desktopPreparedHandoffFixture) withMaxOutputTokens(context.Context, int64) (preparedModelGatewayTurn, error) {
	return &desktopPreparedHandoffFixture{closed: p.closed}, nil
}

func TestDesktopPreparedHandoffReleasesUnacceptedResult(t *testing.T) {
	for _, accept := range []bool{false, true} {
		t.Run(fmt.Sprintf("accepted=%t", accept), func(t *testing.T) {
			var closed atomic.Int32
			store := newDesktopModelSourcePreparedStore()
			parent, err := store.add(&desktopModelSourcePreparedEntry{turn: &desktopPreparedHandoffFixture{closed: &closed}, size: 1})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(desktopModelSourcePreparedOperation{Handle: parent.Handle, OutputLimit: 128})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			sent := make(chan string, 1)
			done := make(chan struct{})
			go func() {
				defer close(done)
				(&desktopModelSourceExecutor{}).handleRequest(ctx, DesktopModelSourceRPCFrame{Method: "ai.turn.prepared.refit", Params: raw}, func(frame DesktopModelSourceRPCFrame) error {
					var result desktopModelSourcePrepareResult
					if err := json.Unmarshal(frame.Result, &result); err != nil {
						return err
					}
					sent <- result.Handle
					if !accept {
						<-ctx.Done()
						return ctx.Err()
					}
					return nil
				}, store)
			}()
			child := <-sent
			if !accept {
				cancel()
			}
			<-done
			store.mu.Lock()
			_, retained := store.entries[child]
			store.mu.Unlock()
			wantClosed := int32(1)
			if accept {
				wantClosed = 0
			}
			if retained != accept || closed.Load() != wantClosed {
				t.Fatalf("accepted=%t retained=%t closed=%d", accept, retained, closed.Load())
			}
			store.closeAll()
		})
	}
}

func TestDesktopPreparedCanceledResultDoesNotExhaustCapacity(t *testing.T) {
	root := t.TempDir()
	configPath, secretsPath := filepath.Join(root, "config.json"), filepath.Join(root, "secrets.json")
	if err := config.Save(configPath, &config.Config{AI: &config.AIConfig{CurrentModelID: "fixture/gpt-4o", Providers: []config.AIProvider{{ID: "fixture", Type: "openai", BaseURL: "https://example.invalid", Models: []config.AIProviderModel{{ModelName: "gpt-4o", ContextWindow: 128000}}}}}}); err != nil {
		t.Fatal(err)
	}
	if err := settings.NewSecretsStore(secretsPath).SetAIProviderAPIKey("fixture", "fixture-key"); err != nil {
		t.Fatal(err)
	}
	executor := &desktopModelSourceExecutor{configPath: configPath, secretsPath: secretsPath}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err == nil {
			_ = executor.serve(t.Context(), ws)
		}
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	if err := ws.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
		t.Fatal(err)
	}
	params, err := json.Marshal(desktopModelSourceStreamRequest{Request: ModelGatewayRequest{Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "fixture"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	for i := range 80 {
		id := fmt.Sprintf("prepare-%d", i)
		if err := ws.WriteJSON(DesktopModelSourceRPCFrame{ProtocolVersion: DesktopModelSourceProtocolVersion, Type: "request", ID: id, Method: "ai.turn.prepare", Params: params}); err != nil {
			t.Fatal(err)
		}
		var part DesktopModelSourceRPCFrame
		if err := ws.ReadJSON(&part); err != nil {
			t.Fatal(err)
		}
		var response DesktopModelSourceRPCFrame
		var prepared desktopModelSourcePrepareResult
		if part.ID != id || !part.Final || json.Unmarshal(part.Part, &response) != nil || response.Type != "result" || json.Unmarshal(response.Result, &prepared) != nil || prepared.Handle == "" {
			t.Fatalf("candidate %d did not prepare: %+v", i, response)
		}
		if err := ws.WriteJSON(DesktopModelSourceRPCFrame{ProtocolVersion: DesktopModelSourceProtocolVersion, Type: "cancel", ID: id}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDesktopModelContinuationPreservesOpaqueState(t *testing.T) {
	for _, kind := range []string{"deepseek_responses_v1", providerContinuationKindOpenAIResponses, geminiStateKind, chatGPTStateKind} {
		t.Run(kind, func(t *testing.T) {
			gateway := &recordingPreparedGateway{}
			adapter := newFloretProviderAdapter(gateway, DesktopModelSourceProviderType, "desktop:model_test", ProviderControls{}, TurnBudgets{}, "")
			state := &flprovider.State{Kind: kind, ID: "response-1", ReusePolicy: flprovider.StateReuseCanonicalHistory, Attributes: map[string]string{"opaque": "original"}}
			prepared, err := adapter.Prepare(t.Context(), flprovider.Request{RunID: "run-continuation", PromptScopeID: "scope-continuation", PreviousState: state})
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			state.Kind, state.ID, state.Attributes["opaque"] = "mutated", "mutated", "mutated"
			stream, err := prepared.Stream(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
			}
			gateway.mu.Lock()
			defer gateway.mu.Unlock()
			if len(gateway.requests) != 1 {
				t.Fatalf("requests = %d", len(gateway.requests))
			}
			request := gateway.requests[0]
			want := &ModelGatewayState{Kind: kind, ID: "response-1", ReusePolicy: flprovider.StateReuseCanonicalHistory, Attributes: map[string]string{"opaque": "original"}}
			if request.Protocol != "" || !reflect.DeepEqual(request.PreviousState, want) {
				t.Fatalf("Desktop must forward frozen opaque state to its executor: %+v", request)
			}
		})
	}
}

// The real RPC client and executor run against a deterministic provider server.
// This catches state loss at either Desktop boundary, which direct adapter tests miss.
func TestDesktopModelContinuationEndToEnd(t *testing.T) {
	for _, tc := range []struct {
		name, provider, model string
		retry, continuation   bool
	}{
		{"deepseek_image", "deepseek", "deepseek-v4-flash-vision-exp", false, false},
		{"openai_enabled", "openai", "gpt-5-mini", false, true},
		{"openai_default_off", "openai", "gpt-5-mini", false, false},
		{"gemini", "google", "gemini-3.8-flash", false, false},
		{"deepseek_retry_restart", "deepseek", "deepseek-v4-flash-vision-exp", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests, effects atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				// Automatic titles use the same gateway but do not advance the tool fixture.
				var tools []json.RawMessage
				_ = json.Unmarshal(body["tools"], &tools)
				n := int32(0)
				if len(tools) > 0 {
					n = requests.Add(1)
				}
				if tc.retry && n == 2 {
					http.Error(w, "fixture provider unavailable", http.StatusBadRequest)
					return
				}
				if tc.retry && n == 3 {
					if strings.Count(string(body["input"]), "Inspect the available target.") != 1 || !strings.Contains(string(body["input"]), "Observed once.") {
						t.Error("Retry must retain one canonical user input and its confirmed tool result")
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if tc.provider == "google" {
					if r.URL.Path != "/chat/completions" {
						t.Errorf("route = %s", r.URL.Path)
					}
					if n > 1 && !strings.Contains(string(body["messages"]), `"thought_signature":"original-signature"`) {
						t.Error("lost Gemini signature")
					}
					delta := map[string]any{"content": "Continued."}
					finish := "stop"
					if n == 1 {
						delta = map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "inspect-call", "type": "function", "function": map[string]any{"name": "inspect", "arguments": "{}"}, "extra_content": map[string]any{"google": map[string]string{"thought_signature": "original-signature"}}}}}
						finish = "tool_calls"
					}
					writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"id": "gemini-response", "object": "chat.completion.chunk", "model": tc.model, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}})
					return
				}
				if r.URL.Path != "/responses" {
					t.Errorf("route = %s", r.URL.Path)
				}
				if tc.provider == "deepseek" {
					if _, ok := body["previous_response_id"]; ok {
						t.Error("DeepSeek received a server continuation ID")
					}
					if n == 2 && !strings.Contains(string(body["input"]), `"receipt":"original-reasoning"`) {
						t.Error("lost original DeepSeek reasoning")
					}
					if n > 1 {
						var input []map[string]json.RawMessage
						_ = json.Unmarshal(body["input"], &input)
						calls, results := 0, 0
						for _, item := range input {
							if string(item["call_id"]) != `"inspect-call"` {
								continue
							}
							switch string(item["type"]) {
							case `"function_call"`:
								calls++
							case `"function_call_output"`:
								results++
							}
						}
						if calls != 1 || results != 1 || !strings.Contains(string(body["input"]), testModelImageURI(t)) {
							t.Errorf("lost or duplicated tool/image history: calls=%d results=%d", calls, results)
						}
					}
				} else {
					if tc.continuation && n > 1 && !strings.HasPrefix(string(body["previous_response_id"]), `"response-`) {
						t.Errorf("OpenAI missing continuation: %s", body["previous_response_id"])
					}
					if !tc.continuation {
						if _, ok := body["previous_response_id"]; ok {
							t.Error("disabled OpenAI continuation sent previous_response_id")
						}
						if n > 1 && (!strings.Contains(string(body["input"]), "Inspect the available target.") || !strings.Contains(string(body["input"]), "Observed once.")) {
							t.Error("disabled OpenAI continuation lost canonical tool history")
						}
					}
				}
				output := `[ {"type":"message","role":"assistant","content":[{"type":"output_text","text":"Continued."}]} ]`
				if n == 1 {
					output = `[{"type":"function_call","id":"inspect-item","call_id":"inspect-call","name":"inspect","arguments":"{}"}]`
					if tc.provider == "deepseek" {
						output = `[{"type":"reasoning","receipt":"original-reasoning","content":[{"type":"reasoning_text","text":"Inspect first."}]},{"type":"function_call","id":"inspect-item","call_id":"inspect-call","name":"inspect","arguments":"{}"}]`
					}
				}
				fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response-%d\",\"status\":\"completed\",\"output\":%s}}\n\n", n, output)
			}))
			defer server.Close()
			gateway := desktopContinuationGateway(t, tc.provider, tc.model, server.URL, tc.continuation)
			tool := fltools.Define[struct{}](fltools.Definition{Name: "inspect", InputSchema: fltools.StrictObject(map[string]any{}, []string{}), ReadOnly: true, Permission: fltools.PermissionSpec{Mode: fltools.PermissionAllow}}, nil, nil, func(context.Context, fltools.Invocation[struct{}]) (fltools.Result, error) {
				effects.Add(1)
				result := fltools.Result{Text: "Observed once."}
				if tc.provider == "deepseek" {
					result.Attachments = []fltools.ArtifactRef{{ID: "fixture:screen", SafeLabel: "screen.png", MIME: "image/png", SizeBytes: 3}}
				}
				return result, nil
			})
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "test", Name: "Test"}, SystemPrompt: "Inspect once.", Context: flconfig.ContextPolicy{ContextWindowTokens: 128000}}, gateway, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "threads.sqlite")
			open := func() (*flruntime.Host, flruntime.ThreadService) {
				host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path)})
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
			if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "send", Input: flruntime.UserInput{Text: "Inspect the available target."}}); err != nil {
				t.Fatal(err)
			}
			first := waitDesktopContinuation(t, service, created.ThreadID)
			if tc.retry {
				if first.LastOutcome == nil || *first.LastOutcome != flruntime.TurnOutcomeFailed || requests.Load() != 2 {
					t.Fatalf("expected provider failure after the completed tool: %+v requests=%d", first.Failure, requests.Load())
				}
			} else if first.Failure != nil {
				t.Fatalf("tool continuation failed: %+v", first.Failure)
			}
			if err := host.Shutdown(context.Background()); err != nil {
				t.Fatal(err)
			}
			host, service = open()
			before, err := service.View(t.Context(), created.ThreadID)
			if err != nil {
				t.Fatal(err)
			}
			if tc.retry {
				_, err = service.Retry(t.Context(), flruntime.RetryInput{ThreadID: created.ThreadID, SourceTurnID: first.TurnID, RequestKey: "retry"})
			} else {
				_, err = service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, RequestKey: "next", Input: flruntime.UserInput{Text: "Continue after restart."}})
			}
			if err != nil {
				t.Fatal(err)
			}
			after := waitDesktopContinuation(t, service, created.ThreadID)
			if after.Failure != nil || after.LastOutcome == nil || *after.LastOutcome != flruntime.TurnOutcomeCompleted || requests.Load() != 3 || effects.Load() != 1 {
				t.Fatalf("continuation: outcome=%v failure=%+v requests=%d effects=%d", after.LastOutcome, after.Failure, requests.Load(), effects.Load())
			}
			for _, previous := range before.Items {
				found := false
				for _, item := range after.Items {
					found = found || item.ID == previous.ID
				}
				if !found {
					t.Fatalf("lost historical item %s", previous.ID)
				}
			}
		})
	}
}

func waitDesktopContinuation(t *testing.T, service flruntime.ThreadService, id flidentity.ThreadID) flruntime.ThreadView {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		view, err := service.View(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		if view.Activity == flruntime.ThreadActivityIdle && view.LastOutcome != nil {
			return view
		}
		if time.Now().After(deadline) {
			t.Fatalf("thread did not settle: %+v", view)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func desktopContinuationGateway(t *testing.T, providerType, model, baseURL string, continuation bool) *floretProviderAdapter {
	t.Helper()
	root := t.TempDir()
	configPath, secretsPath := filepath.Join(root, "config.json"), filepath.Join(root, "secrets.json")
	var responsesContinuation *bool
	if continuation {
		responsesContinuation = &continuation
	}
	if err := config.Save(configPath, &config.Config{AI: &config.AIConfig{CurrentModelID: "fixture/" + model, Providers: []config.AIProvider{{ID: "fixture", Type: providerType, BaseURL: baseURL, ResponsesContinuation: responsesContinuation, Models: []config.AIProviderModel{{ModelName: model, ContextWindow: 128000}}}}}}); err != nil {
		t.Fatal(err)
	}
	if err := settings.NewSecretsStore(secretsPath).SetAIProviderAPIKey("fixture", "fixture-key"); err != nil {
		t.Fatal(err)
	}
	executor := &desktopModelSourceExecutor{configPath: configPath, secretsPath: secretsPath}
	snapshot, _, _, _, err := executor.snapshot()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	client := newDesktopModelSourceClient(nil)
	session := DesktopModelSourceSession{SessionID: "fixture", ProtocolVersion: DesktopModelSourceProtocolVersion, Source: DesktopModelSourceDefaultSource, ExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}
	if _, err := client.Prepare(session); err != nil {
		t.Fatal(err)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_ = client.ServeRPC(ctx, session, conn, nil)
	}))
	ws, _, err := websocket.DefaultDialer.DialContext(ctx, "ws"+strings.TrimPrefix(rpc.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	executor.session = session
	done := make(chan struct{})
	go func() { defer close(done); _ = executor.serve(ctx, ws) }()
	t.Cleanup(func() { cancel(); _ = ws.Close(); rpc.Close(); <-done })
	deadline := time.Now().Add(3 * time.Second)
	for !client.isConnected() {
		if time.Now().After(deadline) {
			t.Fatal("Desktop RPC did not connect")
		}
		time.Sleep(time.Millisecond)
	}
	adapter := newFloretProviderAdapter(client.ModelGateway(snapshot.CurrentModel), DesktopModelSourceProviderType, snapshot.CurrentModel, ProviderControls{ReasoningCapability: config.AIReasoningCapabilityForModel(providerType, model)}, TurnBudgets{}, "")
	adapter.identity = flprovider.Identity{Provider: DesktopModelSourceProviderType, Model: snapshot.CurrentModel, StateCompatibilityKey: "desktop-continuation:" + model}
	adapter.supportsImageInput = true
	adapter.attachmentResolver = func(context.Context, flprovider.Attachment) (ContentPart, error) {
		return ContentPart{Type: "image", MimeType: "image/png", FileURI: testModelImageURI(t)}, nil
	}
	return adapter
}

func TestModelContinuationRejectsInvalidStateBeforeHTTP(t *testing.T) {
	validOpenAI := &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "response"}
	for _, tc := range []struct {
		name, provider, model, protocol string
		state                           *ModelGatewayState
	}{
		{"openai_kind", "openai", "gpt-5-mini", "", &ModelGatewayState{Kind: "unknown", ID: "response"}},
		{"openai_id", "openai", "gpt-5-mini", "", &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses}},
		{"openai_attributes", "openai", "gpt-5-mini", "", &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "response", Attributes: map[string]string{"history": "unexpected"}}},
		{"openai_chat_override", "openai", "gpt-5-mini", "openai-chat-completions", validOpenAI},
		{"chat", "openai_compatible", "chat", "", validOpenAI},
		{"moonshot", "moonshot", "kimi-k3", "", validOpenAI},
		{"kimi_code", "kimi_code", "k3.1-pro", "", validOpenAI},
		{"anthropic", "anthropic", "claude-sonnet-4-5", "", validOpenAI},
		{"deepseek_kind", "deepseek", "deepseek-v4-pro", "", validOpenAI},
		{"deepseek_history", "deepseek", "deepseek-v4-pro", "", &ModelGatewayState{Kind: "deepseek_responses_v1", ID: "response", Attributes: map[string]string{"history": "{"}}},
		{"gemini_kind", "google", "gemini-3.8-flash", "", validOpenAI},
		{"gemini_signatures", "google", "gemini-3.8-flash", "", &ModelGatewayState{Kind: geminiStateKind, ID: "gemini-3.8-flash", Attributes: map[string]string{"tool_signatures": "{"}}},
		{"platform", platformGatewayProviderType, "platform-model", "", validOpenAI},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); http.Error(w, "must not send", 400) }))
			defer server.Close()
			var gateway ModelGateway
			var err error
			if tc.provider == platformGatewayProviderType {
				gateway, err = newPlatformGatewayProvider(server.URL, "fixture", tc.model)
			} else {
				gateway, err = newProviderAdapter(tc.provider, server.URL, "fixture", nil)
			}
			if err != nil {
				t.Fatal(err)
			}
			enabled := true
			configureResponsesContinuation(gateway, config.AIProvider{Type: tc.provider, ResponsesContinuation: &enabled})
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: tc.model, Protocol: tc.protocol, PreviousState: tc.state, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}}, nil)
			if err == nil || requests.Load() != 0 {
				t.Fatalf("invalid state must fail before HTTP: err=%v requests=%d", err, requests.Load())
			}
		})
	}
}

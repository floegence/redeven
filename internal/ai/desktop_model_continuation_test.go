package ai

import (
	"context"
	"encoding/json"
	"fmt"
	flconfig "github.com/floegence/floret/v7/config"
	flidentity "github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestDesktopModelContinuationPreservesOpaqueState(t *testing.T) {
	for _, kind := range []string{"deepseek_responses_v1", providerContinuationKindOpenAIResponses, geminiStateKind} {
		t.Run(kind, func(t *testing.T) {
			gateway := &recordingPreparedGateway{}
			adapter := newFloretProviderAdapter(gateway, DesktopModelSourceProviderType, "desktop:model_test", ProviderControls{}, TurnBudgets{}, "")
			state := &flprovider.State{Kind: kind, ID: "response-1", Attributes: map[string]string{"opaque": "original"}}
			prepared, err := adapter.Prepare(t.Context(), flprovider.Request{PreviousState: state})
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
			want := &ModelGatewayState{Kind: kind, ID: "response-1", Attributes: map[string]string{"opaque": "original"}}
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
		retry                 bool
	}{
		{"deepseek_image", "deepseek", "deepseek-v4-flash-vision-exp", false},
		{"openai", "openai", "gpt-5-mini", false},
		{"gemini", "google", "gemini-3.8-flash", false},
		{"deepseek_retry_restart", "deepseek", "deepseek-v4-flash-vision-exp", true},
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
						if calls != 1 || results != 1 || !strings.Contains(string(body["input"]), "data:image/png;base64,AQID") {
							t.Errorf("lost or duplicated tool/image history: calls=%d results=%d", calls, results)
						}
					}
				} else if n > 1 && !strings.HasPrefix(string(body["previous_response_id"]), `"response-`) {
					t.Errorf("OpenAI missing continuation: %s", body["previous_response_id"])
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
			gateway := desktopContinuationGateway(t, tc.provider, tc.model, server.URL)
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
	deadline := time.Now().Add(5 * time.Second)
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

func desktopContinuationGateway(t *testing.T, providerType, model, baseURL string) *floretProviderAdapter {
	t.Helper()
	root := t.TempDir()
	configPath, secretsPath := filepath.Join(root, "config.json"), filepath.Join(root, "secrets.json")
	if err := config.Save(configPath, &config.Config{AI: &config.AIConfig{CurrentModelID: "fixture/" + model, Providers: []config.AIProvider{{ID: "fixture", Type: providerType, BaseURL: baseURL, Models: []config.AIProviderModel{{ModelName: model, ContextWindow: 128000}}}}}}); err != nil {
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
		return ContentPart{Type: "image", MimeType: "image/png", FileURI: "data:image/png;base64,AQID"}, nil
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
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: tc.model, Protocol: tc.protocol, PreviousState: tc.state, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}}, nil)
			if err == nil || requests.Load() != 0 {
				t.Fatalf("invalid state must fail before HTTP: err=%v requests=%d", err, requests.Load())
			}
		})
	}
}

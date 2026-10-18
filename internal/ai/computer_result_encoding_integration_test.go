package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

type encodingComputerExecutor struct {
	effects      atomic.Int32
	observations atomic.Int32
	oversized    bool
	failure      error
}

func (e *encodingComputerExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	result := TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "fixture"}
	if call.ToolName == "computer.exec" {
		e.effects.Add(1) // A real, counted effect precedes the malformed optional result.
		result.executionFacts.completedActions = []string{"click"}
		result.executionFacts.needsObservation = true
		if e.oversized {
			result.Result = map[string]any{"logs": strings.Repeat("x", computerResultMaxBytes)}
		} else {
			result.Result = map[string]any{"invalid": math.NaN(), "script": "must never leak"}
		}
		return result, e.failure
	}
	e.observations.Add(1)
	result.Result = computerResultFixture()
	result.Result.(map[string]any)["complete_text"] = strings.Repeat("x", 70<<10)
	return result, nil
}

func encodingIntegrationOptions(t *testing.T, provider string, executor *encodingComputerExecutor) Options {
	t.Helper()
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	t.Logf("owned runtime commit=working-tree pid=%d provider=%s state=%s", os.Getpid(), provider, state)
	return Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: registry, TargetToolExecutor: executor,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}}
}
func writeEncodingIntegrationCall(w http.ResponseWriter, name, id, args string) {
	flush := w.(http.Flusher)
	item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": name, "arguments": args}
	writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
	writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
	writeAskUserIntegrationCompletedResponse(w, flush, id)
}

// Decode only the provider's documented output text boundary. Nested JSON
// strings are deliberately never decoded by this assertion.
func assertProviderComputerTypes(t *testing.T, request map[string]any) {
	t.Helper()
	found := false
	for _, raw := range request["input"].([]any) {
		item, _ := raw.(map[string]any)
		if item["type"] != "function_call_output" || item["call_id"] != "observe" {
			continue
		}
		output, ok := item["output"].(string)
		if !ok {
			t.Fatalf("unexpected output boundary: %#v", item)
		}
		var payload map[string]any
		decoder := json.NewDecoder(strings.NewReader(output))
		decoder.UseNumber()
		if err := decoder.Decode(&payload); err != nil {
			t.Fatalf("invalid model output: %q (%v)", output, err)
		}
		assertComputerResultTypes(t, payload)
		if len(payload["data"].(map[string]any)["complete_text"].(string)) != 70<<10 {
			t.Fatal("valid computer output was clipped")
		}
		found = true
	}
	if !found {
		t.Fatalf("provider omitted observe result: %#v", request["input"])
	}
}
func TestComputerProviderPreservesTypesAcrossHistoryRetryAndRestart(t *testing.T) {
	var requests atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if defs, _ := body["tools"].([]any); len(defs) > 0 {
			requests.Add(1)
			hasOutput := false
			for _, raw := range body["input"].([]any) {
				item, _ := raw.(map[string]any)
				if item["type"] == "function_call_output" && item["call_id"] == "observe" {
					hasOutput = true
				}
			}
			if !hasOutput {
				writeEncodingIntegrationCall(w, "computer_observe", "observe", "{\"description\":\"Inspect current state\"}")
				return
			}
			assertProviderComputerTypes(t, body)
		}
		writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Observed exact types.")
	}))
	defer provider.Close()
	options := encodingIntegrationOptions(t, provider.URL, &encodingComputerExecutor{})
	svc, err := NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "fidelity", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	send := func(key string) {
		t.Helper()
		if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: key, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Inspect current state."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
			t.Fatal(err)
		}
		waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
		current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for _, item := range current.Items {
			if item.Activity == nil || item.Activity.ToolID != "observe" {
				continue
			}
			result, found, err := svc.threadRuntime.(flruntime.ThreadToolResultReader).LookupToolResult(t.Context(), flruntime.LookupToolResultInput{ThreadID: current.ThreadID, TurnID: item.TurnID, RunID: item.RunID, ToolCallID: "observe"})
			if err != nil || !found {
				t.Fatalf("canonical result missing: %v", err)
			}
			payload, err := decodeToolJSON([]byte(result.Content))
			if err != nil {
				t.Fatal(err)
			}
			assertComputerResultTypes(t, payload.(map[string]any))
			count++
		}
		if count == 0 {
			t.Fatal("canonical observation identity missing")
		}
	}
	send("first")
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.threadRuntime.Retry(t.Context(), flruntime.RetryInput{ThreadID: view.ThreadID, SourceTurnID: view.TurnID, RequestKey: "retry-fidelity"}); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err = NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	send("after-restart")
	if requests.Load() != 5 {
		t.Fatalf("requests=%d", requests.Load())
	}
}

func TestComputerCompletedEncodingFailureWaitsAndNeverReplays(t *testing.T) {
	for _, mode := range []string{"continue", "stop", "oversize", "unknown"} {
		t.Run(mode, func(t *testing.T) {
			var requests atomic.Int32
			var mu sync.Mutex
			order := []string{}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if defs, _ := body["tools"].([]any); len(defs) > 0 {
					switch requests.Add(1) {
					case 1:
						writeEncodingIntegrationCall(w, "computer_exec", "effect", "{\"code\":\"await ui.click(1,1);\",\"description\":\"Update fixture once\"}")
						return
					case 2:
						mu.Lock()
						order = append(order, "observe")
						mu.Unlock()
						writeEncodingIntegrationCall(w, "computer_observe", "observe", "{\"description\":\"Inspect current state\"}")
						return
					case 3:
						assertProviderComputerTypes(t, body)
					}
				}
				writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "done", "Checked current state without replay.")
			}))
			defer provider.Close()
			executor := &encodingComputerExecutor{oversized: mode == "oversize"}
			if mode == "unknown" {
				executor.failure = errComputerEffectUnknown
			}
			options := encodingIntegrationOptions(t, provider.URL, executor)
			svc, err := NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "encoding failure", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "effect", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Update fixture once."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
				t.Fatal(err)
			}
			if mode == "unknown" {
				final := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
				if final.WaitingPrompt != nil || executor.effects.Load() != 1 || requests.Load() != 3 {
					t.Fatalf("uncertainty did not continue once: %+v requests=%d effects=%d", final, requests.Load(), executor.effects.Load())
				}
				return
			}
			waiting := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "waiting_user" || v.RunStatus == "failed" })
			if waiting.WaitingPrompt == nil {
				t.Fatalf("no pause: %+v", waiting)
			}
			current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
			if err != nil {
				t.Fatal(err)
			}
			canonical, found, err := svc.threadRuntime.(flruntime.ThreadToolResultReader).LookupToolResult(t.Context(), flruntime.LookupToolResultInput{ThreadID: current.ThreadID, TurnID: current.TurnID, RunID: current.RunID, ToolCallID: "effect"})
			if err != nil || !found || canonical.Status != "error" || strings.Contains(canonical.Content, "must never leak") {
				t.Fatalf("canonical error changed: %+v %v", canonical, err)
			}

			if requests.Load() != 1 || executor.effects.Load() != 1 {
				t.Fatal("provider continued before response")
			}
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			restored, err := svc.GetThread(t.Context(), meta, thread.ThreadID)
			if err != nil || restored.WaitingPrompt == nil {
				t.Fatalf("restart lost pause: %+v %v", restored, err)
			}
			if requests.Load() != 1 || executor.effects.Load() != 1 {
				t.Fatal("restart replayed")
			}
			if mode == "stop" {
				current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
				if err != nil {
					t.Fatal(err)
				}
				if _, err := svc.threadRuntime.Cancel(t.Context(), flruntime.CancelInput{ThreadID: current.ThreadID, RequestKey: "stop-encoding"}); err != nil {
					t.Fatal(err)
				}
				waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus != "waiting_user" && v.RunStatus != "running" })
				if requests.Load() != 1 {
					t.Fatal("Stop requested provider")
				}
				return
			}
			prompt := restored.WaitingPrompt
			response := SubmitRequestUserInputResponseRequest{ThreadID: thread.ThreadID, Response: RequestUserInputResponse{PromptID: prompt.PromptID, Answers: map[string]RequestUserInputAnswer{"tool_result_checked": {Text: "Checked, continue"}}}}
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
				t.Fatal(err)
			}
			waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" })
			if _, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, response); err != nil {
				t.Fatal(err)
			}
			if executor.effects.Load() != 1 || executor.observations.Load() != 1 || requests.Load() != 3 {
				t.Fatalf("effect=%d observe=%d requests=%d", executor.effects.Load(), executor.observations.Load(), requests.Load())
			}
			mu.Lock()
			defer mu.Unlock()
			if len(order) != 1 || order[0] != "observe" {
				t.Fatal("resume omitted read-only verification")
			}
		})
	}
}

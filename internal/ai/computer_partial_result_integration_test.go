package ai

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/floegence/floret/v7/observation"
	fltools "github.com/floegence/floret/v7/tools"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

type partialComputerResultExecutor struct {
	failure error
	calls   atomic.Int32
}

func (e *partialComputerResultExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.calls.Add(1)
	return TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "fixture", Result: map[string]any{"completed_actions": []string{"prefix-confirmed"}, "action_executed": true, "completed": false, "operations": 1, "script_error": "SCRIPT_STOPPED", "logs": []any{[]any{"Search field found"}}, "observation": map[string]any{"nodes": []any{map[string]any{"role": "textbox", "name": "Search"}}}}}, e.failure
}
func TestComputerPartialErrorAndUnknownOutcomeSurviveRestart(t *testing.T) {
	for _, name := range []string{"timeout", "unknown_effect", "script_failure"} {
		uncertain := name == "unknown_effect"
		t.Run(name, func(t *testing.T) {
			var requests atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if json.NewDecoder(req.Body).Decode(&body) != nil {
					t.Error("invalid provider request")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flush := w.(http.Flusher)
				if defs, _ := body["tools"].([]any); len(defs) > 0 && requests.Add(1) == 1 {
					item := map[string]any{"type": "function_call", "id": "script", "call_id": "script", "name": "computer_exec", "arguments": `{"code":"await ui.click(1,1);","description":"Update the fixture"}`}
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					writeOpenAISSEJSON(w, flush, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					writeAskUserIntegrationCompletedResponse(w, flush, "script")
					return
				}
				writeAskUserIntegrationTextResponse(w, flush, "done", "The confirmed prefix is preserved; the batch did not finish.")
			}))
			defer provider.Close()
			registry := NewTargetRegistry()
			if err := registry.Register(TargetDescriptor{ID: "browser-main", Kind: "browser.managed", DisplayName: "Fixture", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
				t.Fatal(err)
			}
			executor := &partialComputerResultExecutor{failure: context.DeadlineExceeded}
			if uncertain {
				executor.failure = errComputerEffectUnknown
			}
			if name == "script_failure" {
				executor.failure = &computerScriptExecutionError{code: "INVALID_COMPUTER_ARGUMENTS"}
			}
			state := t.TempDir()
			t.Logf("owned runtime pid=%d provider=%s state=%s", os.Getpid(), provider.URL, state)
			options := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: registry, TargetToolExecutor: executor,
				Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "fixture", true, nil }, RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second}
			svc, err := NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = svc.Close() }()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "partial batch", "openai/gpt-5-mini", "", "")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "partial", Model: "openai/gpt-5-mini", Input: RunInput{Text: "Update the fixture once."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
				t.Fatal(err)
			}
			view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" || view.RunStatus == "failed" })
			if uncertain && view.RunErrorCode != runErrorCodeFloretEffectOutcomeUnknown {
				t.Fatalf("uncertain effect must be terminal: %s %s", view.RunStatus, view.RunError)
			}
			check := func() {
				t.Helper()
				if uncertain {
					// Floret seals an uncertain invocation with a fixed terminal
					// result, not an ordinary partial-success result. Verify that
					// this authority boundary survives restart and rejects replay.
					current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
					if err != nil || current.Failure == nil || current.Failure.Code != flruntime.ThreadTurnFailureEffectOutcomeUnknown {
						t.Fatalf("unknown outcome lost: %+v %v", current, err)
					}
					if _, err := svc.threadRuntime.Retry(t.Context(), flruntime.RetryInput{ThreadID: current.ThreadID, SourceTurnID: current.TurnID, RequestKey: "never-replay"}); !errors.Is(err, flruntime.ErrEffectOutcomeUnknown) {
						t.Fatalf("unknown outcome became retryable: %v", err)
					}
					return
				}
				history, err := svc.threadRuntime.History(t.Context(), identity.ThreadID(thread.ThreadID), "", 100)
				if err != nil {
					t.Fatal(err)
				}
				body, err := json.Marshal(history)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(body), "prefix-confirmed") {
					t.Fatalf("confirmed prefix missing from canonical history: %s", body)
				}
				found := false
				for _, item := range history.Items {
					if item.Activity == nil || item.Activity.ToolID != "script" {
						continue
					}
					found = true
					activity := publicActivityItem(*item.Activity)
					if activity.Status != observation.ActivityStatusError || activity.Presentation.Label != "Update the fixture" {
						t.Fatalf("wrong script intent/status: %+v", activity)
					}
					payload := activity.Presentation.Payload.(fltools.StructuredActivityPayload)
					if len(payload.Inputs) != 1 || payload.Inputs[0].Content != "await ui.click(1,1);" || payload.Inputs[0].Language != "javascript" || !payload.RowsProvided || len(payload.Rows) < 3 {
						t.Fatalf("details lost in history or restart: %+v", payload)
					}
				}
				if !found {
					t.Fatal("canonical tool activity missing")
				}
				if directory := os.Getenv("REDEVEN_TOOL_ACTIVITY_EVIDENCE_DIR"); directory != "" {
					if err := os.MkdirAll(directory, 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(directory, name+"-history.json"), body, 0600); err != nil {
						t.Fatal(err)
					}
				}

			}
			check()
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc, err = NewService(options)
			if err != nil {
				t.Fatal(err)
			}
			check()
			if executor.calls.Load() != 1 {
				t.Fatalf("partial batch replayed %d times", executor.calls.Load())
			}
		})
	}
}

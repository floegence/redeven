package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestComputerParallelSelectionReturnsPairedFeedbackWithoutEffects(t *testing.T) {
	var requests atomic.Int32
	var candidateRef string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if defs, _ := body["tools"].([]any); len(defs) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Computer batch")
			return
		}
		switch requests.Add(1) {
		case 1:
			for i, call := range []struct {
				name string
				args map[string]any
			}{
				{"computer_select_target", map[string]any{"candidate_ref": candidateRef, "description": "Select task page"}},
				{"computer_exec", map[string]any{"code": "await ui.help('core')", "description": "Read help"}},
			} {
				args, _ := json.Marshal(call.args)
				id := call.name
				item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": call.name, "arguments": string(args)}
				writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": i, "item": item})
				writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
			}
			writeAskUserIntegrationCompletedResponse(w, flusher, "parallel")
		case 2:
			outputs := collectOpenAIFunctionOutputs(body["input"])
			if len(outputs) != 2 {
				t.Errorf("paired outputs: %+v", outputs)
			}
			for _, out := range outputs {
				if !strings.Contains(out.Output, "BATCH_CONFLICT") || !strings.Contains(out.Output, "no action was executed") {
					t.Errorf("batch feedback: %+v", out)
				}
			}
			item := map[string]any{"type": "function_call", "id": "observe", "call_id": "observe", "name": "computer_screenshot", "arguments": `{"description":"Inspect original target"}`}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeAskUserIntegrationCompletedResponse(w, flusher, "single")
		default:
			writeAskUserIntegrationTextResponse(w, flusher, "done", "Recovered without changing the target.")
		}
	}))
	defer server.Close()
	registry := NewTargetRegistry()
	for _, id := range []string{"browser-main", "browser-other"} {
		if err := registry.Register(TargetDescriptor{ID: id, Kind: "browser.managed", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
			t.Fatal(err)
		}
	}
	executor := &computerIdentityExecutor{calls: make(chan TargetToolCall, 4)}
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor, "browser-other": executor}, t.TempDir())
	installBrowserStub(t, host)
	defer host.Close()
	state := t.TempDir()
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Computer batch", "openai/gpt-5-mini", "full_access", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.snapshotThreadStore().SetComputerTarget(t.Context(), thread.ThreadID, "browser-main"); err != nil {
		t.Fatal(err)
	}
	candidate, err := host.rememberComputerCandidate(thread.ThreadID, ComputerCandidate{TargetID: "browser-other", Kind: "browser.managed", State: "ready"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	candidateRef = candidate.CandidateRef
	terminal, err := runTypedTurnForTest(t, context.Background(), svc, meta, "batch", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Inspect the task page."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess, ToolAllowlist: legacyComputerFixtureTools()}})
	if err != nil {
		t.Fatalf("turn: %v; failure=%+v", err, terminal.Failure)
	}
	if requests.Load() != 3 {
		t.Fatalf("requests=%d", requests.Load())
	}
	if len(executor.calls) != 1 {
		t.Fatalf("target calls=%d, want only sequential screenshot", len(executor.calls))
	}
	call := <-executor.calls
	if call.TargetID != "browser-main" || call.ToolName != "computer.screenshot" {
		t.Fatalf("unexpected effect: %+v", call)
	}
	bound, err := svc.snapshotThreadStore().GetComputerTarget(t.Context(), thread.ThreadID)
	if err != nil || bound != "browser-main" {
		t.Fatalf("batch changed target: %s %v", bound, err)
	}
}

func TestComputerMixedBatchPreservesIndependentTools(t *testing.T) {
	for _, sibling := range []struct {
		name string
		args map[string]any
	}{
		{"terminal_exec", map[string]any{"command": "printf independent", "description": "Read independent fixture"}},
		{"goal", map[string]any{"operation": "set", "expected_version": 0, "text": "Inspect the isolated fixture."}},
	} {
		t.Run(sibling.name, func(t *testing.T) {

			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				flusher := w.(http.Flusher)
				if defs, _ := body["tools"].([]any); len(defs) == 0 {
					writeAskUserIntegrationTextResponse(w, flusher, "title", "Computer batch")
					return
				}
				switch requests.Add(1) {
				case 1:
					for i, call := range []struct {
						name string
						args map[string]any
					}{
						{sibling.name, sibling.args},
						{"computer_key", map[string]any{"key": "Escape", "description": "Exercise selected fixture"}},
					} {
						args, _ := json.Marshal(call.args)
						id := call.name
						item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": call.name, "arguments": string(args)}
						writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": i, "item": item})
						writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": i, "item": item})
					}
					writeAskUserIntegrationCompletedResponse(w, flusher, "parallel")
				case 2:
					outputs := collectOpenAIFunctionOutputs(body["input"])
					if len(outputs) != 2 {
						t.Errorf("paired outputs: %+v", outputs)
					}
					for _, out := range outputs {
						if strings.Contains(out.Output, "BATCH_CONFLICT") || strings.Contains(out.Output, "ERROR:") {
							t.Errorf("independent batch rejected: %+v", out)
						}
					}
					if sibling.name == "goal" {
						args, _ := json.Marshal(map[string]any{"operation": "review", "expected_version": 1, "outcome": "completed", "evidence": "The isolated computer action completed."})
						item := map[string]any{"type": "function_call", "id": "review", "call_id": "review", "name": "goal", "arguments": string(args)}
						writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
						writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
						writeAskUserIntegrationCompletedResponse(w, flusher, "review")
					} else {
						writeAskUserIntegrationTextResponse(w, flusher, "done", "Independent outputs verified.")
					}
				default:
					writeAskUserIntegrationTextResponse(w, flusher, "done", "Recovered without changing the target.")
				}
			}))
			defer server.Close()
			registry := NewTargetRegistry()
			for _, id := range []string{"browser-main", "browser-other"} {
				if err := registry.Register(TargetDescriptor{ID: id, Kind: "browser.managed", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
					t.Fatal(err)
				}
			}
			executor := &computerIdentityExecutor{calls: make(chan TargetToolCall, 4)}
			host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"browser-main": executor, "browser-other": executor}, t.TempDir())
			installBrowserStub(t, host)
			defer host.Close()
			state := t.TempDir()
			svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
				Config:                &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: server.URL + "/v1", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}}}}},
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second}})
			if err != nil {
				t.Fatal(err)
			}
			defer svc.Close()
			meta := testSendTurnMeta()
			thread, err := svc.CreateThread(t.Context(), meta, "Computer batch", "openai/gpt-5-mini", "full_access", "")
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.snapshotThreadStore().SetComputerTarget(t.Context(), thread.ThreadID, "browser-main"); err != nil {
				t.Fatal(err)
			}
			_, err = host.rememberComputerCandidate(thread.ThreadID, ComputerCandidate{TargetID: "browser-other", Kind: "browser.managed", State: "ready"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			terminal, err := runTypedTurnForTest(t, context.Background(), svc, meta, "batch", RunStartRequest{ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Inspect the task page."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess, ToolAllowlist: append(legacyComputerFixtureTools(), "terminal.exec")}})
			if err != nil {
				t.Fatalf("turn: %v; failure=%+v", err, terminal.Failure)
			}
			wantRequests := int32(2)
			if sibling.name == "goal" {
				wantRequests = 3
			}
			if requests.Load() != wantRequests {
				t.Fatalf("requests=%d", requests.Load())
			}
			if len(executor.calls) != 1 {
				t.Fatalf("target calls=%d, want one isolated input dispatch", len(executor.calls))
			}
			call := <-executor.calls
			if call.TargetID != "browser-main" || call.ToolName != "computer.key" {
				t.Fatalf("unexpected effect: %+v", call)
			}
			bound, err := svc.snapshotThreadStore().GetComputerTarget(t.Context(), thread.ThreadID)
			if err != nil || bound != "browser-main" {
				t.Fatalf("batch changed target: %s %v", bound, err)
			}
		})
	}
}

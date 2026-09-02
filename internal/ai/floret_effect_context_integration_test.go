package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

type openAIFunctionOutput struct {
	CallID string
	Output string
}

func TestHostedAgentRunLabelsAuthorizeParallelEffects(t *testing.T) {
	t.Parallel()

	var mainCalls atomic.Int32
	var outputMu sync.Mutex
	var observedOutputs []openAIFunctionOutput
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)

		tools, _ := request["tools"].([]any)
		if len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "resp_parallel_effect_title", "Parallel effects")
			return
		}
		switch mainCalls.Add(1) {
		case 1:
			calls := []struct {
				ID      string
				CallID  string
				Command string
			}{
				{ID: "fc_effect_one", CallID: "call_effect_one", Command: "printf effect-one"},
				{ID: "fc_effect_two", CallID: "call_effect_two", Command: "printf effect-two"},
			}
			for index, call := range calls {
				arguments, _ := json.Marshal(map[string]any{"command": call.Command})
				item := map[string]any{
					"type": "function_call", "id": call.ID, "call_id": call.CallID,
					"name": "terminal_exec", "arguments": string(arguments),
				}
				writeOpenAISSEJSON(w, flusher, map[string]any{
					"type": "response.output_item.added", "output_index": index, "item": item,
				})
				writeOpenAISSEJSON(w, flusher, map[string]any{
					"type": "response.output_item.done", "output_index": index, "item": item,
				})
			}
			writeAskUserIntegrationCompletedResponse(w, flusher, "resp_parallel_effect_calls")
		case 2:
			outputMu.Lock()
			observedOutputs = collectOpenAIFunctionOutputs(request["input"])
			outputMu.Unlock()
			writeAskUserIntegrationTextResponse(w, flusher, "resp_parallel_effect_done", "Both effects completed.")
		default:
			t.Fatalf("unexpected main provider request %d", mainCalls.Load())
		}
	}))
	t.Cleanup(providerServer.Close)

	stateDir := t.TempDir()
	meta := &session.Meta{
		EndpointID: "env_parallel_effect_context", ChannelID: "channel_parallel_effect_context",
		NamespacePublicID: "namespace_parallel_effect_context", UserPublicID: "user_parallel_effect_context",
		UserEmail: "parallel-effect@example.com", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true,
	}
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{
			CurrentModelID: "openai/gpt-5-mini",
			Providers: []config.AIProvider{{
				ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: providerServer.URL + "/v1",
				Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			}},
		},
		RunMaxWallTime: 5 * time.Second, RunIdleTimeout: 5 * time.Second, PersistOpTimeout: 2 * time.Second,
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	thread, err := svc.CreateThread(context.Background(), meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatalf("SetThreadPermissionType: %v", err)
	}
	terminal, err := runTypedTurnForTest(t, context.Background(), svc, meta, "request_parallel_effect_context", RunStartRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Run both checks."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil {
		t.Fatalf("parallel effect turn: %v; failure=%#v main_calls=%d", err, terminal.Failure, mainCalls.Load())
	}
	if mainCalls.Load() != 2 {
		t.Fatalf("main provider calls=%d, want effect request and final response", mainCalls.Load())
	}
	outputMu.Lock()
	defer outputMu.Unlock()
	if len(observedOutputs) != 2 {
		t.Fatalf("function outputs=%#v, want two authorized handler results", observedOutputs)
	}
	for index, want := range []openAIFunctionOutput{
		{CallID: "call_effect_one", Output: "effect-one"},
		{CallID: "call_effect_two", Output: "effect-two"},
	} {
		got := observedOutputs[index]
		if got.CallID != want.CallID || !strings.Contains(got.Output, want.Output) {
			t.Fatalf("function output[%d]=%#v, want call %q containing %q", index, got, want.CallID, want.Output)
		}
		if strings.Contains(got.Output, "authorization_unavailable") || strings.Contains(got.Output, "permission snapshot identity is incomplete") {
			t.Fatalf("function output[%d] lost its hosted authorization context: %s", index, got.Output)
		}
	}
	requireAssistantTimelineTextContains(t, context.Background(), svc, meta, thread.ThreadID, "Both effects completed.")
}

func TestPermissionRefreshKeepsAdmittedSnapshotIdentity(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		EndpointID: "endpoint_stable_snapshot", ThreadID: "thread_stable_snapshot",
		RunID: "provisional_run", ExecutionKey: "request_stable_snapshot",
	})
	admitted, err := r.freezePermissionSnapshot(buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil))
	if err != nil {
		t.Fatalf("freeze admitted snapshot: %v", err)
	}
	if err := r.observeFloretCanonicalIdentity("canonical_run", "thread_stable_snapshot", "canonical_turn"); err != nil {
		t.Fatalf("observe canonical identity: %v", err)
	}
	refreshed, err := r.preparePermissionSnapshot(buildPermissionSnapshot(FlowerPermissionFullAccess, nil, nil))
	if err != nil {
		t.Fatalf("prepare current permission snapshot: %v", err)
	}
	if refreshed.SnapshotID != admitted.SnapshotID {
		t.Fatalf("permission refresh rebound snapshot id from %q to %q", admitted.SnapshotID, refreshed.SnapshotID)
	}
	current := r.currentPermissionSnapshot()
	if current.SnapshotID != admitted.SnapshotID || current.SnapshotHash != admitted.SnapshotHash {
		t.Fatalf("permission refresh replaced admitted snapshot: current=%#v admitted=%#v", current, admitted)
	}
}

func collectOpenAIFunctionOutputs(value any) []openAIFunctionOutput {
	outputs := make([]openAIFunctionOutput, 0, 2)
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			if strings.TrimSpace(anyToString(typed["type"])) == "function_call_output" {
				outputs = append(outputs, openAIFunctionOutput{
					CallID: strings.TrimSpace(anyToString(typed["call_id"])), Output: anyToString(typed["output"]),
				})
				return
			}
			for _, key := range []string{"input", "content", "messages"} {
				if child, ok := typed[key]; ok {
					visit(child)
				}
			}
		}
	}
	visit(value)
	return outputs
}

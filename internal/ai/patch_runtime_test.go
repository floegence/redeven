package ai

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestPatchHostedRunWritesAndPatchesAbsolutePath(t *testing.T) {
	t.Parallel()
	stateDir := t.TempDir()
	path := filepath.Join(stateDir, "note.txt")
	var calls atomic.Int32
	var outputMu sync.Mutex
	var outputs []openAIFunctionOutput
	patch := "*** Begin Patch\n*** Update File: " + path + "\n@@ beta:\n-same\n+changed\n*** End of File\n*** End Patch"
	alpha := "@@ alpha:\n-same\n+ALPHA\n"
	beta := "@@ beta:\n-changed\n+BETA\n"
	ordered := "*** Begin Patch\n*** Update File: " + path + "\n" + alpha + beta + "*** End Patch"
	backwards := "*** Begin Patch\n*** Update File: " + path + "\n" + beta + alpha + "*** End Patch"
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Patch path qualification")
			return
		}
		assertPatchProviderContract(t, request)
		step := calls.Add(1)
		if step == 3 || step == 5 {
			want, feedback := "alpha:\nsame\nbeta:\nsame\n", "input"
			if step == 5 {
				want, feedback = "alpha:\nsame\nbeta:\nchanged\n", "out_of_order"
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != want {
				t.Errorf("failed call changed file: %q, %v", got, err)
			}
			results := collectOpenAIFunctionOutputs(request["input"])
			if len(results) == 0 || !strings.Contains(results[len(results)-1].Output, feedback) {
				t.Errorf("missing corrective feedback %q: %+v", feedback, results)
			}
		}
		if step > 5 {
			for _, raw := range request["input"].([]any) {
				item, _ := raw.(map[string]any)
				if item["type"] != "function_call" || item["name"] != "apply_patch" {
					continue
				}
				key := "input"
				if item["call_id"] == "invalid-schema" {
					key = "patch"
				}
				var args map[string]any
				if err := json.Unmarshal([]byte(item["arguments"].(string)), &args); err != nil || len(args) != 1 || args[key] == nil {
					t.Errorf("historical arguments changed: %+v, %v", item, err)
				}
			}
			outputMu.Lock()
			outputs = collectOpenAIFunctionOutputs(request["input"])
			outputMu.Unlock()
			writeAskUserIntegrationTextResponse(w, flusher, "done", "Patched the requested section.")
			return
		}
		name, id := "file_write", "write"
		args := map[string]any{"file_path": path, "content": "alpha:\nsame\nbeta:\nsame\n"}
		switch step {
		case 2:
			name, id, args = "apply_patch", "invalid-schema", map[string]any{"patch": patch}
		case 3:
			name, id, args = "apply_patch", "patch", map[string]any{"input": patch}
		case 4:
			name, id, args = "apply_patch", "out-of-order", map[string]any{"input": backwards}
		case 5:
			name, id, args = "apply_patch", "reordered", map[string]any{"input": ordered}
		}
		raw, err := json.Marshal(args)
		if err != nil {
			t.Error(err)
			return
		}
		item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": name, "arguments": string(raw)}
		for _, event := range []string{"response.output_item.added", "response.output_item.done"} {
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": event, "output_index": 0, "item": item})
		}
		writeAskUserIntegrationCompletedResponse(w, flusher, "response-"+id)
	}))
	t.Cleanup(provider.Close)
	opts := Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}}},
		ResolveProviderAPIKey:        func(string) (string, bool, error) { return "test-key", true, nil },
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second},
		PersistOpTimeout:             2 * time.Second,
	}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := &session.Meta{EndpointID: "patch-env", ChannelID: "patch-channel", NamespacePublicID: "ns", UserPublicID: "user", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := svc.CreateThread(t.Context(), meta, "Patch paths", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	terminal, err := runTypedTurnForTest(t, t.Context(), svc, meta, "patch-absolute", RunStartRequest{
		ThreadID: thread.ThreadID, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Create the file, then patch its beta section."},
		Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
	})
	if err != nil {
		t.Fatalf("patch turn: %v; failure=%+v", err, terminal.Failure)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "alpha:\nALPHA\nbeta:\nBETA\n" {
		t.Fatalf("patched file=%q error=%v", got, err)
	}
	outputMu.Lock()
	initialOutputs := append([]openAIFunctionOutput(nil), outputs...)
	outputMu.Unlock()
	if calls.Load() != 6 || len(initialOutputs) != 5 || initialOutputs[4].CallID != "reordered" {
		t.Fatalf("provider calls=%d outputs=%+v", calls.Load(), initialOutputs)
	}
	var patchResult map[string]any
	if err := json.Unmarshal([]byte(initialOutputs[4].Output), &patchResult); err != nil {
		t.Fatal(err)
	}
	if patchResult["status"] != "success" || strings.Contains(initialOutputs[4].Output, "mutations") || !strings.Contains(initialOutputs[4].Output, "note.txt") {
		t.Fatalf("patch result=%s", initialOutputs[4].Output)
	}

	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	fork, err := svc.ForkThreadWithOptions(t.Context(), meta, thread.ThreadID, ForkThreadRequest{ClientRequestID: "patch-fork", Title: "Patch history"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{thread.ThreadID, fork.ThreadID} {
		view, err := runTypedTurnForTest(t, t.Context(), svc, meta, "continue-"+id, RunStartRequest{
			ThreadID: id, Model: "openai/gpt-5-mini", Input: RunInput{Text: "Summarize the confirmed edits without changing files."},
			Options: RunOptions{PermissionType: config.AIPermissionFullAccess},
		})
		if err != nil {
			t.Fatalf("continue patch history: %v; failure=%+v", err, view.Failure)
		}
		outputMu.Lock()
		retained := len(outputs)
		outputMu.Unlock()
		if retained != 5 {
			t.Fatalf("historical tool exchanges lost: %d", retained)
		}
	}
	got, err = os.ReadFile(path)
	if err != nil || string(got) != "alpha:\nALPHA\nbeta:\nBETA\n" || calls.Load() != 8 {
		t.Fatalf("history continuation replayed edits: contents=%q calls=%d err=%v", got, calls.Load(), err)
	}
}

// Inspect the final serialized provider request, after host and Floret shaping.
func assertPatchProviderContract(t *testing.T, request map[string]any) {
	t.Helper()
	for _, raw := range request["tools"].([]any) {
		tool := raw.(map[string]any)
		if tool["name"] != "apply_patch" {
			continue
		}
		parameters, ok := tool["parameters"].(map[string]any)
		if !ok || parameters["additionalProperties"] != false {
			t.Errorf("patch schema is not strict: %+v", parameters)
			return
		}
		properties := parameters["properties"].(map[string]any)
		for _, extra := range []string{"patch", "input_format"} {
			if _, exists := properties[extra]; exists {
				t.Errorf("unexpected patch argument %s", extra)
			}
		}
		input, ok := properties["input"].(map[string]any)
		if !ok || input["type"] != "string" {
			t.Errorf("provider lost input argument: %+v", properties)
			return
		}
		required, _ := parameters["required"].([]any)
		if len(required) != 1 || required[0] != "input" {
			t.Errorf("unexpected required arguments: %+v", required)
		}
		description, _ := input["description"].(string)
		for _, want := range []string{"One file header per canonical path", "non-overlapping chunks in original file order"} {
			if !strings.Contains(description, want) {
				t.Errorf("provider lost patch guidance %q", want)
			}
		}
		return
	}
	t.Error("provider request omitted apply_patch")
}

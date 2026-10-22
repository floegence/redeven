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
		step := calls.Add(1)
		if step > 2 {
			outputMu.Lock()
			outputs = collectOpenAIFunctionOutputs(request["input"])
			outputMu.Unlock()
			writeAskUserIntegrationTextResponse(w, flusher, "done", "Patched the requested section.")
			return
		}
		name, id := "file_write", "write"
		args := map[string]any{"file_path": path, "content": "alpha:\nsame\nbeta:\nsame\n"}
		if step == 2 {
			name, id = "apply_patch", "patch"
			args = map[string]any{"patch": "*** Begin Patch\n*** Update File: " + path + "\n@@ beta:\n-same\n+changed\n*** End of File\n*** End Patch"}
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
	svc, err := NewService(Options{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: stateDir, AgentHomeDir: stateDir, Shell: "/bin/sh",
		Config: &config.AIConfig{CurrentModelID: "openai/gpt-5-mini", Providers: []config.AIProvider{{
			ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: provider.URL + "/v1",
			Models: []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}}},
		ResolveProviderAPIKey:        func(string) (string, bool, error) { return "test-key", true, nil },
		ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 5 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second},
		PersistOpTimeout:             2 * time.Second,
	})
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
	if err != nil || string(got) != "alpha:\nsame\nbeta:\nchanged\n" {
		t.Fatalf("patched file=%q error=%v", got, err)
	}
	outputMu.Lock()
	defer outputMu.Unlock()
	if calls.Load() != 3 || len(outputs) != 2 || outputs[1].CallID != "patch" {
		t.Fatalf("provider calls=%d outputs=%+v", calls.Load(), outputs)
	}
	var patchResult map[string]any
	if err := json.Unmarshal([]byte(outputs[1].Output), &patchResult); err != nil {
		t.Fatal(err)
	}
	if patchResult["status"] != "success" || strings.Contains(outputs[1].Output, "mutations") || !strings.Contains(outputs[1].Output, "note.txt") {
		t.Fatalf("patch result=%s", outputs[1].Output)
	}
}

package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

func TestComputerDeepSeekImageOverflowContinuesProductionThread(t *testing.T) {
	var calls, overflows atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string                       `json:"model"`
			Tools []map[string]any             `json:"tools"`
			Input []map[string]json.RawMessage `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.Model != "deepseek-v4-flash-vision-exp" {
			t.Error("wrong model")
		}
		images := 0
		for _, item := range body.Input {
			var parts []map[string]any
			_ = json.Unmarshal(item["output"], &parts)
			for _, part := range parts {
				if part["type"] == "input_image" {
					images++
				}
			}
		}
		if len(body.Tools) > 0 && images > 3 {
			overflows.Add(1)
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			fmt.Fprint(w, `{"error":{"code":"request_too_large","message":"fixture image budget exceeded"}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if len(body.Tools) > 0 && calls.Load() < 8 {
			if len(body.Tools) < 20 {
				t.Error("qualification did not use the production registry")
			}
			index := calls.Add(1)
			id := fmt.Sprintf("navigate-%d", index)
			item := map[string]any{"type": "function_call", "id": id, "call_id": id, "name": "browser_navigate", "arguments": fmt.Sprintf(`{"url":"https://example.test/step/%d"}`, index)}
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": "capture", "status": "completed", "output": []any{item}}})
			return
		}
		writeDeepSeekIntegrationNaturalResponse(w, flusher, "done", "Visual task progress retained.")
	}))
	defer server.Close()
	body, attachment := computerFrameFixture(t)
	executor := &takeoverObservationExecutor{body: body, attachment: attachment}
	executor.safe.Store(true)
	registry := NewTargetRegistry()
	if err := registry.Register(TargetDescriptor{ID: "target", Kind: "browser.managed", DisplayName: "Managed Browser", Ready: true, State: "ready", Capabilities: []string{"observe", "interaction"}}); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	host := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": executor}, filepath.Join(state, "media"))
	t.Cleanup(func() { _ = host.Close() })
	model, ok := config.AIModelCatalogEntry("deepseek", "deepseek-v4-flash-vision-exp")
	if !ok {
		t.Fatal("vision model missing from production catalog")
	}
	svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", TargetResolver: host, TargetToolExecutor: host,
		Config:                &config.AIConfig{CurrentModelID: "deepseek/deepseek-v4-flash-vision-exp", Providers: []config.AIProvider{{ID: "deepseek", Name: "DeepSeek", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{model}}}},
		ResolveProviderAPIKey: func(string) (string, bool, error) { return "test", true, nil }, RunMaxWallTime: 15 * time.Second, RunIdleTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Visual task", "deepseek/deepseek-v4-flash-vision-exp", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "start", Model: "deepseek/deepseek-v4-flash-vision-exp", Input: RunInput{Text: "Complete eight browser steps."}, Options: RunOptions{PermissionType: config.AIPermissionFullAccess}}); err != nil {
		t.Fatal(err)
	}
	view := waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(v *ThreadView) bool { return v.RunStatus == "success" || v.RunStatus == "failed" })
	if view.RunStatus != "success" {
		t.Fatalf("production image overflow recovery failed: %s %s", view.RunErrorCode, view.RunError)
	}
	if calls.Load() != 8 || executor.effects.Load() != 8 || overflows.Load() == 0 {
		t.Fatalf("calls=%d effects=%d overflows=%d", calls.Load(), executor.effects.Load(), overflows.Load())
	}
}

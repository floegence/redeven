package ai

import (
	"encoding/json"
	"fmt"
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

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

// Exercise the shipped terminal schema through the real product gateway and
// service. The invalid spelling must never reach the terminal handler.
func TestFlowerToolArgumentCorrectionEpisodesAndExplicitRetry(t *testing.T) {
	state := t.TempDir()
	effect := filepath.Join(state, "confirmed.txt")
	var requests atomic.Int32
	var recovered atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			http.Error(w, "invalid fixture request", 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if len(extractOpenAIToolNames(request)) == 0 {
			writeDeepSeekIntegrationTextResponse(w, flusher, "title", "Correction recovery")
			return
		}
		step := requests.Add(1)
		if step > 1 && !requestContainsPairedToolHistory(request, "terminal_exec") {
			t.Error("canonical tool exchange lost during correction or retry")
		}
		if recovered.Load() {
			raw, _ := json.Marshal(request["input"])
			if !strings.Contains(string(raw), "CONFIRMED_PRODUCT_RESULT") {
				t.Error("Retry lost confirmed tool results")
			}
			writeDeepSeekIntegrationTextResponse(w, flusher, "recovered", "Recovered without replaying confirmed commands.")
			return
		}
		args := map[string]any{"command": fmt.Sprintf("printf x >> '%s'; printf CONFIRMED_PRODUCT_RESULT_%d", effect, step), "yield_ms": 1000}
		if step%2 == 1 || step >= 7 {
			delete(args, "yield_ms")
			args["yield_time_ms"] = 1000
		}
		encoded, _ := json.Marshal(args)
		callID := fmt.Sprintf("terminal-%d", step)
		output := []any{}
		if step == 1 {
			output = append(output, map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "Inspecting the runtime."}}})
		}
		output = append(output, map[string]any{"type": "function_call", "id": "item-" + callID, "call_id": callID, "name": "terminal_exec", "arguments": string(encoded)})
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.completed", "response": map[string]any{"id": fmt.Sprintf("response-%d", step), "status": "completed", "output": output}})
	}))
	t.Cleanup(server.Close)
	open := func() *Service {
		svc, err := NewService(Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh",
			Config:                       &config.AIConfig{PermissionType: config.AIPermissionFullAccess, CurrentModelID: "deepseek/deepseek-v4-flash", Providers: []config.AIProvider{{ID: "deepseek", Type: "deepseek", BaseURL: server.URL, Models: []config.AIProviderModel{{ModelName: "deepseek-v4-flash"}}}}},
			ProviderRequestTimeoutPolicy: flruntime.ProviderRequestTimeoutPolicy{MaxAttemptDuration: 10 * time.Second, FirstOutputTimeout: 5 * time.Second, IdleTimeout: 5 * time.Second},
			ResolveProviderAPIKey:        func(string) (string, bool, error) { return "fixture", true, nil }})
		if err != nil {
			t.Fatal(err)
		}
		return svc
	}
	svc := open()
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Correction recovery", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "correction", Input: RunInput{Text: "Inspect the runtime."}}); err != nil {
		t.Fatal(err)
	}
	// Nine provider preparations and three terminal executions exceed the shared
	// single-interaction helper deadline under race instrumentation.
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "failed" }, 30*time.Second)
	if requests.Load() != 9 {
		t.Fatalf("independent correction exhausted early: requests=%d", requests.Load())
	}
	for restart := 0; restart < 2; restart++ {
		detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		view, err := svc.GetThread(t.Context(), meta, thread.ThreadID)
		if err != nil || view.RunErrorCode != runErrorCodeToolArgumentCorrection || view.WaitingPrompt != nil || detail.Current.Failure == nil || detail.Current.Failure.Reason != flruntime.ThreadTurnFailureToolArgumentCorrectionExhausted {
			t.Fatalf("unsafe or inconsistent failure: view=%+v detail=%+v err=%v", view, detail.Current.Failure, err)
		}
		raw, _ := json.Marshal(detail.Current.Items)
		if strings.Contains(string(raw), "yield_time_ms") || strings.Contains(string(raw), "tool_validation_error") || !strings.Contains(string(raw), "Inspecting the runtime.") {
			t.Fatal("correction feedback leaked or accepted output lost")
		}
		contents, err := os.ReadFile(effect)
		if err != nil || string(contents) != "xxx" {
			t.Fatalf("rejected call executed or confirmed result lost: %q %v", contents, err)
		}
		if restart == 0 {
			if err := svc.Close(); err != nil {
				t.Fatal(err)
			}
			svc = open()
		}
	}
	recovered.Store(true)
	if _, err := svc.RetryThreadContinuation(t.Context(), meta, thread.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitForAskUserIntegrationThread(t, svc, meta, thread.ThreadID, func(view *ThreadView) bool { return view.RunStatus == "success" })
	final, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil || final.Current.Failure != nil {
		t.Fatalf("Retry retained current failure: %+v %v", final.Current.Failure, err)
	}
	contents, err := os.ReadFile(effect)
	if err != nil || string(contents) != "xxx" || requests.Load() != 10 {
		t.Fatalf("Retry replayed confirmed work: %q requests=%d err=%v", contents, requests.Load(), err)
	}
}

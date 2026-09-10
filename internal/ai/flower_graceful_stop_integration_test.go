package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

func TestFlowerGracefulStopConfirmsRealTerminalExit(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Stop terminal")
			return
		}
		if calls.Add(1) > 1 {
			writeAskUserIntegrationTextResponse(w, flusher, "continued", "Continued in a new turn.")
			return
		}
		arguments, _ := json.Marshal(map[string]any{"description": "Inspect device status", "command": "printf FLOWER_STOP_OUTPUT; sleep 30", "yield_ms": 10000})
		item := map[string]any{"type": "function_call", "id": "fc_stop", "call_id": "call_stop", "name": "terminal_exec", "arguments": string(arguments)}
		for _, kind := range []string{"response.output_item.added", "response.output_item.done"} {
			writeOpenAISSEJSON(w, flusher, map[string]any{"type": kind, "output_index": 0, "item": item})
		}
		writeAskUserIntegrationCompletedResponse(w, flusher, "stop_calls")
	}))
	defer server.Close()
	stateDir := t.TempDir()
	svc := openRealtimeTestService(t, stateDir, server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Stop terminal", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetThreadPermissionType(t.Context(), meta, thread.ThreadID, string(FlowerPermissionFullAccess)); err != nil {
		t.Fatal(err)
	}
	sub, err := svc.threadRuntime.Subscribe(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	sent, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "stop-real-terminal", Input: RunInput{Text: "Inspect the device"}})
	if err != nil {
		t.Fatal(err)
	}
	var process *terminalProcess
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, candidate := range svc.terminalProcesses.ProcessesForRun(meta.EndpointID, thread.ThreadID, sent.Current.RunID.String()) {
			if strings.Contains(candidate.Snapshot().Output, "FLOWER_STOP_OUTPUT") {
				process = candidate
				break
			}
		}
		if process != nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if process == nil {
		current, _ := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
		t.Fatalf("terminal did not produce output: %#v", current)
	}
	stopCtx, cancel := context.WithCancel(t.Context())
	acceptedAt := time.Now()
	response, err := svc.StopThread(stopCtx, meta, thread.ThreadID)
	cancel()
	if err != nil || !response.OK || time.Since(acceptedAt) > time.Second {
		t.Fatalf("stop acceptance: %#v, %v", response, err)
	}
	ctx, finish := context.WithTimeout(t.Context(), 6*time.Second)
	defer finish()
	var terminal flruntime.ThreadView
	sawStopping := false
	for {
		view, err := sub.Next(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if view.Cancellation != nil && view.Activity == flruntime.ThreadActivityActive {
			sawStopping = true
		}
		if view.Cancellation != nil && view.Activity == flruntime.ThreadActivityIdle {
			terminal = view
			break
		}
	}
	if !sawStopping || terminal.LastOutcome == nil || *terminal.LastOutcome != flruntime.TurnOutcomeCancelled || terminal.Failure != nil {
		t.Fatalf("terminal failure=%+v, stopping=%v", terminal.Failure, sawStopping)
	}
	if terminal.Cancellation.Mode != flruntime.CancelModeGraceful || terminal.Cancellation.Source != "user_stop" {
		t.Fatalf("stop provenance: %#v", terminal.Cancellation)
	}
	if calls.Load() != 1 {
		t.Fatalf("stop dispatched another model call: %d", calls.Load())
	}
	select {
	case <-process.reapedDone:
	default:
		t.Fatal("cancelled turn preceded process reap")
	}
	found := false
	for _, item := range terminal.Items {
		if item.Activity != nil && item.Activity.ToolID == "call_stop" {
			found = true
			if item.Activity.Status != observation.ActivityStatusCanceled {
				t.Fatalf("tool status = %s", item.Activity.Status)
			}
			payload, ok := item.Activity.Presentation.Payload.(fltools.TerminalActivityPayload)
			if !ok || !strings.Contains(payload.Output, "FLOWER_STOP_OUTPUT") {
				t.Fatalf("lost terminal output: %#v", payload)
			}
		}
	}
	if !found {
		t.Fatal("cancelled terminal result missing")
	}
	detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil || detail.Thread.Cancellation == nil || detail.Thread.RunError != "" {
		t.Fatalf("detail = %#v, %v", detail, err)
	}
	summaries, err := svc.threadRuntime.List(t.Context(), flruntime.ThreadScope{})
	if err != nil || len(summaries) != 1 || summaries[0].Cancellation == nil {
		t.Fatalf("summaries = %#v, %v", summaries, err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openRealtimeTestService(t, stateDir, server.URL)
	defer func() { _ = reopened.Close() }()
	restored, err := reopened.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
	if err != nil || restored.Current.Cancellation == nil || restored.Thread.RunError != "" || !restored.Current.Cancellation.RequestedAt.Equal(terminal.Cancellation.RequestedAt) {
		t.Fatalf("reopened = %#v, %v", restored, err)
	}
}

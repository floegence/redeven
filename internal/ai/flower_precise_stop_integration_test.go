package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerPreciseStopPreservesStreamingContextAndRejectsRollover(t *testing.T) {
	var calls atomic.Int32
	requests := make(chan map[string]any, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Stop context")
			return
		}
		step := calls.Add(1)
		requests <- request
		if step == 2 {
			writeAskUserIntegrationTextResponse(w, flusher, "complete", "Continued.")
			return
		}
		writeOpenAISSEJSON(w, flusher, map[string]any{"type": "response.output_text.delta", "delta": "## Partial\n```go\nSTOP_PREFIX 🌸"})
		<-r.Context().Done()
	}))
	defer server.Close()
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Stop context", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "first", Input: RunInput{Text: "work"}})
	if err != nil {
		t.Fatal(err)
	}
	<-requests
	waitPreciseStopView(t, svc, thread.ThreadID, func(view flruntime.ThreadView) bool {
		for _, item := range view.Items {
			if strings.Contains(item.Text, "STOP_PREFIX") {
				return true
			}
		}
		return false
	})
	stop := StopThreadRequest{ExpectedTurnID: first.TurnID, ExpectedRunID: first.RunID, ClientRequestID: "stop-first"}
	if response, err := svc.StopThread(t.Context(), meta, thread.ThreadID, stop); err != nil || !response.OK {
		t.Fatalf("stop=%+v err=%v", response, err)
	}
	terminal := waitPreciseStopView(t, svc, thread.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	if terminal.LastOutcome == nil || *terminal.LastOutcome != flruntime.TurnOutcomeCancelled {
		t.Fatalf("terminal=%+v", terminal)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = openRealtimeTestService(t, state, server.URL)
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "next", Input: RunInput{Text: "continue"}}); err != nil {
		t.Fatal(err)
	}
	nextRequest := <-requests
	encoded, err := json.Marshal(nextRequest["input"])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), "STOP_PREFIX") || !strings.Contains(string(encoded), "turn_interruption") || !strings.Contains(string(encoded), first.RunID) {
		t.Fatalf("next provider input lost interrupted history: %s", encoded)
	}
	waitPreciseStopView(t, svc, thread.ThreadID, func(v flruntime.ThreadView) bool {
		return v.Activity == flruntime.ThreadActivityIdle && v.TurnID.String() != first.TurnID
	})
	third, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "third", Input: RunInput{Text: "more"}})
	if err != nil {
		t.Fatal(err)
	}
	<-requests
	delayed := stop
	delayed.ClientRequestID = "delayed"
	if _, err := svc.StopThread(t.Context(), meta, thread.ThreadID, delayed); !errors.Is(err, flruntime.ErrRequestConflict) {
		t.Fatalf("delayed stop=%v", err)
	}
	if _, err := svc.StopThread(t.Context(), meta, thread.ThreadID, stop); err != nil {
		t.Fatal(err)
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if current.RunID.String() != third.RunID || current.Activity != flruntime.ThreadActivityActive || current.Cancellation != nil {
		t.Fatalf("old stop affected new execution: %+v", current)
	}
	if _, err := svc.StopThread(t.Context(), meta, thread.ThreadID, StopThreadRequest{ExpectedTurnID: third.TurnID, ExpectedRunID: third.RunID, ClientRequestID: "stop-third"}); err != nil {
		t.Fatal(err)
	}
	waitPreciseStopView(t, svc, thread.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
}
func waitPreciseStopView(t *testing.T, svc *Service, id string, ready func(flruntime.ThreadView) bool) flruntime.ThreadView {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		view, err := svc.threadRuntime.View(context.Background(), identity.ThreadID(id))
		if err != nil {
			t.Fatal(err)
		}
		if ready(view) {
			return view
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("stop boundary did not converge")
	return flruntime.ThreadView{}
}

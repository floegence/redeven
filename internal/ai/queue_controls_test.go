package ai

import (
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

func TestQueuedMessageEditAndSendNowReachCanonicalProviderInput(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	inputs := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		if tools, _ := request["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, flusher, "title", "Queue controls")
			return
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusOK)
			flusher.Flush()
			close(started)
			<-r.Context().Done()
			return
		}
		raw, _ := json.Marshal(request["input"])
		inputs <- string(raw)
		writeAskUserIntegrationTextResponse(w, flusher, "done", "Continued with the chosen message.")
	}))
	defer server.Close()
	svc := openRealtimeTestService(t, t.TempDir(), server.URL)
	defer func() { _ = svc.Close() }()
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Queue controls", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "active-queue-controls", Input: RunInput{Text: "Start work"}}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider did not start")
	}
	queued, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "chosen-queue-controls", Input: RunInput{Text: "Original instruction"}})
	if err != nil || queued.Kind != "queued" {
		t.Fatalf("queued=%#v err=%v", queued, err)
	}
	original := "Original instruction"
	updated, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, queued.QueueID, EditQueuedInputRequest{ClientRequestID: "edit-queue-controls", ExpectedText: &original, Text: "Focus on the revised instruction"})
	if err != nil || len(updated.Queue) != 1 || updated.Queue[0].Input.Text != "Focus on the revised instruction" {
		t.Fatalf("updated=%#v err=%v", updated.Queue, err)
	}
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, queued.QueueID, EditQueuedInputRequest{ClientRequestID: "stale-queue-controls", ExpectedText: &original, Text: "Stale edit"}); err == nil {
		t.Fatal("stale edit accepted")
	}
	sent, err := svc.SendQueuedInputNow(t.Context(), meta, thread.ThreadID, queued.QueueID)
	if err != nil || len(sent.Queue) != 0 {
		t.Fatalf("send-now=%#v err=%v", sent, err)
	}
	select {
	case input := <-inputs:
		if !strings.Contains(input, "Focus on the revised instruction") || strings.Contains(input, "Original instruction") {
			t.Fatalf("provider input=%s", input)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("chosen input never reached provider")
	}
	current, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range current.Items {
		if item.Kind == flruntime.ThreadItemUser && item.Text == "Focus on the revised instruction" {
			found = true
		}
	}
	if !found {
		t.Fatal("edited user input missing from canonical history")
	}
	originalRequest := SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "chosen-queue-controls", Input: RunInput{Text: original}}
	replayed, err := svc.SendUserTurn(t.Context(), meta, originalRequest)
	if err != nil || replayed.TurnID != string(sent.TurnID) {
		t.Fatalf("original send replay after promotion: %+v %v", replayed, err)
	}
	originalRequest.Input.Text = "Focus on the revised instruction"
	if _, err := svc.SendUserTurn(t.Context(), meta, originalRequest); !errors.Is(err, ErrTurnIdempotencyConflict) {
		t.Fatalf("edited content reused the original send identity: %v", err)
	}
}

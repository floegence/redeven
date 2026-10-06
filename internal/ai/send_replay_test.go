package ai

import (
	"errors"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestSendReplayRejectsChangedInputAcrossQueueEditAndRestart(t *testing.T) {
	server := newRealtimeTestServer(t, time.Minute)
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Replay", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	active := SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "active", Input: RunInput{Text: "active"}}
	if _, err := svc.SendUserTurn(t.Context(), meta, active); err != nil {
		t.Fatal(err)
	}
	original := SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "original", Input: RunInput{Text: "original"}}
	queued, err := svc.SendUserTurn(t.Context(), meta, original)
	if err != nil || queued.Kind != "queued" {
		t.Fatalf("queue: %+v %v", queued, err)
	}
	check := func() {
		t.Helper()
		if _, err := svc.SendUserTurn(t.Context(), meta, original); err != nil {
			t.Fatalf("identical replay: %v", err)
		}
		changed := original
		changed.Input.Text = "different"
		if _, err := svc.SendUserTurn(t.Context(), meta, changed); !errors.Is(err, ErrTurnIdempotencyConflict) {
			t.Fatalf("changed replay: %v", err)
		}
	}
	check()
	old := original.Input.Text
	if _, err := svc.EditQueuedInput(t.Context(), meta, thread.ThreadID, queued.QueueID, EditQueuedInputRequest{ClientRequestID: "edit", ExpectedText: &old, Text: "edited"}); err != nil {
		t.Fatal(err)
	}
	check()
	if err := svc.DeleteQueuedInput(t.Context(), meta, thread.ThreadID, queued.QueueID); err != nil {
		t.Fatal(err)
	}
	check()
	if _, err := svc.threadRuntime.Cancel(t.Context(), flruntime.CancelInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: "stop"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = openRealtimeTestService(t, state, server.URL)
	check()
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || len(view.Queue) != 0 {
		t.Fatalf("replay revived deleted queue: %+v %v", view.Queue, err)
	}
}

func TestConcurrentSendReplayRejectsDifferentContent(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Concurrent replay", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	commands := make([]func() error, 2)
	for i, text := range []string{"first", "second"} {
		commands[i] = func() error {
			_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "same-key", Input: RunInput{Text: text}})
			return err
		}
	}
	errs := ollamaConcurrent(commands...)
	if (errs[0] != nil || !errors.Is(errs[1], ErrTurnIdempotencyConflict)) && (errs[1] != nil || !errors.Is(errs[0], ErrTurnIdempotencyConflict)) {
		t.Fatalf("concurrent different input: %v", errs)
	}
}

func TestConcurrentConflictingReplayDoesNotRejectIdenticalReplay(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Replay contention", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	request := SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "same-key", Input: RunInput{Text: "original"}}
	if _, err := svc.SendUserTurn(t.Context(), meta, request); err != nil {
		t.Fatal(err)
	}
	commands := make([]func() error, 64)
	for i := range commands {
		commands[i] = func() error {
			input := request
			if i%2 == 0 {
				input.Input.Text = "conflict"
			}
			_, err := svc.SendUserTurn(t.Context(), meta, input)
			return err
		}
	}
	for i, err := range ollamaConcurrent(commands...) {
		if i%2 == 0 && !errors.Is(err, ErrTurnIdempotencyConflict) || i%2 != 0 && err != nil {
			t.Fatalf("replay %d inherited another request's result: %v", i, err)
		}
	}
}

package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestThreadGoalSubmissionStartsUpdatesStopsAndReplays(t *testing.T) {
	requests := make(chan map[string]any, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			return
		}
		if tools, _ := input["tools"].([]any); len(tools) == 0 {
			w.Header().Set("Content-Type", "text/event-stream")
			writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "title", "Goal task")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		writeTestRealtimeSSE(w, w.(http.Flusher), map[string]any{"type": "response.output_text.delta", "delta": "Working on the requested result"})
		requests <- input
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	awaitRequest := func() map[string]any {
		t.Helper()
		select {
		case request := <-requests:
			return request
		case <-time.After(5 * time.Second):
			t.Fatal("submitted Goal never reached the model")
			return nil
		}
	}
	meta := testSendTurnMeta()
	request := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "submit-new", Operation: "submit", Text: "Deliver the verified result", NewThread: &CreateThreadRequest{ModelID: "openai/gpt-5-mini", WorkingDir: state}}
	result, started, err := svc.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || result.Conflict || started.TurnID == "" || started.Goal.Text != request.Text {
		t.Fatalf("result=%+v view=%+v err=%v", result, started, err)
	}
	awaitRequest()
	waitGoalInteraction(t, svc.threadRuntime, started.ThreadID.String(), func(v flruntime.ThreadView) bool {
		for _, item := range v.Items {
			if item.Kind == flruntime.ThreadItemAssistant && item.Live {
				return true
			}
		}
		return false
	})
	if started.Failure != nil {
		t.Fatalf("submission failed: %+v", started.Failure)
	}
	countUsers := func(v flruntime.ThreadView) int {
		n := 0
		for _, item := range v.Items {
			if item.Kind == flruntime.ThreadItemUser {
				n++
			}
		}
		return n
	}
	if countUsers(started) != 1 {
		t.Fatalf("explicit Goal input missing: %+v", started.Items)
	}
	update := request
	update.NewThread = nil
	update.ThreadID = started.ThreadID.String()
	update.ClientRequestID = "submit-running"
	update.ExpectedVersion = 1
	update.Text = "Deliver the updated verified result"
	_, running, err := svc.ManageThreadGoal(t.Context(), meta, update)
	if err != nil || running.Goal.Version != 2 || running.Goal.Text != update.Text || running.TurnID != started.TurnID || len(running.Queue) != 0 || countUsers(running) != 1 {
		t.Fatalf("running update admitted work: %+v err=%v", running, err)
	}
	if _, err := svc.StopThread(t.Context(), meta, started.ThreadID.String()); err != nil {
		t.Fatal(err)
	}
	waitGoalInteraction(t, svc.threadRuntime, started.ThreadID.String(), func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	// An exact retry keeps its original update-only decision after Stop.
	replay, stopped, err := svc.ManageThreadGoal(t.Context(), meta, update)
	if err != nil || !replay.Replayed || stopped.Activity != flruntime.ThreadActivityIdle || countUsers(stopped) != 1 {
		t.Fatalf("replay=%+v stopped=%+v err=%v", replay, stopped, err)
	}
	update.ClientRequestID = "submit-after-stop"
	update.ExpectedVersion = 2
	_, resumed, err := svc.ManageThreadGoal(t.Context(), meta, update)
	if err != nil || resumed.TurnID == started.TurnID || countUsers(resumed) != 2 || len(resumed.Queue) != 0 {
		t.Fatalf("new execution=%+v err=%v", resumed, err)
	}
	nextRequest, _ := json.Marshal(awaitRequest())
	if !strings.Contains(string(nextRequest), request.Text) {
		t.Fatal("Goal submission lost previous conversation context")
	}
	edit := update
	edit.Operation = "set"
	edit.ClientRequestID = "popup-edit"
	edit.ExpectedVersion = 3
	edit.Text = "Edited without another execution"
	_, saved, err := svc.ManageThreadGoal(t.Context(), meta, edit)
	if err != nil || saved.Goal.Version != 4 || saved.Goal.Text != edit.Text || saved.TurnID != resumed.TurnID || countUsers(saved) != 2 || len(saved.Queue) != 0 {
		t.Fatalf("popup started work: %+v err=%v", saved, err)
	}
	edit.Operation = "delete"
	edit.ClientRequestID = "popup-delete"
	edit.ExpectedVersion = 4
	_, deleted, err := svc.ManageThreadGoal(t.Context(), meta, edit)
	if err != nil || deleted.Goal.Status != "absent" || deleted.TurnID != resumed.TurnID || deleted.Activity != saved.Activity {
		t.Fatalf("delete changed execution: %+v err=%v", deleted, err)
	}
	if _, err := svc.StopThread(t.Context(), meta, started.ThreadID.String()); err != nil {
		t.Fatal(err)
	}
	waitGoalInteraction(t, svc.threadRuntime, started.ThreadID.String(), func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	// The original new-thread submission cannot create or start again either.
	replay, again, err := svc.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || !replay.Replayed || again.ThreadID != started.ThreadID || again.Activity != flruntime.ThreadActivityIdle || countUsers(again) != 2 {
		t.Fatalf("new-thread replay=%+v view=%+v err=%v", replay, again, err)
	}
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	restored := openRealtimeTestService(t, state, server.URL)
	defer restored.Close()
	request.StorageGeneration = restored.storageGeneration
	replay, afterRestart, err := restored.ManageThreadGoal(t.Context(), meta, request)
	if err != nil || !replay.Replayed || afterRestart.Activity != flruntime.ThreadActivityIdle || countUsers(afterRestart) != 2 || afterRestart.Goal.Status != "absent" {
		t.Fatalf("restart replay=%+v view=%+v err=%v", replay, afterRestart, err)
	}
	if len(requests) != 0 {
		t.Fatal("exact replay requested model execution")
	}

}

type goalSubmitLostResponseRuntime struct {
	flruntime.ThreadSummaryReader
	flruntime.ThreadService
	flruntime.ThreadGoalController
	flruntime.ThreadGoalSubmitter
}

func (r goalSubmitLostResponseRuntime) SubmitGoal(ctx context.Context, in flruntime.SetGoalInput) (flruntime.GoalSubmissionResult, error) {
	result, err := r.ThreadGoalSubmitter.SubmitGoal(ctx, in)
	if err == nil {
		return result, errors.New("submission response lost")
	}
	return result, err
}
func TestThreadGoalSubmissionLostResponseDoesNotReactivateStoppedThread(t *testing.T) {
	svc := newRealtimeTestService(t, time.Second)
	meta := testSendTurnMeta()
	canonical := svc.threadRuntime
	created, err := svc.CreateThread(t.Context(), meta, "", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatal(err)
	}
	req := ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "lost-submit", ThreadID: created.ThreadID, Operation: "submit", Text: "Recover the verified result"}
	svc.threadRuntime = goalSubmitLostResponseRuntime{canonical.(flruntime.ThreadSummaryReader), canonical, canonical.(flruntime.ThreadGoalController), canonical.(flruntime.ThreadGoalSubmitter)}
	if _, _, err := svc.ManageThreadGoal(t.Context(), meta, req); !errors.Is(err, ErrThreadGoalOutcomeUnknown) {
		t.Fatalf("unknown=%v", err)
	}
	svc.threadRuntime = canonical
	if _, err := svc.StopThread(t.Context(), meta, created.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitGoalInteraction(t, canonical, created.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	replay, view, err := svc.ManageThreadGoal(t.Context(), meta, req)
	if err != nil || !replay.Replayed || view.Activity != flruntime.ThreadActivityIdle || len(view.Queue) != 0 || view.Goal.Version != 1 {
		t.Fatalf("replay=%+v view=%+v err=%v", replay, view, err)
	}
	current, err := canonical.View(t.Context(), identity.ThreadID(created.ThreadID))
	if err != nil || current.TurnID != view.TurnID {
		t.Fatalf("canonical=%+v err=%v", current, err)
	}
}

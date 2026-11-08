package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/tessiven"
)

type tessivenActivityRuntime struct {
	flruntime.ThreadService
	flruntime.ThreadHostWorkService
	work      map[identity.ThreadID][]flruntime.HostWork
	summaries map[identity.ThreadID]flruntime.ThreadSummary
	children  map[identity.ThreadID][]flruntime.ThreadSummary
}

func (r *tessivenActivityRuntime) ListHostWork(ctx context.Context, id identity.ThreadID) ([]flruntime.HostWork, error) {
	return r.work[id], nil
}

func (r *tessivenActivityRuntime) Summary(ctx context.Context, id identity.ThreadID) (flruntime.ThreadSummary, error) {
	if summary, ok := r.summaries[id]; ok {
		return summary, nil
	}
	return r.ThreadService.(flruntime.ThreadSummaryReader).Summary(ctx, id)
}
func (r *tessivenActivityRuntime) List(ctx context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	if scope.ParentID != nil {
		if children, ok := r.children[*scope.ParentID]; ok {
			return children, nil
		}
	}
	return r.ThreadService.List(ctx, scope)
}

func TestTessivenInactiveConversationRejectsEveryExecutionEntry(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	svc.tessiven = library
	meta := testSendTurnMeta()
	canvas, err := library.Create(t.Context(), "canvas", "Canvas")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "first", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "second", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	tests := map[string]func() error{
		"send": func() error {
			_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: first.ThreadID, ClientRequestID: "inactive-send", Input: RunInput{Text: "run"}})
			return err
		},
		"retry": func() error { _, err := svc.RetryThreadContinuation(t.Context(), meta, first.ThreadID); return err },
		"goal": func() error {
			_, _, err := svc.ManageThreadGoal(t.Context(), meta, ThreadGoalRequest{StorageGeneration: svc.storageGeneration, ThreadID: first.ThreadID, ClientRequestID: "inactive-goal", Operation: "submit", Text: "run"})
			return err
		},
		"compact": func() error {
			_, err := svc.CompactThreadContext(t.Context(), meta, first.ThreadID, CompactThreadContextRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: "inactive-compact"})
			return err
		},
		"approval": func() error {
			_, err := svc.SubmitFlowerApproval(meta, SubmitFlowerApprovalRequest{ThreadID: first.ThreadID, InteractionID: "pending", Approved: true})
			return err
		},
		"input": func() error {
			_, err := svc.SubmitRequestUserInputResponse(t.Context(), meta, SubmitRequestUserInputResponseRequest{ThreadID: first.ThreadID})
			return err
		},
		"queue": func() error {
			_, err := svc.PromoteQueuedInput(t.Context(), meta, first.ThreadID, "pending")
			return err
		},
		"queue_now": func() error {
			_, err := svc.SendQueuedInputNow(t.Context(), meta, first.ThreadID, "pending")
			return err
		},
		"factory": func() error {
			_, err := svc.floretEffects.Agent(t.Context(), flruntime.AgentRequest{ThreadID: identity.ThreadID(first.ThreadID), RequestKey: "automatic-continuation"})
			return err
		},
	}
	for name, run := range tests {
		t.Run(name, func(t *testing.T) {
			if err := run(); !errors.Is(err, tessiven.ErrFlowerThreadInactive) {
				t.Fatalf("inactive execution: %v", err)
			}
		})
	}
	childSettings, err := svc.threadsDB.GetThreadSettings(t.Context(), meta.EndpointID, first.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	childSettings.ThreadID, childSettings.ParentThreadID = "inactive-child", first.ThreadID
	if err := svc.threadsDB.CreateThreadSettings(t.Context(), *childSettings); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.lockTessivenExecution(t.Context(), childSettings.ThreadID); !errors.Is(err, tessiven.ErrFlowerThreadInactive) {
		t.Fatalf("inactive child: %v", err)
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, childSettings.ThreadID); !errors.Is(err, tessiven.ErrConflict) {
		t.Fatalf("child activated as root: %v", err)
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); err != nil {
		t.Fatal(err)
	}
	unlock, err := svc.lockTessivenExecution(t.Context(), first.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	if _, err = svc.lockTessivenExecution(t.Context(), second.ThreadID); !errors.Is(err, tessiven.ErrFlowerThreadInactive) {
		t.Fatal(err)
	}
	// Rejecting a stale execution does not append user or turn records.
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(first.ThreadID))
	if err != nil || view.TurnID != "" || len(view.Items) != 0 {
		t.Fatalf("inactive mutation: %+v %v", view, err)
	}
}

func TestTessivenActivationRetainsRunningWaitingQueuedAndChildWork(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	svc.tessiven = library
	meta := testSendTurnMeta()
	canvas, err := library.Create(t.Context(), "canvas", "Canvas")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "first", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "second", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	root := identity.ThreadID(second.ThreadID)
	runtime := &tessivenActivityRuntime{ThreadService: svc.threadRuntime, summaries: map[identity.ThreadID]flruntime.ThreadSummary{}, children: map[identity.ThreadID][]flruntime.ThreadSummary{}}
	svc.threadRuntime = runtime
	for _, state := range []struct {
		name    string
		summary flruntime.ThreadSummary
	}{
		{"running", flruntime.ThreadSummary{Activity: flruntime.ThreadActivityActive}},
		{"input", flruntime.ThreadSummary{Activity: flruntime.ThreadActivityIdle, Attention: flruntime.AttentionSummary{InputCount: 1}}},
		{"approval", flruntime.ThreadSummary{Activity: flruntime.ThreadActivityIdle, Attention: flruntime.AttentionSummary{ApprovalCount: 1}}},
		{"queued", flruntime.ThreadSummary{Activity: flruntime.ThreadActivityIdle, QueueCount: 1}},
	} {
		t.Run(state.name, func(t *testing.T) {
			runtime.summaries[root] = state.summary
			for _, op := range []func() error{
				func() error { return svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID) },
				func() error {
					_, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "blocked-" + state.name, TessivenCanvasID: canvas.Canvas.ID})
					return err
				},
				func() error {
					_, err := svc.ForkThreadWithOptions(t.Context(), meta, first.ThreadID, ForkThreadRequest{ClientRequestID: "fork-" + state.name})
					return err
				},
			} {
				if err := op(); !errors.Is(err, tessiven.ErrFlowerThreadBusy) {
					t.Fatalf("busy activation: %v", err)
				}
			}
			active, _ := library.Canvas(t.Context(), canvas.Canvas.ID)
			if active.FlowerThreadID != second.ThreadID {
				t.Fatal("busy selection changed")
			}
		})
	}
	runtime.summaries[root] = flruntime.ThreadSummary{ID: root, Activity: flruntime.ThreadActivityIdle}
	runtime.children[root] = []flruntime.ThreadSummary{{ID: "child"}}
	runtime.summaries["child"] = flruntime.ThreadSummary{ID: "child", Activity: flruntime.ThreadActivityActive}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); !errors.Is(err, tessiven.ErrFlowerThreadBusy) {
		t.Fatalf("child activity: %v", err)
	}
	runtime.summaries["child"] = flruntime.ThreadSummary{ID: "child", Activity: flruntime.ThreadActivityIdle}
	runtime.work = map[identity.ThreadID][]flruntime.HostWork{root: {{WorkID: "pending-command", State: "bound"}}}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); !errors.Is(err, tessiven.ErrFlowerThreadBusy) {
		t.Fatalf("host work activation: %v", err)
	}
	runtime.work[root] = nil
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); err != nil {
		t.Fatal(err)
	}
}

func TestTessivenSelectionSerializesWithExecutionAdmission(t *testing.T) {
	svc := newSendTurnTestServiceWithActivation(t, true)
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	svc.tessiven = library
	meta := testSendTurnMeta()
	canvas, _ := library.Create(t.Context(), "canvas", "Canvas")
	first, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "first", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "second", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	unlock, err := svc.lockTessivenExecution(t.Context(), second.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	ctx, cancel := context.WithCancel(t.Context())
	go func() { result <- svc.SelectTessivenThread(ctx, meta, canvas.Canvas.ID, first.ThreadID) }()
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("selection bypassed admission: %v", err)
	}
	unlock()
	ctx, cancel = context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := svc.SelectTessivenThread(ctx, meta, canvas.Canvas.ID, first.ThreadID); err != nil {
		t.Fatal(err)
	}
	if len(svc.threadSettingsLocks) != 0 {
		t.Fatal("canvas admission lock leaked")
	}
}

func TestTessivenActiveConversationRunsAndRejectsSwitchUntilStopped(t *testing.T) {
	requests := make(chan struct{}, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if tools, _ := input["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "title", "Canvas discussion")
			return
		}
		writeTestRealtimeSSE(w, w.(http.Flusher), map[string]any{"type": "response.output_text.delta", "delta": "Working on the active canvas"})
		requests <- struct{}{}
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	state := t.TempDir()
	svc := openRealtimeTestService(t, state, server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = library.Close() })
	svc.tessiven = library
	meta := testSendTurnMeta()
	canvas, err := library.Create(t.Context(), "canvas", "Canvas")
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "first", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "second", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); err != nil {
		t.Fatal(err)
	}
	send := func(id, key string) {
		t.Helper()
		if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: id, ClientRequestID: key, Input: RunInput{Text: "Inspect the canvas"}}); err != nil {
			t.Fatal(err)
		}
		select {
		case <-requests:
		case <-time.After(5 * time.Second):
			t.Fatal("active conversation never reached provider")
		}
	}
	send(first.ThreadID, "first-send")
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, second.ThreadID); !errors.Is(err, tessiven.ErrFlowerThreadBusy) {
		t.Fatalf("running switch: %v", err)
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: second.ThreadID, ClientRequestID: "inactive", Input: RunInput{Text: "Do not run"}}); !errors.Is(err, tessiven.ErrFlowerThreadInactive) {
		t.Fatalf("inactive send: %v", err)
	}
	if _, err := svc.StopThread(t.Context(), meta, first.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitGoalInteraction(t, svc.threadRuntime, first.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, second.ThreadID); err != nil {
		t.Fatal(err)
	}
	send(second.ThreadID, "second-send")
	if _, err := svc.StopThread(t.Context(), meta, second.ThreadID); err != nil {
		t.Fatal(err)
	}
	waitGoalInteraction(t, svc.threadRuntime, second.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
	firstView, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(first.ThreadID))
	if err != nil || len(firstView.Items) == 0 {
		t.Fatalf("history lost: %+v %v", firstView, err)
	}
	select {
	case <-requests:
		t.Fatal("unexpected inactive provider dispatch")
	default:
	}
}

func TestTessivenConcurrentRunAndActivationKeepOneRunnableRoot(t *testing.T) {
	requests := make(chan struct{}, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if tools, _ := input["tools"].([]any); len(tools) == 0 {
			writeAskUserIntegrationTextResponse(w, w.(http.Flusher), "title", "Canvas")
			return
		}
		writeTestRealtimeSSE(w, w.(http.Flusher), map[string]any{"type": "response.output_text.delta", "delta": "Active canvas"})
		requests <- struct{}{}
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	svc := openRealtimeTestService(t, t.TempDir(), server.URL)
	t.Cleanup(func() { _ = svc.Close() })
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = library.Close() })
	svc.tessiven = library
	meta := testSendTurnMeta()
	canvas, _ := library.Create(t.Context(), "canvas", "Canvas")
	first, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "first", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateThreadWithOptions(t.Context(), meta, CreateThreadRequest{ClientRequestID: "second", TessivenCanvasID: canvas.Canvas.ID})
	if err != nil {
		t.Fatal(err)
	}
	for attempt := range 5 {
		if err := svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, first.ThreadID); err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		sends, switches := make(chan error, 1), make(chan error, 1)
		go func() {
			<-start
			_, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{ThreadID: first.ThreadID, ClientRequestID: fmt.Sprintf("race-%d", attempt), Input: RunInput{Text: "Run"}})
			sends <- err
		}()
		go func() {
			<-start
			switches <- svc.SelectTessivenThread(t.Context(), meta, canvas.Canvas.ID, second.ThreadID)
		}()
		close(start)
		sendErr, switchErr := <-sends, <-switches
		active, err := library.Canvas(t.Context(), canvas.Canvas.ID)
		if err != nil {
			t.Fatal(err)
		}
		if sendErr == nil {
			if !errors.Is(switchErr, tessiven.ErrFlowerThreadBusy) || active.FlowerThreadID != first.ThreadID {
				t.Fatalf("send and switch both admitted: %v %+v", switchErr, active)
			}
			select {
			case <-requests:
			case <-time.After(5 * time.Second):
				t.Fatal("admitted run did not dispatch")
			}
			if _, err := svc.StopThread(t.Context(), meta, first.ThreadID); err != nil {
				t.Fatal(err)
			}
			waitGoalInteraction(t, svc.threadRuntime, first.ThreadID, func(v flruntime.ThreadView) bool { return v.Activity == flruntime.ThreadActivityIdle })
		} else if !errors.Is(sendErr, tessiven.ErrFlowerThreadInactive) || switchErr != nil || active.FlowerThreadID != second.ThreadID {
			t.Fatalf("unexpected race result: send=%v switch=%v active=%+v", sendErr, switchErr, active)
		}
	}
	select {
	case <-requests:
		t.Fatal("inactive model dispatch")
	default:
	}
}

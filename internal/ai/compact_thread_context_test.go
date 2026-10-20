package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

func TestSendRejectsStandaloneCompactionWithCanvasContext(t *testing.T) {
	svc := newRealtimeTestService(t, time.Second)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "canvas compaction", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("testdata/environment_flower_context.json")
	if err != nil {
		t.Fatal(err)
	}
	var canvas ContextActionEnvelope
	if err := json.Unmarshal(raw, &canvas); err != nil {
		t.Fatal(err)
	}
	_, err = svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID, ClientRequestID: "canvas-compact",
		Input: RunInput{Text: " /compact\n", ContextAction: &canvas},
	})
	if err == nil || !strings.Contains(err.Error(), "dedicated context compaction") {
		t.Fatalf("standalone canvas command entered ordinary Send: %v", err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Items) != 0 || view.TurnID != "" || len(view.Queue) != 0 {
		t.Fatalf("command changed canonical conversation: %#v", view)
	}
}

func TestCompactThreadContextReturnsBeforeFactoryAndSurvivesRequestDisconnect(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "independent compaction", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	svc.resolveProviderKey = func(string) (string, bool, error) {
		once.Do(func() { close(entered) })
		<-release
		return "sk-test", true, nil
	}
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	requestCtx, disconnect := context.WithCancel(t.Context())
	defer disconnect()
	start := time.Now()
	view, err := svc.CompactThreadContext(requestCtx, meta, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "prepare-compact"})
	if err != nil || time.Since(start) > 500*time.Millisecond {
		t.Fatalf("admission blocked on factory: %v", err)
	}
	if view.TurnKind != flruntime.TurnKindContextCompaction || len(view.Items) != 0 {
		t.Fatalf("typed admission=%#v", view)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("factory never started")
	}
	disconnect()
	if _, err := svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "other-compact"}); !errors.Is(err, flruntime.ErrThreadBusy) {
		t.Fatalf("busy error=%v", err)
	}
	replay, err := svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "prepare-compact"})
	if err != nil || replay.TurnID != view.TurnID {
		t.Fatalf("replay=%#v err=%v", replay, err)
	}
	unblock()
	terminal := compactQualificationThread(t, t.Context(), svc, meta, thread.ThreadID, "prepare-compact")
	if terminal.Current.TurnID != view.TurnID {
		t.Fatal("request disconnect replaced the admitted operation")
	}
	svc.floretEffects.mu.Lock()
	pendingCount := len(svc.floretEffects.pending)
	svc.floretEffects.mu.Unlock()
	if pendingCount != 0 {
		t.Fatalf("replay left %d stale factory inputs", pendingCount)
	}
}

func TestCompactThreadContextRejectsAuthorizationAndGenerationBeforeFactory(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "protected context", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	svc.resolveProviderKey = func(string) (string, bool, error) {
		t.Error("rejected compaction reached factory")
		return "", false, nil
	}
	unauthorized := *meta
	unauthorized.CanExecute = false
	if _, err := svc.CompactThreadContext(t.Context(), &unauthorized, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "unauthorized"}); err == nil {
		t.Fatal("missing authority accepted")
	}
	if _, err := svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, CompactThreadContextRequest{ClientRequestID: "stale", StorageGeneration: "stale"}); !errors.Is(err, ErrFlowerStorageRestored) {
		t.Fatalf("generation error=%v", err)
	}
	view, err := svc.threadRuntime.View(t.Context(), identity.ThreadID(thread.ThreadID))
	if err != nil || view.TurnID != "" || len(view.Items) != 0 {
		t.Fatalf("rejection changed canonical state: %#v %v", view, err)
	}
}

func compactQualificationThread(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID, key string) *FlowerThreadDetail {
	t.Helper()
	view, err := svc.CompactThreadContext(ctx, meta, threadID, CompactThreadContextRequest{StorageGeneration: svc.storageGeneration, ClientRequestID: key})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(7 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		detail, err := svc.GetFlowerThreadDetail(ctx, meta, threadID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Current.TurnID == view.TurnID && detail.Current.Activity == flruntime.ThreadActivityIdle && detail.Current.LastOutcome != nil {
			if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
				t.Fatalf("compaction outcome=%v failure=%#v", detail.Current.LastOutcome, detail.Current.Failure)
			}
			return detail
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-deadline.C:
			t.Fatal("compaction timed out")
		case <-ticker.C:
		}
	}
}

func TestCompactThreadContextFreezesGoalContinuationIntent(t *testing.T) {
	svc := newRealtimeTestService(t, 0)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "goal continuation", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.threadRuntime.(flruntime.ThreadGoalController).SetGoal(t.Context(), flruntime.SetGoalInput{ThreadID: identity.ThreadID(thread.ThreadID), RequestKey: "goal", Text: "Finish verified work"}); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	svc.resolveProviderKey = func(string) (string, bool, error) {
		once.Do(func() { close(entered) })
		<-release
		return "sk-test", true, nil
	}
	defer close(release)
	var req CompactThreadContextRequest
	if err = json.Unmarshal([]byte(`{"client_request_id":"goal-compact","continue_goal":true}`), &req); err != nil {
		t.Fatal(err)
	}
	view, err := svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, req)
	if err != nil {
		t.Fatal(err)
	}
	if string(view.TurnKind) != "goal_continuation" {
		t.Fatalf("kind=%s", view.TurnKind)
	}
	select {
	case <-entered:
	case <-time.After(time.Second * 3):
		t.Fatal("factory did not start")
	}
	replay, err := svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, req)
	if err != nil || replay.TurnID != view.TurnID {
		t.Fatalf("replay=%+v err=%v", replay, err)
	}
	if err = json.Unmarshal([]byte(`{"client_request_id":"goal-compact","continue_goal":false}`), &req); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.CompactThreadContext(t.Context(), meta, thread.ThreadID, req); err == nil {
		t.Fatal("changed intent reused request identity")
	}
}

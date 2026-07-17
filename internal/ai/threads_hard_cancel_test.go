package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func newTestService(t *testing.T, cfg *config.AIConfig) *Service {
	t.Helper()

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir:         t.TempDir(),
		AgentHomeDir:     t.TempDir(),
		Shell:            "/bin/bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func stopTestServiceMaintenance(t *testing.T, svc *Service) {
	t.Helper()
	if svc == nil {
		return
	}

	svc.mu.Lock()
	stopCh := svc.maintenanceStopCh
	doneCh := svc.maintenanceDoneCh
	svc.maintenanceStopCh = nil
	svc.maintenanceDoneCh = nil
	svc.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if doneCh != nil {
		<-doneCh
	}
}

func TestService_DeleteThreadForce_DoesNotWaitForRunExit(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_force_delete_test"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}

	// Keep a real run object blocked while force deletion removes its durable rows.
	stuck := &run{
		id:               runID,
		channelID:        meta.ChannelID,
		endpointID:       meta.EndpointID,
		threadID:         th.ThreadID,
		messageID:        "message_force_delete_test",
		threadsDB:        svc.threadsDB,
		persistOpTimeout: time.Second,
		doneCh:           make(chan struct{}),
	}
	stuck.persistRunRecord(RunStateRunning, "", "", time.Now().UnixMilli(), 0)
	stuck.persistRunEvent("run.start", RealtimeStreamKindLifecycle, nil)
	if _, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, th.ThreadID, threadstore.Message{
		MessageID:   "transcript_force_delete_test",
		Role:        "user",
		Status:      "complete",
		MessageJSON: `{"id":"transcript_force_delete_test","role":"user","status":"complete","blocks":[]}`,
	}, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("AppendMessage before delete: %v", err)
	}

	releaseRun := make(chan struct{})
	runExited := make(chan struct{})
	go func() {
		defer close(runExited)
		<-releaseRun
		stuck.persistRunRecord(RunStateSuccess, "", "", time.Now().Add(-time.Second).UnixMilli(), time.Now().UnixMilli())
		stuck.persistRunEvent("run.end", RealtimeStreamKindLifecycle, map[string]any{"state": "success"})
		_, _ = svc.threadsDB.AppendMessage(context.Background(), meta.EndpointID, th.ThreadID, threadstore.Message{
			MessageID:   "transcript_force_delete_late",
			Role:        "assistant",
			Status:      "complete",
			MessageJSON: `{"id":"transcript_force_delete_late","role":"assistant","status":"complete","blocks":[]}`,
		}, meta.UserPublicID, meta.UserEmail)
		stuck.markDone()
	}()

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = runID
	svc.runs[runID] = stuck
	svc.mu.Unlock()

	if _, err := svc.DeleteThread(ctx, meta, th.ThreadID, true); err != nil {
		t.Fatalf("DeleteThread(force=true): %v", err)
	}

	got, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if got != nil {
		t.Fatalf("thread should be deleted, got=%+v", got)
	}

	svc.mu.Lock()
	_, byTh := svc.activeRunByTh[thKey]
	svc.mu.Unlock()
	if byTh {
		t.Fatalf("active run mappings should be detached after force delete")
	}

	close(releaseRun)
	select {
	case <-runExited:
	case <-time.After(3 * time.Second):
		t.Fatalf("blocked run did not exit after release")
	}
	if got, err := svc.threadsDB.GetRun(ctx, meta.EndpointID, runID); err != nil {
		t.Fatalf("GetRun after released run: %v", err)
	} else if got != nil {
		t.Fatalf("run reappeared after delete: %+v", got)
	}
	if events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, runID, 20); err != nil {
		t.Fatalf("ListRunEvents after released run: %v", err)
	} else if len(events) != 0 {
		t.Fatalf("run events reappeared after delete: %+v", events)
	}
	if messages, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 20, 0); err != nil {
		t.Fatalf("ListMessages after released run: %v", err)
	} else if len(messages) != 0 {
		t.Fatalf("transcript messages reappeared after delete: %+v", messages)
	}
}

func TestService_DeleteThreadHandlesIdleCompactionBusyAndForce(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	var cancelCalled bool
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_delete_idle", "run_delete_idle_compaction", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_delete_idle_anchor",
		Edge:       "after",
	}, func() {
		cancelCalled = true
		svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_delete_idle")
	})
	if gateErr != nil || !begin.Started || begin.RequestID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}

	if _, err := svc.DeleteThread(ctx, meta, th.ThreadID, false); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("DeleteThread(force=false) err=%v, want %v", err, ErrThreadBusy)
	}
	if got, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID); err != nil {
		t.Fatalf("GetThread after busy delete: %v", err)
	} else if got == nil {
		t.Fatalf("thread should remain after busy delete")
	}
	if _, err := svc.DeleteThread(ctx, meta, th.ThreadID, true); err != nil {
		t.Fatalf("DeleteThread(force=true): %v", err)
	}
	if !cancelCalled {
		t.Fatalf("idle compaction cancel callback was not called")
	}
	got, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread after force delete: %v", err)
	}
	if got != nil {
		t.Fatalf("thread should be deleted, got=%+v", got)
	}
	if state, err := svc.threadsDB.GetThreadState(ctx, meta.EndpointID, th.ThreadID); err != nil {
		t.Fatalf("GetThreadState after force delete: %v", err)
	} else if state != nil {
		t.Fatalf("thread state should not remain, got=%+v", state)
	}
}

func TestService_CancelRun_DetachesStaleActiveMapping(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_cancel_detach_test"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)

	// Simulate a corrupted state: active mapping exists, but the run is missing from svc.runs.
	svc.mu.Lock()
	svc.activeRunByTh[thKey] = runID
	svc.mu.Unlock()

	if err := svc.CancelRun(meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	svc.mu.Lock()
	_, byTh := svc.activeRunByTh[thKey]
	svc.mu.Unlock()
	if byTh {
		t.Fatalf("active run mappings should be detached after cancel")
	}

	tv, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if tv == nil {
		t.Fatalf("thread missing after cancel")
	}
	if tv.RunStatus != "canceled" {
		t.Fatalf("unexpected run_status=%q, want %q", tv.RunStatus, "canceled")
	}
}

func TestService_CancelThreadCancelsIdleCompaction(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	anchorMessage := threadstore.Message{
		ThreadID:        th.ThreadID,
		EndpointID:      meta.EndpointID,
		MessageID:       "m_cancel_idle_anchor",
		Role:            "assistant",
		Status:          "complete",
		TextContent:     "ready",
		MessageJSON:     `{"id":"m_cancel_idle_anchor","role":"assistant","status":"complete","blocks":[{"type":"text","text":"ready"}]}`,
		CreatedAtUnixMs: time.Now().UnixMilli(),
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	}
	if _, err := svc.threadsDB.AppendMessage(ctx, meta.EndpointID, th.ThreadID, anchorMessage, meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("AppendMessage anchor: %v", err)
	}
	var cancelCalled bool
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_cancel_idle", "run_cancel_idle_compaction", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_cancel_idle_anchor",
		Edge:       "after",
	}, func() {
		cancelCalled = true
	})
	if gateErr != nil || !begin.Started || begin.RequestID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.RequestID)

	if err := svc.CancelThread(meta, th.ThreadID); err != nil {
		t.Fatalf("CancelThread: %v", err)
	}
	if !cancelCalled {
		t.Fatalf("idle compaction cancel callback was not called")
	}
	if got := svc.idleThreadCompactionRequestID(meta.EndpointID, th.ThreadID); got != "" {
		t.Fatalf("idleThreadCompactionRequestID=%q, want empty after cancel", got)
	}
}

func TestService_BeginIdleCompactionReplacesCancelledUnfinishedOperation(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	anchor := FlowerTimelineAnchor{TargetKind: "message", MessageID: "m_cancelled_replace_anchor", Edge: "after"}
	var firstCancelCalled bool
	first, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_replace_first", "run_replace_first", anchor, func() {
		firstCancelCalled = true
	})
	if gateErr != nil || !first.Started {
		t.Fatalf("begin first result=%+v err=%v", first, gateErr)
	}
	if _, ok := svc.cancelIdleThreadCompactionWithBroadcast(meta.EndpointID, th.ThreadID); !ok {
		t.Fatalf("cancel first returned not found")
	}
	if !firstCancelCalled {
		t.Fatalf("first cancel callback was not called")
	}

	var secondCancelCalled bool
	second, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_replace_second", "run_replace_second", anchor, func() {
		secondCancelCalled = true
	})
	if gateErr != nil || !second.Started || second.RequestID != "compact_replace_second" {
		t.Fatalf("begin second result=%+v err=%v", second, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, second.RequestID)
	if got := svc.idleThreadCompactionRequestID(meta.EndpointID, th.ThreadID); got != second.RequestID {
		t.Fatalf("idleThreadCompactionRequestID=%q, want %q", got, second.RequestID)
	}
	if secondCancelCalled {
		t.Fatalf("second cancel callback was called unexpectedly")
	}
}

func TestService_CancelRun_DoesNotPersistCanceledAssistantBeforeNextUserTurn(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	firstUser, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{Text: "first request"})
	if err != nil {
		t.Fatalf("persist first user: %v", err)
	}
	runID := "run_cancel_order_test"
	assistantID, err := newMessageID()
	if err != nil {
		t.Fatalf("newMessageID: %v", err)
	}
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	oldRun := &run{
		id:                        runID,
		channelID:                 meta.ChannelID,
		endpointID:                meta.EndpointID,
		threadID:                  th.ThreadID,
		userPublicID:              meta.UserPublicID,
		messageID:                 assistantID,
		threadsDB:                 svc.threadsDB,
		persistOpTimeout:          svc.persistOpTO,
		doneCh:                    make(chan struct{}),
		currentThinkingBlockIndex: -1,
	}

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = runID
	svc.runs[runID] = oldRun
	svc.mu.Unlock()

	if err := svc.CancelRun(meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	secondUser, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{Text: "second request"})
	if err != nil {
		t.Fatalf("persist second user: %v", err)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	got := make([]string, 0, len(msgs))
	for _, msg := range msgs {
		got = append(got, msg.MessageID+":"+msg.Role+":"+msg.Status)
	}
	want := []string{
		firstUser.MessageID + ":user:complete",
		secondUser.MessageID + ":user:complete",
	}
	if len(got) != len(want) {
		t.Fatalf("messages=%v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("messages=%v, want %v", got, want)
		}
	}
}

func TestFloretTerminalProjectionUpdatesCanceledBoundaryWithoutTranscriptShadow(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)

	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "hello", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	firstUser, _, err := svc.persistUserMessage(ctx, meta, meta.EndpointID, th.ThreadID, RunInput{Text: "first request"})
	if err != nil {
		t.Fatalf("persist first user: %v", err)
	}

	runID := "run_cancel_projection_test"
	assistantID, err := newMessageID()
	if err != nil {
		t.Fatalf("newMessageID: %v", err)
	}
	r := newRun(runOptions{})
	r.id = runID
	r.channelID = meta.ChannelID
	r.endpointID = meta.EndpointID
	r.threadID = th.ThreadID
	r.userPublicID = meta.UserPublicID
	r.messageID = assistantID
	r.threadsDB = svc.threadsDB
	r.persistOpTimeout = svc.persistOpTO
	r.markDetached()

	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      th.ThreadID,
		TurnID:        assistantID,
		TraceID:       runID,
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusCanceled, Severity: observation.ActivitySeverityWarning, TotalItems: 1, Counts: observation.ActivityCounts{Canceled: 1}},
		Items: []observation.ActivityItem{{
			ItemID:   "tool:exec-1",
			ToolID:   "exec-1",
			ToolName: "terminal.exec",
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusCanceled,
			Severity: observation.ActivitySeverityWarning,
		}},
	}
	if !r.applyFloretThreadProjectionInternal(flruntime.ThreadTurnProjection{
		ThreadID:       flruntime.ThreadID(th.ThreadID),
		TurnID:         flruntime.TurnID(assistantID),
		RunID:          flruntime.RunID(runID),
		TraceID:        flruntime.TraceID(runID),
		Status:         flruntime.TurnStatusCancelled,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: &timeline,
		}},
	}, false, true) {
		t.Fatalf("terminal projection returned false")
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks after projection=%#v, want one activity block", r.assistantBlocks)
	}
	if block, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok || block.Summary.Status != observation.ActivityStatusCanceled {
		t.Fatalf("assistant block after projection=%T %#v, want canceled activity", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	projectedRaw, _, _, err := r.snapshotAssistantMessageJSONWithStatus("canceled")
	if err != nil {
		t.Fatalf("snapshot projected assistant: %v", err)
	}
	if !strings.Contains(projectedRaw, "activity-timeline") {
		t.Fatalf("projected assistant JSON missing activity timeline: %s", projectedRaw)
	}
	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 20, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("messages=%d, want only the user row after canceled projection: %#v", len(msgs), msgs)
	}
	if msgs[0].MessageID != firstUser.MessageID {
		t.Fatalf("message order/id mismatch: %#v", msgs)
	}
}

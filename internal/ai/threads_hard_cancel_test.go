package ai

import (
	"context"
	"encoding/json"
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

	// Simulate a stuck run: present in active maps, but it never closes doneCh.
	stuck := &run{
		id:         runID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = runID
	svc.runs[runID] = stuck
	svc.mu.Unlock()

	if err := svc.DeleteThread(ctx, meta, th.ThreadID, true); err != nil {
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
	}, threadstore.ThreadContextBoundary{}, func() {
		cancelCalled = true
		svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_delete_idle")
	})
	if gateErr != nil || !begin.Started || begin.OperationID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}

	if err := svc.DeleteThread(ctx, meta, th.ThreadID, false); !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("DeleteThread(force=false) err=%v, want %v", err, ErrThreadBusy)
	}
	if got, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID); err != nil {
		t.Fatalf("GetThread after busy delete: %v", err)
	} else if got == nil {
		t.Fatalf("thread should remain after busy delete")
	}
	if err := svc.DeleteThread(ctx, meta, th.ThreadID, true); err != nil {
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
	boundary, err := svc.threadsDB.CurrentThreadContextBoundary(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("CurrentThreadContextBoundary: %v", err)
	}

	var cancelCalled bool
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_cancel_idle", "run_cancel_idle_compaction", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_cancel_idle_anchor",
		Edge:       "after",
	}, boundary, func() {
		cancelCalled = true
	})
	if gateErr != nil || !begin.Started || begin.OperationID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.OperationID)

	if err := svc.CancelThread(meta, th.ThreadID); err != nil {
		t.Fatalf("CancelThread: %v", err)
	}
	if !cancelCalled {
		t.Fatalf("idle compaction cancel callback was not called")
	}
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != "" {
		t.Fatalf("idleThreadCompactionOperation=%q, want empty after cancel", got)
	}

	continuation := threadstore.ThreadProviderContinuation{
		State:           threadstore.ProviderContinuationState{Kind: "responses", ID: "late_cancelled_response"},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	}
	err = svc.commitIdleThreadCompaction(ctx, svc.threadsDB, meta.EndpointID, th.ThreadID, begin.RunID, begin.OperationID, continuation)
	if !errors.Is(err, errIdleCompactionNotCurrent) {
		t.Fatalf("commitIdleThreadCompaction err=%v, want %v", err, errIdleCompactionNotCurrent)
	}
	state, err := svc.threadsDB.GetThreadState(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadState: %v", err)
	}
	if state != nil && !state.ProviderContinuation.IsZero() {
		t.Fatalf("ProviderContinuation=%+v, want empty after rejected late commit", state.ProviderContinuation)
	}
	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, "run_cancel_idle_compaction", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if !hasIdleCompactionGatePhase(events, "cancel_requested") || !hasIdleCompactionGatePhase(events, "commit_rejected") {
		t.Fatalf("gate events=%+v, want cancel_requested and commit_rejected", events)
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
	first, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_replace_first", "run_replace_first", anchor, threadstore.ThreadContextBoundary{}, func() {
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
	second, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_replace_second", "run_replace_second", anchor, threadstore.ThreadContextBoundary{}, func() {
		secondCancelCalled = true
	})
	if gateErr != nil || !second.Started || second.OperationID != "compact_replace_second" {
		t.Fatalf("begin second result=%+v err=%v", second, gateErr)
	}
	defer svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, second.OperationID)
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != second.OperationID {
		t.Fatalf("idleThreadCompactionOperation=%q, want %q", got, second.OperationID)
	}
	if secondCancelCalled {
		t.Fatalf("second cancel callback was called unexpectedly")
	}

	continuation := threadstore.ThreadProviderContinuation{
		State:           threadstore.ProviderContinuationState{Kind: "responses", ID: "late_replaced_response"},
		ProviderID:      "openai",
		Model:           "gpt-5-mini",
		UpdatedAtUnixMs: time.Now().UnixMilli(),
	}
	err = svc.commitIdleThreadCompaction(ctx, svc.threadsDB, meta.EndpointID, th.ThreadID, first.RunID, first.OperationID, continuation)
	if !errors.Is(err, errIdleCompactionNotCurrent) {
		t.Fatalf("first late commit err=%v, want %v", err, errIdleCompactionNotCurrent)
	}
	state, err := svc.threadsDB.GetThreadState(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThreadState: %v", err)
	}
	if state != nil && !state.ProviderContinuation.IsZero() {
		t.Fatalf("ProviderContinuation=%+v, want empty after replaced late commit", state.ProviderContinuation)
	}
}

func TestService_StopThreadWaitsForFinalizingIdleCompaction(t *testing.T) {
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
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_finalizing_idle", "run_finalizing_idle_compaction", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_finalizing_idle_anchor",
		Edge:       "after",
	}, threadstore.ThreadContextBoundary{}, func() {
		cancelCalled = true
	})
	if gateErr != nil || !begin.Started || begin.OperationID == "" {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}

	svc.mu.Lock()
	compaction := svc.idleCompactionByTh[runThreadKey(meta.EndpointID, th.ThreadID)]
	svc.mu.Unlock()
	if compaction == nil {
		t.Fatalf("idle compaction missing")
	}
	compaction.mu.Lock()
	compaction.finalizing = true
	compaction.mu.Unlock()

	stopDone := make(chan error, 1)
	go func() {
		_, err := svc.StopThread(ctx, meta, th.ThreadID)
		stopDone <- err
	}()

	select {
	case err := <-stopDone:
		t.Fatalf("StopThread returned before finalizing compaction finished: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	if cancelCalled {
		t.Fatalf("finalizing idle compaction cancel callback was called")
	}
	if got := svc.idleThreadCompactionOperation(meta.EndpointID, th.ThreadID); got != begin.OperationID {
		t.Fatalf("idleThreadCompactionOperation=%q, want finalizing operation %q", got, begin.OperationID)
	}

	svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, begin.OperationID)

	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatalf("StopThread after finalizing compaction finished: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatalf("StopThread did not return after finalizing compaction finished")
	}

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, "run_finalizing_idle_compaction", 20)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	if !hasIdleCompactionGatePhase(events, "cancel_skipped_finalizing") {
		t.Fatalf("gate events=%+v, want cancel_skipped_finalizing", events)
	}
	if hasIdleCompactionEventPhase(events, string(FlowerLiveContextCompactionUpdated), "cancelled") {
		t.Fatalf("gate events=%+v, finalizing compaction must not publish cancelled divider", events)
	}
}

func hasIdleCompactionEventPhase(events []threadstore.RunEventRecord, eventType string, phase string) bool {
	eventType = strings.TrimSpace(eventType)
	phase = strings.TrimSpace(phase)
	for _, event := range events {
		if strings.TrimSpace(event.EventType) != eventType {
			continue
		}
		var payload FlowerLiveContextCompactionUpdatedPayload
		if !decodeFlowerPayload(json.RawMessage(event.PayloadJSON), &payload) {
			continue
		}
		if strings.TrimSpace(payload.Compaction.Phase) == phase {
			return true
		}
	}
	return false
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
		activitySegmentBlockIndex: -1,
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
	if !r.applyFloretTerminalThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: flruntime.ThreadID(th.ThreadID),
		TurnID:   flruntime.TurnID(assistantID),
		RunID:    flruntime.RunID(runID),
		TraceID:  flruntime.TraceID(runID),
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: &timeline,
		}},
	}) {
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

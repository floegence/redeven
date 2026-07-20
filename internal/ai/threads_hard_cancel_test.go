package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

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
	productCapabilities, err := bindRootRunProductCapabilities(svc.threadsDB, meta.EndpointID, th.ThreadID, runID)
	if err != nil {
		t.Fatalf("bindRootRunProductCapabilities: %v", err)
	}

	// Keep a real run object blocked while force deletion removes its durable rows.
	stuck := &run{
		id:               runID,
		channelID:        meta.ChannelID,
		endpointID:       meta.EndpointID,
		threadID:         th.ThreadID,
		messageID:        "message_force_delete_test",
		product:          productCapabilities,
		persistOpTimeout: time.Second,
		doneCh:           make(chan struct{}),
	}
	releaseRun := make(chan struct{})
	runExited := make(chan struct{})
	go func() {
		defer close(runExited)
		<-releaseRun
		stuck.markDone()
	}()

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = runID
	svc.runs[runID] = stuck
	svc.mu.Unlock()

	if _, err := svc.DeleteThread(ctx, meta, th.ThreadID, true); err != nil {
		t.Fatalf("DeleteThread(force=true): %v", err)
	}

	got, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, th.ThreadID)
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
	if got, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, th.ThreadID); err != nil {
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
	got, err := svc.threadsDB.GetThreadSettings(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread after force delete: %v", err)
	}
	if got != nil {
		t.Fatalf("thread should be deleted, got=%+v", got)
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
	if tv.RunStatus != "idle" {
		t.Fatalf("unexpected canonical run_status=%q, want %q", tv.RunStatus, "idle")
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

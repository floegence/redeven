package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func newTestService(t *testing.T, cfg *config.AIConfig) *Service {
	t.Helper()

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelDebug})),
		StateDir:         t.TempDir(),
		FSRoot:           t.TempDir(),
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

	th, err := svc.CreateThread(ctx, meta, "hello", "")
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
	svc.activeRunByChan[meta.ChannelID] = runID
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
	_, byCh := svc.activeRunByChan[meta.ChannelID]
	svc.mu.Unlock()
	if byTh || byCh {
		t.Fatalf("active run mappings should be detached after force delete")
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

	th, err := svc.CreateThread(ctx, meta, "hello", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_cancel_detach_test"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)

	// Simulate a corrupted state: active mapping exists, but the run is missing from svc.runs.
	svc.mu.Lock()
	svc.activeRunByChan[meta.ChannelID] = runID
	svc.activeRunByTh[thKey] = runID
	svc.mu.Unlock()

	if err := svc.CancelRun(meta, runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	svc.mu.Lock()
	_, byTh := svc.activeRunByTh[thKey]
	_, byCh := svc.activeRunByChan[meta.ChannelID]
	svc.mu.Unlock()
	if byTh || byCh {
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

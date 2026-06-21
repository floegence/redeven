package ai

import (
	"context"
	"encoding/json"
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

func TestService_CancelRun_PersistsCanceledAssistantBeforeNextUserTurn(t *testing.T) {
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
		assistantID + ":assistant:canceled",
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
	var assistantPayload struct {
		Status string `json:"status"`
		Blocks []any  `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(msgs[1].MessageJSON), &assistantPayload); err != nil {
		t.Fatalf("unmarshal assistant json: %v", err)
	}
	if assistantPayload.Status != "canceled" {
		t.Fatalf("assistant json status=%q, want canceled", assistantPayload.Status)
	}
	if len(assistantPayload.Blocks) != 0 {
		t.Fatalf("assistant canceled boundary should not carry stale blocks: %#v", assistantPayload.Blocks)
	}
}

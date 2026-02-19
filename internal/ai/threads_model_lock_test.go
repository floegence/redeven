package ai

import (
	"context"
	"errors"
	"testing"
)

func TestSetThreadModel_RejectsSwitchWhenThreadLocked(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "locked-thread", "openai/gpt-5-mini", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.threadsDB.UpdateThreadModelLock(ctx, meta.EndpointID, th.ThreadID, true); err != nil {
		t.Fatalf("UpdateThreadModelLock: %v", err)
	}

	err = svc.SetThreadModel(ctx, meta, th.ThreadID, "openai/gpt-4o-mini")
	if !errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
		t.Fatalf("SetThreadModel err=%v, want %v", err, ErrModelSwitchRequiresExplicitRestart)
	}

	latest, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest == nil {
		t.Fatalf("thread missing")
	}
	if latest.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want %q", latest.ModelID, "openai/gpt-5-mini")
	}
}

func TestSetThreadModel_RejectsSwitchWhenThreadActive(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "active-thread", "openai/gpt-5-mini", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	runID := "run_active_set_model"
	key := runThreadKey(meta.EndpointID, th.ThreadID)
	svc.mu.Lock()
	svc.activeRunByTh[key] = runID
	svc.runs[runID] = &run{
		id:         runID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}
	svc.mu.Unlock()

	err = svc.SetThreadModel(ctx, meta, th.ThreadID, "openai/gpt-4o-mini")
	if !errors.Is(err, ErrModelSwitchRequiresExplicitRestart) {
		t.Fatalf("SetThreadModel err=%v, want %v", err, ErrModelSwitchRequiresExplicitRestart)
	}

	latest, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest == nil {
		t.Fatalf("thread missing")
	}
	if latest.ModelID != "openai/gpt-5-mini" {
		t.Fatalf("ModelID=%q, want %q", latest.ModelID, "openai/gpt-5-mini")
	}
}

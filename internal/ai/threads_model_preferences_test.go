package ai

import (
	"context"
	"errors"
	"testing"
)

func TestSetThreadModelAllowsIdleThreadSwitch(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "switch-model", "openai/gpt-5-mini", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := svc.SetThreadModel(ctx, meta, th.ThreadID, "openai/gpt-4o-mini"); err != nil {
		t.Fatalf("SetThreadModel: %v", err)
	}

	latest, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if latest == nil {
		t.Fatalf("thread missing")
	}
	if latest.ModelID != "openai/gpt-4o-mini" {
		t.Fatalf("ModelID=%q, want %q", latest.ModelID, "openai/gpt-4o-mini")
	}
}

func TestSetThreadModel_RejectsSwitchWhenThreadActive(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "active-thread", "openai/gpt-5-mini", "", "")
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
	if !errors.Is(err, ErrThreadBusy) {
		t.Fatalf("SetThreadModel err=%v, want %v", err, ErrThreadBusy)
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

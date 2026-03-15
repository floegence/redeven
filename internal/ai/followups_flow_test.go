package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestSendUserTurn_WaitingUserQueueAfterWaitingUser_QueuesWithoutConsumingPrompt(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "waiting-user-queue-later", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testSingleQuestionPrompt(
		"msg_waiting_user_queue_later",
		"tool_waiting_user_queue_later",
		"queue_decision",
		"Choose how to proceed.",
		nil,
	)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	seedWaitingUserPrompt(t, svc, ctx, meta, th.ThreadID, waitingPrompt)

	_, err = svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			Text: "send immediately while waiting",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if !errors.Is(err, ErrWaitingUserQueueConflict) {
		t.Fatalf("SendUserTurn immediate err=%v, want %v", err, ErrWaitingUserQueueConflict)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:              th.ThreadID,
		Model:                 "openai/gpt-5-mini",
		QueueAfterWaitingUser: true,
		Input: RunInput{
			MessageID: "m_waiting_queue_later_1",
			Text:      "queue this until I answer",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn queue later: %v", err)
	}
	if resp.Kind != "queued" {
		t.Fatalf("resp.Kind=%q, want queued", resp.Kind)
	}
	if strings.TrimSpace(resp.ConsumedWaitingPromptID) != "" {
		t.Fatalf("ConsumedWaitingPromptID=%q, want empty", resp.ConsumedWaitingPromptID)
	}
	if resp.QueuePosition != 1 {
		t.Fatalf("QueuePosition=%d, want 1", resp.QueuePosition)
	}

	queued, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("len(queued)=%d, want 1", len(queued))
	}
	if queued[0].MessageID != "m_waiting_queue_later_1" {
		t.Fatalf("queued[0].MessageID=%q, want m_waiting_queue_later_1", queued[0].MessageID)
	}

	threadRecord, err := svc.threadsDB.GetThread(ctx, meta.EndpointID, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if threadRecord == nil {
		t.Fatalf("thread missing")
	}
	if got := strings.TrimSpace(threadRecord.RunStatus); got != "waiting_user" {
		t.Fatalf("RunStatus=%q, want waiting_user", got)
	}
	if got := requestUserInputPromptFromThreadRecord(threadRecord, threadRecord.RunStatus); got == nil || got.PromptID != waitingPrompt.PromptID {
		t.Fatalf("waiting prompt mismatch: %+v", got)
	}

	msgs, _, _, err := svc.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 200, 0)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected no persisted transcript messages while queueing after waiting_user, got %d", len(msgs))
	}

	followups, err := svc.ListFollowups(ctx, meta, th.ThreadID, 20)
	if err != nil {
		t.Fatalf("ListFollowups: %v", err)
	}
	if followups.PausedReason != "waiting_user" {
		t.Fatalf("PausedReason=%q, want waiting_user", followups.PausedReason)
	}
	if len(followups.Queued) != 1 || len(followups.Drafts) != 0 {
		t.Fatalf("unexpected followups payload: %+v", followups)
	}
}

func TestService_StopThread_RecoversQueuedFollowupsToDraftsAndClearsQueue(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "stop-thread-recovery", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	activeRunID := "run_stop_thread_recovery"
	thKey := runThreadKey(meta.EndpointID, th.ThreadID)
	if thKey == "" {
		t.Fatalf("invalid thread key")
	}

	svc.mu.Lock()
	svc.activeRunByTh[thKey] = activeRunID
	svc.runs[activeRunID] = &run{
		id:         activeRunID,
		channelID:  meta.ChannelID,
		endpointID: meta.EndpointID,
		threadID:   th.ThreadID,
		doneCh:     make(chan struct{}),
	}
	svc.mu.Unlock()

	queuedResp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_stop_recover_1",
			Text:      "recover this after stop",
		},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if queuedResp.Kind != "queued" {
		t.Fatalf("queuedResp.Kind=%q, want queued", queuedResp.Kind)
	}

	stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stopResp, err := svc.StopThread(stopCtx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("StopThread: %v", err)
	}
	if !stopResp.OK {
		t.Fatalf("StopThread OK=false")
	}
	if len(stopResp.RecoveredFollowups) != 1 {
		t.Fatalf("len(RecoveredFollowups)=%d, want 1", len(stopResp.RecoveredFollowups))
	}
	if got := strings.TrimSpace(stopResp.RecoveredFollowups[0].FollowupID); got != strings.TrimSpace(queuedResp.QueueID) {
		t.Fatalf("RecoveredFollowups[0].FollowupID=%q, want %q", got, queuedResp.QueueID)
	}
	if got := strings.TrimSpace(stopResp.RecoveredFollowups[0].Lane); got != threadstore.FollowupLaneDraft {
		t.Fatalf("RecoveredFollowups[0].Lane=%q, want %q", got, threadstore.FollowupLaneDraft)
	}

	queued, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 0 {
		t.Fatalf("len(queued)=%d, want 0", len(queued))
	}

	drafts, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane draft: %v", err)
	}
	if len(drafts) != 1 {
		t.Fatalf("len(drafts)=%d, want 1", len(drafts))
	}
	if drafts[0].MessageID != "m_stop_recover_1" {
		t.Fatalf("drafts[0].MessageID=%q, want m_stop_recover_1", drafts[0].MessageID)
	}

	svc.mu.Lock()
	remainingActive := strings.TrimSpace(svc.activeRunByTh[thKey])
	remainingRun := svc.runs[activeRunID]
	svc.mu.Unlock()
	if remainingActive != "" {
		t.Fatalf("activeRunByTh[%q]=%q, want empty", thKey, remainingActive)
	}
	if remainingRun != nil && !remainingRun.isDetached() {
		t.Fatalf("remaining run should be detached after StopThread")
	}
}

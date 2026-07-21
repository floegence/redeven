package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
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
		Options: RunOptions{},
	})
	if !errors.Is(err, ErrWaitingUserQueueConflict) {
		t.Fatalf("SendUserTurn immediate err=%v, want %v", err, ErrWaitingUserQueueConflict)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID:              th.ThreadID,
		Model:                 "openai/gpt-5-mini",
		QueueAfterWaitingUser: true,
		Input: RunInput{
			TurnID: "m_waiting_queue_later_1",
			Text:   "queue this until I answer",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn queue later: %v", err)
	}
	if resp.Kind != "queued" {
		t.Fatalf("resp.Kind=%q, want queued", resp.Kind)
	}
	if resp.TurnID != "m_waiting_queue_later_1" || strings.TrimSpace(resp.RunID) == "" {
		t.Fatalf("queued receipt=%#v, want exact turn and allocated run", resp)
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
	if queued[0].TurnID == "" || queued[0].RunID == "" || queued[0].TextContent != "queue this until I answer" {
		t.Fatalf("queued command lacks canonical identity or prompt: %#v", queued[0])
	}
	threadView, err := svc.GetThread(ctx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if threadView == nil {
		t.Fatalf("thread missing")
	}
	if got := strings.TrimSpace(threadView.RunStatus); got != "waiting_user" {
		t.Fatalf("RunStatus=%q, want waiting_user", got)
	}
	if got := threadView.WaitingPrompt; got == nil || got.PromptID != waitingPrompt.PromptID {
		t.Fatalf("waiting prompt mismatch: %+v", got)
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

	queuedFollowup, _, _, err := svc.threadsDB.CreateFollowup(ctx, threadstore.QueuedTurn{
		QueueID:               "followup_stop_recover_1",
		ThreadID:              th.ThreadID,
		EndpointID:            meta.EndpointID,
		ChannelID:             meta.ChannelID,
		Lane:                  threadstore.FollowupLaneQueued,
		TurnID:                "m_stop_recover_1",
		RunID:                 "run_stop_recover_1",
		ModelID:               "openai/gpt-5-mini",
		TextContent:           "recover this after stop",
		AttachmentsJSON:       "[]",
		OptionsJSON:           "{}",
		SessionMetaJSON:       "{}",
		CreatedByUserPublicID: meta.UserPublicID,
		CreatedByUserEmail:    meta.UserEmail,
	})
	if err != nil {
		t.Fatalf("CreateFollowup: %v", err)
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
	if got := strings.TrimSpace(stopResp.RecoveredFollowups[0].FollowupID); got != strings.TrimSpace(queuedFollowup.QueueID) {
		t.Fatalf("RecoveredFollowups[0].FollowupID=%q, want %q", got, queuedFollowup.QueueID)
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
	if drafts[0].TurnID == "" || drafts[0].RunID == "" || drafts[0].TextContent != "recover this after stop" {
		t.Fatalf("unexpected recovered draft: %#v", drafts[0])
	}
}

func TestService_StopThread_CancelsIdleCompactionAndKeepsQueuedTurnDrafted(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	th, err := svc.CreateThread(ctx, meta, "stop-idle-compaction", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	var cancelCalled bool
	begin, gateErr := svc.beginIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_stop_idle", "run_stop_idle_compaction", FlowerTimelineAnchor{
		TargetKind: "message",
		MessageID:  "m_stop_idle_compaction_anchor",
		Edge:       "after",
	}, func() {
		cancelCalled = true
		svc.finishIdleThreadCompaction(meta.EndpointID, th.ThreadID, "compact_stop_idle")
	})
	if gateErr != nil || !begin.Started {
		t.Fatalf("beginIdleThreadCompaction result=%+v err=%v", begin, gateErr)
	}

	followupResp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			TurnID: "m_stop_idle_compaction_followup",
			Text:   "queued behind compaction",
		},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn followup: %v", err)
	}
	if followupResp.Kind != "queued" {
		t.Fatalf("followupResp.Kind=%q, want queued", followupResp.Kind)
	}

	stopCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	stopResp, err := svc.StopThread(stopCtx, meta, th.ThreadID)
	if err != nil {
		t.Fatalf("StopThread: %v", err)
	}
	if !stopResp.OK || len(stopResp.RecoveredFollowups) != 1 {
		t.Fatalf("StopThread response=%+v, want one recovered followup", stopResp)
	}
	if got := strings.TrimSpace(stopResp.RecoveredFollowups[0].FollowupID); got != strings.TrimSpace(followupResp.QueueID) {
		t.Fatalf("recovered followup=%q, want %q", got, followupResp.QueueID)
	}
	if got := svc.idleThreadCompactionRequestID(meta.EndpointID, th.ThreadID); got != "" {
		t.Fatalf("idleThreadCompactionRequestID=%q, want empty after stop", got)
	}
	if !cancelCalled {
		t.Fatalf("idle compaction cancel callback was not called")
	}
	if begin.RequestID == "" {
		t.Fatalf("begin.RequestID is empty")
	}

	queued, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneQueued, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane queued: %v", err)
	}
	if len(queued) != 0 {
		t.Fatalf("queued=%+v, want none after stop", queued)
	}
	drafts, err := svc.threadsDB.ListFollowupsByLane(ctx, meta.EndpointID, th.ThreadID, threadstore.FollowupLaneDraft, 10)
	if err != nil {
		t.Fatalf("ListFollowupsByLane drafts: %v", err)
	}
	if len(drafts) != 1 || drafts[0].TurnID == "" || drafts[0].RunID == "" || drafts[0].TextContent != "queued behind compaction" {
		t.Fatalf("drafts=%+v, want stopped followup drafted", drafts)
	}
}

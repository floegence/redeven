package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestPrepareRun_DoesNotCreateThreadCheckpoint(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "prepare without checkpoint", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_prepare_without_checkpoint"
	prepared, err := svc.prepareRun(meta, runID, RunStartRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{},
	}, nil, nil)
	if err != nil {
		t.Fatalf("prepareRun: %v", err)
	}
	t.Cleanup(func() {
		svc.mu.Lock()
		delete(svc.runs, runID)
		delete(svc.activeRunByTh, runThreadKey(meta.EndpointID, thread.ThreadID))
		svc.mu.Unlock()
		prepared.r.markDone()
	})

	assertThreadHasNoCheckpoints(t, ctx, svc, meta, thread.ThreadID)
}

func TestSendUserTurn_DoesNotCreateThreadCheckpoint(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "send turn without checkpoint", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	resp, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input:    RunInput{Text: "hello"},
		Options:  RunOptions{},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.RunID == "" {
		t.Fatalf("SendUserTurn run_id is empty")
	}

	assertThreadHasNoCheckpoints(t, ctx, svc, meta, thread.ThreadID)
}

func TestSubmitRequestUserInputResponse_DoesNotCreateThreadCheckpoint(t *testing.T) {
	t.Parallel()

	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	ctx := context.Background()

	thread, err := svc.CreateThread(ctx, meta, "structured response without checkpoint", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	waitingPrompt := testSingleQuestionPrompt(
		"msg_waiting_no_checkpoint",
		"tool_waiting_no_checkpoint",
		"question_1",
		"Choose a direction.",
		nil,
	)
	seedWaitingUserPrompt(t, svc, ctx, meta, thread.ThreadID, waitingPrompt)

	resp, err := svc.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"question_1": {Text: "continue"},
		}),
		Input:   RunInput{Text: "continue"},
		Options: RunOptions{},
	})
	if err != nil {
		t.Fatalf("SubmitRequestUserInputResponse: %v", err)
	}
	if resp.RunID == "" {
		t.Fatalf("SubmitRequestUserInputResponse run_id is empty")
	}

	assertThreadHasNoCheckpoints(t, ctx, svc, meta, thread.ThreadID)
}

func assertThreadHasNoCheckpoints(t *testing.T, ctx context.Context, svc *Service, meta *session.Meta, threadID string) {
	t.Helper()

	checkpointIDs, err := svc.threadsDB.ListThreadCheckpointIDs(ctx, meta.EndpointID, threadID)
	if err != nil {
		t.Fatalf("ListThreadCheckpointIDs: %v", err)
	}
	if len(checkpointIDs) != 0 {
		t.Fatalf("checkpointIDs=%v, want none", checkpointIDs)
	}
}

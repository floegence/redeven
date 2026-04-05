package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestNewService_SweepsOrphanLegacyWorkspaceCheckpointArtifacts(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	orphanDir := checkpointArtifactsDir(stateDir, "cp_orphan")
	if err := os.MkdirAll(orphanDir, 0o700); err != nil {
		t.Fatalf("MkdirAll orphanDir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(orphanDir, "snapshot.tar.gz"), []byte("legacy"), 0o600); err != nil {
		t.Fatalf("WriteFile snapshot.tar.gz: %v", err)
	}

	svc, err := NewService(Options{
		Logger:           slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:         stateDir,
		AgentHomeDir:     t.TempDir(),
		Shell:            "/bin/bash",
		PersistOpTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(orphanDir); os.IsNotExist(err) {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	if _, err := os.Stat(orphanDir); !os.IsNotExist(err) {
		t.Fatalf("orphanDir stat err=%v, want not exist", err)
	}
}

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
		Options:  RunOptions{MaxSteps: 1},
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
		Options:  RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SendUserTurn: %v", err)
	}
	if resp.RunID == "" {
		t.Fatalf("SendUserTurn run_id is empty")
	}

	assertThreadHasNoCheckpoints(t, ctx, svc, meta, thread.ThreadID)
}

func TestSubmitStructuredPromptResponse_DoesNotCreateThreadCheckpoint(t *testing.T) {
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

	resp, err := svc.SubmitStructuredPromptResponse(ctx, meta, SubmitStructuredPromptResponseRequest{
		ThreadID: thread.ThreadID,
		Model:    "openai/gpt-5-mini",
		Response: testResponseForPrompt(waitingPrompt, map[string]RequestUserInputAnswer{
			"question_1": {Text: "continue"},
		}),
		Input:   RunInput{Text: "continue"},
		Options: RunOptions{MaxSteps: 1},
	})
	if err != nil {
		t.Fatalf("SubmitStructuredPromptResponse: %v", err)
	}
	if resp.RunID == "" {
		t.Fatalf("SubmitStructuredPromptResponse run_id is empty")
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

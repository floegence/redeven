package ai

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestNewService_ResetsStaleActiveThreadRunStateAfterRestart(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))

	meta := session.Meta{
		EndpointID:        "env_restart_reset",
		NamespacePublicID: "ns_restart_reset",
		ChannelID:         "ch_restart_reset",
		UserPublicID:      "u_restart_reset",
		UserEmail:         "u_restart_reset@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}
	ctx := context.Background()

	svc, err := NewService(Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: agentHomeDir,
		Shell:        "bash",
	})
	if err != nil {
		t.Fatalf("NewService first: %v", err)
	}

	runningThread, err := svc.CreateThread(ctx, &meta, "running thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread running: %v", err)
	}
	waitingUserThread, err := svc.CreateThread(ctx, &meta, "waiting_user thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread waiting_user: %v", err)
	}

	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, runningThread.ThreadID, "running", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState running: %v", err)
	}
	waitingPrompt := testSingleQuestionPrompt("msg_waiting_seed", "tool_waiting_seed", "question_1", "Need your input.", nil)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, waitingUserThread.ThreadID, "waiting_user", "", mustTestWaitingUserInputJSON(t, waitingPrompt), meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState waiting_user: %v", err)
	}

	if err := svc.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}

	restarted, err := NewService(Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: agentHomeDir,
		Shell:        "bash",
	})
	if err != nil {
		t.Fatalf("NewService second: %v", err)
	}
	t.Cleanup(func() { _ = restarted.Close() })

	gotRunning, err := restarted.GetThread(ctx, &meta, runningThread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread running: %v", err)
	}
	if gotRunning == nil {
		t.Fatalf("running thread missing after restart")
	}
	if got := strings.TrimSpace(gotRunning.RunStatus); got != "canceled" {
		t.Fatalf("running thread run_status=%q, want canceled", got)
	}
	if got := strings.TrimSpace(gotRunning.RunError); got != "" {
		t.Fatalf("running thread run_error=%q, want empty", got)
	}

	gotWaitingUser, err := restarted.GetThread(ctx, &meta, waitingUserThread.ThreadID)
	if err != nil {
		t.Fatalf("GetThread waiting_user: %v", err)
	}
	if gotWaitingUser == nil {
		t.Fatalf("waiting_user thread missing after restart")
	}
	if got := strings.TrimSpace(gotWaitingUser.RunStatus); got != "waiting_user" {
		t.Fatalf("waiting_user thread run_status=%q, want waiting_user", got)
	}
}

package ai

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
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

	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, runningThread.ThreadID, "running", "", "", "", meta.UserPublicID, meta.UserEmail); err != nil {
		t.Fatalf("UpdateThreadRunState running: %v", err)
	}
	if err := svc.threadsDB.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_restart_reset",
		EndpointID: meta.EndpointID,
		ThreadID:   runningThread.ThreadID,
		MessageID:  "msg_restart_reset",
		State:      string(RunStateRunning),
	}); err != nil {
		t.Fatalf("UpsertRun running: %v", err)
	}
	waitingPrompt := testSingleQuestionPrompt("msg_waiting_seed", "tool_waiting_seed", "question_1", "Need your input.", nil)
	if waitingPrompt == nil {
		t.Fatalf("waitingPrompt should not be nil")
	}
	if err := svc.threadsDB.UpdateThreadRunState(ctx, meta.EndpointID, waitingUserThread.ThreadID, "waiting_user", "", "", mustTestWaitingUserInputJSON(t, waitingPrompt), meta.UserPublicID, meta.UserEmail); err != nil {
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
	if got := strings.TrimSpace(gotRunning.RunErrorCode); got != threadstore.RuntimeRestartedRunErrorCode {
		t.Fatalf("running thread run_error_code=%q, want %q", got, threadstore.RuntimeRestartedRunErrorCode)
	}
	if got := strings.TrimSpace(gotRunning.RunError); got != threadstore.RuntimeRestartedRunErrorMessage {
		t.Fatalf("running thread run_error=%q, want %q", got, threadstore.RuntimeRestartedRunErrorMessage)
	}
	gotRun, err := restarted.threadsDB.GetRun(ctx, meta.EndpointID, "run_restart_reset")
	if err != nil {
		t.Fatalf("GetRun after restart: %v", err)
	}
	if gotRun == nil {
		t.Fatalf("running run missing after restart")
	}
	if got := strings.TrimSpace(gotRun.State); got != string(RunStateCanceled) {
		t.Fatalf("running run state=%q, want %q", got, RunStateCanceled)
	}
	if got := strings.TrimSpace(gotRun.ErrorCode); got != threadstore.RuntimeRestartedRunErrorCode {
		t.Fatalf("running run error_code=%q, want %q", got, threadstore.RuntimeRestartedRunErrorCode)
	}
	if got := strings.TrimSpace(gotRun.ErrorMessage); got != threadstore.RuntimeRestartedRunErrorMessage {
		t.Fatalf("running run error_message=%q, want %q", got, threadstore.RuntimeRestartedRunErrorMessage)
	}
	if gotRun.EndedAtUnixMs <= 0 {
		t.Fatalf("running run ended_at_unix_ms=%d, want terminal timestamp", gotRun.EndedAtUnixMs)
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

func TestNewService_RecoversDurableQueuedTurnAfterRestart(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := &config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{{
			ID:      "openai",
			Type:    "openai",
			BaseURL: "https://api.openai.com/v1",
			Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
		}},
	}
	meta := session.Meta{
		EndpointID:        "env_restart_queue",
		NamespacePublicID: "ns_restart_queue",
		ChannelID:         "ch_restart_queue",
		UserPublicID:      "u_restart_queue",
		UserEmail:         "u_restart_queue@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}
	ctx := context.Background()

	svc, err := NewService(Options{
		Logger:           logger,
		StateDir:         stateDir,
		AgentHomeDir:     agentHomeDir,
		Shell:            "bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   time.Second,
		RunIdleTimeout:   time.Second,
	})
	if err != nil {
		t.Fatalf("NewService first: %v", err)
	}
	th, err := svc.CreateThread(ctx, &meta, "restart queued turn", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, _, err := svc.enqueueQueuedTurn(ctx, &meta, SendUserTurnRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/gpt-5-mini",
		Input: RunInput{
			MessageID: "m_restart_queued",
			Text:      "resume this queued turn",
			ContextAction: &ContextActionEnvelope{
				SchemaVersion: ContextActionSchemaVersion,
				ActionID:      contextActionAskFlowerID,
				Provider:      contextActionFlowerProvider,
				Target:        ContextActionTarget{TargetID: "current", Locality: "auto"},
				Source:        ContextActionSource{Surface: contextActionSurfaceFile},
				Context: []ContextActionContextItem{
					{Kind: contextActionKindFilePath, Path: "/workspace/restart.go", IsDirectory: false},
				},
				Presentation: ContextActionPresentation{Label: "Ask Flower", Priority: 100},
			},
		},
		Options: RunOptions{},
	}); err != nil {
		t.Fatalf("enqueueQueuedTurn: %v", err)
	}
	queuedView, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread queued before restart: %v", err)
	}
	if queuedView == nil || len(queuedView.QueuedTurns) != 1 || queuedView.QueuedTurns[0].ContextAction == nil {
		t.Fatalf("queued view before restart=%#v, want linked context", queuedView)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}

	restarted, err := NewService(Options{
		Logger:           logger,
		StateDir:         stateDir,
		AgentHomeDir:     agentHomeDir,
		Shell:            "bash",
		Config:           cfg,
		PersistOpTimeout: 2 * time.Second,
		RunMaxWallTime:   time.Second,
		RunIdleTimeout:   time.Second,
	})
	if err != nil {
		t.Fatalf("NewService second: %v", err)
	}
	t.Cleanup(func() { _ = restarted.Close() })

	deadline := time.Now().Add(2 * time.Second)
	for {
		queued, err := restarted.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
		if err != nil {
			t.Fatalf("ListQueuedTurns: %v", err)
		}
		msgs, _, _, err := restarted.threadsDB.ListMessages(ctx, meta.EndpointID, th.ThreadID, 20, 0)
		if err != nil {
			t.Fatalf("ListMessages: %v", err)
		}
		if len(queued) == 0 && len(msgs) >= 1 {
			if msgs[0].MessageID != "m_restart_queued" {
				t.Fatalf("messages=%+v, want restarted queued user message first", msgs)
			}
			if !strings.Contains(msgs[0].MessageJSON, `"contextAction"`) || !strings.Contains(msgs[0].MessageJSON, `"is_directory":false`) {
				t.Fatalf("restarted queued message lost canonical linked context: %s", msgs[0].MessageJSON)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("queued=%+v messages=%+v, want queued turn consumed after restart", queued, msgs)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestNewService_FlowerLiveStreamGenerationChangesAcrossInstances(t *testing.T) {
	t.Parallel()

	stateDir := t.TempDir()
	agentHomeDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))

	first, err := NewService(Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: agentHomeDir,
		Shell:        "bash",
	})
	if err != nil {
		t.Fatalf("NewService first: %v", err)
	}
	firstGeneration := first.flowerLiveStreamGenerationValue()
	if firstGeneration <= flowerLiveFallbackStreamGeneration {
		t.Fatalf("first stream generation=%d, want process epoch greater than fallback", firstGeneration)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close first service: %v", err)
	}

	second, err := NewService(Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: agentHomeDir,
		Shell:        "bash",
	})
	if err != nil {
		t.Fatalf("NewService second: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	secondGeneration := second.flowerLiveStreamGenerationValue()
	if secondGeneration <= firstGeneration {
		t.Fatalf("second stream generation=%d, want greater than first %d", secondGeneration, firstGeneration)
	}
}

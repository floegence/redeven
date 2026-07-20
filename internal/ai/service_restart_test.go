package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

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
			TurnID: "m_restart_queued",
			Text:   "resume this queued turn",
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

	queued, err := restarted.threadsDB.ListQueuedTurns(ctx, meta.EndpointID, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListQueuedTurns: %v", err)
	}
	if len(queued) != 1 || queued[0].TextContent != "resume this queued turn" || queued[0].TurnID == "" || queued[0].RunID == "" {
		t.Fatalf("unaccepted command was not retained across restart: %#v", queued)
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

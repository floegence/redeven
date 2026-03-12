package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestService_CreateThread_RejectsWorkingDirOutsideAgentHome(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()

	rootDir := t.TempDir()
	outsideDir := t.TempDir()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	svc, err := NewService(Options{
		Logger:       logger,
		StateDir:     stateDir,
		AgentHomeDir: rootDir,
		Shell:        "bash",
		Config:       cfg,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	meta := &session.Meta{
		ChannelID:         "ch_test_threads_working_dir",
		EndpointID:        "env_123",
		NamespacePublicID: "ns_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          false,
	}

	if _, err := svc.CreateThread(context.Background(), meta, "test", "", "", outsideDir); err == nil {
		t.Fatalf("expected CreateThread to reject outside working_dir")
	}
}

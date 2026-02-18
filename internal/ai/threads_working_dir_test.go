package ai

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestService_CreateThread_AllowsWorkingDirOutsideRootDir(t *testing.T) {
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
		Logger:   logger,
		StateDir: stateDir,
		FSRoot:   rootDir,
		Shell:    "bash",
		Config:   cfg,
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

	th, err := svc.CreateThread(context.Background(), meta, "test", "", outsideDir)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if th == nil {
		t.Fatalf("CreateThread returned nil thread")
	}
	if filepath.Clean(th.WorkingDir) != filepath.Clean(outsideDir) {
		t.Fatalf("working_dir=%q, want %q", th.WorkingDir, outsideDir)
	}
}

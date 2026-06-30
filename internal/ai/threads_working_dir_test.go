package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

func newWorkingDirTestService(t *testing.T, rootDir string) *Service {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	scope, err := filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: rootDir,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []config.FilesystemRootPolicy{
				{
					ID:          "home",
					Label:       "Home",
					Path:        rootDir,
					Kind:        config.FilesystemRootHome,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

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
		Logger:          logger,
		StateDir:        stateDir,
		AgentHomeDir:    rootDir,
		FilesystemScope: scope,
		Shell:           "bash",
		Config:          cfg,
		ResolveProviderAPIKey: func(string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func workingDirTestMeta() *session.Meta {
	return &session.Meta{
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
}

func TestService_CreateThread_StoresWorkingDir(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	projectDir := filepath.Join(rootDir, "project")
	if err := os.Mkdir(projectDir, 0o755); err != nil {
		t.Fatalf("os.Mkdir(project): %v", err)
	}
	projectReal, err := filepath.EvalSymlinks(projectDir)
	if err != nil {
		t.Fatalf("EvalSymlinks(project): %v", err)
	}
	svc := newWorkingDirTestService(t, rootDir)

	view, err := svc.CreateThread(context.Background(), workingDirTestMeta(), "test", "", "", projectDir)
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if view.WorkingDir != projectReal {
		t.Fatalf("WorkingDir = %q, want %q", view.WorkingDir, projectReal)
	}
}

func TestService_CreateThread_RejectsInvalidWorkingDir(t *testing.T) {
	t.Parallel()

	rootDir := t.TempDir()
	outsideDir := t.TempDir()
	filePath := filepath.Join(rootDir, "notes.txt")
	if err := os.WriteFile(filePath, []byte("note"), 0o600); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}
	svc := newWorkingDirTestService(t, rootDir)

	if _, err := svc.CreateThread(context.Background(), workingDirTestMeta(), "test", "", "", outsideDir); err == nil {
		t.Fatalf("expected CreateThread to reject outside working_dir")
	}
	if _, err := svc.CreateThread(context.Background(), workingDirTestMeta(), "test", "", "", filePath); err == nil || err.Error() != "working_dir must be a directory" {
		t.Fatalf("CreateThread file error = %v, want working_dir must be a directory", err)
	}
}

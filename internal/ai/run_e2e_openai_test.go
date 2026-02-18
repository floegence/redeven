package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestE2E_OpenAICompatibleBaseURL_StreamText(t *testing.T) {
	t.Parallel()

	// This is an opt-in e2e test that hits a real OpenAI-compatible endpoint via Go native runtime.
	//
	// It is intentionally skipped by default to avoid leaking secrets and creating flaky CI.
	if strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E")) != "1" {
		t.Skip("set REDEVEN_AI_E2E=1 to enable this e2e test")
	}

	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_BASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_API_KEY"))
	modelName := strings.TrimSpace(os.Getenv("REDEVEN_AI_E2E_MODEL"))
	if modelName == "" {
		modelName = "gpt-5-mini"
	}
	if baseURL == "" || apiKey == "" {
		t.Skip("missing REDEVEN_AI_E2E_BASE_URL / REDEVEN_AI_E2E_API_KEY")
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo}))
	stateDir := t.TempDir()
	fsRoot := t.TempDir()

	cfg := &config.AIConfig{
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: baseURL,
				Models:  []config.AIProviderModel{{ModelName: modelName}},
			},
		},
	}

	channelID := "ch_e2e"
	meta := session.Meta{
		EndpointID:        "env_e2e",
		NamespacePublicID: "ns_e2e",
		ChannelID:         channelID,
		UserPublicID:      "u_e2e",
		UserEmail:         "u_e2e@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          true,
	}

	svc, err := NewService(Options{
		Logger:              logger,
		StateDir:            stateDir,
		FSRoot:              fsRoot,
		Shell:               "bash",
		Config:              cfg,
		RunMaxWallTime:      2 * time.Minute,
		RunIdleTimeout:      90 * time.Second,
		ToolApprovalTimeout: 30 * time.Second,
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			if strings.TrimSpace(providerID) != "openai" {
				return "", false, nil
			}
			return apiKey, true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	th, err := svc.CreateThread(ctx, &meta, "e2e", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	token := "E2E_OK_" + strings.ReplaceAll(strings.ToLower(th.ThreadID), "-", "_")
	prompt := "Reply with exactly this token and nothing else: " + token

	rr := httptest.NewRecorder()
	if err := svc.StartRun(ctx, &meta, "run_e2e_1", RunStartRequest{
		ThreadID: th.ThreadID,
		Model:    "openai/" + modelName,
		Input:    RunInput{Text: prompt},
		Options:  RunOptions{MaxSteps: 1},
	}, rr); err != nil {
		t.Fatalf("StartRun: %v", err)
	}

	view, err := svc.GetThread(ctx, &meta, th.ThreadID)
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if view == nil {
		t.Fatalf("thread missing after run")
	}
	if !strings.Contains(view.LastMessagePreview, token) {
		t.Fatalf("unexpected last_message_preview=%q, want token %q", view.LastMessagePreview, token)
	}
}

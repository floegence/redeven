package ai

import (
	"io"
	"log/slog"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestInitStructuredOutputProvider_MoonshotUsesPromptLevelJSON(t *testing.T) {
	t.Parallel()

	svc, err := NewService(Options{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		Config: &config.AIConfig{
			Providers: []config.AIProvider{{
				ID:      "moonshot",
				Type:    "moonshot",
				BaseURL: "https://api.moonshot.example/v1",
				Models:  []config.AIProviderModel{{ModelName: "kimi-k2.6"}},
			}},
		},
		ResolveProviderAPIKey: func(providerID string) (string, bool, error) {
			return "sk-test", true, nil
		},
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })

	_, responseFormat, err := svc.initStructuredOutputProvider(resolvedRunModel{
		ID:         "moonshot/kimi-k2.6",
		ProviderID: "moonshot",
		ModelName:  "kimi-k2.6",
		Provider: config.AIProvider{
			ID:      "moonshot",
			Type:    "moonshot",
			BaseURL: "https://api.moonshot.example/v1",
			Models:  []config.AIProviderModel{{ModelName: "kimi-k2.6"}},
		},
	})
	if err != nil {
		t.Fatalf("initStructuredOutputProvider: %v", err)
	}
	if responseFormat != "" {
		t.Fatalf("responseFormat=%q, want empty prompt-level JSON mode", responseFormat)
	}
}

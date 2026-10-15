package ai

import (
	"io"
	"log/slog"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestInitResolvedProviderAdapterUsesResponsesContinuationConfig(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		flag *bool
		want bool
	}{
		{name: "legacy api key defaults off", want: false},
		{name: "explicit api key opt in", flag: func() *bool { value := true; return &value }(), want: true},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, err := NewService(Options{
				Logger:   slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
				StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "bash",
				Config:                &config.AIConfig{},
				ResolveProviderAPIKey: func(string) (string, bool, error) { return "sk-test", true, nil },
			})
			if err != nil {
				t.Fatalf("NewService: %v", err)
			}
			t.Cleanup(func() { _ = svc.Close() })
			adapter, err := svc.initResolvedProviderAdapter(resolvedRunModel{
				ID: "openai/gpt-5-mini", ProviderID: "openai", ModelName: "gpt-5-mini",
				Provider: config.AIProvider{ID: "openai", Type: "openai", BaseURL: "https://api.openai.example/v1", ResponsesContinuation: tc.flag},
			})
			if err != nil {
				t.Fatalf("initResolvedProviderAdapter: %v", err)
			}
			gateway, ok := adapter.Adapter.(*openAIProvider)
			if !ok {
				t.Fatalf("adapter type=%T, want *openAIProvider", adapter.Adapter)
			}
			if gateway.responsesContinuation != tc.want {
				t.Fatalf("responsesContinuation=%v, want %v", gateway.responsesContinuation, tc.want)
			}
		})
	}
}

func TestInitStructuredOutputProvider_MoonshotUsesPromptLevelJSON(t *testing.T) {
	t.Parallel()

	svc, err := NewService(Options{
		Logger:       slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelInfo})),
		StateDir:     t.TempDir(),
		AgentHomeDir: t.TempDir(),
		Shell:        "bash",
		Config: &config.AIConfig{
			CurrentModelID: "moonshot/kimi-k2.6",
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

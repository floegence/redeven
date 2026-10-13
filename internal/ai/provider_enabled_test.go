package ai

import (
	"context"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestDisabledProviderPreservesDirectoryAndBlocksNewRuns(t *testing.T) {
	enabled := false
	cfg := &config.AIConfig{CurrentModelID: "local/agent", Providers: []config.AIProvider{{
		ID: "local", Type: "ollama", Enabled: &enabled, BaseURL: "http://127.0.0.1:1",
		ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent"}},
		Models:         []config.AIProviderModel{{ModelName: "agent", ContextWindow: 32768}},
	}}}
	svc := &Service{cfg: cfg, resolveProviderKey: func(string) (string, bool, error) {
		t.Fatal("disabled provider requested credentials")
		return "", false, nil
	}}
	for _, baseline := range []bool{true, false} {
		out, err := svc.readModelDirectory(t.Context(), nil, baseline)
		if err != nil {
			t.Fatal(err)
		}
		if len(out.Models) != 0 || out.CurrentModel != cfg.CurrentModelID {
			t.Fatalf("disabled default was replaced or exposed: %+v", out)
		}
		if len(out.Directory.Models) != 1 || out.Directory.Models[0].Reason != "provider_disabled" || out.Directory.Sources[0].State != "unavailable" {
			t.Fatalf("saved model intent missing from directory: %+v", out.Directory)
		}
	}
	for _, requested := range []string{"", cfg.CurrentModelID} {
		_, err := svc.resolveRunModel(context.Background(), cfg, requested, "", nil)
		if err == nil || !strings.Contains(err.Error(), "model not allowed") {
			t.Fatalf("disabled model admitted: %v", err)
		}
	}
	if err := svc.SetCurrentModelID(cfg.CurrentModelID, func(*config.AIConfig) error { t.Fatal("disabled model persisted as selectable"); return nil }); err == nil {
		t.Fatal("disabled model could be selected")
	}
	snapshot, registry, err := buildDesktopModelSourceModelSnapshot(cfg, nil)
	if err != nil || len(snapshot.Models) != 0 || len(registry) != 0 || len(snapshot.MissingKeyProviderIDs) != 0 {
		t.Fatalf("disabled provider exported through Desktop: %+v, %v", snapshot, err)
	}
	// Re-enabling uses the same saved model and default, without rebuilding the profile.
	enabled = true
	cfg.Providers[0].Type = "openai_compatible"
	cfg.Providers[0].ModelSelection = nil
	models, current, err := configModelViews(cfg)
	if err != nil || len(models) != 1 || current != cfg.CurrentModelID || !cfg.IsAllowedModelID(current) {
		t.Fatalf("re-enable lost saved configuration: %v", err)
	}
}

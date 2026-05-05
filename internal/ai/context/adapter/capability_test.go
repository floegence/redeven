package adapter

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/ai/context/model"
	contextstore "github.com/floegence/redeven/internal/ai/context/store"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
)

func TestResolver_ResolveAndCache(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	repo := contextstore.NewRepository(db)
	resolver := NewResolver(repo)

	provider := config.AIProvider{ID: "openai", Type: "openai"}
	cap, err := resolver.Resolve(context.Background(), provider, "openai/gpt-5-mini")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.ProviderID != "openai" {
		t.Fatalf("ProviderID=%q, want openai", cap.ProviderID)
	}
	if cap.ModelName != "gpt-5-mini" {
		t.Fatalf("ModelName=%q, want gpt-5-mini", cap.ModelName)
	}
	if cap.MaxContextTokens <= 0 {
		t.Fatalf("MaxContextTokens=%d, want > 0", cap.MaxContextTokens)
	}

	cached, ok, err := repo.GetCapability(context.Background(), "openai", "gpt-5-mini")
	if err != nil {
		t.Fatalf("GetCapability: %v", err)
	}
	if !ok {
		t.Fatalf("expected cached capability")
	}
	if cached.ModelName != "gpt-5-mini" {
		t.Fatalf("cached.ModelName=%q, want gpt-5-mini", cached.ModelName)
	}
}

func TestResolver_Resolve_RefreshesStaleCapability(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	repo := contextstore.NewRepository(db)
	resolver := NewResolver(repo)

	ctx := context.Background()

	// Seed a stale cached capability (e.g., provider type changed from openai_compatible to moonshot).
	if err := repo.UpsertCapability(ctx, model.ModelCapability{
		ProviderID:               "prov_1",
		ProviderType:             "openai_compatible",
		ResolverVersion:          0,
		ModelName:                "kimi-k2.6",
		SupportsTools:            true,
		SupportsParallelTools:    false,
		SupportsStrictJSONSchema: false,
		SupportsImageInput:       true,
		SupportsFileInput:        true,
		SupportsReasoningTokens:  true,
		MaxContextTokens:         64000,
		MaxOutputTokens:          4096,
		PreferredToolSchemaMode:  "relaxed_json",
	}); err != nil {
		t.Fatalf("UpsertCapability: %v", err)
	}

	cap, err := resolver.Resolve(ctx, config.AIProvider{ID: "prov_1", Type: "moonshot"}, "prov_1/kimi-k2.6")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.ProviderType != "moonshot" {
		t.Fatalf("ProviderType=%q, want moonshot", cap.ProviderType)
	}
	if cap.ResolverVersion != capabilityResolverVersion {
		t.Fatalf("ResolverVersion=%d, want %d", cap.ResolverVersion, capabilityResolverVersion)
	}
	if cap.MaxContextTokens != 256000 {
		t.Fatalf("MaxContextTokens=%d, want 256000", cap.MaxContextTokens)
	}
	if cap.MaxOutputTokens != 96000 {
		t.Fatalf("MaxOutputTokens=%d, want 96000", cap.MaxOutputTokens)
	}

	cached, ok, err := repo.GetCapability(ctx, "prov_1", "kimi-k2.6")
	if err != nil {
		t.Fatalf("GetCapability: %v", err)
	}
	if !ok {
		t.Fatalf("expected cached capability")
	}
	cached = model.NormalizeCapability(cached)
	if cached.ProviderType != "moonshot" {
		t.Fatalf("cached.ProviderType=%q, want moonshot", cached.ProviderType)
	}
	if cached.MaxContextTokens != 256000 {
		t.Fatalf("cached.MaxContextTokens=%d, want 256000", cached.MaxContextTokens)
	}
}

func TestResolver_Resolve_UsesCuratedNativeModelMetadata(t *testing.T) {
	t.Parallel()

	resolver := NewResolver(nil)
	tests := []struct {
		name       string
		provider   config.AIProvider
		modelID    string
		wantCtx    int
		wantOutput int
	}{
		{
			name:       "moonshot_kimi_k2_6",
			provider:   config.AIProvider{ID: "moonshot", Type: "moonshot"},
			modelID:    "moonshot/kimi-k2.6",
			wantCtx:    256000,
			wantOutput: 96000,
		},
		{
			name:       "glm_5_1",
			provider:   config.AIProvider{ID: "glm", Type: "chatglm"},
			modelID:    "glm/glm-5.1",
			wantCtx:    200000,
			wantOutput: 128000,
		},
		{
			name:       "deepseek_v4_pro",
			provider:   config.AIProvider{ID: "deepseek", Type: "deepseek"},
			modelID:    "deepseek/deepseek-v4-pro",
			wantCtx:    1000000,
			wantOutput: 384000,
		},
		{
			name:       "deepseek_v4_flash",
			provider:   config.AIProvider{ID: "deepseek", Type: "deepseek"},
			modelID:    "deepseek/deepseek-v4-flash",
			wantCtx:    1000000,
			wantOutput: 384000,
		},
		{
			name:       "qwen_3_6_plus",
			provider:   config.AIProvider{ID: "qwen", Type: "qwen"},
			modelID:    "qwen/qwen3.6-plus",
			wantCtx:    1000000,
			wantOutput: 65536,
		},
		{
			name:       "qwen_3_6_flash_snapshot",
			provider:   config.AIProvider{ID: "qwen", Type: "qwen"},
			modelID:    "qwen/qwen3.6-flash-2026-04-16",
			wantCtx:    1000000,
			wantOutput: 65536,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cap, err := resolver.Resolve(context.Background(), tc.provider, tc.modelID)
			if err != nil {
				t.Fatalf("Resolve: %v", err)
			}
			if cap.MaxContextTokens != tc.wantCtx {
				t.Fatalf("MaxContextTokens=%d, want %d", cap.MaxContextTokens, tc.wantCtx)
			}
			if cap.MaxOutputTokens != tc.wantOutput {
				t.Fatalf("MaxOutputTokens=%d, want %d", cap.MaxOutputTokens, tc.wantOutput)
			}
		})
	}
}

func TestResolver_Resolve_UsesProviderModelContextWindow(t *testing.T) {
	t.Parallel()

	resolver := NewResolver(nil)
	provider := config.AIProvider{
		ID:   "compat",
		Type: "openai_compatible",
		Models: []config.AIProviderModel{
			{
				ModelName:                     "custom-model",
				ContextWindow:                 200000,
				MaxOutputTokens:               32000,
				EffectiveContextWindowPercent: 90,
			},
		},
	}

	cap, err := resolver.Resolve(context.Background(), provider, "compat/custom-model")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.MaxContextTokens != 180000 {
		t.Fatalf("MaxContextTokens=%d, want 180000", cap.MaxContextTokens)
	}
	if cap.MaxOutputTokens != 32000 {
		t.Fatalf("MaxOutputTokens=%d, want 32000", cap.MaxOutputTokens)
	}
}

func TestAdaptAttachments_DegradeUnsupportedModes(t *testing.T) {
	t.Parallel()

	cap := model.ModelCapability{
		SupportsImageInput: false,
		SupportsFileInput:  false,
	}
	items := []model.AttachmentManifest{
		{Name: "img", MimeType: "image/png", URL: "file:///tmp/a.png"},
		{Name: "txt", MimeType: "text/plain", URL: "file:///tmp/a.txt"},
	}
	out := AdaptAttachments(cap, items)
	if len(out) != 2 {
		t.Fatalf("len(out)=%d, want 2", len(out))
	}
	if out[0].Mode != "text_reference" {
		t.Fatalf("out[0].Mode=%q, want text_reference", out[0].Mode)
	}
	if out[1].Mode != "text_reference" {
		t.Fatalf("out[1].Mode=%q, want text_reference", out[1].Mode)
	}
}

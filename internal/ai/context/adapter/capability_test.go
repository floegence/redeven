package adapter

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/config"
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
		ModelName:                "kimi-k2.5",
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

	cap, err := resolver.Resolve(ctx, config.AIProvider{ID: "prov_1", Type: "moonshot"}, "prov_1/kimi-k2.5")
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
	if cap.MaxOutputTokens != 16384 {
		t.Fatalf("MaxOutputTokens=%d, want 16384", cap.MaxOutputTokens)
	}

	cached, ok, err := repo.GetCapability(ctx, "prov_1", "kimi-k2.5")
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

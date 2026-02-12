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

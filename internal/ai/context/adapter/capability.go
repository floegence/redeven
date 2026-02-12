package adapter

import (
	"context"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/config"
)

// Resolver builds and caches provider/model capability descriptors.
type Resolver struct {
	repo *contextstore.Repository
}

func NewResolver(repo *contextstore.Repository) *Resolver {
	return &Resolver{repo: repo}
}

func (r *Resolver) Resolve(ctx context.Context, provider config.AIProvider, modelID string) (model.ModelCapability, error) {
	providerID := strings.TrimSpace(provider.ID)
	modelName := modelNameFromID(modelID)
	if providerID == "" {
		providerID = "unknown"
	}
	if modelName == "" {
		modelName = strings.TrimSpace(modelID)
	}

	if r != nil && r.repo != nil && r.repo.Ready() {
		if cached, ok, err := r.repo.GetCapability(ctx, providerID, modelName); err == nil && ok {
			return model.NormalizeCapability(cached), nil
		}
	}

	cap := defaultCapability(provider, modelName)
	cap.ProviderID = providerID
	cap.ModelName = modelName
	cap = model.NormalizeCapability(cap)
	if r != nil && r.repo != nil && r.repo.Ready() {
		_ = r.repo.UpsertCapability(ctx, cap)
	}
	return cap, nil
}

func modelNameFromID(modelID string) string {
	modelID = strings.TrimSpace(modelID)
	_, modelName, ok := strings.Cut(modelID, "/")
	if ok {
		return strings.TrimSpace(modelName)
	}
	return strings.TrimSpace(modelID)
}

func defaultCapability(provider config.AIProvider, modelName string) model.ModelCapability {
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	modelLower := strings.ToLower(strings.TrimSpace(modelName))
	cap := model.ModelCapability{
		SupportsTools:            true,
		SupportsParallelTools:    false,
		SupportsStrictJSONSchema: true,
		SupportsImageInput:       true,
		SupportsFileInput:        true,
		SupportsReasoningTokens:  true,
		MaxContextTokens:         128000,
		MaxOutputTokens:          4096,
		PreferredToolSchemaMode:  "json_schema",
	}

	switch providerType {
	case "anthropic":
		cap.SupportsParallelTools = false
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 200000
		cap.MaxOutputTokens = 8192
	case "openai_compatible":
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 64000
		cap.MaxOutputTokens = 4096
	case "openai":
		cap.SupportsParallelTools = false
		cap.SupportsStrictJSONSchema = true
		cap.PreferredToolSchemaMode = "json_schema"
	}

	if strings.Contains(modelLower, "mini") {
		cap.MaxContextTokens = min(cap.MaxContextTokens, 64000)
		cap.MaxOutputTokens = min(cap.MaxOutputTokens, 4096)
	}
	if strings.Contains(modelLower, "nano") {
		cap.MaxContextTokens = min(cap.MaxContextTokens, 32000)
		cap.MaxOutputTokens = min(cap.MaxOutputTokens, 2048)
	}
	if strings.Contains(modelLower, "haiku") {
		cap.MaxContextTokens = min(cap.MaxContextTokens, 128000)
		cap.MaxOutputTokens = min(cap.MaxOutputTokens, 4096)
	}
	return cap
}

// AdaptAttachments applies explicit capability-based degradation modes.
func AdaptAttachments(cap model.ModelCapability, in []model.AttachmentManifest) []model.AttachmentManifest {
	if len(in) == 0 {
		return nil
	}
	out := make([]model.AttachmentManifest, 0, len(in))
	for _, item := range in {
		item.Mode = "native"
		mime := strings.ToLower(strings.TrimSpace(item.MimeType))
		if strings.HasPrefix(mime, "image/") && !cap.SupportsImageInput {
			item.Mode = "text_reference"
		}
		if !strings.HasPrefix(mime, "image/") && !cap.SupportsFileInput {
			item.Mode = "text_reference"
		}
		out = append(out, item)
	}
	return out
}

func min(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

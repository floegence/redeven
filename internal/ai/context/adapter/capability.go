package adapter

import (
	"context"
	"strings"

	"github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/config"
)

const capabilityResolverVersion = 1

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
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	if providerID == "" {
		providerID = "unknown"
	}
	if modelName == "" {
		modelName = strings.TrimSpace(modelID)
	}

	cap := defaultCapability(provider, modelName)
	cap.ProviderID = providerID
	cap.ProviderType = providerType
	cap.ResolverVersion = capabilityResolverVersion
	cap.ModelName = modelName
	cap = model.NormalizeCapability(cap)
	if r != nil && r.repo != nil && r.repo.Ready() {
		if cached, ok, err := r.repo.GetCapability(ctx, providerID, modelName); err == nil && ok {
			cached = model.NormalizeCapability(cached)
			if !capabilitiesEquivalent(cached, cap) {
				_ = r.repo.UpsertCapability(ctx, cap)
			}
		} else {
			_ = r.repo.UpsertCapability(ctx, cap)
		}
	}
	return cap, nil
}

func capabilitiesEquivalent(a model.ModelCapability, b model.ModelCapability) bool {
	a = model.NormalizeCapability(a)
	b = model.NormalizeCapability(b)

	return a.ProviderID == b.ProviderID &&
		a.ModelName == b.ModelName &&
		a.ProviderType == b.ProviderType &&
		a.ResolverVersion == b.ResolverVersion &&
		a.SupportsTools == b.SupportsTools &&
		a.SupportsParallelTools == b.SupportsParallelTools &&
		a.SupportsStrictJSONSchema == b.SupportsStrictJSONSchema &&
		a.SupportsImageInput == b.SupportsImageInput &&
		a.SupportsFileInput == b.SupportsFileInput &&
		a.SupportsReasoningTokens == b.SupportsReasoningTokens &&
		a.MaxContextTokens == b.MaxContextTokens &&
		a.MaxOutputTokens == b.MaxOutputTokens &&
		a.PreferredToolSchemaMode == b.PreferredToolSchemaMode
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
		ProviderType:             providerType,
		ResolverVersion:          capabilityResolverVersion,
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
	case "moonshot":
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 256000
		cap.MaxOutputTokens = 16384
	case "chatglm":
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 200000
		cap.MaxOutputTokens = 16000
	case "deepseek":
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 128000
		cap.MaxOutputTokens = 64000
	case "qwen":
		cap.SupportsStrictJSONSchema = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 262144
		cap.MaxOutputTokens = 65536
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
	if strings.Contains(modelLower, "qwen-plus") || strings.Contains(modelLower, "qwen-flash") || strings.Contains(modelLower, "qwen3-coder-plus") {
		cap.MaxContextTokens = max(cap.MaxContextTokens, 1000000)
	}
	if strings.Contains(modelLower, "qwen3-max") {
		cap.MaxContextTokens = max(cap.MaxContextTokens, 262144)
		cap.MaxOutputTokens = max(cap.MaxOutputTokens, 65536)
	}
	if strings.Contains(modelLower, "kimi-k2") {
		cap.MaxContextTokens = max(cap.MaxContextTokens, 256000)
	}
	if strings.Contains(modelLower, "deepseek-chat") || strings.Contains(modelLower, "deepseek-reasoner") {
		cap.MaxContextTokens = max(cap.MaxContextTokens, 128000)
		cap.MaxOutputTokens = max(cap.MaxOutputTokens, 64000)
	}
	if strings.Contains(modelLower, "glm-5") {
		cap.MaxContextTokens = max(cap.MaxContextTokens, 200000)
		cap.MaxOutputTokens = max(cap.MaxOutputTokens, 128000)
	}

	if providerModel, ok := providerModelByName(provider, modelName); ok {
		if effectiveInputWindow := providerModel.EffectiveInputWindowTokens(); effectiveInputWindow > 0 {
			cap.MaxContextTokens = effectiveInputWindow
		}
		if providerModel.MaxOutputTokens > 0 {
			cap.MaxOutputTokens = providerModel.MaxOutputTokens
		}
	}
	return cap
}

func providerModelByName(provider config.AIProvider, modelName string) (config.AIProviderModel, bool) {
	target := strings.TrimSpace(modelName)
	if target == "" {
		return config.AIProviderModel{}, false
	}
	for _, item := range provider.Models {
		if strings.TrimSpace(item.ModelName) != target {
			continue
		}
		return item, true
	}
	return config.AIProviderModel{}, false
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

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

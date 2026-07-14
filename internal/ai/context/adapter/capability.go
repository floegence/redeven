package adapter

import (
	"context"
	"strings"

	"github.com/floegence/redeven/internal/ai/context/model"
	contextstore "github.com/floegence/redeven/internal/ai/context/store"
	"github.com/floegence/redeven/internal/config"
)

const capabilityResolverVersion = 4

type explicitCapabilityMetadata struct {
	MaxContextTokens     int
	MaxOutputTokens      int
	InputModalities      []string
	SupportsStrictSchema *bool
	ToolSchemaMode       string
}

var explicitModelCapabilityMetadata = map[string]map[string]explicitCapabilityMetadata{
	"openai": {
		"gpt-5.5":      {MaxContextTokens: 1050000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5.4":      {MaxContextTokens: 1050000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5.4-mini": {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5.4-nano": {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5.2":      {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5.2-mini": {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5":        {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
		"gpt-5-mini":   {MaxContextTokens: 400000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}},
	},
	"anthropic": {
		"claude-opus-4-7":           {MaxContextTokens: 1000000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"claude-sonnet-4-6":         {MaxContextTokens: 1000000, MaxOutputTokens: 64000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"claude-haiku-4-5-20251001": {MaxContextTokens: 200000, MaxOutputTokens: 64000, InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
	},
	"moonshot": {
		"kimi-k2.6": {MaxContextTokens: 256000, MaxOutputTokens: 96000, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
	},
	"chatglm": {
		"glm-5.1": {MaxContextTokens: 200000, MaxOutputTokens: 128000, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
	},
	"deepseek": {
		"deepseek-v4-pro":   {MaxContextTokens: 1000000, MaxOutputTokens: 384000, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"deepseek-v4-flash": {MaxContextTokens: 1000000, MaxOutputTokens: 384000, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
	},
	"qwen": {
		"qwen3.6-plus":             {MaxContextTokens: 1000000, MaxOutputTokens: 65536, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"qwen3.6-plus-2026-04-02":  {MaxContextTokens: 1000000, MaxOutputTokens: 65536, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"qwen3.6-flash":            {MaxContextTokens: 1000000, MaxOutputTokens: 65536, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
		"qwen3.6-flash-2026-04-16": {MaxContextTokens: 1000000, MaxOutputTokens: 65536, InputModalities: []string{config.AIInputModalityText}, SupportsStrictSchema: boolPtr(false), ToolSchemaMode: "relaxed_json"},
	},
}

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

	wireModelName := modelName
	if providerModel, ok := providerModelByName(provider, modelName); ok {
		wireModelName = providerModel.EffectiveWireModelName()
	}
	cap := defaultCapability(provider, modelName, wireModelName)
	cap.ProviderID = providerID
	cap.ProviderType = providerType
	cap.ResolverVersion = capabilityResolverVersion
	cap.ModelName = modelName
	cap.WireModelName = wireModelName
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
		a.WireModelName == b.WireModelName &&
		a.ProviderType == b.ProviderType &&
		a.ResolverVersion == b.ResolverVersion &&
		a.SupportsTools == b.SupportsTools &&
		a.SupportsStrictJSONSchema == b.SupportsStrictJSONSchema &&
		a.SupportsImageInput == b.SupportsImageInput &&
		a.SupportsFileInput == b.SupportsFileInput &&
		a.SupportsReasoningTokens == b.SupportsReasoningTokens &&
		reasoningCapabilitiesEquivalent(a.ReasoningCapability, b.ReasoningCapability) &&
		a.SupportsAskUserQuestionBatches == b.SupportsAskUserQuestionBatches &&
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

func defaultCapability(provider config.AIProvider, modelName string, wireModelName string) model.ModelCapability {
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	modelName = strings.TrimSpace(modelName)
	wireModelName = strings.TrimSpace(wireModelName)
	if wireModelName == "" {
		wireModelName = modelName
	}
	cap := model.ModelCapability{
		ProviderType:                   providerType,
		ResolverVersion:                capabilityResolverVersion,
		ModelName:                      modelName,
		WireModelName:                  wireModelName,
		SupportsTools:                  true,
		SupportsStrictJSONSchema:       true,
		SupportsImageInput:             false,
		SupportsFileInput:              false,
		SupportsReasoningTokens:        true,
		SupportsAskUserQuestionBatches: true,
		MaxContextTokens:               128000,
		MaxOutputTokens:                4096,
		PreferredToolSchemaMode:        "json_schema",
	}

	switch providerType {
	case "anthropic":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 200000
		cap.MaxOutputTokens = 8192
	case "moonshot":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 256000
		cap.MaxOutputTokens = 16384
	case "chatglm":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 200000
		cap.MaxOutputTokens = 16000
	case "deepseek":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 128000
		cap.MaxOutputTokens = 64000
	case "qwen":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 262144
		cap.MaxOutputTokens = 65536
	case "openai_compatible":
		cap.SupportsStrictJSONSchema = false
		cap.SupportsAskUserQuestionBatches = false
		cap.PreferredToolSchemaMode = "relaxed_json"
		cap.MaxContextTokens = 64000
		cap.MaxOutputTokens = 4096
	case "openai":
		cap.SupportsStrictJSONSchema = true
		cap.PreferredToolSchemaMode = "json_schema"
	}

	if metadata, ok := explicitCapabilityFor(providerType, wireModelName); ok {
		if metadata.MaxContextTokens > 0 {
			cap.MaxContextTokens = metadata.MaxContextTokens
		}
		if metadata.MaxOutputTokens > 0 {
			cap.MaxOutputTokens = metadata.MaxOutputTokens
		}
		cap.SupportsImageInput = modalitiesSupportImage(metadata.InputModalities)
		if metadata.SupportsStrictSchema != nil {
			cap.SupportsStrictJSONSchema = *metadata.SupportsStrictSchema
		}
		if strings.TrimSpace(metadata.ToolSchemaMode) != "" {
			cap.PreferredToolSchemaMode = strings.TrimSpace(metadata.ToolSchemaMode)
		}
	}

	if providerModel, ok := providerModelByName(provider, modelName); ok {
		if effectiveInputWindow := providerModel.EffectiveInputWindowTokens(); effectiveInputWindow > 0 {
			cap.MaxContextTokens = effectiveInputWindow
		}
		if providerModel.MaxOutputTokens > 0 {
			cap.MaxOutputTokens = providerModel.MaxOutputTokens
		}
		cap.SupportsImageInput = providerModel.SupportsImageInput()
		cap.ReasoningCapability = providerModel.EffectiveReasoningCapability(providerType)
	} else {
		cap.ReasoningCapability = config.AIReasoningCapabilityForModel(providerType, wireModelName)
	}
	return cap
}

func reasoningCapabilitiesEquivalent(a config.AIReasoningCapability, b config.AIReasoningCapability) bool {
	a = a.Normalize()
	b = b.Normalize()
	if a.Kind != b.Kind ||
		a.DefaultLevel != b.DefaultLevel ||
		a.DisableSupported != b.DisableSupported ||
		a.WireShape != b.WireShape ||
		a.DisableShape != b.DisableShape ||
		a.BudgetShape != b.BudgetShape ||
		a.MinBudgetTokens != b.MinBudgetTokens ||
		a.MaxBudgetTokens != b.MaxBudgetTokens ||
		a.DynamicProviderMetadata != b.DynamicProviderMetadata ||
		a.SourceCheckedAt != b.SourceCheckedAt ||
		a.Fixture != b.Fixture {
		return false
	}
	if (a.DefaultEnabled == nil) != (b.DefaultEnabled == nil) {
		return false
	}
	if a.DefaultEnabled != nil && b.DefaultEnabled != nil && *a.DefaultEnabled != *b.DefaultEnabled {
		return false
	}
	return equalStringSlices(a.SupportedLevels, b.SupportedLevels) &&
		equalStringSlices(a.ResponseReasoningFields, b.ResponseReasoningFields) &&
		equalStringSlices(a.HistoryReplayRequirements, b.HistoryReplayRequirements) &&
		equalStringSlices(a.SourceURLs, b.SourceURLs)
}

func equalStringSlices(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func explicitCapabilityFor(providerType string, modelName string) (explicitCapabilityMetadata, bool) {
	models, ok := explicitModelCapabilityMetadata[strings.ToLower(strings.TrimSpace(providerType))]
	if !ok {
		return explicitCapabilityMetadata{}, false
	}
	metadata, ok := models[strings.ToLower(strings.TrimSpace(modelName))]
	return metadata, ok
}

func modalitiesSupportImage(modalities []string) bool {
	for _, item := range modalities {
		if strings.ToLower(strings.TrimSpace(item)) == config.AIInputModalityImage {
			return true
		}
	}
	return false
}

func boolPtr(v bool) *bool {
	return &v
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

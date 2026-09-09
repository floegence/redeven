package adapter

import (
	"context"
	"strings"

	"github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

const capabilityResolverVersion = 5

type explicitCapabilityMetadata struct {
	MaxContextTokens     int
	MaxOutputTokens      int
	InputModalities      []string
	SupportsStrictSchema *bool
	ToolSchemaMode       string
}

// Resolver computes provider/model capability descriptors from current config.
type Resolver struct{}

func NewResolver() *Resolver {
	return &Resolver{}
}

func (r *Resolver) Resolve(_ context.Context, provider config.AIProvider, modelID string) (model.ModelCapability, error) {
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
	case "google", "openai_compatible":
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

func explicitCapabilityFor(providerType string, modelName string) (explicitCapabilityMetadata, bool) {
	entry, ok := config.AIModelCatalogEntry(providerType, modelName)
	if !ok {
		return explicitCapabilityMetadata{}, false
	}
	return explicitCapabilityMetadata{MaxContextTokens: entry.ContextWindow, MaxOutputTokens: entry.MaxOutputTokens, InputModalities: entry.InputModalities}, true
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
	for _, item := range provider.EffectiveModels() {
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

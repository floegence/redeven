package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

type normalizedReasoning struct {
	Requested  config.AIReasoningSelection
	Effective  config.AIReasoningSelection
	Capability config.AIReasoningCapability
	Source     string
	Adjusted   bool
}

func normalizeReasoningForModelSwitch(capability config.AIReasoningCapability, requested config.AIReasoningSelection, modelDefault config.AIReasoningSelection) (config.AIReasoningSelection, bool, error) {
	capability = capability.Normalize()
	requested = config.NormalizeAIReasoningSelection(requested)
	modelDefault = config.NormalizeAIReasoningSelection(modelDefault)
	if requested.IsZero() {
		return modelDefault, !modelDefault.IsZero(), nil
	}
	if err := config.ValidateAIReasoningSelection(capability, requested); err == nil {
		return requested, false, nil
	}
	if modelDefault.IsZero() {
		return config.AIReasoningSelection{}, true, nil
	}
	if err := config.ValidateAIReasoningSelection(capability, modelDefault); err != nil {
		return config.AIReasoningSelection{}, false, err
	}
	return modelDefault, true, nil
}

func resolveEffectiveReasoning(capability config.AIReasoningCapability, singleTurn config.AIReasoningSelection, threadDefault config.AIReasoningSelection, modelDefault config.AIReasoningSelection) (normalizedReasoning, error) {
	capability = capability.Normalize()
	candidates := []struct {
		name      string
		selection config.AIReasoningSelection
	}{
		{name: "turn_override", selection: singleTurn},
		{name: "thread_default", selection: threadDefault},
		{name: "model_default", selection: modelDefault},
	}
	for _, candidate := range candidates {
		selection := config.NormalizeAIReasoningSelection(candidate.selection)
		if selection.IsZero() {
			continue
		}
		if err := config.ValidateAIReasoningSelection(capability, selection); err != nil {
			return normalizedReasoning{}, err
		}
		return normalizedReasoning{
			Requested:  selection,
			Effective:  selection,
			Capability: capability,
			Source:     candidate.name,
			Adjusted:   false,
		}, nil
	}
	return normalizedReasoning{Capability: capability, Source: "omitted"}, nil
}

func marshalReasoningSelection(selection config.AIReasoningSelection) (string, error) {
	selection = config.NormalizeAIReasoningSelection(selection)
	if selection.IsZero() {
		return "", nil
	}
	b, err := json.Marshal(selection)
	if err != nil {
		return "", fmt.Errorf("encode reasoning selection: %w", err)
	}
	return string(b), nil
}

func parseStoredReasoningSelection(raw string) (config.AIReasoningSelection, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return config.AIReasoningSelection{}, nil
	}
	var selection config.AIReasoningSelection
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&selection); err != nil {
		return config.AIReasoningSelection{}, fmt.Errorf("decode stored reasoning selection: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return config.AIReasoningSelection{}, fmt.Errorf("decode stored reasoning selection: %w", err)
	}
	return config.NormalizeAIReasoningSelection(selection), nil
}

func modelReasoningDefaultsFromConfig(cfg *config.AIConfig, modelID string) (config.AIReasoningCapability, config.AIReasoningSelection, bool) {
	if cfg == nil {
		return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
	}
	provider, providerModel, ok := cfg.ProviderModelByID(modelID)
	if !ok {
		return config.AIReasoningCapability{}, config.AIReasoningSelection{}, false
	}
	providerType := strings.ToLower(strings.TrimSpace(provider.Type))
	capability := providerModel.EffectiveReasoningCapability(providerType)
	defaultSelection := providerModel.EffectiveDefaultReasoningSelection(providerType)
	return capability, defaultSelection, true
}

func modelReasoningDefaultsFromCapability(capability contextmodel.ModelCapability) (config.AIReasoningCapability, config.AIReasoningSelection) {
	reasoningCapability := capability.ReasoningCapability.Normalize()
	if reasoningCapability.IsZero() {
		return reasoningCapability, config.AIReasoningSelection{}
	}
	if strings.TrimSpace(reasoningCapability.DefaultLevel) != "" {
		return reasoningCapability, config.AIReasoningSelection{Level: config.AIReasoningLevel(reasoningCapability.DefaultLevel)}
	}
	return reasoningCapability, config.AIReasoningSelection{}
}

func normalizeRequestedReasoningOrReject(capability config.AIReasoningCapability, selection config.AIReasoningSelection) (config.AIReasoningSelection, error) {
	selection = config.NormalizeAIReasoningSelection(selection)
	if selection.IsZero() {
		return config.AIReasoningSelection{}, nil
	}
	if err := config.ValidateAIReasoningSelection(capability, selection); err != nil {
		return config.AIReasoningSelection{}, err
	}
	return selection, nil
}

func reasoningSelectionError(modelID string, err error) error {
	if err == nil {
		return nil
	}
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return err
	}
	return fmt.Errorf("invalid reasoning selection for %s: %w", modelID, err)
}

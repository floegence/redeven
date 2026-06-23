package config

import (
	"errors"
	"fmt"
	"strings"

	flconfig "github.com/floegence/floret/config"
)

const aiReasoningSourceCheckedAt = "2026-06-23"

type AIReasoningSelection = flconfig.ReasoningSelection
type AIReasoningLevel = flconfig.ReasoningLevel

const (
	AIReasoningLevelDefault = flconfig.ReasoningLevelDefault
	AIReasoningLevelOff     = flconfig.ReasoningLevelOff
	AIReasoningLevelMinimal = flconfig.ReasoningLevelMinimal
	AIReasoningLevelLow     = flconfig.ReasoningLevelLow
	AIReasoningLevelMedium  = flconfig.ReasoningLevelMedium
	AIReasoningLevelHigh    = flconfig.ReasoningLevelHigh
	AIReasoningLevelXHigh   = flconfig.ReasoningLevelXHigh
	AIReasoningLevelMax     = flconfig.ReasoningLevelMax
)

type AIReasoningCapability struct {
	Kind                      string   `json:"kind"`
	SupportedLevels           []string `json:"supported_levels,omitempty"`
	DefaultLevel              string   `json:"default_level,omitempty"`
	DisableSupported          bool     `json:"disable_supported,omitempty"`
	DefaultEnabled            *bool    `json:"default_enabled,omitempty"`
	WireShape                 string   `json:"wire_shape"`
	DisableShape              string   `json:"disable_shape,omitempty"`
	BudgetShape               string   `json:"budget_shape,omitempty"`
	MinBudgetTokens           int      `json:"min_budget_tokens,omitempty"`
	MaxBudgetTokens           int      `json:"max_budget_tokens,omitempty"`
	DynamicProviderMetadata   bool     `json:"dynamic_provider_metadata,omitempty"`
	ResponseReasoningFields   []string `json:"response_reasoning_fields,omitempty"`
	HistoryReplayRequirements []string `json:"history_replay_requirements,omitempty"`
	SourceURLs                []string `json:"source_urls"`
	SourceCheckedAt           string   `json:"source_checked_at"`
	Fixture                   string   `json:"fixture"`
}

func NormalizeAIReasoningSelection(in AIReasoningSelection) AIReasoningSelection {
	in.Level = AIReasoningLevel(strings.TrimSpace(strings.ToLower(string(in.Level))))
	if in.BudgetTokens < 0 {
		in.BudgetTokens = 0
	}
	return in
}

func ValidateAIReasoningLevel(level AIReasoningLevel) bool {
	switch NormalizeAIReasoningSelection(AIReasoningSelection{Level: level}).Level {
	case "", AIReasoningLevelDefault, AIReasoningLevelOff, AIReasoningLevelMinimal, AIReasoningLevelLow, AIReasoningLevelMedium, AIReasoningLevelHigh, AIReasoningLevelXHigh, AIReasoningLevelMax:
		return true
	default:
		return false
	}
}

func (c AIReasoningCapability) Normalize() AIReasoningCapability {
	out := c
	out.Kind = strings.TrimSpace(strings.ToLower(out.Kind))
	out.DefaultLevel = string(NormalizeAIReasoningSelection(AIReasoningSelection{Level: AIReasoningLevel(out.DefaultLevel)}).Level)
	out.WireShape = strings.TrimSpace(strings.ToLower(out.WireShape))
	out.DisableShape = strings.TrimSpace(strings.ToLower(out.DisableShape))
	out.BudgetShape = strings.TrimSpace(strings.ToLower(out.BudgetShape))
	out.SourceCheckedAt = strings.TrimSpace(out.SourceCheckedAt)
	out.Fixture = strings.TrimSpace(out.Fixture)
	out.SupportedLevels = normalizeReasoningLevelStrings(out.SupportedLevels)
	out.SourceURLs = normalizeStringList(out.SourceURLs)
	out.ResponseReasoningFields = normalizeStringList(out.ResponseReasoningFields)
	out.HistoryReplayRequirements = normalizeStringList(out.HistoryReplayRequirements)
	if out.MinBudgetTokens < 0 {
		out.MinBudgetTokens = 0
	}
	if out.MaxBudgetTokens < 0 {
		out.MaxBudgetTokens = 0
	}
	return out
}

func (c AIReasoningCapability) IsZero() bool {
	c = c.Normalize()
	return c.Kind == "" && c.WireShape == "" && len(c.SupportedLevels) == 0 && c.BudgetShape == "" && !c.DisableSupported && !c.DynamicProviderMetadata
}

func (c AIReasoningCapability) SupportsBudget() bool {
	c = c.Normalize()
	return c.BudgetShape != "" || c.MinBudgetTokens > 0 || c.MaxBudgetTokens > 0
}

func (c AIReasoningCapability) SupportsLevel(level AIReasoningLevel) bool {
	c = c.Normalize()
	selection := NormalizeAIReasoningSelection(AIReasoningSelection{Level: level})
	level = selection.Level
	switch level {
	case "":
		return true
	case AIReasoningLevelDefault:
		return c.Kind != ""
	case AIReasoningLevelOff:
		if c.DisableSupported {
			return true
		}
	}
	for _, item := range c.SupportedLevels {
		if item == string(level) {
			return true
		}
	}
	return false
}

func (c AIReasoningCapability) Validate() error {
	c = c.Normalize()
	if c.IsZero() {
		return nil
	}
	if c.Kind == "" {
		return errors.New("missing kind")
	}
	if c.WireShape == "" {
		return errors.New("missing wire_shape")
	}
	for _, level := range c.SupportedLevels {
		if !ValidateAIReasoningLevel(AIReasoningLevel(level)) || level == "" || level == string(AIReasoningLevelDefault) {
			return fmt.Errorf("unsupported reasoning level %q", level)
		}
	}
	if c.DefaultLevel != "" && !c.SupportsLevel(AIReasoningLevel(c.DefaultLevel)) {
		return fmt.Errorf("default_level %q is not supported", c.DefaultLevel)
	}
	if c.MinBudgetTokens > 0 && c.MaxBudgetTokens > 0 && c.MinBudgetTokens > c.MaxBudgetTokens {
		return fmt.Errorf("min_budget_tokens %d exceeds max_budget_tokens %d", c.MinBudgetTokens, c.MaxBudgetTokens)
	}
	if c.SourceCheckedAt != aiReasoningSourceCheckedAt {
		return fmt.Errorf("source_checked_at must be %s", aiReasoningSourceCheckedAt)
	}
	if len(c.SourceURLs) == 0 {
		return errors.New("missing source_urls")
	}
	if c.Fixture == "" {
		return errors.New("missing fixture")
	}
	return nil
}

func ValidateAIReasoningSelection(capability AIReasoningCapability, selection AIReasoningSelection) error {
	capability = capability.Normalize()
	selection = NormalizeAIReasoningSelection(selection)
	if selection.IsZero() {
		return nil
	}
	if capability.IsZero() {
		return errors.New("model does not support reasoning selection")
	}
	if !ValidateAIReasoningLevel(selection.Level) {
		return fmt.Errorf("unsupported reasoning level %q", selection.Level)
	}
	if selection.Level != "" && !capability.SupportsLevel(selection.Level) {
		return fmt.Errorf("reasoning level %q is not supported by this model", selection.Level)
	}
	if selection.BudgetTokens > 0 {
		if selection.Level == AIReasoningLevelOff {
			return errors.New("reasoning budget cannot be set when reasoning is off")
		}
		if !capability.SupportsBudget() {
			return errors.New("reasoning budget is not supported by this model")
		}
		if capability.MinBudgetTokens > 0 && selection.BudgetTokens < int64(capability.MinBudgetTokens) {
			return fmt.Errorf("reasoning budget %d is below minimum %d", selection.BudgetTokens, capability.MinBudgetTokens)
		}
		if capability.MaxBudgetTokens > 0 && selection.BudgetTokens > int64(capability.MaxBudgetTokens) {
			return fmt.Errorf("reasoning budget %d exceeds maximum %d", selection.BudgetTokens, capability.MaxBudgetTokens)
		}
	}
	return nil
}

func normalizeReasoningLevelStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, item := range in {
		level := NormalizeAIReasoningSelection(AIReasoningSelection{Level: AIReasoningLevel(item)}).Level
		if level == "" {
			continue
		}
		key := string(level)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func normalizeStringList(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, item := range in {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

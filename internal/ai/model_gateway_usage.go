package ai

import (
	"encoding/json"
	"errors"
	"fmt"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	openai "github.com/openai/openai-go"
	oresponses "github.com/openai/openai-go/responses"
)

func turnUsageFromOpenAIResponse(usage oresponses.ResponseUsage) (TurnUsage, error) {
	return normalizedPromptUsage(
		usage.InputTokens,
		usage.OutputTokens,
		usage.OutputTokensDetails.ReasoningTokens,
		usage.InputTokensDetails.CachedTokens,
		0,
	)
}

func turnUsageFromOpenAICompletion(usage openai.CompletionUsage) (TurnUsage, error) {
	cacheRead := usage.PromptTokensDetails.CachedTokens
	typedCacheReadPresent := usage.PromptTokensDetails.JSON.CachedTokens.Valid()
	var extra struct {
		PromptCacheHitTokens *int64 `json:"prompt_cache_hit_tokens"`
	}
	if raw := usage.RawJSON(); raw != "" {
		if err := json.Unmarshal([]byte(raw), &extra); err != nil {
			return TurnUsage{}, fmt.Errorf("decode provider usage details: %w", err)
		}
	}
	if extra.PromptCacheHitTokens != nil {
		if typedCacheReadPresent && cacheRead != *extra.PromptCacheHitTokens {
			return TurnUsage{}, errors.New("provider cache-read token fields disagree")
		}
		if !typedCacheReadPresent {
			cacheRead = *extra.PromptCacheHitTokens
		}
	}
	return normalizedPromptUsage(
		usage.PromptTokens,
		usage.CompletionTokens,
		usage.CompletionTokensDetails.ReasoningTokens,
		cacheRead,
		0,
	)
}

func turnUsageFromAnthropic(usage anthropic.Usage) (TurnUsage, error) {
	out := TurnUsage{
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
		CacheReadTokens: usage.CacheReadInputTokens, CacheWriteTokens: usage.CacheCreationInputTokens,
	}
	if err := validateTurnUsage(out); err != nil {
		return TurnUsage{}, err
	}
	return out, nil
}

func normalizedPromptUsage(totalInput, output, reasoning, cacheRead, cacheWrite int64) (TurnUsage, error) {
	if totalInput < 0 || output < 0 || reasoning < 0 || cacheRead < 0 || cacheWrite < 0 {
		return TurnUsage{}, errors.New("provider usage token counts must not be negative")
	}
	if cacheRead > totalInput {
		return TurnUsage{}, errors.New("provider cache-read tokens exceed total input tokens")
	}
	out := TurnUsage{
		InputTokens: totalInput - cacheRead, OutputTokens: output, ReasoningTokens: reasoning,
		CacheReadTokens: cacheRead, CacheWriteTokens: cacheWrite,
	}
	if err := validateTurnUsage(out); err != nil {
		return TurnUsage{}, err
	}
	return out, nil
}

func validateTurnUsage(usage TurnUsage) error {
	if usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.ReasoningTokens < 0 || usage.CacheReadTokens < 0 || usage.CacheWriteTokens < 0 {
		return errors.New("model gateway usage token counts must not be negative")
	}
	return nil
}

func partialUsageFromTurnUsage(usage TurnUsage) *PartialUsage {
	return &PartialUsage{
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, ReasoningTokens: usage.ReasoningTokens,
		CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
	}
}

func validatePartialUsage(usage PartialUsage) error {
	return validateTurnUsage(TurnUsage(usage))
}

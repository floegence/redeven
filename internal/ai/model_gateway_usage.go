package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	openai "github.com/openai/openai-go/v3"
	oresponses "github.com/openai/openai-go/v3/responses"
)

func turnUsageFromOpenAIResponse(usage oresponses.ResponseUsage) (TurnUsage, error) {
	out, err := normalizedPromptUsage(
		usage.InputTokens,
		usage.OutputTokens,
		usage.OutputTokensDetails.ReasoningTokens,
		usage.InputTokensDetails.CachedTokens,
		usage.InputTokensDetails.CacheWriteTokens,
	)
	out.TotalTokens, out.TotalTokensReported = usage.TotalTokens, usage.JSON.TotalTokens.Valid()
	out.InputTokensReported = usage.JSON.InputTokens.Valid() || usage.InputTokens > 0
	out.OutputTokensReported = usage.JSON.OutputTokens.Valid()
	out.InputTokenScope = "provider_execution"
	out.Available = usage.JSON.InputTokens.Valid() || usage.JSON.OutputTokens.Valid() || usage.InputTokens > 0 || usage.OutputTokens > 0
	if err == nil {
		err = validateTurnUsage(out)
	}
	return out, err
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
	out, err := normalizedPromptUsage(
		usage.PromptTokens,
		usage.CompletionTokens,
		usage.CompletionTokensDetails.ReasoningTokens,
		cacheRead,
		0,
	)
	out.TotalTokens, out.TotalTokensReported = usage.TotalTokens, usage.JSON.TotalTokens.Valid()
	out.InputTokensReported = usage.JSON.PromptTokens.Valid() || usage.PromptTokens > 0
	out.OutputTokensReported = usage.JSON.CompletionTokens.Valid()
	out.InputTokenScope = "request_input"
	out.Available = usage.JSON.PromptTokens.Valid() || usage.JSON.CompletionTokens.Valid() || usage.PromptTokens > 0 || usage.CompletionTokens > 0
	if err == nil {
		err = validateTurnUsage(out)
	}
	return out, err
}

func normalizedPromptUsage(totalInput, output, reasoning, cacheRead, cacheWrite int64) (TurnUsage, error) {
	if totalInput < 0 || output < 0 || reasoning < 0 || cacheRead < 0 || cacheWrite < 0 {
		return TurnUsage{}, errors.New("provider usage token counts must not be negative")
	}
	if cacheRead > totalInput || cacheWrite > totalInput-cacheRead {
		return TurnUsage{}, errors.New("provider cached tokens exceed total input tokens")
	}
	out := TurnUsage{
		OutputIncludesReasoning: true,
		InputTokens:             totalInput - cacheRead - cacheWrite, OutputTokens: output, ReasoningTokens: reasoning,
		CacheReadTokens: cacheRead, CacheWriteTokens: cacheWrite,
	}
	if err := validateTurnUsage(out); err != nil {
		return TurnUsage{}, err
	}
	return out, nil
}

func validateTurnUsage(usage TurnUsage) error {
	if usage.TotalTokens < 0 || usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.ReasoningTokens < 0 || usage.CacheReadTokens < 0 || usage.CacheWriteTokens < 0 {
		return errors.New("model gateway usage token counts must not be negative")
	}
	reasoning := usage.ReasoningTokens
	if usage.OutputIncludesReasoning {
		reasoning = 0
	}
	remaining := int64(math.MaxInt64)
	for _, tokens := range []int64{usage.InputTokens, usage.OutputTokens, reasoning, usage.CacheReadTokens, usage.CacheWriteTokens} {
		if tokens > remaining {
			return errors.New("model gateway usage total overflows int64")
		}
		remaining -= tokens
	}
	return nil
}

func partialUsageFromTurnUsage(usage TurnUsage) *PartialUsage {
	return &PartialUsage{
		OutputTokensReported: usage.OutputTokensReported,
		InputTokensReported:  usage.InputTokensReported, InputTokenScope: usage.InputTokenScope,
		TotalTokens: usage.TotalTokens, TotalTokensReported: usage.TotalTokensReported, OutputIncludesReasoning: usage.OutputIncludesReasoning, Available: usage.Available,
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, ReasoningTokens: usage.ReasoningTokens,
		CacheReadTokens: usage.CacheReadTokens, CacheWriteTokens: usage.CacheWriteTokens,
	}
}

func validatePartialUsage(usage PartialUsage) error {
	return validateTurnUsage(TurnUsage(usage))
}

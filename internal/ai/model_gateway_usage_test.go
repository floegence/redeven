package ai

import (
	"encoding/json"
	"math"
	"testing"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	openai "github.com/openai/openai-go/v3"
	oresponses "github.com/openai/openai-go/v3/responses"
)

func TestProviderUsageNormalizationKeepsDisjointCacheBuckets(t *testing.T) {
	t.Parallel()

	var responseUsage oresponses.ResponseUsage
	if err := json.Unmarshal([]byte(`{
		"input_tokens":100,"input_tokens_details":{"cached_tokens":40},
		"output_tokens":20,"output_tokens_details":{"reasoning_tokens":5},"total_tokens":120
	}`), &responseUsage); err != nil {
		t.Fatal(err)
	}
	response, err := turnUsageFromOpenAIResponse(responseUsage)
	if err != nil {
		t.Fatal(err)
	}
	assertTurnUsage(t, response, TurnUsage{InputTokens: 60, OutputTokens: 20, ReasoningTokens: 5, CacheReadTokens: 40})

	var chatUsage openai.CompletionUsage
	if err := json.Unmarshal([]byte(`{
		"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,
		"prompt_tokens_details":{"cached_tokens":40},
		"completion_tokens_details":{"reasoning_tokens":5}
	}`), &chatUsage); err != nil {
		t.Fatal(err)
	}
	chat, err := turnUsageFromOpenAICompletion(chatUsage)
	if err != nil {
		t.Fatal(err)
	}
	assertTurnUsage(t, chat, TurnUsage{InputTokens: 60, OutputTokens: 20, ReasoningTokens: 5, CacheReadTokens: 40})

	var deepSeekUsage openai.CompletionUsage
	if err := json.Unmarshal([]byte(`{
		"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,
		"prompt_cache_hit_tokens":35
	}`), &deepSeekUsage); err != nil {
		t.Fatal(err)
	}
	deepSeek, err := turnUsageFromOpenAICompletion(deepSeekUsage)
	if err != nil {
		t.Fatal(err)
	}
	assertTurnUsage(t, deepSeek, TurnUsage{InputTokens: 65, OutputTokens: 20, CacheReadTokens: 35})

	var anthropicUsage anthropic.Usage
	if err := json.Unmarshal([]byte(`{
		"input_tokens":10,"output_tokens":20,
		"cache_read_input_tokens":70,"cache_creation_input_tokens":20
	}`), &anthropicUsage); err != nil {
		t.Fatal(err)
	}
	claude, err := turnUsageFromAnthropic(anthropicUsage)
	if err != nil {
		t.Fatal(err)
	}
	assertTurnUsage(t, claude, TurnUsage{InputTokens: 10, OutputTokens: 20, CacheReadTokens: 70, CacheWriteTokens: 20})
}

func TestProviderUsageNormalizationRejectsInvalidCacheCounts(t *testing.T) {
	t.Parallel()

	if _, err := normalizedPromptUsage(10, 2, 0, 11, 0); err == nil {
		t.Fatal("cache-read tokens above total input must fail")
	}
	var conflicting openai.CompletionUsage
	if err := json.Unmarshal([]byte(`{
		"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,
		"prompt_tokens_details":{"cached_tokens":40},"prompt_cache_hit_tokens":35
	}`), &conflicting); err != nil {
		t.Fatal(err)
	}
	if _, err := turnUsageFromOpenAICompletion(conflicting); err == nil {
		t.Fatal("conflicting cache-read fields must fail")
	}
}

func TestFloretUsageKeepsCacheOnlyProviderUsageAvailable(t *testing.T) {
	t.Parallel()

	usage := floretUsageFromFlower(TurnUsage{CacheReadTokens: 100})
	if !usage.Available || usage.TotalTokens != 100 || usage.CacheReadTokens != 100 {
		t.Fatalf("Floret usage=%#v, want available cache-only usage", usage)
	}
}

func assertTurnUsage(t *testing.T, got, want TurnUsage) {
	t.Helper()
	if got != want {
		t.Fatalf("usage=%#v, want %#v", got, want)
	}
}

func TestOpenAIUsageValidatesCacheWritesWithoutOverflow(t *testing.T) {
	for _, sample := range []struct {
		total, read, write int64
		valid              bool
	}{{100, 40, 10, true}, {100, 0, 0, true}, {0, 0, 0, true}, {100, 70, 31, false}, {100, 0, 101, false}, {math.MaxInt64, math.MaxInt64, 1, false}, {math.MaxInt64, math.MaxInt64 - 1, 1, true}, {100, -1, 0, false}, {100, 0, -1, false}} {
		usage, err := normalizedPromptUsage(sample.total, 0, 0, sample.read, sample.write)
		if (err == nil) != sample.valid {
			t.Fatalf("sample=%+v usage=%+v err=%v", sample, usage, err)
		}
		if err == nil && usage.InputTokens != sample.total-sample.read-sample.write {
			t.Fatal(usage)
		}
	}
	var usage oresponses.ResponseUsage
	if err := json.Unmarshal([]byte(`{"input_tokens":100,"input_tokens_details":{"cached_tokens":40,"cache_write_tokens":10}}`), &usage); err != nil {
		t.Fatal(err)
	}
	got, err := turnUsageFromOpenAIResponse(usage)
	if err != nil || got.InputTokens != 50 || got.CacheWriteTokens != 10 {
		t.Fatalf("usage=%+v %v", got, err)
	}
}

func TestProviderUsageRejectsAggregateOverflow(t *testing.T) {
	if _, err := normalizedPromptUsage(math.MaxInt64, 1, 0, 0, 0); err == nil {
		t.Fatal("aggregate overflow accepted")
	}
}

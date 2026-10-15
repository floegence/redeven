package ai

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
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

func TestResponsesFailedAttemptRetainsOnlyExplicitUsage(t *testing.T) {
	for _, tc := range []struct {
		name, event, usage string
		chatGPT            bool
	}{
		{"failed", "response.failed", `,"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40}}`, false},
		{"interrupted", "response.in_progress", `,"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40}}`, false},
		{"chatgpt_incomplete", "response.incomplete", `,"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":40}}`, true},
		{"unknown_usage", "response.failed", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprintf(w, "data: {\"type\":\"%s\",\"response\":{\"error\":{\"code\":\"server_error\"}%s}}\n\n", tc.event, tc.usage)
			}))
			defer server.Close()
			raw, err := newProviderAdapter("openai", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			gateway := raw.(*openAIProvider)
			gateway.chatGPT = tc.chatGPT
			result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "test", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}, nil)
			if err == nil {
				t.Fatal("unfinished response accepted")
			}
			want := TurnUsage{}
			if tc.usage != "" {
				want = TurnUsage{InputTokens: 60, OutputTokens: 20, CacheReadTokens: 40}
			}
			assertTurnUsage(t, result.Usage, want)
			if result.FinishReason != "" || len(result.ToolCalls) != 0 {
				t.Fatalf("failed attempt completed: %+v", result)
			}
		})
	}
}

func TestAnthropicFailedAttemptRetainsReportedUsage(t *testing.T) {
	for _, mode := range []string{"overloaded", "interrupted"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, `event: message_start
data: {"type":"message_start","message":{"id":"msg-usage","type":"message","role":"assistant","model":"test","content":[],"usage":{"input_tokens":60,"output_tokens":2,"cache_read_input_tokens":40}}}

`)
				if mode == "overloaded" {
					fmt.Fprint(w, "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\"}}\n\n")
				}
			}))
			defer server.Close()
			gateway, err := newProviderAdapter("anthropic", server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "test", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}, nil)
			if err == nil {
				t.Fatal("unfinished response accepted")
			}
			assertTurnUsage(t, result.Usage, TurnUsage{InputTokens: 60, OutputTokens: 2, CacheReadTokens: 40})
		})
	}
}

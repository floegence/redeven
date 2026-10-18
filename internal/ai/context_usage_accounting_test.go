package ai

import (
	"encoding/json"
	"testing"

	"github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	oresponses "github.com/openai/openai-go/v3/responses"
)

// Native totals and protocol inclusion survive both gateway and Floret mapping.
func TestOpenAIReasoningIsIncludedOnceInTotal(t *testing.T) {
	var raw oresponses.ResponseUsage
	if err := json.Unmarshal([]byte(`{"input_tokens":100,"output_tokens":20,"output_tokens_details":{"reasoning_tokens":5},"total_tokens":120}`), &raw); err != nil {
		t.Fatal(err)
	}
	turn, err := turnUsageFromOpenAIResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	got := floretUsageFromFlower(turn)
	if got.TotalTokens != raw.TotalTokens {
		t.Fatalf("native total changed: raw=%+v normalized=%+v", raw, got)
	}
	if (got.InputTokens + got.CacheReadTokens + got.CacheWriteTokens) != raw.InputTokens {
		t.Fatalf("context input must remain separate from this total issue: %+v", got)
	}
	t.Logf("reported_total=%d normalized_total=%d window_input=%d", raw.TotalTokens, got.TotalTokens, (got.InputTokens + got.CacheReadTokens + got.CacheWriteTokens))
}

func TestFlowerContextMappingUsesPublishedCharacters(t *testing.T) {
	for _, total := range []int64{0, 1, 126467} {
		status := observation.ContextStatus{RunID: "run", RequestID: "request", PayloadFingerprint: "fingerprint", Provider: "openai", Model: "test", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable,
			Usage:           observation.ProviderUsage{Available: true, InputTokensReported: true, InputTokenScope: "provider_execution", Source: "native", InputTokens: total, WindowInputTokens: total},
			RequestEstimate: config.RequestEstimate{Characters: &config.ContextCharacterBreakdown{Source: "prepared_characters_v1", Unit: "unicode_code_points", TotalCharacters: 169903, Categories: []config.ContextCharacterCategory{{Category: "tool_result", Characters: 169903}}}},
		}
		got, err := flowerContextSampleFromFloret(&status)
		if err != nil || !got.Available || !got.Measured || !got.CharactersAvailable || got.Characters.TotalCharacters != 169903 || got.InputTokens != total {
			t.Fatalf("mapping=%+v err=%v", got, err)
		}
		if got.RequestID != status.RequestID || got.PayloadFingerprint != status.PayloadFingerprint {
			t.Fatal("request identity lost")
		}
		status.RequestEstimate.Characters = nil
		historical, err := flowerContextSampleFromFloret(&status)
		if err != nil || !historical.Available || historical.CharactersAvailable {
			t.Fatalf("historical=%+v err=%v", historical, err)
		}
		raw, err := json.Marshal(historical)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err := json.Unmarshal(raw, &fields); err != nil {
			t.Fatal(err)
		}
		if _, ok := fields["input_tokens"]; !ok {
			t.Fatal("explicit zero omitted")
		}
		if _, ok := fields["unattributed_tokens"]; ok {
			t.Fatal("obsolete token remainder exposed")
		}
	}
}

func TestFlowerContextMappingCopiesCharacterDetails(t *testing.T) {
	status := observation.ContextStatus{RunID: "run", RequestID: "request", PayloadFingerprint: "fingerprint", Provider: "test", Model: "test", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable,
		Usage:           observation.ProviderUsage{Available: true, Source: "native", InputTokens: 100, WindowInputTokens: 100},
		RequestEstimate: config.RequestEstimate{Characters: &config.ContextCharacterBreakdown{Source: "prepared_characters_v1", Unit: "unicode_code_points", TotalCharacters: 20, Categories: []config.ContextCharacterCategory{{Category: "tool_definition", Characters: 20, Details: []config.ContextCharacterDetail{{Key: "read", Characters: 20}}}}}},
	}
	got, err := flowerContextSampleFromFloret(&status)
	if err != nil || got.Characters == nil {
		t.Fatalf("%+v %v", got, err)
	}
	got.Characters.Categories[0].Details[0].Characters = -1
	if status.RequestEstimate.Characters.Categories[0].Details[0].Characters != 20 {
		t.Fatal("display mutated canonical attribution")
	}
	status.RequestEstimate.Characters.Categories[0].Characters = -1
	got, err = flowerContextSampleFromFloret(&status)
	if err != nil || !got.Available || got.CharactersAvailable {
		t.Fatalf("optional damage discarded usable total: %+v %v", got, err)
	}
	status.Phase = observation.ContextPhaseProjectedRequest
	got, err = flowerContextSampleFromFloret(&status)
	if err != nil || got.Available {
		t.Fatalf("estimate became measured display: %+v %v", got, err)
	}
}

func TestOpenAIUsagePreservesNativeZeroAndMissingTotal(t *testing.T) {
	for _, value := range []struct {
		raw     string
		total   int64
		present bool
	}{
		{raw: `{"input_tokens":100,"output_tokens":20,"output_tokens_details":{"reasoning_tokens":5}}`, total: 120},
		{raw: `{"input_tokens":0,"output_tokens":0,"total_tokens":0}`, present: true},
		{raw: `{"input_tokens":100,"output_tokens":20,"total_tokens":999}`, total: 999, present: true},
	} {
		var raw oresponses.ResponseUsage
		if err := json.Unmarshal([]byte(value.raw), &raw); err != nil {
			t.Fatal(err)
		}
		turn, err := turnUsageFromOpenAIResponse(raw)
		if err != nil {
			t.Fatal(err)
		}
		got := floretUsageFromFlower(turn)
		if got.TotalTokens != value.total || got.TotalTokensReported != value.present || !got.Available || !got.OutputIncludesReasoning {
			t.Fatalf("%+v", got)
		}
		partial := partialUsageFromTurnUsage(turn)
		if floretUsageFromFlower(TurnUsage(*partial)) != got {
			t.Fatal("stream and final usage differ")
		}
	}
}

func TestEmptyOpenAIUsageIsNotAMeasurement(t *testing.T) {
	var raw oresponses.ResponseUsage
	if err := json.Unmarshal([]byte("{}"), &raw); err != nil {
		t.Fatal(err)
	}
	turn, err := turnUsageFromOpenAIResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if floretUsageFromFlower(turn).Available {
		t.Fatal("missing usage became measured zero")
	}
}

func TestFlowerRecentCacheRequiresConfirmedInputMeasurement(t *testing.T) {
	for _, reported := range []bool{false, true} {
		status := &observation.ContextStatus{RunID: "run", RequestID: "request", PayloadFingerprint: "fingerprint", Provider: "openai", Model: "test", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable, Usage: observation.ProviderUsage{Available: true, Source: "native", InputTokensReported: reported, InputTokenScope: "provider_execution", OutputTokens: 1}}
		got, err := flowerContextUsageFromFloret(&flruntime.ThreadContextUsage{Confirmed: status}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if (got.RecentRequestUsage != nil) != reported || got.Confirmed.Available != reported {
			t.Fatalf("reported=%t mapping=%+v", reported, got)
		}
	}
}

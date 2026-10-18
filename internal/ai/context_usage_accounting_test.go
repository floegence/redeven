package ai

import (
	"encoding/json"
	"testing"

	"github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/observation"
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

func TestFlowerContextMappingUsesPublishedReconciliation(t *testing.T) {
	for _, tc := range []struct {
		name                                string
		total, category                     int64
		legacy, damaged, partial, projected bool
		available, details                  bool
	}{
		{name: "screenshot", total: 46292, category: 18363, available: true, details: true},
		{name: "equal", total: 100, category: 100, available: true, details: true},
		{name: "over", total: 100, category: 101, available: true},
		{name: "zero", available: true, details: true},
		{name: "legacy", total: 100, category: 99, legacy: true, available: true},
		{name: "damaged", total: 100, category: 20, damaged: true, available: true},
		{name: "partial", category: 20, partial: true, projected: true},
		{name: "complete_estimate", category: 20, projected: true, available: true, details: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status := observation.ContextStatus{RunID: "run", RequestID: "request", PayloadFingerprint: "fingerprint", Provider: "openai", Model: "test", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable,
				Usage:           observation.ProviderUsage{Available: true, Source: "native", WindowInputTokens: tc.total},
				RequestEstimate: config.RequestEstimate{EstimatedInputTokens: 99999, Breakdown: config.ContextBreakdown{Source: "prepared_content_v4", Quality: "token_estimate", Tokenizer: "proxy_bpe", AttributionCoverage: "complete", UserTokens: tc.category}},
			}
			if tc.legacy {
				status.RequestEstimate.Breakdown.Source = "prepared_content_v3"
			}
			if tc.damaged {
				status.RequestEstimate.Breakdown.Details = &config.ContextBreakdownDetails{Items: []config.ContextTokenDetail{{Category: "tool_definition", Key: "read", Tokens: 1}}}
			}
			if tc.partial {
				status.RequestEstimate.Breakdown.AttributionCoverage = "partial"
				status.RequestEstimate.Breakdown.Limitation = "hosted_context"
			}
			if tc.projected {
				status.Phase = observation.ContextPhaseProjectedRequest
			}
			want, _ := observation.ReconcileContextStatus(status)
			got, err := flowerContextSampleFromFloret(&status)
			if err != nil || got.Available != tc.available || got.BreakdownAvailable != tc.details || got.InputTokens != want.InputTokens || got.UnattributedTokens != want.UnattributedTokens || got.Measured != want.Measured || got.Limitation != want.Limitation {
				t.Fatalf("mapping=%+v expected=%+v err=%v", got, want, err)
			}
			if got.RequestID != status.RequestID || got.PayloadFingerprint != status.PayloadFingerprint {
				t.Fatal("request identity lost")
			}
			raw, err := json.Marshal(got)
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
		})
	}
}

func TestFlowerContextMappingCopiesAttributionDetails(t *testing.T) {
	status := observation.ContextStatus{RunID: "run", RequestID: "request", PayloadFingerprint: "fingerprint", Provider: "test", Model: "test", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable,
		Usage:           observation.ProviderUsage{Available: true, Source: "native", WindowInputTokens: 100},
		RequestEstimate: config.RequestEstimate{Breakdown: config.ContextBreakdown{Source: "prepared_content_v4", Quality: "token_estimate", Tokenizer: "proxy_bpe", AttributionCoverage: "complete", ToolDefinitionTokens: 20, Details: &config.ContextBreakdownDetails{Items: []config.ContextTokenDetail{{Category: "tool_definition", Key: "read", Tokens: 20}}}}},
	}
	got, err := flowerContextSampleFromFloret(&status)
	if err != nil || got.Breakdown == nil {
		t.Fatalf("%+v %v", got, err)
	}
	got.Breakdown.Details.Items[0].Tokens = -1
	if status.RequestEstimate.Breakdown.Details.Items[0].Tokens != 20 {
		t.Fatal("display mutated canonical attribution")
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

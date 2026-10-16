package ai

import "testing"

func TestFloretModelContextPolicySeparatesCapabilityFromOutputLimit(t *testing.T) {
	policy := floretModelContextPolicy(1_000_000, 0, 384_000)
	if policy.ContextWindowTokens != 1_000_000 || policy.ModelMaxOutputTokens != 384_000 || policy.MaxOutputTokens != 0 || policy.ReservedOutputTokens != 0 {
		t.Fatalf("policy=%#v, want model capability without fixed output reservation", policy)
	}
}

func TestFloretModelContextPolicyPrefersExplicitRunBudget(t *testing.T) {
	policy := floretModelContextPolicy(1_000_000, 32_000, 384_000)
	if policy.ModelMaxOutputTokens != 384_000 || policy.MaxOutputTokens != 32_000 || policy.ReservedOutputTokens != 0 {
		t.Fatalf("policy=%#v, want exact explicit limit without legacy reservation", policy)
	}
}

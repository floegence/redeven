package ai

import "testing"

func TestFloretModelContextPolicyUsesCapabilityOutputHeadroomByDefault(t *testing.T) {
	policy := floretModelContextPolicy(1_000_000, 0, 384_000)
	if policy.ContextWindowTokens != 1_000_000 || policy.MaxOutputTokens != 384_000 || policy.ReservedOutputTokens != 384_000 {
		t.Fatalf("policy=%#v, want DeepSeek capability output headroom", policy)
	}
}

func TestFloretModelContextPolicyPrefersExplicitRunBudget(t *testing.T) {
	policy := floretModelContextPolicy(1_000_000, 32_000, 384_000)
	if policy.MaxOutputTokens != 32_000 || policy.ReservedOutputTokens != 32_000 {
		t.Fatalf("policy=%#v, want explicit run output headroom", policy)
	}
}

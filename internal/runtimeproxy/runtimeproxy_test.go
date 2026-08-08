package runtimeproxy

import (
	"slices"
	"testing"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

func TestApplyOptionsBlocksOnlyEmbeddingPolicies(t *testing.T) {
	t.Parallel()

	opts := Options{BlockedResponseHeaders: []string{"x-product-secret"}}
	proxy, err := New(opts)
	if err == nil || proxy != nil {
		t.Fatalf("expected invalid empty upstream")
	}
	_ = flowersec.ProxyServerOptions{}

	wantBlocked := []string{
		"x-product-secret",
		"Content-Security-Policy",
		"Content-Security-Policy-Report-Only",
		"X-Frame-Options",
	}
	blocked := append(append([]string{}, opts.BlockedResponseHeaders...), ProductBlockedResponseHeaders()...)
	if !slices.Equal(blocked, wantBlocked) {
		t.Fatalf("BlockedResponseHeaders = %#v, want %#v", blocked, wantBlocked)
	}
	for _, preserved := range []string{
		"x-content-type-options",
		"referrer-policy",
		"permissions-policy",
		"cross-origin-opener-policy",
		"cross-origin-embedder-policy",
		"cross-origin-resource-policy",
	} {
		if slices.Contains(opts.BlockedResponseHeaders, preserved) {
			t.Fatalf("BlockedResponseHeaders must preserve default security header %q", preserved)
		}
	}
}

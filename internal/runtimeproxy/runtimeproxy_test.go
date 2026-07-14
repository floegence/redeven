package runtimeproxy

import (
	"slices"
	"testing"

	fsproxy "github.com/floegence/flowersec/flowersec-go/proxy"
)

func TestApplyOptionsBlocksOnlyEmbeddingPolicies(t *testing.T) {
	t.Parallel()

	opts := ApplyOptions(fsproxy.Options{
		ContractOptions: fsproxy.ContractOptions{
			BlockedResponseHeaders: []string{"x-product-secret"},
		},
	})

	wantBlocked := []string{
		"x-product-secret",
		"content-security-policy",
		"content-security-policy-report-only",
		"x-frame-options",
	}
	if !slices.Equal(opts.BlockedResponseHeaders, wantBlocked) {
		t.Fatalf("BlockedResponseHeaders = %#v, want %#v", opts.BlockedResponseHeaders, wantBlocked)
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

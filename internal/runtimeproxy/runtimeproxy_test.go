package runtimeproxy

import (
	"reflect"
	"testing"

	fsproxy "github.com/floegence/flowersec/flowersec-go/proxy"
)

func TestProductBlockedResponseHeaders(t *testing.T) {
	t.Parallel()

	want := []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only", "X-Frame-Options"}
	if got := ProductBlockedResponseHeaders(); !reflect.DeepEqual(got, want) {
		t.Fatalf("ProductBlockedResponseHeaders() = %v, want %v", got, want)
	}

	opts := ApplyOptions(fsproxy.Options{ContractOptions: fsproxy.ContractOptions{BlockedResponseHeaders: ProductBlockedResponseHeaders()}})
	if !reflect.DeepEqual(opts.BlockedResponseHeaders, want) {
		t.Fatalf("ApplyOptions blocked headers = %v, want %v", opts.BlockedResponseHeaders, want)
	}
}

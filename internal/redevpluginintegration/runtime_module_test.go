package redevpluginintegration

import (
	"os"
	"strings"
	"testing"
)

func TestOfficialRuntimeVersionMatchesReleasedPlatform(t *testing.T) {
	if officialRuntimeVersion != "0.7.27" {
		t.Fatalf("official runtime version = %q, want 0.7.27", officialRuntimeVersion)
	}
}

func TestOfficialRuntimeTrustAnchorComesFromBundledDescriptor(t *testing.T) {
	raw, err := os.ReadFile("runtime_module.go")
	if err != nil {
		t.Fatalf("read runtime module source: %v", err)
	}
	source := string(raw)
	if strings.Contains(source, "sha256File(runtimePath)") {
		t.Fatal("runtime admission derives its expected digest from the live binary instead of bundled release evidence")
	}
	if !strings.Contains(source, "BundledRuntimeDescriptor") {
		t.Fatal("runtime admission does not consume the product-owned bundled runtime descriptor")
	}
}

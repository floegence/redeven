package redevpluginintegration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redevplugin/pkg/version"
)

func TestOfficialRuntimeVersionMatchesReleasedPlatform(t *testing.T) {
	if officialRuntimeVersion != "1.1.3" {
		t.Fatalf("official runtime version = %q, want 1.1.3", officialRuntimeVersion)
	}
}

func TestBundledRuntimeDescriptorUsesReleasedDigest(t *testing.T) {
	const releasedDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	marker := map[string]any{
		"schema_version": "redeven.redevplugin_runtime_build.v1",
		"platform_publication": map[string]any{
			"platform_version": officialRuntimeVersion, "contract_set_sha256": version.ContractSetSHA256,
		},
		"product_build": map[string]any{"ignored": true},
		"runtime": map[string]any{
			"target": "linux/amd64",
			"binary": map[string]any{"path": "redevplugin-runtime", "sha256": releasedDigest, "size": 42},
		},
	}
	raw, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), bundledRuntimeDescriptorName)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	descriptor, err := bundledRuntimeDescriptor(path, "linux/amd64")
	if err != nil {
		t.Fatal(err)
	}
	if descriptor.BinarySHA256().String() != releasedDigest {
		t.Fatalf("runtime digest = %s, want released descriptor digest", descriptor.BinarySHA256().String())
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

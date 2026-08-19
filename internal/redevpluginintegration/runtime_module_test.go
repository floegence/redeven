package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/version"
)

func TestOfficialRuntimeVersionMatchesReleasedPlatform(t *testing.T) {
	want := version.CurrentPlatformVersion()
	if officialRuntimeVersion != want {
		t.Fatalf("official runtime version = %q, want release-manifest version %q", officialRuntimeVersion, want)
	}
}

func TestBundledRuntimeDescriptorUsesReleasedDigest(t *testing.T) {
	const releasedDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	marker := map[string]any{
		"schema_version":   "redeven.redevplugin_runtime_build.v1",
		"platform_release": map[string]any{"platform_version": officialRuntimeVersion},
		"product_build":    map[string]any{"ignored": true},
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

func TestOfficialRuntimeModuleKeepsHostAvailableWhenAdmissionIsUnsupported(t *testing.T) {
	runtimeRoot := t.TempDir()
	runtimePath := filepath.Join(runtimeRoot, "redevplugin-runtime")
	if err := os.WriteFile(runtimePath, []byte("runtime fixture"), 0o500); err != nil {
		t.Fatal(err)
	}
	writeRuntimeDescriptorFixture(t, runtimeRoot)

	module, err := newOfficialRuntimeModuleForPlatform(
		context.Background(),
		runtimeModuleDependencies{
			Path:          runtimePath,
			ExecutionRoot: filepath.Join(runtimeRoot, "runtime-exec"),
		},
		"linux/amd64",
		func(context.Context, host.VerifiedExecutableOptions) (*host.VerifiedExecutable, error) {
			return nil, host.ErrRuntimeAdmissionUnsupported
		},
	)
	if err != nil || module != nil {
		t.Fatalf("unsupported admission result = %#v, %v, want optional runtime disabled", module, err)
	}
}

func TestOfficialRuntimeModuleRejectsOtherAdmissionFailures(t *testing.T) {
	runtimeRoot := t.TempDir()
	runtimePath := filepath.Join(runtimeRoot, "redevplugin-runtime")
	if err := os.WriteFile(runtimePath, []byte("runtime fixture"), 0o500); err != nil {
		t.Fatal(err)
	}
	writeRuntimeDescriptorFixture(t, runtimeRoot)
	want := errors.New("runtime digest mismatch")

	module, err := newOfficialRuntimeModuleForPlatform(
		context.Background(),
		runtimeModuleDependencies{
			Path:          runtimePath,
			ExecutionRoot: filepath.Join(runtimeRoot, "runtime-exec"),
		},
		"linux/amd64",
		func(context.Context, host.VerifiedExecutableOptions) (*host.VerifiedExecutable, error) {
			return nil, want
		},
	)
	if module != nil || !errors.Is(err, want) {
		t.Fatalf("invalid admission result = %#v, %v, want exact failure", module, err)
	}
}

func writeRuntimeDescriptorFixture(t *testing.T, root string) {
	t.Helper()
	marker := map[string]any{
		"schema_version":   "redeven.redevplugin_runtime_build.v1",
		"platform_release": map[string]any{"platform_version": officialRuntimeVersion},
		"runtime": map[string]any{
			"target": "linux/amd64",
			"binary": map[string]any{
				"path":   "redevplugin-runtime",
				"sha256": strings.Repeat("a", 64),
				"size":   15,
			},
		},
	}
	raw, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, bundledRuntimeDescriptorName), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

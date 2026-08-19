package supervisor

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProvisionPrecompiledRuntimeInstallsExactSuiteIdempotently(t *testing.T) {
	controller, runtimeRoot, manifestPath, runtimeBytes := newPrecompiledTestController(t)

	bundle, err := controller.provisionPrecompiledRuntime()
	if err != nil {
		t.Fatalf("provisionPrecompiledRuntime() error = %v", err)
	}
	if bundle.Version != "v1.2.3" || bundle.Platform != runtime.GOOS || bundle.Architecture != runtime.GOARCH {
		t.Fatalf("provisioned bundle = %#v", bundle)
	}
	managedPath := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	installed, err := os.ReadFile(managedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(installed) != string(runtimeBytes) {
		t.Fatalf("installed Runtime = %q, want %q", installed, runtimeBytes)
	}
	before, err := os.Stat(managedPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.provisionPrecompiledRuntime(); err != nil {
		t.Fatalf("repeat provisionPrecompiledRuntime() error = %v", err)
	}
	after, err := os.Stat(managedPath)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) {
		t.Fatal("repeat precompiled provisioning replaced an already exact managed Runtime")
	}
	if filepath.Dir(manifestPath) == filepath.Dir(managedPath) {
		t.Fatal("test fixture did not separate the immutable bundle from the managed slot")
	}
}

func TestProvisionPrecompiledRuntimeRejectsTamperedBundleWithoutClaimingManagedSlot(t *testing.T) {
	controller, runtimeRoot, manifestPath, _ := newPrecompiledTestController(t)
	manifestRoot := filepath.Dir(manifestPath)
	if err := os.WriteFile(filepath.Join(manifestRoot, "redeven"), []byte("tampered Runtime"), 0o700); err != nil {
		t.Fatal(err)
	}

	if _, err := controller.provisionPrecompiledRuntime(); err == nil {
		t.Fatal("provisionPrecompiledRuntime() accepted a tampered Runtime")
	}
	if _, err := os.Stat(filepath.Join(runtimeRoot, "runtime", "managed")); !os.IsNotExist(err) {
		t.Fatalf("tampered bundle created a managed Runtime slot: %v", err)
	}
}

func TestProvisionPrecompiledRuntimeFailsClosedForDifferentManagedBytes(t *testing.T) {
	controller, runtimeRoot, _, _ := newPrecompiledTestController(t)
	managedPath := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven")
	writeExecutableFixture(t, managedPath, []byte("different managed Runtime"))

	if _, err := controller.provisionPrecompiledRuntime(); err == nil {
		t.Fatal("provisionPrecompiledRuntime() replaced an unreviewed managed Runtime")
	}
	got, err := os.ReadFile(managedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "different managed Runtime" {
		t.Fatalf("managed Runtime changed after fail-closed conflict: %q", got)
	}
}

func TestProvisionPrecompiledRuntimeFailsClosedForExtraManagedFile(t *testing.T) {
	controller, runtimeRoot, _, _ := newPrecompiledTestController(t)
	if _, err := controller.provisionPrecompiledRuntime(); err != nil {
		t.Fatal(err)
	}
	extraPath := filepath.Join(runtimeRoot, "runtime", "managed", "bin", "unexpected")
	if err := os.WriteFile(extraPath, []byte("unexpected\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := controller.provisionPrecompiledRuntime(); err == nil {
		t.Fatal("provisionPrecompiledRuntime() accepted an extra managed Runtime file")
	}
}

func TestProvisionPrecompiledRuntimeAcceptsPersistedVerifiedManagedUpdate(t *testing.T) {
	controller, runtimeRoot, _, _ := newPrecompiledTestController(t)
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	managedPath := filepath.Join(managedRoot, "bin", "redeven")
	updatedBytes := []byte("#!/bin/sh\nprintf 'redeven v1.3.0\\n'\n")
	writeExecutableFixture(t, managedPath, updatedBytes)
	if err := os.WriteFile(filepath.Join(managedRoot, "bin", "LICENSE"), []byte("reviewed license\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	suiteDigest, executableDigest, err := managedRuntimeSuiteSHA256(managedRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.bindings.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-updated", RuntimeBinaryVersion: "v1.3.0",
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: executableDigest,
		ManagedSuiteSHA256: suiteDigest,
	}); err != nil {
		t.Fatal(err)
	}

	bundle, err := controller.provisionPrecompiledRuntime()
	if err != nil {
		t.Fatalf("provisionPrecompiledRuntime() verified update error = %v", err)
	}
	if bundle.Version != "v1.3.0" || bundle.RuntimeSHA256 != executableDigest {
		t.Fatalf("verified managed update = %#v", bundle)
	}
}

func TestProvisionPrecompiledRuntimeRejectsTamperedVerifiedManagedUpdateSuite(t *testing.T) {
	controller, runtimeRoot, _, _ := newPrecompiledTestController(t)
	managedRoot := filepath.Join(runtimeRoot, "runtime", "managed")
	managedPath := filepath.Join(managedRoot, "bin", "redeven")
	writeExecutableFixture(t, managedPath, []byte("#!/bin/sh\nprintf 'redeven v1.3.0\\n'\n"))
	evidencePath := filepath.Join(managedRoot, "bin", "LICENSE")
	if err := os.WriteFile(evidencePath, []byte("reviewed license\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	suiteDigest, executableDigest, err := managedRuntimeSuiteSHA256(managedRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.bindings.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: "runtime-updated", RuntimeBinaryVersion: "v1.3.0",
		Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		ServiceProtocol: "redeven-runtime-v2", CompatibilityEpoch: 9,
		Capabilities: []string{"lifecycle_fence_v1"}, ArtifactSHA256: executableDigest,
		ManagedSuiteSHA256: suiteDigest,
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(evidencePath, []byte("tampered license\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := controller.provisionPrecompiledRuntime(); err == nil {
		t.Fatal("provisionPrecompiledRuntime() accepted a tampered verified managed suite")
	}
}

func newPrecompiledTestController(t *testing.T) (*Controller, string, string, []byte) {
	t.Helper()
	root := t.TempDir()
	bundleRoot := filepath.Join(root, "bundle")
	runtimeRoot := filepath.Join(root, "runtime-root")
	if err := os.MkdirAll(bundleRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	runtimeBytes := []byte("#!/bin/sh\nprintf 'redeven v1.2.3\\n'\n")
	gatewayBytes := []byte("#!/bin/sh\nprintf 'redeven-gateway v1.2.3\\n'\n")
	writeExecutableFixture(t, filepath.Join(bundleRoot, "redeven"), runtimeBytes)
	writeExecutableFixture(t, filepath.Join(bundleRoot, "redeven-gateway"), gatewayBytes)
	runtimeSuite := []map[string]any{precompiledArtifactFixture("redeven", runtimeBytes, true)}
	if runtime.GOOS == "linux" {
		companions := []struct {
			name       string
			executable bool
		}{
			{name: "redevplugin-runtime", executable: true},
			{name: ".redevplugin-release-artifacts-verified.json"},
			{name: "REDEVPLUGIN_RUNTIME.spdx.json"},
			{name: "REDEVPLUGIN_THIRD_PARTY_NOTICES.md"},
			{name: "redevplugin-runtime.pem"},
			{name: "redevplugin-runtime.provenance.json"},
			{name: "redevplugin-runtime.sig"},
		}
		for _, companion := range companions {
			value := []byte(companion.name + "\n")
			mode := os.FileMode(0o600)
			if companion.executable {
				mode = 0o700
			}
			if err := os.WriteFile(filepath.Join(bundleRoot, companion.name), value, mode); err != nil {
				t.Fatal(err)
			}
			runtimeSuite = append(runtimeSuite, precompiledArtifactFixture(companion.name, value, companion.executable))
		}
	}
	manifest := map[string]any{
		"schema_version": 1,
		"version":        "v1.2.3",
		"commit":         "abc123",
		"platform":       runtime.GOOS,
		"architecture":   runtime.GOARCH,
		"gateway":        precompiledArtifactFixture("redeven-gateway", gatewayBytes, true),
		"runtime_suite":  runtimeSuite,
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(bundleRoot, "desktop-bundle-manifest.json")
	if err := os.WriteFile(manifestPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	bindings, err := OpenLocalBindingStore(filepath.Join(root, "gateway-state"), runtimeRoot)
	if err != nil {
		t.Fatal(err)
	}
	controller, err := NewController(ControllerOptions{
		BindingStore:               bindings,
		PrecompiledRuntimeManifest: manifestPath,
	})
	if err != nil {
		t.Fatal(err)
	}
	return controller, runtimeRoot, manifestPath, runtimeBytes
}

func precompiledArtifactFixture(name string, value []byte, executable bool) map[string]any {
	digest := sha256.Sum256(value)
	return map[string]any{
		"path":       name,
		"sha256":     hex.EncodeToString(digest[:]),
		"size_bytes": len(value),
		"executable": executable,
	}
}

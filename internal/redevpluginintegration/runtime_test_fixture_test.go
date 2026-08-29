package redevpluginintegration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/floegence/redeven/internal/testutil/redevpluginruntime"
)

func testRuntimePath(t *testing.T, root string) string {
	t.Helper()
	cleanup, err := redevpluginruntime.InstallAt(root)
	if err != nil {
		t.Fatalf("install test ReDevPlugin runtime: %v", err)
	}
	t.Cleanup(func() {
		if err := cleanup(); err != nil {
			t.Errorf("cleanup test ReDevPlugin runtime: %v", err)
		}
	})
	runtimePath := filepath.Join(root, "redevplugin-runtime")
	raw, err := os.ReadFile(runtimePath)
	if err != nil {
		t.Fatalf("read test ReDevPlugin runtime: %v", err)
	}
	digest := sha256.Sum256(raw)
	marker := map[string]any{
		"schema_version":   "redeven.redevplugin_runtime_build.v1",
		"platform_release": map[string]any{"platform_version": officialRuntimeVersion},
		"runtime": map[string]any{
			"target": runtime.GOOS + "/" + runtime.GOARCH,
			"binary": map[string]any{
				"path": "redevplugin-runtime", "sha256": hex.EncodeToString(digest[:]), "size": len(raw),
			},
		},
	}
	markerRaw, err := json.Marshal(marker)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, bundledRuntimeDescriptorName), markerRaw, 0o600); err != nil {
		t.Fatalf("write test ReDevPlugin runtime descriptor: %v", err)
	}
	return runtimePath
}

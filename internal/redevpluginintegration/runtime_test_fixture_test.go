package redevpluginintegration

import (
	"path/filepath"
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
	return filepath.Join(root, "redevplugin-runtime")
}

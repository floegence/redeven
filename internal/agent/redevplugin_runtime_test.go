package agent

import (
	"path/filepath"
	"testing"
)

func TestBundledReDevPluginRuntimePathUsesOnlyExecutableSibling(t *testing.T) {
	redevenPath := filepath.Join(string(filepath.Separator), "opt", "redeven", "bin", "redeven")
	got, err := bundledReDevPluginRuntimePath(redevenPath)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(filepath.Dir(redevenPath), "redevplugin-runtime")
	if got != want {
		t.Fatalf("runtime path = %q, want %q", got, want)
	}
	for _, invalid := range []string{"", "redeven", redevenPath + string(filepath.Separator) + ".."} {
		if _, err := bundledReDevPluginRuntimePath(invalid); err == nil {
			t.Fatalf("runtime path resolver accepted %q", invalid)
		}
	}
}

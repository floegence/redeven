package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCommittedCatalogPackageMatchesDeterministicGeneration(t *testing.T) {
	root := filepath.Clean(filepath.Join("..", ".."))
	input := filepath.Join(root, "spec", "redevplugin", "official-containers-plugin", "plugins",
		"com.redeven.official", "com.redeven.official.containers", "2.0.0", "plugin.redevplugin")
	committedPath := filepath.Join(root, "spec", "redevplugin", "catalog-containers-plugin", "2.0.0", "plugin.redevplugin")
	generatedPath := filepath.Join(t.TempDir(), "plugin.redevplugin")
	if err := buildUnsignedPackage(input, generatedPath); err != nil {
		t.Fatal(err)
	}
	generated, err := os.ReadFile(generatedPath)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := os.ReadFile(committedPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(generated, committed) {
		t.Fatal("committed catalog package does not match deterministic generation")
	}
}

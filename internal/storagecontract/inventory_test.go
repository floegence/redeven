package storagecontract

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestInventoryCountsOnlyFilesAndDisclosesIncompleteRoots(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "ai"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ai", "threads.sqlite"), []byte("opaque"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "ai", "external")); err != nil {
		t.Fatal(err)
	}
	for _, entry := range Inventory(context.Background(), root) {
		if entry.ID == "flower" && (entry.Bytes != 6 || entry.Complete || !entry.Present) {
			t.Fatalf("%+v", entry)
		}
		if entry.ID == "notes" && (!entry.Complete || entry.Present) {
			t.Fatalf("%+v", entry)
		}
	}
}
func TestInventoryNeverFollowsSymlinkedAncestor(t *testing.T) {
	root, external := t.TempDir(), t.TempDir()
	os.MkdirAll(filepath.Join(external, "notes"), 0700)
	os.WriteFile(filepath.Join(external, "notes", "private"), []byte("secret"), 0600)
	os.Symlink(external, filepath.Join(root, "apps"))
	for _, entry := range Inventory(context.Background(), root) {
		if entry.ID == "notes" && (entry.Bytes != 0 || entry.Complete) {
			t.Fatalf("escaped root: %+v", entry)
		}
	}
}

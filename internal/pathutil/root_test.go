package pathutil

import (
	"path/filepath"
	"testing"
)

func TestResolveVirtualPath(t *testing.T) {
	t.Parallel()

	root := t.TempDir()

	resolved, err := ResolveVirtualPath(root, "")
	if err != nil {
		t.Fatalf("ResolveVirtualPath(empty): %v", err)
	}
	if resolved.Virtual != "/" {
		t.Fatalf("virtual=%q, want /", resolved.Virtual)
	}
	if filepath.Clean(resolved.Real) != filepath.Clean(root) {
		t.Fatalf("real=%q, want %q", resolved.Real, root)
	}

	resolved, err = ResolveVirtualPath(root, "a/b")
	if err != nil {
		t.Fatalf("ResolveVirtualPath(rel): %v", err)
	}
	if resolved.Virtual != "/a/b" {
		t.Fatalf("virtual=%q, want /a/b", resolved.Virtual)
	}
	want := filepath.Join(root, "a", "b")
	if filepath.Clean(resolved.Real) != filepath.Clean(want) {
		t.Fatalf("real=%q, want %q", resolved.Real, want)
	}

	resolved, err = ResolveVirtualPath(root, "/../../..")
	if err != nil {
		t.Fatalf("ResolveVirtualPath(clamp): %v", err)
	}
	if resolved.Virtual != "/" {
		t.Fatalf("virtual=%q, want /", resolved.Virtual)
	}
}

func TestRealPathToVirtual(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	child := filepath.Join(root, "repo", "file.txt")
	virtual, err := RealPathToVirtual(root, child)
	if err != nil {
		t.Fatalf("RealPathToVirtual: %v", err)
	}
	if virtual != "/repo/file.txt" {
		t.Fatalf("virtual=%q, want /repo/file.txt", virtual)
	}
}

func TestIsWithinRoot(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	inside := filepath.Join(root, "a", "b")
	ok, err := IsWithinRoot(inside, root)
	if err != nil {
		t.Fatalf("IsWithinRoot(inside): %v", err)
	}
	if !ok {
		t.Fatalf("inside path should be allowed")
	}

	outside := filepath.Join(root, "..", "outside")
	ok, err = IsWithinRoot(outside, root)
	if err != nil {
		t.Fatalf("IsWithinRoot(outside): %v", err)
	}
	if ok {
		t.Fatalf("outside path should be rejected")
	}
}

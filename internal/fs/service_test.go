package fs

import (
	"os"
	"path/filepath"
	"testing"
)

func mustEvalPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	return filepath.Clean(resolved)
}

func TestServiceResolve(t *testing.T) {
	root := t.TempDir()
	s := NewService(root)

	// Empty -> agent home
	p, err := s.resolveExistingDir("")
	if err != nil {
		t.Fatalf("resolve(empty) error: %v", err)
	}
	if mustEvalPath(t, p) != mustEvalPath(t, root) {
		t.Fatalf("resolve(empty) = %q, want %q", p, root)
	}

	child := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	// Existing absolute path inside scope
	p, err = s.resolveExistingDir(child)
	if err != nil {
		t.Fatalf("resolve(existing dir) error: %v", err)
	}
	if mustEvalPath(t, p) != mustEvalPath(t, child) {
		t.Fatalf("resolve(existing dir) = %q, want %q", p, child)
	}

	if _, err := s.resolveExistingDir("/../../.."); err == nil {
		t.Fatalf("expected out-of-scope path to fail")
	}
}

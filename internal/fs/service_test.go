package fs

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/flowersec/flowersec-go/rpc"
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

func TestServiceMkdirTarget(t *testing.T) {
	root := t.TempDir()
	s := NewService(root)

	t.Run("creates directory under existing parent", func(t *testing.T) {
		target := filepath.Join(root, "docs")
		created, err := s.mkdirTarget(target, false)
		if err != nil {
			t.Fatalf("mkdirTarget(existing parent): %v", err)
		}
		if mustEvalPath(t, created) != mustEvalPath(t, target) {
			t.Fatalf("mkdirTarget(existing parent) = %q, want %q", created, target)
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatalf("Stat(%q): %v", target, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q should be a directory", target)
		}
	})

	t.Run("rejects out of scope target", func(t *testing.T) {
		_, err := s.mkdirTarget("/../../outside", false)
		rpcErr, ok := err.(*rpc.Error)
		if !ok || rpcErr.Code != 400 {
			t.Fatalf("expected rpc 400 error, got %#v", err)
		}
	})

	t.Run("rejects existing directory", func(t *testing.T) {
		existing := filepath.Join(root, "existing")
		if err := os.MkdirAll(existing, 0o755); err != nil {
			t.Fatalf("MkdirAll(%q): %v", existing, err)
		}
		_, err := s.mkdirTarget(existing, false)
		rpcErr, ok := err.(*rpc.Error)
		if !ok || rpcErr.Code != 409 {
			t.Fatalf("expected rpc 409 error, got %#v", err)
		}
	})

	t.Run("creates parents when requested", func(t *testing.T) {
		target := filepath.Join(root, "nested", "dir")
		created, err := s.mkdirTarget(target, true)
		if err != nil {
			t.Fatalf("mkdirTarget(create parents): %v", err)
		}
		if mustEvalPath(t, created) != mustEvalPath(t, target) {
			t.Fatalf("mkdirTarget(create parents) = %q, want %q", created, target)
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatalf("Stat(%q): %v", target, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q should be a directory", target)
		}
	})
}

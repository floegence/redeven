package pathutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalizeExistingDirAbs(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	want, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}

	got, err := CanonicalizeExistingDirAbs(root)
	if err != nil {
		t.Fatalf("CanonicalizeExistingDirAbs: %v", err)
	}
	if filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("got=%q, want %q", got, want)
	}
}

func TestNormalizeUserPathInput(t *testing.T) {
	t.Parallel()
	home := t.TempDir()

	got, err := NormalizeUserPathInput("~/repo", home)
	if err != nil {
		t.Fatalf("NormalizeUserPathInput: %v", err)
	}
	want := filepath.Join(home, "repo")
	if got != want {
		t.Fatalf("got=%q, want %q", got, want)
	}
}

func TestNormalizeUserPathInput_RejectsRelative(t *testing.T) {
	t.Parallel()
	home := t.TempDir()

	if _, err := NormalizeUserPathInput("repo", home); err == nil {
		t.Fatalf("expected relative path to fail")
	}
}

func TestResolveExistingScopedDir(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	child := filepath.Join(home, "workspace")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	want, err := filepath.EvalSymlinks(child)
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}

	got, err := ResolveExistingScopedDir("~/workspace", home)
	if err != nil {
		t.Fatalf("ResolveExistingScopedDir: %v", err)
	}
	if filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("got=%q, want %q", got, want)
	}
}

func TestResolveExistingScopedDir_RejectsOutsideScope(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	outside := t.TempDir()

	if _, err := ResolveExistingScopedDir(outside, home); err == nil {
		t.Fatalf("expected outside path to fail")
	}
}

func TestResolveTargetScopedPath_RejectsSymlinkEscape(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(home, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatalf("Symlink: %v", err)
	}

	if _, err := ResolveTargetScopedPath(filepath.Join(link, "file.txt"), home); err == nil {
		t.Fatalf("expected symlink escape to fail")
	}
}

func TestIsWithinScope(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	child := filepath.Join(home, "nested")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	ok, err := IsWithinScope(child, home)
	if err != nil {
		t.Fatalf("IsWithinScope: %v", err)
	}
	if !ok {
		t.Fatalf("expected child to be within scope")
	}
}

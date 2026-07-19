package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimeidentity"
)

func TestCanonicalExecutablePathResolvesVersionedSuiteActivation(t *testing.T) {
	root := t.TempDir()
	hash := strings.Repeat("a", 64)
	suite := filepath.Join(root, ".redeven-runtime-suites", hash)
	if err := os.MkdirAll(suite, 0o700); err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(suite, "redeven")
	if err := os.WriteFile(executable, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	activation := filepath.Join(root, "redeven")
	if err := os.Symlink(filepath.Join(".redeven-runtime-suites", hash, "redeven"), activation); err != nil {
		t.Fatal(err)
	}

	want, err := filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	got, err := runtimeidentity.CanonicalExecutablePath(activation)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("canonical executable path = %q, want %q", got, want)
	}
}

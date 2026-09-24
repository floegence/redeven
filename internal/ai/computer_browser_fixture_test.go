package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/browserinstall"
)

// Protocol-only executors still need explicit installer state. This executable
// cannot launch a browser; real-browser fixtures use configureBrowserFixture.
func installBrowserStub(t *testing.T, runtime *ComputerUseRuntime) {
	t.Helper()
	root := t.TempDir()
	pkg := browserinstall.Package{ID: "protocol-fixture", SHA256: strings.Repeat("a", 64), SizeBytes: 1, Executable: "browser"}
	directory := filepath.Join(root, "packages", pkg.SHA256)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, ".redeven-browser"), []byte(pkg.SHA256), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, pkg.Executable), []byte("#!/bin/sh\nexit 97\n"), 0700); err != nil {
		t.Fatal(err)
	}
	manager, err := browserinstall.New(root, pkg)
	if err != nil {
		t.Fatal(err)
	}
	runtime.browserInstallation = manager
	t.Cleanup(manager.Close)
}

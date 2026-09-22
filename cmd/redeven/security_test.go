package main

import (
	"os"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
)

func TestSecurityCLIHelpAndInputBoundary(t *testing.T) {
	for _, args := range [][]string{{"security", "--help"}, {"help", "security"}, {"help", "security", "setup"}} {
		code, stdout, stderr := runCLITest(t, args...)
		if code != 0 || stderr != "" || !strings.Contains(stdout, "Stop this Runtime") {
			t.Fatalf("security help: %d %q %q", code, stdout, stderr)
		}
	}
	code, _, _ := runCLITest(t, "security", "setup", "--state-root", t.TempDir(), "--password", "should-not-be-accepted")
	if code != 2 {
		t.Fatal("security CLI accepted a command-line password")
	}
}

func TestSecurityCLIRequiresStoppedRuntime(t *testing.T) {
	root := t.TempDir()
	layout, err := config.LocalEnvironmentStateLayout(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(layout.StateDir, 0700); err != nil {
		t.Fatal(err)
	}
	lock, err := lockfile.Acquire(layout.LockPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Release() }()
	for _, action := range []string{"setup", "recover"} {
		code, _, stderr := runCLITest(t, "security", action, "--state-root", root)
		if code != 1 || !strings.Contains(stderr, "Stop this Runtime") {
			t.Fatalf("live owner lock bypassed: %d %q", code, stderr)
		}
	}
}

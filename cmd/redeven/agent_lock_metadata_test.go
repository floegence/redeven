package main

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/lockfile"
)

func TestWriteAndReadAgentLockMetadata(t *testing.T) {
	lockPath := t.TempDir() + "/agent.lock"
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		t.Fatalf("Acquire() error = %v", err)
	}
	defer func() {
		_ = lk.Release()
	}()

	metadata := newAgentLockMetadata(
		"desktop",
		true,
		true,
		"/Users/tester/.redeven/config.json",
		"/Users/tester/.redeven/runtime/local-ui.json",
	)
	if err := writeAgentLockMetadata(lk, metadata); err != nil {
		t.Fatalf("writeAgentLockMetadata() error = %v", err)
	}

	got, err := readAgentLockMetadata(lockPath)
	if err != nil {
		t.Fatalf("readAgentLockMetadata() error = %v", err)
	}
	if got == nil {
		t.Fatalf("expected metadata")
	}
	if got.Mode != "desktop" || !got.DesktopManaged || !got.LocalUIEnabled {
		t.Fatalf("unexpected metadata: %#v", got)
	}
	if got.ConfigPath != "/Users/tester/.redeven/config.json" {
		t.Fatalf("ConfigPath = %q", got.ConfigPath)
	}
	if got.StateDir != "/Users/tester/.redeven" {
		t.Fatalf("StateDir = %q", got.StateDir)
	}
}

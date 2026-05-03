package main

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/lockfile"
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
		config.StateLayout{
			ScopeKey:         "machine",
			ConfigPath:       "/Users/tester/.redeven/machine/config.json",
			RuntimeStatePath: "/Users/tester/.redeven/machine/runtime/local-ui.json",
		},
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
	if got.ScopeKey != "machine" {
		t.Fatalf("ScopeKey = %q", got.ScopeKey)
	}
	if got.ConfigPath != "/Users/tester/.redeven/machine/config.json" {
		t.Fatalf("ConfigPath = %q", got.ConfigPath)
	}
	if got.StateDir != "/Users/tester/.redeven/machine" {
		t.Fatalf("StateDir = %q", got.StateDir)
	}
}

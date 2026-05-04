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
			ScopeKey:         "local_environment",
			ConfigPath:       "/Users/tester/.redeven/local-environment/config.json",
			RuntimeStatePath: "/Users/tester/.redeven/local-environment/runtime/local-ui.json",
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
	if got.ScopeKey != "local_environment" {
		t.Fatalf("ScopeKey = %q", got.ScopeKey)
	}
	if got.ConfigPath != "/Users/tester/.redeven/local-environment/config.json" {
		t.Fatalf("ConfigPath = %q", got.ConfigPath)
	}
	if got.StateDir != "/Users/tester/.redeven/local-environment" {
		t.Fatalf("StateDir = %q", got.StateDir)
	}
}

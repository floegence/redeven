package main

import (
	"os"
	"path/filepath"
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
		"rt_test",
		true,
		"desktop-owner-test",
		true,
		config.StateLayout{
			StateRoot:                "/Users/tester/.redeven",
			ConfigPath:               "/Users/tester/.redeven/local-environment/config.json",
			RuntimeControlSocketPath: "/Users/tester/.redeven/local-environment/runtime/control.sock",
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
	if got.InstanceID != "rt_test" {
		t.Fatalf("InstanceID = %q", got.InstanceID)
	}
	if got.DesktopOwnerID != "desktop-owner-test" {
		t.Fatalf("DesktopOwnerID = %q", got.DesktopOwnerID)
	}
	if got.ConfigPath != "/Users/tester/.redeven/local-environment/config.json" {
		t.Fatalf("ConfigPath = %q", got.ConfigPath)
	}
	if got.StateDir != "/Users/tester/.redeven/local-environment" {
		t.Fatalf("StateDir = %q", got.StateDir)
	}
	if got.RuntimeControlSocketPath != "/Users/tester/.redeven/local-environment/runtime/control.sock" {
		t.Fatalf("RuntimeControlSocketPath = %q", got.RuntimeControlSocketPath)
	}
}

func TestReadAgentLockMetadataSupportsTransitionalRawPID(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "agent.lock")
	if err := os.WriteFile(lockPath, []byte("12345\n"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := readAgentLockMetadata(lockPath)
	if err != nil {
		t.Fatalf("readAgentLockMetadata() error = %v", err)
	}
	if got == nil || got.PID != 12345 {
		t.Fatalf("unexpected metadata: %#v", got)
	}
}

func TestReadAgentLockMetadataRejectsReleasedEmptyLease(t *testing.T) {
	lockPath := filepath.Join(t.TempDir(), "agent.lock")
	if err := os.WriteFile(lockPath, nil, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if got, err := readAgentLockMetadata(lockPath); err == nil || got != nil {
		t.Fatalf("readAgentLockMetadata() = %#v, %v; want released lease error", got, err)
	}
}

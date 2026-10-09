package main

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestBuildRunBootstrapArgs(t *testing.T) {
	t.Run("desktop bootstrap defaults to info logging", func(t *testing.T) {
		got := buildRunBootstrapArgs(
			"/tmp/redeven",
			"https://redeven.test",
			"env_123",
			"ticket-123",
			"",
			runModeDesktop,
			"dev",
		)

		if got.LogLevel != "info" {
			t.Fatalf("LogLevel = %q, want %q", got.LogLevel, "info")
		}
		assertRunBootstrapArgsCore(t, got)
	})

	t.Run("non desktop bootstrap keeps inherited logging behavior", func(t *testing.T) {
		got := buildRunBootstrapArgs(
			"/tmp/redeven",
			"https://redeven.test",
			"env_123",
			"ticket-123",
			"execute_read",
			runModeHybrid,
			"dev",
		)

		if got.LogLevel != "" {
			t.Fatalf("LogLevel = %q, want empty", got.LogLevel)
		}
		if got.PermissionPolicyPreset != "execute_read" {
			t.Fatalf("PermissionPolicyPreset = %q, want %q", got.PermissionPolicyPreset, "execute_read")
		}
		assertRunBootstrapArgsCore(t, got)
	})

	t.Run("link ticket args populate the alternate credential field", func(t *testing.T) {
		got := buildRunBootstrapArgs(
			"/tmp/redeven",
			"https://redeven.test",
			"env_123",
			"ticket-123",
			"",
			runModeDesktop,
			"dev",
		)

		if got.RuntimeLinkTicket != "ticket-123" {
			t.Fatalf("RuntimeLinkTicket = %q, want %q", got.RuntimeLinkTicket, "ticket-123")
		}
	})
}

func assertRunBootstrapArgsCore(t *testing.T, got config.BootstrapArgs) {
	t.Helper()
	if got.StateRoot != "/tmp/redeven" {
		t.Fatalf("StateRoot = %q", got.StateRoot)
	}
	if got.CloudOrigin != "https://redeven.test" {
		t.Fatalf("CloudOrigin = %q", got.CloudOrigin)
	}
	if got.EnvironmentID != "env_123" {
		t.Fatalf("EnvironmentID = %q", got.EnvironmentID)
	}
	if got.RuntimeLinkTicket != "ticket-123" {
		t.Fatalf("RuntimeLinkTicket = %q, want %q", got.RuntimeLinkTicket, "ticket-123")
	}
	if got.RuntimeVersion != "dev" {
		t.Fatalf("RuntimeVersion = %q, want dev", got.RuntimeVersion)
	}
}

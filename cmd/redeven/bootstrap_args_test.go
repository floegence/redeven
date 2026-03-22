package main

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/config"
)

func TestBuildRunBootstrapArgs(t *testing.T) {
	t.Run("desktop managed bootstrap defaults to info logging", func(t *testing.T) {
		got := buildRunBootstrapArgs(
			"/tmp/redeven/envs/env_123/config.json",
			"https://region.example.invalid",
			"env_123",
			"token-123",
			"",
			runModeDesktop,
			true,
		)

		if got.LogLevel != "info" {
			t.Fatalf("LogLevel = %q, want %q", got.LogLevel, "info")
		}
		assertRunBootstrapArgsCore(t, got)
	})

	t.Run("non desktop bootstrap keeps inherited logging behavior", func(t *testing.T) {
		got := buildRunBootstrapArgs(
			"/tmp/redeven/config.json",
			"https://region.example.invalid",
			"env_123",
			"token-123",
			"execute_read",
			runModeHybrid,
			false,
		)

		if got.LogLevel != "" {
			t.Fatalf("LogLevel = %q, want empty", got.LogLevel)
		}
		if got.PermissionPolicyPreset != "execute_read" {
			t.Fatalf("PermissionPolicyPreset = %q, want %q", got.PermissionPolicyPreset, "execute_read")
		}
		assertRunBootstrapArgsCore(t, got)
	})
}

func assertRunBootstrapArgsCore(t *testing.T, got config.BootstrapArgs) {
	t.Helper()
	if got.ControlplaneBaseURL != "https://region.example.invalid" {
		t.Fatalf("ControlplaneBaseURL = %q", got.ControlplaneBaseURL)
	}
	if got.EnvironmentID != "env_123" {
		t.Fatalf("EnvironmentID = %q", got.EnvironmentID)
	}
	if got.EnvironmentToken != "token-123" {
		t.Fatalf("EnvironmentToken = %q", got.EnvironmentToken)
	}
}

package config

import "testing"

func TestCodexConfigValidate_DefaultsAreAccepted(t *testing.T) {
	t.Parallel()

	cfg := &CodexConfig{Enabled: true}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if got := cfg.ApprovalPolicyValue(); got != "on_request" {
		t.Fatalf("ApprovalPolicyValue=%q, want=%q", got, "on_request")
	}
	if got := cfg.SandboxModeValue(); got != "workspace_write" {
		t.Fatalf("SandboxModeValue=%q, want=%q", got, "workspace_write")
	}
}

func TestCodexConfigNormalize_TrimsAndLowercasesFields(t *testing.T) {
	t.Parallel()

	cfg := &CodexConfig{
		BinaryPath:     "  /usr/local/bin/codex  ",
		DefaultModel:   "  gpt-5.4  ",
		ApprovalPolicy: "  ON_FAILURE  ",
		SandboxMode:    "  DANGER_FULL_ACCESS  ",
	}
	cfg.Normalize()

	if cfg.BinaryPath != "/usr/local/bin/codex" {
		t.Fatalf("BinaryPath=%q, want=%q", cfg.BinaryPath, "/usr/local/bin/codex")
	}
	if cfg.DefaultModel != "gpt-5.4" {
		t.Fatalf("DefaultModel=%q, want=%q", cfg.DefaultModel, "gpt-5.4")
	}
	if cfg.ApprovalPolicy != "on_failure" {
		t.Fatalf("ApprovalPolicy=%q, want=%q", cfg.ApprovalPolicy, "on_failure")
	}
	if cfg.SandboxMode != "danger_full_access" {
		t.Fatalf("SandboxMode=%q, want=%q", cfg.SandboxMode, "danger_full_access")
	}
}

func TestCodexConfigValidate_RejectsInvalidValues(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cfg  *CodexConfig
	}{
		{
			name: "invalid approval policy",
			cfg: &CodexConfig{
				Enabled:        true,
				ApprovalPolicy: "sometimes",
			},
		},
		{
			name: "invalid sandbox mode",
			cfg: &CodexConfig{
				Enabled:     true,
				SandboxMode: "unsafe",
			},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.cfg.Normalize()
			if err := tc.cfg.Validate(); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}

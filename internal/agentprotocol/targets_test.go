package agentprotocol

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
)

func TestDiscoverTargetsFromLocalEnvironmentState(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	if err := config.Save(layout.ConfigPath, &config.Config{
		ControlplaneBaseURL:      "https://region.example.invalid",
		ControlplaneProviderID:   "provider_1",
		EnvironmentID:            "env_123",
		LocalEnvironmentPublicID: "le_123",
		AgentHomeDir:             "/workspace",
		Shell:                    "/bin/zsh",
		AI: &config.AIConfig{
			CurrentModelID: "openai/gpt-5.5",
			Providers: []config.AIProvider{
				{
					ID:   "openai",
					Type: "openai",
					Models: []config.AIProviderModel{
						{ModelName: "gpt-5.5", ContextWindow: 1_000_000},
					},
				},
			},
		},
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if err := localuiruntime.WriteState(layout.RuntimeStatePath, localuiruntime.State{
		LocalUIURL:       "http://127.0.0.1:23998/",
		EffectiveRunMode: "hybrid",
		RemoteEnabled:    true,
		StateDir:         layout.StateDir,
	}); err != nil {
		t.Fatalf("WriteState() error = %v", err)
	}

	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	if len(catalog.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(catalog.Targets))
	}

	target := catalog.Targets[0]
	if target.ID != "local:local" || target.Status != TargetStatusAvailable {
		t.Fatalf("unexpected target identity: %#v", target)
	}
	if target.EnvPublicID != "env_123" || target.LocalEnvironmentID != "le_123" {
		t.Fatalf("unexpected environment fields: %#v", target)
	}
	assertHasCapability(t, target.Capabilities, CapabilityLocalUI)
	assertHasCapability(t, target.Capabilities, CapabilityRemoteControl)
	assertHasCapability(t, target.Capabilities, CapabilityFlower)
	assertHasCapability(t, target.Capabilities, CapabilityCodexGateway)
}

func TestDiscoverTargetsWithoutConfigReturnsInspectableTarget(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	if len(catalog.Targets) != 1 {
		t.Fatalf("Targets len = %d, want 1", len(catalog.Targets))
	}
	target := catalog.Targets[0]
	if target.Status != TargetStatusNotConfigured || target.UnavailableReasonCode != "config_missing" {
		t.Fatalf("unexpected target status: %#v", target)
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "local-environment")); err == nil {
		t.Fatalf("discovery should not create state directories")
	}
}

func TestResolveTarget(t *testing.T) {
	t.Parallel()

	target := TargetDescriptor{
		ID:                 "local:local",
		Label:              "Local Environment",
		EnvPublicID:        "env_123",
		LocalEnvironmentID: "le_123",
	}
	catalog := TargetCatalog{Targets: []TargetDescriptor{target}}

	for _, raw := range []string{"local", "local:local", "Local Environment", "env_123", "le_123", ""} {
		got, err := ResolveTarget(catalog, raw)
		if err != nil {
			t.Fatalf("ResolveTarget(%q) error = %v", raw, err)
		}
		if got.ID != target.ID {
			t.Fatalf("ResolveTarget(%q) = %#v", raw, got)
		}
	}

	if _, err := ResolveTarget(catalog, "missing"); err == nil {
		t.Fatalf("expected missing target error")
	}
}

func assertHasCapability(t *testing.T, capabilities []string, want string) {
	t.Helper()
	for _, got := range capabilities {
		if got == want {
			return
		}
	}
	t.Fatalf("missing capability %q in %#v", want, capabilities)
}

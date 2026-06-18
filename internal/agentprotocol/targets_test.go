package agentprotocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestDiscoverTargetsFromLocalEnvironmentState(t *testing.T) {
	t.Parallel()

	stateRoot, err := os.MkdirTemp("/tmp", "rdv-targets-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := os.MkdirAll(layout.StateDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	if err := config.Save(layout.ConfigPath, &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
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

	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:       layout.StateDir,
				DesktopManaged: true,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:  "http://127.0.0.1:23998/",
				LocalUIURLs: []string{"http://127.0.0.1:23998/"},
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				EffectiveRunMode: "hybrid",
				RemoteEnabled:    true,
				Bindings: runtimeservice.Bindings{
					ProviderLink: runtimeservice.ProviderLinkBinding{
						ProviderOrigin:    "https://redeven.test",
						ProviderID:        "provider_1",
						EnvPublicID:       "env_123",
						AccessPointOrigin: "https://dev.redeven.test",
					},
				},
			}),
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

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
	assertHasCapability(t, target.Capabilities, CapabilityCodexAPI)
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

func TestDiscoverTargetsDoesNotAdvertiseFlowerFromBoundDesktopModelSource(t *testing.T) {
	t.Parallel()

	stateRoot, err := os.MkdirTemp("/tmp", "rdv-targets-model-source-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := os.MkdirAll(layout.StateDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:       layout.StateDir,
				DesktopManaged: true,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL: "http://127.0.0.1:23998/",
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				Capabilities: runtimeservice.Capabilities{
					DesktopModelSource: runtimeservice.Capability{Supported: true},
				},
				Bindings: runtimeservice.Bindings{
					DesktopModelSource: runtimeservice.Binding{
						State:      runtimeservice.BindingStateBound,
						ModelCount: 2,
					},
				},
			}),
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	assertLacksCapability(t, catalog.Targets[0].Capabilities, "flower")
}

func TestDiscoverTargetsDoesNotAdvertiseFlowerForUnboundDesktopModelSource(t *testing.T) {
	t.Parallel()

	stateRoot, err := os.MkdirTemp("/tmp", "rdv-targets-model-source-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:       layout.StateDir,
				DesktopManaged: true,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL: "http://127.0.0.1:23998/",
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				Capabilities: runtimeservice.Capabilities{
					DesktopModelSource: runtimeservice.Capability{Supported: true},
				},
				Bindings: runtimeservice.Bindings{
					DesktopModelSource: runtimeservice.Binding{
						State:      runtimeservice.BindingStateUnbound,
						ModelCount: 2,
					},
				},
			}),
		}, nil
	})
	if err != nil {
		t.Fatalf("NewServer() error = %v", err)
	}
	if err := statusServer.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = statusServer.Close() }()

	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	assertLacksCapability(t, catalog.Targets[0].Capabilities, "flower")
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

	for _, raw := range []string{"local", "local:local", "Local Environment", "env_123", "le_123", "", "current"} {
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

func assertLacksCapability(t *testing.T, capabilities []string, want string) {
	t.Helper()
	for _, got := range capabilities {
		if got == want {
			t.Fatalf("unexpected capability %q in %#v", want, capabilities)
		}
	}
}

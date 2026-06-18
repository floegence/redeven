package agentprotocol

import (
	"context"
	"encoding/json"
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

func TestDiscoverTargetsIncludesCatalogSSHConnection(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	writeCatalogConnection(t, stateRoot, "ssh-devbox", map[string]any{
		"schema_version":          1,
		"record_kind":             "connection",
		"kind":                    "ssh",
		"id":                      "ssh:devbox:2222:key_agent:remote_default",
		"label":                   "Devbox",
		"ssh_destination":         "devbox",
		"ssh_port":                2222,
		"auth_mode":               "key_agent",
		"runtime_root":            "remote_default",
		"connect_timeout_seconds": 7,
	})

	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	target, err := ResolveTarget(catalog, "ssh:ssh%3Adevbox%3A2222%3Akey_agent%3Aremote_default")
	if err != nil {
		t.Fatalf("ResolveTarget(provider-style ssh alias) error = %v", err)
	}
	if target.ID != "ssh:devbox:2222:key_agent:remote_default" || target.Kind != TargetKindSSHEnvironment {
		t.Fatalf("unexpected ssh target: %#v", target)
	}
	if target.Execution == nil || target.Execution.Location != TargetExecutionLocationSSH || target.Execution.SSHDestination != "devbox" {
		t.Fatalf("unexpected execution route: %#v", target.Execution)
	}
	if target.Execution.SSHPort == nil || *target.Execution.SSHPort != 2222 {
		t.Fatalf("ssh port=%v, want 2222", target.Execution.SSHPort)
	}
	assertHasCapability(t, target.Capabilities, CapabilityTerminal)
}

func TestDiscoverTargetsIncludesExternalLocalUIConnection(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	writeCatalogConnection(t, stateRoot, "external-local-ui", map[string]any{
		"schema_version": 1,
		"record_kind":    "connection",
		"kind":           "url",
		"id":             "external_local_ui:http%3A%2F%2F127.0.0.1%3A23998%2F",
		"label":          "External Local UI",
		"local_ui_url":   "http://127.0.0.1:23998/",
	})

	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: stateRoot})
	if err != nil {
		t.Fatalf("DiscoverTargets() error = %v", err)
	}
	target, err := ResolveTarget(catalog, "external_local_ui:http%3A%2F%2F127.0.0.1%3A23998%2F")
	if err != nil {
		t.Fatalf("ResolveTarget(external local ui) error = %v", err)
	}
	if target.Kind != TargetKindExternalLocalUI || target.LocalUIURL != "http://127.0.0.1:23998/" {
		t.Fatalf("unexpected external local ui target: %#v", target)
	}
	if target.Execution != nil {
		t.Fatalf("external local ui should not have an execution route: %#v", target.Execution)
	}
	assertHasCapability(t, target.Capabilities, CapabilityLocalUI)

	result, err := ExecuteTargetCommand(context.Background(), TargetExecOptions{
		StateRoot: stateRoot,
		Target:    "external_local_ui:http%3A%2F%2F127.0.0.1%3A23998%2F",
		Command:   "date",
		Runner: func(context.Context, TargetExecInvocation) (TargetExecProcessResult, error) {
			t.Fatalf("runner should not be called for external local ui targets")
			return TargetExecProcessResult{}, nil
		},
	})
	if err != nil {
		t.Fatalf("ExecuteTargetCommand(external local ui) error = %v", err)
	}
	if result.Supported || result.ReasonCode != TargetExecReasonUnsupportedTargetKind {
		t.Fatalf("unexpected external local ui exec result: %#v", result)
	}
}

func TestExecuteTargetCommandUsesLocalExecutionRoute(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	var got TargetExecInvocation
	result, err := ExecuteTargetCommand(context.Background(), TargetExecOptions{
		StateRoot: stateRoot,
		Target:    "current",
		Command:   "printf ok",
		CWD:       "/tmp",
		Runner: func(_ context.Context, inv TargetExecInvocation) (TargetExecProcessResult, error) {
			got = inv
			return TargetExecProcessResult{Stdout: "ok", ExitCode: 0, DurationMS: 4}, nil
		},
	})
	if err != nil {
		t.Fatalf("ExecuteTargetCommand() error = %v", err)
	}
	if got.ExecutionLocation != TargetExecutionLocationLocalRuntime || got.Command != "printf ok" || got.CWD != "/tmp" {
		t.Fatalf("unexpected invocation: %#v", got)
	}
	if !result.Supported || result.TargetID != "local:local" || result.ExecutionLocation != TargetExecutionLocationLocalRuntime {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Target.StateRoot != "" || result.Target.RuntimeControlSocketPath != "" {
		t.Fatalf("target exec result leaked local state paths: %#v", result.Target)
	}
}

func TestExecuteTargetCommandReturnsStructuredUnsupportedForContainerTarget(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	writeCatalogConnection(t, stateRoot, "container-dev", map[string]any{
		"schema_version": 1,
		"record_kind":    "connection",
		"kind":           "runtime_target",
		"id":             "local:container:docker:dev:abc12345",
		"label":          "Dev Container",
		"host_access": map[string]any{
			"kind": "local_host",
		},
		"placement": map[string]any{
			"kind":             "container_process",
			"container_engine": "docker",
			"container_ref":    "dev",
			"runtime_root":     "/workspace",
		},
	})

	result, err := ExecuteTargetCommand(context.Background(), TargetExecOptions{
		StateRoot: stateRoot,
		Target:    "local:container:docker:dev:abc12345",
		Command:   "date",
		Runner: func(context.Context, TargetExecInvocation) (TargetExecProcessResult, error) {
			t.Fatalf("runner should not be called for unsupported targets")
			return TargetExecProcessResult{}, nil
		},
	})
	if err != nil {
		t.Fatalf("ExecuteTargetCommand() error = %v", err)
	}
	if result.Supported || result.ReasonCode != TargetExecReasonUnsupportedTargetKind {
		t.Fatalf("unexpected unsupported result: %#v", result)
	}
}

func TestExecuteTargetCommandReturnsStructuredUnsupportedForRecognizedTargetShapes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		kind string
	}{
		{name: "provider environment", raw: "provider:https%3A%2F%2Fredeven.test:env:env_123", kind: TargetKindProviderEnvironment},
		{name: "gateway environment", raw: "gateway:gw_123:env:env_123", kind: TargetKindGatewayEnvironment},
		{name: "external local ui", raw: "external_local_ui:http%3A%2F%2F127.0.0.1%3A23998%2F", kind: TargetKindExternalLocalUI},
		{name: "local container", raw: "local:container:docker:dev:abc12345", kind: TargetKindLocalContainerRuntime},
		{name: "ssh container", raw: "ssh:container:devbox:docker:dev:abc12345", kind: TargetKindSSHContainerRuntime},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result, err := ExecuteTargetCommand(context.Background(), TargetExecOptions{
				StateRoot: t.TempDir(),
				Target:    tt.raw,
				Command:   "date",
				Runner: func(context.Context, TargetExecInvocation) (TargetExecProcessResult, error) {
					t.Fatalf("runner should not be called for recognized unsupported target shapes")
					return TargetExecProcessResult{}, nil
				},
			})
			if err != nil {
				t.Fatalf("ExecuteTargetCommand() error = %v", err)
			}
			if result.Supported || result.ReasonCode != TargetExecReasonUnsupportedTargetKind {
				t.Fatalf("unexpected unsupported result: %#v", result)
			}
			if result.TargetID != tt.raw || result.Target.Kind != tt.kind {
				t.Fatalf("target resolution = %#v, want id %q kind %q", result.Target, tt.raw, tt.kind)
			}
		})
	}
}

func TestExecuteTargetCommandReturnsStructuredUnsupportedForPasswordSSHTarget(t *testing.T) {
	t.Parallel()

	stateRoot := t.TempDir()
	writeCatalogConnection(t, stateRoot, "ssh-password-dev", map[string]any{
		"schema_version":  1,
		"record_kind":     "connection",
		"kind":            "ssh",
		"id":              "ssh:devbox:22:password:remote_default",
		"label":           "Password Devbox",
		"ssh_destination": "devbox",
		"ssh_port":        22,
		"auth_mode":       "password",
		"runtime_root":    "remote_default",
	})

	result, err := ExecuteTargetCommand(context.Background(), TargetExecOptions{
		StateRoot: stateRoot,
		Target:    "ssh:devbox:22:password:remote_default",
		Command:   "date",
		Runner: func(context.Context, TargetExecInvocation) (TargetExecProcessResult, error) {
			t.Fatalf("runner should not be called for password SSH targets")
			return TargetExecProcessResult{}, nil
		},
	})
	if err != nil {
		t.Fatalf("ExecuteTargetCommand() error = %v", err)
	}
	if result.Supported || result.ReasonCode != TargetExecReasonPasswordAuthUnavailable {
		t.Fatalf("unexpected password auth result: %#v", result)
	}
	if result.TargetID != "ssh:devbox:22:password:remote_default" {
		t.Fatalf("target_id=%q, want password ssh target", result.TargetID)
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

func TestResolveTargetLocalAliasDoesNotDependOnCatalogOrder(t *testing.T) {
	t.Parallel()

	catalog := TargetCatalog{Targets: []TargetDescriptor{
		{
			ID:    "ssh:devbox",
			Kind:  TargetKindSSHEnvironment,
			Label: "Devbox",
		},
		{
			ID:    "local:local",
			Kind:  TargetKindLocalEnvironment,
			Label: "Local Environment",
		},
	}}

	got, err := ResolveTarget(catalog, "local")
	if err != nil {
		t.Fatalf("ResolveTarget(local) error = %v", err)
	}
	if got.ID != "local:local" {
		t.Fatalf("ResolveTarget(local) = %#v, want local:local", got)
	}
}

func writeCatalogConnection(t *testing.T, stateRoot string, name string, value map[string]any) {
	t.Helper()
	dir := filepath.Join(stateRoot, "catalog", "connections")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("MkdirAll(%s) error = %v", dir, err)
	}
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent() error = %v", err)
	}
	path := filepath.Join(dir, name+".json")
	if err := os.WriteFile(path, append(body, '\n'), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", path, err)
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

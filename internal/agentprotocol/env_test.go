package agentprotocol

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestResolveEnvironmentTargetRecognizesUnsupportedRedevenTargetShapes(t *testing.T) {
	t.Parallel()

	catalog := TargetCatalog{Targets: []TargetDescriptor{{
		ID:          "local:local",
		Kind:        TargetKindLocalEnvironment,
		Label:       "Local Environment",
		Status:      TargetStatusConfigured,
		EnvPublicID: "env_123",
	}}}

	local, err := ResolveEnvironmentTarget(catalog, "env_123")
	if err != nil {
		t.Fatalf("ResolveEnvironmentTarget(local) error = %v", err)
	}
	if !local.Supported || local.Target.ID != "local:local" {
		t.Fatalf("local resolution = %#v, want supported local:local", local)
	}

	tests := []struct {
		name string
		raw  string
		kind string
	}{
		{name: "local container", raw: "local:container:docker:redeven-dev:abcd1234", kind: TargetKindLocalContainerRuntime},
		{name: "welcome prefixed local container", raw: "local:local:container:docker:redeven-dev:abcd1234", kind: TargetKindLocalContainerRuntime},
		{name: "welcome prefixed local host", raw: "local:local:host:redeven-dev", kind: TargetKindLocalHostRuntime},
		{name: "ssh container", raw: "ssh:container:devbox:docker:redeven-dev:abcd1234", kind: TargetKindSSHContainerRuntime},
		{name: "provider environment", raw: "provider:https%3A%2F%2Fredeven.test:env:env_999", kind: TargetKindProviderEnvironment},
		{name: "gateway environment", raw: "gateway:gw_123:env:env_999", kind: TargetKindGatewayEnvironment},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveEnvironmentTarget(catalog, tt.raw)
			if err != nil {
				t.Fatalf("ResolveEnvironmentTarget(%q) error = %v", tt.raw, err)
			}
			if got.Supported {
				t.Fatalf("Supported = true, want false: %#v", got)
			}
			if got.Target.Kind != tt.kind || got.ReasonCode != EnvReasonUnsupportedTargetKind {
				t.Fatalf("resolution = %#v, want kind %q reason %q", got, tt.kind, EnvReasonUnsupportedTargetKind)
			}
		})
	}
}

func TestEnvironmentStatusFromAttachSanitizesRuntimeControlToken(t *testing.T) {
	t.Parallel()

	resolution := EnvironmentTargetResolution{
		Target: TargetDescriptor{
			ID:     "local:local",
			Kind:   TargetKindLocalEnvironment,
			Label:  "Local Environment",
			Status: TargetStatusAvailable,
		},
		Supported: true,
	}
	status := EnvironmentStatusFromAttach(resolution, runtimemanagement.RuntimeAttachStatus{
		State: runtimemanagement.AttachStateReady,
		Identity: runtimemanagement.RuntimeInstanceIdentity{
			PID:            123,
			RuntimeVersion: "1.2.3",
			DesktopManaged: true,
		},
		Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
			LocalUIURL: "http://127.0.0.1:23998/",
			RuntimeControl: &runtimemanagement.RuntimeControlEndpoint{
				BaseURL: "http://runtime",
				Token:   "secret-runtime-control-token",
			},
		},
		RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
			EffectiveRunMode: "desktop",
			RemoteEnabled:    true,
		}),
	}, true)

	body, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if strings.Contains(string(body), "secret-runtime-control-token") || strings.Contains(string(body), "runtime_control") {
		t.Fatalf("environment status leaked runtime-control material: %s", body)
	}
	if status.Runtime.LocalUIURL == "" || !status.Runtime.DesktopManaged {
		t.Fatalf("sanitized runtime summary lost expected public fields: %#v", status.Runtime)
	}
	if status.Operations[EnvOperationStop].Availability != OperationAvailabilityAvailable {
		t.Fatalf("stop availability = %#v, want available", status.Operations[EnvOperationStop])
	}
}

func TestEnvironmentTargetCatalogSanitizesLocalPaths(t *testing.T) {
	t.Parallel()

	catalog := EnvironmentTargetCatalog(TargetCatalog{Targets: []TargetDescriptor{{
		ID:                       "local:local",
		Kind:                     TargetKindLocalEnvironment,
		Label:                    "Local Environment",
		Status:                   TargetStatusAvailable,
		StateRoot:                "/tmp/redeven",
		StateDir:                 "/tmp/redeven/local-environment",
		ConfigPath:               "/tmp/redeven/config.json",
		RuntimeControlSocketPath: "/tmp/redeven/runtime.sock",
		AgentHomeDir:             "/Users/example/.redeven-agent",
		LocalUIURL:               "http://127.0.0.1:23998/",
		EnvPublicID:              "env_123",
		Capabilities:             []string{CapabilityLocalUI},
	}}})
	if len(catalog.Targets) != 1 {
		t.Fatalf("target count = %d, want 1", len(catalog.Targets))
	}
	target := catalog.Targets[0]
	if target.StateRoot != "" ||
		target.StateDir != "" ||
		target.ConfigPath != "" ||
		target.RuntimeControlSocketPath != "" ||
		target.AgentHomeDir != "" {
		t.Fatalf("environment target leaked local paths: %#v", target)
	}
	if target.LocalUIURL == "" || target.EnvPublicID != "env_123" {
		t.Fatalf("environment target lost public fields: %#v", target)
	}
}

func TestEnvironmentOperationPlansKeepUnsupportedTargetsInRedevenContract(t *testing.T) {
	t.Parallel()

	rawTarget := "local:container:docker:redeven dev;rm:abcd1234"
	resolution, err := ResolveEnvironmentTarget(TargetCatalog{}, rawTarget)
	if err != nil {
		t.Fatalf("ResolveEnvironmentTarget() error = %v", err)
	}
	status := UnsupportedEnvironmentStatus(resolution)
	statusPlan := status.Operations[EnvOperationStatus]
	if got, want := statusPlan.Argv, []string{"redeven", "env", "status", "--target", rawTarget, "--json"}; len(got) != len(want) {
		t.Fatalf("status argv len=%d, want %d: %#v", len(got), len(want), got)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("status argv[%d]=%q, want %q: %#v", i, got[i], want[i], got)
			}
		}
	}
	if !strings.Contains(statusPlan.Command, "'local:container:docker:redeven dev;rm:abcd1234'") {
		t.Fatalf("status command is not shell-quoted for display: %q", statusPlan.Command)
	}
	restart := status.Operations[EnvOperationRestart]
	if restart.Availability != OperationAvailabilityUnavailable || restart.ReasonCode != EnvReasonUnsupportedTargetKind {
		t.Fatalf("restart plan = %#v, want unsupported unavailable plan", restart)
	}
	for _, operation := range []string{EnvOperationStart, EnvOperationStop, EnvOperationRestart, EnvOperationUpdate} {
		plan := status.Operations[operation]
		if strings.Contains(strings.Join(plan.NextActions, "\n"), "redeven env status") {
			t.Fatalf("%s next actions suggest status loop: %#v", operation, plan.NextActions)
		}
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	for _, forbidden := range []string{"docker restart", "docker stop", "docker start", "systemctl", "ssh "} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("unsupported plan contains forbidden low-level command %q: %s", forbidden, encoded)
		}
	}
}

func TestStopOperationPlanDoesNotExposeExecutableCommandWhenUnavailable(t *testing.T) {
	t.Parallel()

	target := TargetDescriptor{
		ID:     "local:local",
		Kind:   TargetKindLocalEnvironment,
		Label:  "Local Environment",
		Status: TargetStatusAvailable,
	}
	tests := []struct {
		name       string
		status     runtimemanagement.RuntimeAttachStatus
		reasonCode string
	}{
		{
			name:       "not running",
			status:     runtimemanagement.RuntimeAttachStatus{State: runtimemanagement.AttachStateNotRunning},
			reasonCode: EnvReasonRuntimeNotStarted,
		},
		{
			name: "external owner",
			status: runtimemanagement.RuntimeAttachStatus{
				State: runtimemanagement.AttachStateReady,
				Identity: runtimemanagement.RuntimeInstanceIdentity{
					PID:            123,
					DesktopManaged: false,
				},
			},
			reasonCode: EnvReasonRuntimeOwnerExternal,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			runtime := RuntimeStatusSummaryFromAttach(tt.status)
			plan := EnvironmentOperationPlansFromRuntime(target, tt.status, runtime)[EnvOperationStop]
			if plan.ReasonCode != tt.reasonCode {
				t.Fatalf("reason_code = %q, want %q: %#v", plan.ReasonCode, tt.reasonCode, plan)
			}
			if plan.Command != "" || len(plan.Argv) != 0 {
				t.Fatalf("unavailable stop plan exposed executable command: %#v", plan)
			}
		})
	}
}

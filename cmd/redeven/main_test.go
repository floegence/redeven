package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/redeven/internal/agentprotocol"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

func TestRunCLIHelp(t *testing.T) {
	t.Run("top level help flag prints quick start", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "--help")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"Redeven runtime and Local UI launcher.",
			"Quick start:",
			"env         Inspect and plan Redeven environment lifecycle operations.",
			"targets     Inspect Redeven targets for local automation.",
			"redeven bootstrap --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket <bootstrap-ticket>",
			"redeven run --mode local",
		)
	})

	t.Run("run help includes mode and bind guidance", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "help", "run")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"redeven run",
			"Modes:",
			"Local Environment state rules:",
			"Local UI bind rules:",
			"Always start the Local UI. Connect to the control plane only when bootstrap config is already valid.",
			"--state-root <path>",
			"--presentation <auto|rich|plain|machine>",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.42.0.9:24000, 127.0.0.1:0, [::1]:24000",
			"Local UI is permanently loopback-only.",
		)
	})

	t.Run("bootstrap help includes required flags and example", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "bootstrap", "--help")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"Required flags:",
			"--provider-origin <url>",
			"--controlplane <url>",
			"--env-id <env_public_id>",
			"--bootstrap-ticket <ticket>",
			"--bootstrap-ticket-env <env_name>",
			"--state-root <path>",
			"redeven bootstrap --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket <bootstrap-ticket>",
		)
	})

	t.Run("okf bundle help is available through help command", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "help", "okf", "bundle")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"redeven okf bundle",
			"--verify-only",
			"--validate-source-only",
		)
	})

	t.Run("targets help includes local automation contract", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "help", "targets")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"redeven targets",
			"local automation",
			"redeven targets list --json",
			"redeven targets resolve --target local --json",
			"redeven targets exec --target current --command 'uname -a' --json",
		)
	})

	t.Run("env help includes lifecycle contract", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "help", "env")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"redeven env",
			"environment status, runtime attach diagnostics, stop, start, restart, and update requests",
			"instead of inferring Docker, SSH, systemd, or process-manager commands",
			"redeven env status --target local --json",
		)
	})
}

func TestRunCLIStartupGuidanceErrors(t *testing.T) {
	t.Run("unknown command points to help", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "nope")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		if stdout != "" {
			t.Fatalf("stdout = %q, want empty", stdout)
		}
		assertContainsAll(t, stderr,
			"unknown command: nope",
			"Run `redeven help` for usage and startup examples.",
			"Quick start:",
		)
	})

	t.Run("renamed local ui flag shows migration hint", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "run", "--local-ui-port", "12345")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		if stdout != "" {
			t.Fatalf("stdout = %q, want empty", stdout)
		}
		assertContainsAll(t, stderr,
			"unknown flag for `redeven run`: --local-ui-port",
			"Hint: `--local-ui-port` was replaced by `--local-ui-bind <host:port>`.",
			"Example: redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000",
		)
	})

	t.Run("bootstrap missing flags are listed explicitly", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "bootstrap")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"missing required flags for `redeven bootstrap`: --provider-origin, --controlplane, --env-id, one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)",
			"Example: redeven bootstrap --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket <bootstrap-ticket>",
		)
	})

	t.Run("run incomplete inline bootstrap flags explain the missing flag", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "hybrid", "--provider-origin", "https://redeven.test", "--controlplane", "https://dev.redeven.test", "--env-id", "env_123")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"incomplete bootstrap flags for `redeven run`: missing flag one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)",
			"Hint: provide --provider-origin, --controlplane, --env-id, and exactly one bootstrap ticket together, or run `redeven bootstrap` first.",
		)
	})

	t.Run("desktop startup report captures incomplete inline bootstrap flags", func(t *testing.T) {
		tempDir := t.TempDir()
		reportPath := filepath.Join(tempDir, "startup", "report.json")
		stateRoot := filepath.Join(tempDir, "state")
		code, _, stderr := runCLITest(t,
			"run",
			"--mode", "desktop",
			"--desktop-managed",
			"--state-root", stateRoot,
			"--startup-report-file", reportPath,
			"--provider-origin", "https://redeven.test",
			"--controlplane", "https://dev.redeven.test",
			"--env-id", "env_123",
		)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"incomplete bootstrap flags for `redeven run`: missing flag one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)",
		)

		body, err := os.ReadFile(reportPath)
		if err != nil {
			t.Fatalf("ReadFile(%s) error = %v", reportPath, err)
		}
		var report desktopLaunchReport
		if err := json.Unmarshal(body, &report); err != nil {
			t.Fatalf("json.Unmarshal() error = %v", err)
		}
		if report.Status != desktopLaunchStatusBlocked {
			t.Fatalf("Status = %q, want %q", report.Status, desktopLaunchStatusBlocked)
		}
		if report.Code != desktopLaunchCodeStartupInvalid {
			t.Fatalf("Code = %q, want %q", report.Code, desktopLaunchCodeStartupInvalid)
		}
		if !strings.Contains(report.Message, "missing flag one bootstrap ticket") {
			t.Fatalf("Message = %q", report.Message)
		}
		if report.Diagnostics == nil || report.Diagnostics.StateDir != filepath.Join(stateRoot, "local-environment") {
			t.Fatalf("Diagnostics = %#v", report.Diagnostics)
		}
	})

	t.Run("invalid mode includes allowed values", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "bad")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--mode`: bad",
			"Allowed values: remote, hybrid, local, desktop.",
			"Example: redeven run --mode hybrid",
		)
	})

	t.Run("invalid presentation includes allowed values", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--presentation", "cinematic")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--presentation`: cinematic",
			"Allowed values: auto, rich, plain, machine.",
			"Example: redeven run --mode hybrid --presentation rich",
		)
	})

	t.Run("desktop startup rejects human presentation", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "desktop", "--desktop-managed", "--presentation", "rich")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"`--desktop-managed` and `--startup-report-file` require `--presentation machine`",
			"Desktop and startup-report consumers must use the machine presentation contract.",
		)
	})

	t.Run("invalid local ui bind includes accepted examples", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "example.com:12345")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--local-ui-bind`: host must be localhost or an IP literal",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.42.0.9:24000, 127.0.0.1:0, [::1]:24000.",
			"For access from another device, use Redeven Desktop, SSH forwarding, or a Flowersec secure tunnel.",
		)
	})

	t.Run("localhost zero port explains the supported loopback alternative", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "localhost:0")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--local-ui-bind`: localhost:0 is not supported; use 127.0.0.1:0 or [::1]:0",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.42.0.9:24000, 127.0.0.1:0, [::1]:24000.",
		)
	})

	t.Run("desktop managed requires a local ui mode", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "remote", "--desktop-managed")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"`--desktop-managed` requires a Local UI run mode",
			"Hint: use `redeven run --mode desktop --desktop-managed --presentation machine` for the packaged desktop shell.",
		)
	})

	t.Run("startup report file requires a local ui mode", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "remote", "--startup-report-file", filepath.Join(t.TempDir(), "startup.json"))
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"`--startup-report-file` requires a Local UI run mode",
			"Hint: use `redeven run --mode desktop --presentation machine --startup-report-file <path>` when a desktop shell needs machine-readable readiness output.",
		)
	})

	t.Run("non loopback bind is rejected with secure access alternatives", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "0.0.0.0:12345")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--local-ui-bind`: Local UI is loopback-only; use localhost, 127.0.0.0/8, or ::1",
			"For access from another device, use Redeven Desktop, SSH forwarding, or a Flowersec secure tunnel.",
		)
	})

	t.Run("multiple password sources explain the conflict", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--password", "a", "--password-env", "TEST_PASSWORD")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid password flags: use only one of --password, --password-stdin, --password-env, or --password-file",
			"Hint: choose a single password source for one startup command.",
		)
	})

	t.Run("missing password env gives export example", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--password-env", "MISSING_PASSWORD")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid password flags: password env var \"MISSING_PASSWORD\" is not set",
			"Hint: export MISSING_PASSWORD with a non-empty password before running `redeven run`.",
			"MISSING_PASSWORD=replace-with-a-long-password redeven run --mode hybrid --password-env MISSING_PASSWORD",
		)
	})

	t.Run("empty password stdin gets a non-interactive hint", func(t *testing.T) {
		code, _, stderr := runCLITestWithStdin(t, "\n", "run", "--mode", "local", "--password-stdin")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid password flags: stdin password is empty",
			"Hint: pipe a non-empty access password into `redeven run --password-stdin` and retry.",
		)
	})

	t.Run("env token flags are no longer supported", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--env-token", "token-1")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"unknown flag for `redeven run`: --env-token",
		)
	})

	t.Run("multiple bootstrap ticket sources explain the conflict", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--bootstrap-ticket", "ticket-1", "--bootstrap-ticket-env", "REDEVEN_BOOTSTRAP_TICKET")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid bootstrap ticket flags: use only one of --bootstrap-ticket or --bootstrap-ticket-env",
			"Hint: choose a single bootstrap ticket source for `redeven run`.",
		)
	})

	t.Run("missing bootstrap ticket env gives export guidance", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--bootstrap-ticket-env", "REDEVEN_BOOTSTRAP_TICKET")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid bootstrap ticket flags: bootstrap ticket env var \"REDEVEN_BOOTSTRAP_TICKET\" is not set",
			"Hint: export REDEVEN_BOOTSTRAP_TICKET with a non-empty ticket before running `redeven run`.",
		)
	})

	t.Run("empty password file explains how to fix it", func(t *testing.T) {
		passwordFile := filepath.Join(t.TempDir(), "password.txt")
		if err := os.WriteFile(passwordFile, []byte("\n"), 0o600); err != nil {
			t.Fatalf("WriteFile() error = %v", err)
		}

		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--password-file", passwordFile)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid password flags: password file",
			"is empty",
			"Hint: write the full access password to the file and retry.",
		)
	})

	t.Run("hybrid mode without bootstrap config gives both supported recovery paths", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "hybrid")
		if code != 1 {
			t.Fatalf("exit code = %d, want 1", code)
		}
		assertContainsAll(t, stderr,
			"runtime is not bootstrapped for remote or hybrid mode:",
			"Hint: run `redeven bootstrap` first, or pass --provider-origin, --controlplane, --env-id, and a one-time bootstrap ticket directly to `redeven run`.",
			"redeven bootstrap --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket <bootstrap-ticket>",
			"redeven run --mode hybrid --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket <bootstrap-ticket>",
			"REDEVEN_BOOTSTRAP_TICKET=<bootstrap-ticket> redeven run --mode desktop --desktop-managed --presentation machine --provider-origin https://redeven.test --controlplane https://dev.redeven.test --env-id env_123 --bootstrap-ticket-env REDEVEN_BOOTSTRAP_TICKET",
		)
	})
}

func TestResolveRunStateLayoutDefaultsToLocalEnvironmentLayout(t *testing.T) {
	stateRoot := t.TempDir()

	layout, err := resolveRunStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("resolveRunStateLayout() error = %v", err)
	}
	if layout.ConfigPath != filepath.Join(stateRoot, "local-environment", "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
}

func TestResolveRunStateLayoutUsesLocalEnvironmentLayoutForInlineBootstrap(t *testing.T) {
	stateRoot := t.TempDir()

	layout, err := resolveRunStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("resolveRunStateLayout() error = %v", err)
	}
	if layout.ConfigPath != filepath.Join(stateRoot, "local-environment", "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
}

func TestResolveRuntimeLaunchPolicy(t *testing.T) {
	tests := []struct {
		name                  string
		mode                  runMode
		desktopManaged        bool
		remoteConfigValid     bool
		wantLocalUIEnabled    bool
		wantControlEnabled    bool
		wantEffectiveRunMode  runMode
		wantProcessRemoteMode bool
	}{
		{
			name:                  "desktop managed restores saved provider link",
			mode:                  runModeDesktop,
			desktopManaged:        true,
			remoteConfigValid:     true,
			wantLocalUIEnabled:    true,
			wantControlEnabled:    true,
			wantEffectiveRunMode:  runModeHybrid,
			wantProcessRemoteMode: true,
		},
		{
			name:                 "desktop without provider link stays local",
			mode:                 runModeDesktop,
			desktopManaged:       true,
			remoteConfigValid:    false,
			wantLocalUIEnabled:   true,
			wantControlEnabled:   false,
			wantEffectiveRunMode: runModeLocal,
		},
		{
			name:                 "local mode remains local even with provider config",
			mode:                 runModeLocal,
			desktopManaged:       true,
			remoteConfigValid:    true,
			wantLocalUIEnabled:   true,
			wantControlEnabled:   false,
			wantEffectiveRunMode: runModeLocal,
		},
		{
			name:                  "hybrid mode requires remote control",
			mode:                  runModeHybrid,
			remoteConfigValid:     true,
			wantLocalUIEnabled:    true,
			wantControlEnabled:    true,
			wantEffectiveRunMode:  runModeHybrid,
			wantProcessRemoteMode: true,
		},
		{
			name:                  "remote mode has no local ui",
			mode:                  runModeRemote,
			remoteConfigValid:     true,
			wantControlEnabled:    true,
			wantEffectiveRunMode:  runModeRemote,
			wantProcessRemoteMode: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveRuntimeLaunchPolicy(tt.mode, tt.desktopManaged, tt.remoteConfigValid)
			if got.localUIEnabled != tt.wantLocalUIEnabled ||
				got.controlChannelEnabled != tt.wantControlEnabled ||
				got.effectiveRunMode != tt.wantEffectiveRunMode ||
				got.remoteEnabled != tt.wantProcessRemoteMode {
				t.Fatalf("resolveRuntimeLaunchPolicy() = %#v", got)
			}
		})
	}
}

func TestTargetsCommandJSON(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-targets-cli-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := config.Save(layout.ConfigPath, &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "provider_1",
		EnvironmentID:            "env_123",
		LocalEnvironmentPublicID: "le_123",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir: layout.StateDir,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:  "http://127.0.0.1:23998/",
				LocalUIURLs: []string{"http://127.0.0.1:23998/"},
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				EffectiveRunMode: "hybrid",
				RemoteEnabled:    true,
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

	t.Run("list writes protocol envelope", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "targets", "list", "--state-root", stateRoot, "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true || payload["schema_version"].(float64) != 1 {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		targets := data["targets"].([]any)
		if len(targets) != 1 {
			t.Fatalf("targets len = %d, want 1", len(targets))
		}
		target := targets[0].(map[string]any)
		if target["id"] != "local:local" || target["env_public_id"] != "env_123" {
			t.Fatalf("unexpected target: %#v", target)
		}
	})

	t.Run("resolve accepts env id", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "targets", "resolve", "--state-root", stateRoot, "--target", "env_123", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v", err)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		trace := payload["trace"].(map[string]any)
		if trace["target_id"] != "local:local" {
			t.Fatalf("trace target_id = %#v", trace["target_id"])
		}
	})

	t.Run("exec writes local execution provenance", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "targets", "exec", "--state-root", stateRoot, "--target", "current", "--command", "printf cli-ok", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		if data["target_id"] != "local:local" || data["execution_location"] != agentprotocol.TargetExecutionLocationLocalRuntime {
			t.Fatalf("exec provenance = %#v", data)
		}
		if data["stdout"] != "cli-ok" || data["exit_code"].(float64) != 0 {
			t.Fatalf("exec result = %#v", data)
		}
		trace := payload["trace"].(map[string]any)
		if trace["target_id"] != "local:local" {
			t.Fatalf("trace target_id = %#v", trace["target_id"])
		}
	})

	t.Run("exec unsupported target returns structured success envelope", func(t *testing.T) {
		containerTarget := "local:container:docker:dev:abc12345"
		writeCLICatalogConnection(t, stateRoot, "container-dev", map[string]any{
			"schema_version": 1,
			"record_kind":    "connection",
			"kind":           "runtime_target",
			"id":             containerTarget,
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

		code, stdout, stderr := runCLITest(t, "targets", "exec", "--state-root", stateRoot, "--target", containerTarget, "--command", "date", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		if data["supported"] != false || data["reason_code"] != agentprotocol.TargetExecReasonUnsupportedTargetKind {
			t.Fatalf("unexpected unsupported exec result: %#v", data)
		}
		if data["target_id"] != containerTarget {
			t.Fatalf("target_id = %#v, want %q", data["target_id"], containerTarget)
		}
		if strings.Contains(stdout, "docker exec") || strings.Contains(stdout, "ssh ") || strings.Contains(stdout, "systemctl") {
			t.Fatalf("unsupported exec result contains forbidden low-level command: %s", stdout)
		}
	})

	t.Run("exec recognized unsupported target shape returns structured success envelope", func(t *testing.T) {
		providerTarget := "provider:https%3A%2F%2Fredeven.test:env:env_456"
		code, stdout, stderr := runCLITest(t, "targets", "exec", "--state-root", stateRoot, "--target", providerTarget, "--command", "date", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		if data["supported"] != false || data["reason_code"] != agentprotocol.TargetExecReasonUnsupportedTargetKind {
			t.Fatalf("unexpected unsupported exec result: %#v", data)
		}
		if data["target_id"] != providerTarget {
			t.Fatalf("target_id = %#v, want %q", data["target_id"], providerTarget)
		}
		trace := payload["trace"].(map[string]any)
		if trace["target_id"] != providerTarget {
			t.Fatalf("trace target_id = %#v", trace["target_id"])
		}
	})

	t.Run("exec password ssh target returns structured success envelope", func(t *testing.T) {
		passwordTarget := "ssh:devbox:22:password:remote_default"
		writeCLICatalogConnection(t, stateRoot, "ssh-password-dev", map[string]any{
			"schema_version":  1,
			"record_kind":     "connection",
			"kind":            "ssh",
			"id":              passwordTarget,
			"label":           "Password Devbox",
			"ssh_destination": "devbox",
			"ssh_port":        22,
			"auth_mode":       "password",
			"runtime_root":    "remote_default",
		})

		code, stdout, stderr := runCLITest(t, "targets", "exec", "--state-root", stateRoot, "--target", passwordTarget, "--command", "date", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		if data["supported"] != false || data["reason_code"] != agentprotocol.TargetExecReasonPasswordAuthUnavailable {
			t.Fatalf("unexpected password ssh exec result: %#v", data)
		}
	})

	t.Run("resolve missing target returns error envelope", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "targets", "resolve", "--state-root", stateRoot, "--target", "missing", "--json")
		if code != 1 {
			t.Fatalf("exit code = %d, want 1; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v", err)
		}
		if payload["ok"] != false {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		errPayload := payload["error"].(map[string]any)
		if errPayload["code"] != agentprotocol.ErrCodeTargetNotFound {
			t.Fatalf("error code = %#v", errPayload["code"])
		}
	})
}

func TestPrintRunStateLayoutGuidanceIncludesStateRootHint(t *testing.T) {
	var stderr bytes.Buffer
	exitCode := (&cli{stderr: &stderr}).printRunStateLayoutGuidance(config.ErrHomeDirUnavailable)
	if exitCode != 1 {
		t.Fatalf("exitCode = %d, want 1", exitCode)
	}
	assertContainsAll(t, stderr.String(),
		"failed to resolve runtime state layout: user home directory is unavailable",
		"Hint: export HOME before running `redeven run`, or pass --state-root <path>.",
	)
}

func runCLITest(t *testing.T, args ...string) (int, string, string) {
	return runCLITestWithStdin(t, "", args...)
}

func runCLITestWithStdin(t *testing.T, stdinText string, args ...string) (int, string, string) {
	t.Helper()

	t.Setenv("HOME", t.TempDir())

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := runCLI(args, strings.NewReader(stdinText), &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func writeCLICatalogConnection(t *testing.T, stateRoot string, name string, value map[string]any) {
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

func assertContainsAll(t *testing.T, text string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected output to contain %q\nfull output:\n%s", needle, text)
		}
	}
}

func TestEnvCommandJSON(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-env-cli-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := config.Save(layout.ConfigPath, &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "provider_1",
		EnvironmentID:            "env_123",
		LocalEnvironmentPublicID: "le_123",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:        layout.StateDir,
				PID:             12345,
				RuntimeVersion:  "1.2.3",
				DesktopManaged:  true,
				DesktopOwnerID:  "desktop_1",
				StartedAtUnixMS: 1779100944496,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL:  "http://127.0.0.1:23998/",
				LocalUIURLs: []string{"http://127.0.0.1:23998/"},
				RuntimeControl: &runtimemanagement.RuntimeControlEndpoint{
					BaseURL: "http://runtime",
					Token:   "secret-runtime-control-token",
				},
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				EffectiveRunMode: "desktop",
				RemoteEnabled:    true,
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

	t.Run("list writes sanitized environment targets", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "env", "list", "--state-root", stateRoot, "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		for _, forbidden := range []string{
			"state_root",
			"state_dir",
			"config_path",
			"runtime_control_socket_path",
			layout.StateRoot,
			layout.StateDir,
			layout.ConfigPath,
			layout.RuntimeControlSocketPath,
		} {
			if forbidden != "" && strings.Contains(stdout, forbidden) {
				t.Fatalf("list leaked local path material %q: %s", forbidden, stdout)
			}
		}
	})

	t.Run("status writes sanitized runtime summary", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "env", "status", "--state-root", stateRoot, "--target", "local", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		if strings.Contains(stdout, "secret-runtime-control-token") ||
			strings.Contains(stdout, `"token"`) ||
			strings.Contains(stdout, `"runtime_control":{"`) {
			t.Fatalf("status leaked runtime-control material: %s", stdout)
		}
		for _, forbidden := range []string{
			"state_root",
			"state_dir",
			"config_path",
			"runtime_control_socket_path",
			layout.StateRoot,
			layout.StateDir,
			layout.ConfigPath,
			layout.RuntimeControlSocketPath,
		} {
			if forbidden != "" && strings.Contains(stdout, forbidden) {
				t.Fatalf("status leaked local path material %q: %s", forbidden, stdout)
			}
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		if payload["ok"] != true {
			t.Fatalf("unexpected envelope: %#v", payload)
		}
		data := payload["data"].(map[string]any)
		runtime := data["runtime"].(map[string]any)
		if runtime["state"] != "ready" || runtime["desktop_managed"] != true {
			t.Fatalf("unexpected runtime summary: %#v", runtime)
		}
		operations := data["operations"].(map[string]any)
		stop := operations["stop"].(map[string]any)
		if stop["availability"] != "available" || stop["command"] != "redeven env stop --target local:local --json" {
			t.Fatalf("unexpected stop plan: %#v", stop)
		}
	})

	t.Run("current target resolves to default environment", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "env", "status", "--state-root", stateRoot, "--target", "current", "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		data := payload["data"].(map[string]any)
		target := data["target"].(map[string]any)
		if target["id"] != "local:local" {
			t.Fatalf("target id = %#v, want local:local", target["id"])
		}
	})

	t.Run("resolve keeps container target in Redeven semantics", func(t *testing.T) {
		target := "local:container:docker:redeven-dev-mysql-db-dev-1:63ce185e"
		code, stdout, stderr := runCLITest(t, "env", "resolve", "--state-root", stateRoot, "--target", target, "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		data := payload["data"].(map[string]any)
		if data["supported"] != false || data["reason_code"] != agentprotocol.EnvReasonUnsupportedTargetKind {
			t.Fatalf("unexpected unsupported resolution: %#v", data)
		}
		resolvedTarget := data["target"].(map[string]any)
		if resolvedTarget["kind"] != agentprotocol.TargetKindLocalContainerRuntime {
			t.Fatalf("target kind = %#v, want local container runtime", resolvedTarget["kind"])
		}
	})

	t.Run("restart unsupported target returns business plan", func(t *testing.T) {
		target := "local:container:docker:redeven-dev-mysql-db-dev-1:63ce185e"
		code, stdout, stderr := runCLITest(t, "env", "restart", "--state-root", stateRoot, "--target", target, "--json")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
		}
		if strings.Contains(stdout, "docker restart") || strings.Contains(stdout, "docker stop") || strings.Contains(stdout, "systemctl") {
			t.Fatalf("restart plan contains forbidden low-level command: %s", stdout)
		}
		var payload map[string]any
		if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
			t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
		}
		data := payload["data"].(map[string]any)
		operation := data["operation"].(map[string]any)
		if operation["availability"] != agentprotocol.OperationAvailabilityUnavailable ||
			operation["reason_code"] != agentprotocol.EnvReasonUnsupportedTargetKind {
			t.Fatalf("unexpected restart operation: %#v", operation)
		}
	})
}

func TestEnvRestartStoppedLocalRuntimeReturnsDesktopHandoffPlan(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-env-stopped-cli-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := config.Save(layout.ConfigPath, &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "provider_1",
		EnvironmentID:            "env_123",
		LocalEnvironmentPublicID: "le_123",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	code, stdout, stderr := runCLITest(t, "env", "restart", "--state-root", stateRoot, "--target", "local", "--json")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
	}
	data := payload["data"].(map[string]any)
	runtime := data["runtime"].(map[string]any)
	if runtime["state"] != "not_running" {
		t.Fatalf("runtime state = %#v, want not_running", runtime["state"])
	}
	operation := data["operation"].(map[string]any)
	if operation["availability"] != agentprotocol.OperationAvailabilityUnavailable ||
		operation["reason_code"] != agentprotocol.EnvReasonDesktopStartRequired ||
		operation["performed"] == true {
		t.Fatalf("unexpected restart operation: %#v", operation)
	}
}

func TestEnvStopRechecksDesktopOwnerBeforeStopping(t *testing.T) {
	stateRoot, err := os.MkdirTemp("/tmp", "rdv-env-stop-owner-cli-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(stateRoot) }()
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := config.Save(layout.ConfigPath, &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "provider_1",
		EnvironmentID:            "env_123",
		LocalEnvironmentPublicID: "le_123",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	var calls int32
	statusServer, err := runtimemanagement.NewServer(layout.RuntimeControlSocketPath, func(context.Context) (runtimemanagement.RuntimeAttachStatus, error) {
		desktopManaged := atomic.AddInt32(&calls, 1) == 1
		return runtimemanagement.RuntimeAttachStatus{
			State: runtimemanagement.AttachStateReady,
			Identity: runtimemanagement.RuntimeInstanceIdentity{
				StateDir:       layout.StateDir,
				PID:            os.Getpid(),
				RuntimeVersion: "1.2.3",
				DesktopManaged: desktopManaged,
			},
			Endpoint: &runtimemanagement.RuntimeAttachEndpoint{
				LocalUIURL: "http://127.0.0.1:23998/",
			},
			RuntimeService: runtimeservice.NormalizeSnapshot(runtimeservice.Snapshot{
				EffectiveRunMode: "desktop",
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

	code, stdout, stderr := runCLITest(t, "env", "stop", "--state-root", stateRoot, "--target", "local", "--json")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr=%s", code, stderr)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stdout), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v\nstdout=%s", err, stdout)
	}
	if payload["ok"] != true {
		t.Fatalf("unexpected envelope: %#v", payload)
	}
	data := payload["data"].(map[string]any)
	operation := data["operation"].(map[string]any)
	if operation["availability"] != agentprotocol.OperationAvailabilityBlocked ||
		operation["reason_code"] != agentprotocol.EnvReasonRuntimeOwnerExternal ||
		operation["performed"] == true {
		t.Fatalf("unexpected stop operation: %#v", operation)
	}
}

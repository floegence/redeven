package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
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
			"redeven bootstrap --controlplane https://region.example.invalid --env-id env_123 --env-token <token>",
			"redeven run --mode local",
			"redeven run --mode local --scope named/dev-a",
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
			"Scope selection rules:",
			"Local UI bind rules:",
			"Always start the Local UI. Connect to the control plane only when bootstrap config is already valid.",
			"--scope <selector>",
			"--state-root <path>",
			"--config-path <path>",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.0.0.1:0, 0.0.0.0:24000, 192.168.1.11:24000",
			"redeven run --mode local --scope named/dev-a",
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
			"--controlplane <url>",
			"--env-id <env_public_id>",
			"--env-token <token>",
			"--env-token-env <env_name>",
			"--bootstrap-ticket <ticket>",
			"--bootstrap-ticket-env <env_name>",
			"--scope <selector>",
			"--state-root <path>",
			"redeven bootstrap --controlplane https://region.example.invalid --env-id env_123 --env-token <token>",
		)
	})

	t.Run("knowledge bundle help is available through help command", func(t *testing.T) {
		code, stdout, stderr := runCLITest(t, "help", "knowledge", "bundle")
		if code != 0 {
			t.Fatalf("exit code = %d, want 0", code)
		}
		if stderr != "" {
			t.Fatalf("stderr = %q, want empty", stderr)
		}
		assertContainsAll(t, stdout,
			"redeven knowledge bundle",
			"--verify-only",
			"--validate-source-only",
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
			"missing required flags for `redeven bootstrap`: --controlplane, --env-id, one bootstrap credential (--env-token/--env-token-env or --bootstrap-ticket/--bootstrap-ticket-env)",
			"Example: redeven bootstrap --controlplane https://region.example.invalid --env-id env_123 --env-token <token>",
		)
	})

	t.Run("run incomplete inline bootstrap flags explain the missing flag", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "hybrid", "--controlplane", "https://region.example.invalid", "--env-id", "env_123")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"incomplete bootstrap flags for `redeven run`: missing flag one bootstrap credential (--env-token/--env-token-env or --bootstrap-ticket/--bootstrap-ticket-env)",
			"Hint: provide --controlplane, --env-id, and exactly one bootstrap credential together, or run `redeven bootstrap` first.",
		)
	})

	t.Run("env token env can satisfy inline bootstrap requirements", func(t *testing.T) {
		t.Setenv("REDEVEN_ENV_TOKEN", "token-123")
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--controlplane", "https://region.example.invalid", "--env-id", "env_123", "--env-token-env", "REDEVEN_ENV_TOKEN")
		if code != 1 {
			t.Fatalf("exit code = %d, want 1", code)
		}
		if strings.Contains(stderr, "invalid environment token flags") {
			t.Fatalf("stderr = %q, want no env token flag error", stderr)
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

	t.Run("invalid local ui bind includes accepted examples", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "example.com:12345")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--local-ui-bind`: host must be localhost or an IP literal",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.0.0.1:0, 0.0.0.0:24000, 192.168.1.11:24000",
		)
	})

	t.Run("localhost zero port explains the supported loopback alternative", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "localhost:0")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid value for `--local-ui-bind`: localhost:0 is not supported; use 127.0.0.1:0 or [::1]:0",
			"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.0.0.1:0, 0.0.0.0:24000, 192.168.1.11:24000",
		)
	})

	t.Run("desktop managed requires a local ui mode", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "remote", "--desktop-managed")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"`--desktop-managed` requires a Local UI run mode",
			"Hint: use `redeven run --mode desktop --desktop-managed` for the packaged desktop shell.",
		)
	})

	t.Run("startup report file requires a local ui mode", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "remote", "--startup-report-file", filepath.Join(t.TempDir(), "startup.json"))
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"`--startup-report-file` requires a Local UI run mode",
			"Hint: use `redeven run --mode desktop --startup-report-file <path>` when a desktop shell needs machine-readable readiness output.",
		)
	})

	t.Run("non loopback bind without password gives exact next step", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--local-ui-bind", "0.0.0.0:12345")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"non-loopback `--local-ui-bind` requires an access password",
			"Hint: set exactly one of --password, --password-stdin, --password-env, or --password-file.",
			"REDEVEN_LOCAL_UI_PASSWORD=replace-with-a-long-password redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env REDEVEN_LOCAL_UI_PASSWORD",
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
			"MISSING_PASSWORD=replace-with-a-long-password redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env MISSING_PASSWORD",
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

	t.Run("multiple env token sources explain the conflict", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--env-token", "token-1", "--env-token-env", "REDEVEN_ENV_TOKEN")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid environment token flags: use only one of --env-token or --env-token-env",
			"Hint: choose a single environment token source for `redeven run`.",
		)
	})

	t.Run("multiple bootstrap credential types explain the conflict", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--env-token", "token-1", "--bootstrap-ticket", "ticket-1")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid bootstrap flags for `redeven run`: choose either an environment token or a bootstrap ticket",
			"Hint: use exactly one bootstrap credential source for each run command.",
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

	t.Run("missing env token env gives export guidance", func(t *testing.T) {
		code, _, stderr := runCLITest(t, "run", "--mode", "local", "--env-token-env", "REDEVEN_ENV_TOKEN")
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		assertContainsAll(t, stderr,
			"invalid environment token flags: environment token env var \"REDEVEN_ENV_TOKEN\" is not set",
			"Hint: export REDEVEN_ENV_TOKEN with a non-empty token before running `redeven run`.",
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
			"Hint: run `redeven bootstrap` first, or pass --controlplane, --env-id, and exactly one bootstrap credential directly to `redeven run`.",
			"redeven bootstrap --controlplane https://region.example.invalid --env-id env_123 --env-token <token>",
			"redeven run --mode hybrid --controlplane https://region.example.invalid --env-id env_123 --env-token <token>",
			"REDEVEN_BOOTSTRAP_TICKET=<bootstrap-ticket> redeven run --mode desktop --desktop-managed --controlplane https://region.example.invalid --env-id env_123 --bootstrap-ticket-env REDEVEN_BOOTSTRAP_TICKET",
		)
	})
}

func TestResolveRunStateLayoutUsesExplicitConfigPath(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "custom", "config.json")

	layout, err := resolveRunStateLayout(configPath, "", nil, "", "", false)
	if err != nil {
		t.Fatalf("resolveRunStateLayout() error = %v", err)
	}
	if layout.ConfigPath != configPath {
		t.Fatalf("ConfigPath = %q, want %q", layout.ConfigPath, configPath)
	}
	if layout.StateDir != filepath.Join(tmpDir, "custom") {
		t.Fatalf("StateDir = %q", layout.StateDir)
	}
}

func TestResolveRunStateLayoutDefaultsToLocalScope(t *testing.T) {
	stateRoot := t.TempDir()

	layout, err := resolveRunStateLayout("", stateRoot, nil, "", "", false)
	if err != nil {
		t.Fatalf("resolveRunStateLayout() error = %v", err)
	}
	if layout.ScopeKey != "local/default" {
		t.Fatalf("ScopeKey = %q", layout.ScopeKey)
	}
	if layout.ConfigPath != filepath.Join(stateRoot, "scopes", "local", "default", "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
}

func TestResolveRunStateLayoutUsesInlineBootstrapControlPlaneScope(t *testing.T) {
	stateRoot := t.TempDir()

	layout, err := resolveRunStateLayout("", stateRoot, nil, "https://region.example.invalid", "env_123", true)
	if err != nil {
		t.Fatalf("resolveRunStateLayout() error = %v", err)
	}
	if layout.ScopeKey != "controlplane/https__region.example.invalid/env_123" {
		t.Fatalf("ScopeKey = %q", layout.ScopeKey)
	}
	if layout.ConfigPath != filepath.Join(stateRoot, "scopes", "controlplane", "https__region.example.invalid", "env_123", "config.json") {
		t.Fatalf("ConfigPath = %q", layout.ConfigPath)
	}
}

func TestValidateStateLayoutSelectionRejectsConfigPathWithScopeOrStateRoot(t *testing.T) {
	scopeRef := &config.ScopeRef{Kind: config.ScopeKindNamed, Name: "dev-a"}

	err := validateStateLayoutSelection("/tmp/config.json", scopeRef, "")
	if err == nil || !strings.Contains(err.Error(), "`--config-path` cannot be combined with `--scope`") {
		t.Fatalf("validateStateLayoutSelection() error = %v", err)
	}

	err = validateStateLayoutSelection("/tmp/config.json", nil, "/tmp/state")
	if err == nil || !strings.Contains(err.Error(), "`--config-path` cannot be combined with `--state-root`") {
		t.Fatalf("validateStateLayoutSelection() error = %v", err)
	}
}

func TestPrintRunStateLayoutGuidanceIncludesConfigPathHint(t *testing.T) {
	var stderr bytes.Buffer
	exitCode := (&cli{stderr: &stderr}).printRunStateLayoutGuidance(config.ErrHomeDirUnavailable)
	if exitCode != 1 {
		t.Fatalf("exitCode = %d, want 1", exitCode)
	}
	assertContainsAll(t, stderr.String(),
		"failed to resolve runtime state layout: user home directory is unavailable",
		"Hint: export HOME before running `redeven run`, or pass --config-path <path>.",
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

func assertContainsAll(t *testing.T, text string, needles ...string) {
	t.Helper()
	for _, needle := range needles {
		if !strings.Contains(text, needle) {
			t.Fatalf("expected output to contain %q\nfull output:\n%s", needle, text)
		}
	}
}

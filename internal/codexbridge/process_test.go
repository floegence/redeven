package codexbridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestBuildAppServerCommand_ExecutesResolvedBinaryDirectly(t *testing.T) {
	shellPath := writeEnvCaptureShell(t, []string{
		"PATH=/usr/bin:/bin",
		"CUSTOM_PROVIDER_API_KEY=from-login-shell",
	}, "")
	fallbackShell := writeEnvCaptureShell(t, []string{
		"PATH=/fallback/bin",
	}, "")
	codexPath := writeExecutable(t, "codex")
	t.Setenv("SHELL", fallbackShell)

	cmd, err := buildAppServerCommand(shellPath, codexPath)
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, codexPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, codexPath)
	pathValue := pathFromEnv(cmd.Env)
	if pathValue == "" {
		t.Fatalf("cmd.Env missing PATH: %v", cmd.Env)
	}
	if first := strings.Split(pathValue, string(os.PathListSeparator))[0]; first != filepath.Dir(codexPath) {
		t.Fatalf("PATH first entry=%q want %q", first, filepath.Dir(codexPath))
	}
	if got := envValue(cmd.Env, "CUSTOM_PROVIDER_API_KEY"); got != "from-login-shell" {
		t.Fatalf("CUSTOM_PROVIDER_API_KEY=%q want login shell value", got)
	}
}

func TestLookPathFromLoginShell_UsesConfiguredShell(t *testing.T) {
	dir := t.TempDir()
	codexPath := writeExecutableAt(t, dir, "codex")
	shellPath := filepath.Join(t.TempDir(), "shell")
	script := "#!/bin/sh\nif [ \"$1\" = \"-l\" ] && [ \"$2\" = \"-i\" ] && [ \"$3\" = \"-c\" ]; then\n  PATH=\"" + dir + ":$PATH\" /bin/sh -c \"$4\" \"$5\"\n  exit $?\nfi\nexit 64\n"
	if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write shell %q: %v", shellPath, err)
	}
	t.Setenv("SHELL", "")

	if got := lookPathFromLoginShell(shellPath, "codex"); got != codexPath {
		t.Fatalf("lookPathFromLoginShell()=%q want %q", got, codexPath)
	}
}

func TestLookPathFromLoginShell_IgnoresInteractiveShellNoise(t *testing.T) {
	dir := t.TempDir()
	codexPath := writeExecutableAt(t, dir, "codex")
	shellPath := filepath.Join(t.TempDir(), "shell")
	script := "#!/bin/sh\nif [ \"$1\" = \"-l\" ] && [ \"$2\" = \"-i\" ] && [ \"$3\" = \"-c\" ]; then\n  printf 'alias codex=%s\\n' \"'codex --dangerously-bypass-approvals-and-sandbox'\"\n  PATH=\"" + dir + ":$PATH\" /bin/sh -c \"$4\" \"$5\"\n  exit $?\nfi\nexit 64\n"
	if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write shell %q: %v", shellPath, err)
	}
	t.Setenv("SHELL", "")

	if got := lookPathFromLoginShell(shellPath, "codex"); got != codexPath {
		t.Fatalf("lookPathFromLoginShell()=%q want %q", got, codexPath)
	}
}

func TestBuildAppServerCommand_UsesLoginShellPathForNodeShim(t *testing.T) {
	dir := t.TempDir()
	codexPath := writeNodeShimAt(t, dir, "codex")
	nodeDir := filepath.Join(t.TempDir(), "node-bin")
	if err := os.MkdirAll(nodeDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	_ = writeExecutableAt(t, nodeDir, "node")
	shellPath := writeEnvCaptureShell(t, []string{
		"PATH=" + nodeDir + string(os.PathListSeparator) + "/usr/bin",
	}, "")

	cmd, err := buildAppServerCommand(shellPath, codexPath)
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}
	pathValue := pathFromEnv(cmd.Env)
	parts := strings.Split(pathValue, string(os.PathListSeparator))
	if len(parts) < 2 || parts[0] != dir || parts[1] != nodeDir {
		t.Fatalf("PATH=%q, want binary dir then shell PATH", pathValue)
	}
}

func TestBuildAppServerCommand_RejectsNodeShimWithoutNodeInRuntimePath(t *testing.T) {
	dir := t.TempDir()
	codexPath := writeNodeShimAt(t, dir, "codex")
	shellPath := writeEnvCaptureShell(t, []string{
		"PATH=" + t.TempDir(),
	}, "")
	t.Setenv("SHELL", "")

	_, err := buildAppServerCommand(shellPath, codexPath)
	if err == nil || !strings.Contains(err.Error(), "Node.js shim") || !strings.Contains(err.Error(), "`node` is not available") {
		t.Fatalf("buildAppServerCommand error=%v, want actionable node shim error", err)
	}
}

func TestBuildAppServerCommand_RejectsLoginShellEnvCaptureFailure(t *testing.T) {
	codexPath := writeExecutable(t, "codex")
	shellPath := filepath.Join(t.TempDir(), "shell")
	script := "#!/bin/sh\nexit 64\n"
	if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write shell %q: %v", shellPath, err)
	}

	_, err := buildAppServerCommand(shellPath, codexPath)
	if err == nil || !strings.Contains(err.Error(), "capture login shell environment") {
		t.Fatalf("buildAppServerCommand error=%v, want login shell capture error", err)
	}
}

func TestParseLoginShellEnvironmentOutput_IgnoresShellNoise(t *testing.T) {
	raw := []byte("welcome from shell\n" +
		loginShellEnvBeginMarker + "\x00" +
		"PATH=/login/bin:/usr/bin\x00" +
		"CUSTOM_PROVIDER_API_KEY=secret-from-login\x00" +
		loginShellEnvEndMarker + "\x00" +
		"trailing noise\n")

	snapshot, err := parseLoginShellEnvironmentOutput(raw)
	if err != nil {
		t.Fatalf("parseLoginShellEnvironmentOutput: %v", err)
	}
	if got := snapshot.PATH; got != "/login/bin:/usr/bin" {
		t.Fatalf("PATH=%q want login path", got)
	}
	if got := envValue(snapshot.Env, "CUSTOM_PROVIDER_API_KEY"); got != "secret-from-login" {
		t.Fatalf("CUSTOM_PROVIDER_API_KEY=%q want secret-from-login", got)
	}
}

func TestParseLoginShellEnvironmentOutput_RejectsMalformedOutput(t *testing.T) {
	_, err := parseLoginShellEnvironmentOutput([]byte("startup noise only"))
	if err == nil || !strings.Contains(err.Error(), "marker") {
		t.Fatalf("parseLoginShellEnvironmentOutput error=%v, want marker error", err)
	}
}

func TestAppServerProcessStructuredStderrFiltering(t *testing.T) {
	t.Parallel()

	proc := &appServerProcess{}
	proc.handleStderrLine(`{"level":"INFO","fields":{"message":"processor task exited","exit_reason":"last_connection_closed","remaining_connection_count":0,"shutdown_forced":false},"target":"codex_app_server"}`)
	if got := proc.lastStderr(); got != "" {
		t.Fatalf("lastStderr=%q, want empty", got)
	}

	proc.handleStderrLine(`{"level":"WARN","fields":{"message":"processor task exited","exit_reason":"last_connection_closed","shutdown_forced":false},"target":"codex_app_server"}`)
	if got := proc.lastStderr(); got == "" {
		t.Fatalf("expected WARN structured stderr to be retained")
	}

	proc = &appServerProcess{}
	proc.handleStderrLine("env: node: No such file or directory")
	if got := proc.lastStderr(); got != "env: node: No such file or directory" {
		t.Fatalf("lastStderr=%q", got)
	}
}

func TestBuildAppServerCommand_RejectsNonExecutableResolvedOutput(t *testing.T) {
	_, err := buildAppServerCommand("", "alias codex='codex --dangerously-bypass-approvals-and-sandbox'")
	if err == nil || !strings.Contains(err.Error(), "not executable") {
		t.Fatalf("buildAppServerCommand error=%v, want not executable", err)
	}
}

func assertCommandArgs(t *testing.T, cmd *exec.Cmd, codexPath string) {
	t.Helper()
	want := []string{
		codexPath,
		"app-server",
		"--listen",
		"stdio://",
	}
	if !reflect.DeepEqual(cmd.Args, want) {
		t.Fatalf("cmd.Args=%v want=%v", cmd.Args, want)
	}
}

func writeExecutable(t *testing.T, name string) string {
	t.Helper()
	return writeExecutableAt(t, t.TempDir(), name)
}

func writeExecutableAt(t *testing.T, dir string, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("write executable %q: %v", path, err)
	}
	return path
}

func writeNodeShimAt(t *testing.T, dir string, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/usr/bin/env node\nprocess.exit(0)\n"), 0o755); err != nil {
		t.Fatalf("write node shim %q: %v", path, err)
	}
	return path
}

func writeEnvCaptureShell(t *testing.T, env []string, noise string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "shell")
	var script strings.Builder
	script.WriteString("#!/bin/sh\n")
	script.WriteString("if [ \"$1\" = \"-l\" ] && [ \"$2\" = \"-i\" ] && [ \"$3\" = \"-c\" ]; then\n")
	if noise != "" {
		script.WriteString("  printf '%s\\n' " + shellQuote(noise) + "\n")
	}
	script.WriteString("  printf '%s\\000' " + shellQuote(loginShellEnvBeginMarker))
	for _, kv := range env {
		script.WriteString(" " + shellQuote(kv))
	}
	script.WriteString(" " + shellQuote(loginShellEnvEndMarker) + "\n")
	script.WriteString("  exit 0\n")
	script.WriteString("fi\n")
	script.WriteString("exit 64\n")
	if err := os.WriteFile(path, []byte(script.String()), 0o755); err != nil {
		t.Fatalf("write shell %q: %v", path, err)
	}
	return path
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func pathFromEnv(env []string) string {
	return envValue(env, "PATH")
}

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
	shellPath := writeExecutable(t, "preferred-shell")
	fallbackShell := writeExecutable(t, "fallback-shell")
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
	codexPath := writeExecutableAt(t, dir, "codex")
	nodeDir := filepath.Join(t.TempDir(), "node-bin")
	if err := os.MkdirAll(nodeDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	shellPath := filepath.Join(t.TempDir(), "shell")
	script := "#!/bin/sh\nif [ \"$1\" = \"-l\" ] && [ \"$2\" = \"-i\" ] && [ \"$3\" = \"-c\" ]; then\n  PATH=\"" + nodeDir + ":$PATH\" /bin/sh -c \"$4\" \"$5\"\n  exit $?\nfi\nexit 64\n"
	if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write shell %q: %v", shellPath, err)
	}

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

func pathFromEnv(env []string) string {
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			return strings.TrimPrefix(kv, "PATH=")
		}
	}
	return ""
}

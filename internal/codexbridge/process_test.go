package codexbridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestBuildAppServerCommand_UsesConfiguredShellWithLoginInteractiveFlags(t *testing.T) {
	shellPath := writeExecutable(t, "preferred-shell")
	fallbackShell := writeExecutable(t, "fallback-shell")
	t.Setenv("SHELL", fallbackShell)

	cmd, err := buildAppServerCommand(shellPath, "/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, shellPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, shellPath)
	if cmd.Env != nil {
		t.Fatalf("cmd.Env=%v want nil", cmd.Env)
	}
}

func TestBuildAppServerCommand_ResolvesConfiguredShellFromPath(t *testing.T) {
	dir := t.TempDir()
	shellPath := writeExecutableAt(t, dir, "custom-shell")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("SHELL", "")

	cmd, err := buildAppServerCommand("custom-shell", "/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, shellPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, shellPath)
}

func TestBuildAppServerCommand_FallsBackToEnvShellWhenConfiguredShellUnset(t *testing.T) {
	envShellPath := writeExecutable(t, "env-shell")
	t.Setenv("SHELL", envShellPath)

	cmd, err := buildAppServerCommand("", "/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, envShellPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, envShellPath)
}

func TestBuildAppServerCommand_FallsBackToEnvShellWhenConfiguredShellMissing(t *testing.T) {
	envShellPath := writeExecutable(t, "env-shell")
	t.Setenv("SHELL", envShellPath)

	cmd, err := buildAppServerCommand(filepath.Join(t.TempDir(), "missing-shell"), "/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, envShellPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, envShellPath)
}

func TestBuildAppServerCommand_FallsBackToBashWhenNoConfiguredShellAvailable(t *testing.T) {
	t.Setenv("SHELL", "")
	bashPath := mustLookPath(t, "bash")

	cmd, err := buildAppServerCommand("", "/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, bashPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, bashPath)
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

func assertCommandArgs(t *testing.T, cmd *exec.Cmd, shellPath string) {
	t.Helper()
	want := []string{
		shellPath,
		"-l",
		"-i",
		"-c",
		`exec "$0" app-server --listen stdio://`,
		"/opt/homebrew/bin/codex",
	}
	if !reflect.DeepEqual(cmd.Args, want) {
		t.Fatalf("cmd.Args=%v want=%v", cmd.Args, want)
	}
}

func mustLookPath(t *testing.T, name string) string {
	t.Helper()
	path, err := exec.LookPath(name)
	if err != nil {
		t.Fatalf("exec.LookPath(%q): %v", name, err)
	}
	return path
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

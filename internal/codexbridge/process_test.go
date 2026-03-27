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
	t.Setenv("SHELL", shellPath)

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
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
	t.Setenv("SHELL", "custom-shell")

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, shellPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, shellPath)
}

func TestBuildAppServerCommand_FallsBackToBashWhenShellUnset(t *testing.T) {
	t.Setenv("SHELL", "")
	bashPath := mustLookPath(t, "bash")

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, bashPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, bashPath)
}

func TestBuildAppServerCommand_FallsBackToBashWhenConfiguredShellMissing(t *testing.T) {
	t.Setenv("SHELL", filepath.Join(t.TempDir(), "missing-shell"))
	bashPath := mustLookPath(t, "bash")

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := cmd.Path, bashPath; got != want {
		t.Fatalf("cmd.Path=%q want=%q", got, want)
	}
	assertCommandArgs(t, cmd, bashPath)
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

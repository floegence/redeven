package codexbridge

import (
	"path/filepath"
	"testing"
)

func TestBuildAppServerCommand_UsesLoginShell(t *testing.T) {
	t.Parallel()

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := filepath.Base(cmd.Path), "bash"; got != want {
		t.Fatalf("filepath.Base(cmd.Path)=%q want=%q full=%q", got, want, cmd.Path)
	}
	if len(cmd.Args) != 4 {
		t.Fatalf("len(cmd.Args)=%d want=4 args=%v", len(cmd.Args), cmd.Args)
	}
	if got, want := cmd.Args[1], "-lc"; got != want {
		t.Fatalf("cmd.Args[1]=%q want=%q", got, want)
	}
	if got, want := cmd.Args[2], `exec "$0" app-server --listen stdio://`; got != want {
		t.Fatalf("cmd.Args[2]=%q want=%q", got, want)
	}
	if got, want := cmd.Args[3], "/opt/homebrew/bin/codex"; got != want {
		t.Fatalf("cmd.Args[3]=%q want=%q", got, want)
	}
}

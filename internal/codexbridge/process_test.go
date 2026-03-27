package codexbridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildAppServerCommand_UsesLoginShell(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("CODEX_HOME", "")

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
	if got, want := envValue(cmd.Env, "CODEX_HOME"), filepath.Join(homeDir, ".codex"); got != want {
		t.Fatalf("CODEX_HOME=%q want=%q env=%v", got, want, cmd.Env)
	}
}

func TestBuildAppServerCommand_PrefersExplicitCodexHomeEnv(t *testing.T) {
	homeDir := t.TempDir()
	explicitCodexHome := filepath.Join(homeDir, "custom-codex-home")
	if err := os.MkdirAll(explicitCodexHome, 0o755); err != nil {
		t.Fatalf("mkdir custom codex home: %v", err)
	}
	t.Setenv("HOME", homeDir)
	t.Setenv("CODEX_HOME", explicitCodexHome)

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := envValue(cmd.Env, "CODEX_HOME"), explicitCodexHome; got != want {
		t.Fatalf("CODEX_HOME=%q want=%q env=%v", got, want, cmd.Env)
	}
}

func TestBuildAppServerCommand_FallsBackToDesktopCodexHomeWhenDefaultAuthMissing(t *testing.T) {
	homeDir := t.TempDir()
	defaultCodexHome := filepath.Join(homeDir, ".codex")
	desktopCodexHome := filepath.Join(homeDir, ".codex-cc")
	if err := os.MkdirAll(defaultCodexHome, 0o755); err != nil {
		t.Fatalf("mkdir default codex home: %v", err)
	}
	if err := os.MkdirAll(desktopCodexHome, 0o755); err != nil {
		t.Fatalf("mkdir desktop codex home: %v", err)
	}
	if err := os.WriteFile(filepath.Join(desktopCodexHome, "auth.json"), []byte(`{"OPENAI_API_KEY":"test"}`), 0o600); err != nil {
		t.Fatalf("write desktop auth: %v", err)
	}
	t.Setenv("HOME", homeDir)
	t.Setenv("CODEX_HOME", "")

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := envValue(cmd.Env, "CODEX_HOME"), desktopCodexHome; got != want {
		t.Fatalf("CODEX_HOME=%q want=%q env=%v", got, want, cmd.Env)
	}
}

func TestBuildAppServerCommand_KeepsDefaultCodexHomeWhenDefaultAuthExists(t *testing.T) {
	homeDir := t.TempDir()
	defaultCodexHome := filepath.Join(homeDir, ".codex")
	desktopCodexHome := filepath.Join(homeDir, ".codex-cc")
	if err := os.MkdirAll(defaultCodexHome, 0o755); err != nil {
		t.Fatalf("mkdir default codex home: %v", err)
	}
	if err := os.MkdirAll(desktopCodexHome, 0o755); err != nil {
		t.Fatalf("mkdir desktop codex home: %v", err)
	}
	if err := os.WriteFile(filepath.Join(defaultCodexHome, "auth.json"), []byte(`{"OPENAI_API_KEY":"test"}`), 0o600); err != nil {
		t.Fatalf("write default auth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(desktopCodexHome, "auth.json"), []byte(`{"OPENAI_API_KEY":"test"}`), 0o600); err != nil {
		t.Fatalf("write desktop auth: %v", err)
	}
	t.Setenv("HOME", homeDir)
	t.Setenv("CODEX_HOME", "")

	cmd, err := buildAppServerCommand("/opt/homebrew/bin/codex")
	if err != nil {
		t.Fatalf("buildAppServerCommand: %v", err)
	}

	if got, want := envValue(cmd.Env, "CODEX_HOME"), defaultCodexHome; got != want {
		t.Fatalf("CODEX_HOME=%q want=%q env=%v", got, want, cmd.Env)
	}
}

func envValue(env []string, key string) string {
	tail, ok := lookupEnv(env, key)
	if !ok {
		return ""
	}
	return tail
}

package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	termgo "github.com/floegence/floeterm/terminal-go"
)

func mustEvalPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	return filepath.Clean(resolved)
}

func TestResolveWorkingDir(t *testing.T) {
	root := t.TempDir()
	m := NewManager("/bin/bash", root, nil)

	got, err := m.resolveWorkingDir("")
	if err != nil {
		t.Fatalf("resolveWorkingDir(empty) error: %v", err)
	}
	if mustEvalPath(t, got) != mustEvalPath(t, root) {
		t.Fatalf("resolveWorkingDir(empty) = %q, want %q", got, root)
	}

	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	got, err = m.resolveWorkingDir(sub)
	if err != nil {
		t.Fatalf("resolveWorkingDir(existing dir) error: %v", err)
	}
	if mustEvalPath(t, got) != mustEvalPath(t, sub) {
		t.Fatalf("resolveWorkingDir(existing dir) = %q, want %q", got, sub)
	}

	if _, err := m.resolveWorkingDir("/../../.."); err == nil {
		t.Fatalf("expected out-of-scope path to fail")
	}
}

func TestCreateSessionStartsDormantWithoutColsRows(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	t.Cleanup(func() {
		m.Cleanup()
	})

	if sess.IsActive() {
		t.Fatalf("expected session to remain dormant until attach")
	}
	if sess.PTY != nil || sess.Cmd != nil {
		t.Fatalf("expected PTY process to stay nil before attach activation")
	}

	got, ok := m.term.GetSession(sess.ID)
	if !ok || got == nil {
		t.Fatalf("expected created session to be tracked")
	}
	if got.ToSessionInfo().IsActive {
		t.Fatalf("expected listed session info to stay inactive before attach")
	}
}

func TestAttachSessionActivatesDormantSessionAndKeepsResizeWorking(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	t.Cleanup(func() {
		m.Cleanup()
	})

	if err := m.attachSession(sess.ID, "conn-1", 111, 33, nil); err != nil {
		t.Fatalf("attachSession() error = %v", err)
	}

	waitForPTYSize(t, sess, 111, 33, 2*time.Second)

	if err := m.resize(sess.ID, "conn-1", 95, 29); err != nil {
		t.Fatalf("resize() error = %v", err)
	}

	waitForPTYSize(t, sess, 95, 29, 2*time.Second)
}

func TestRedevenShellInitEnvProviderInjectsSentinelWhenPathPrependIsEmpty(t *testing.T) {
	provider := redevenShellInitEnvProvider{base: termgo.DefaultEnvProvider{}}

	env, pathPrepend, err := provider.BuildEnv("/bin/zsh", "/tmp")
	if err != nil {
		t.Fatalf("BuildEnv() error = %v", err)
	}
	if len(env) == 0 {
		t.Fatalf("expected environment to be preserved")
	}
	if pathPrepend != redevenShellInitPathPrependSentinel {
		t.Fatalf("pathPrepend = %q, want sentinel %q", pathPrepend, redevenShellInitPathPrependSentinel)
	}
}

func TestRedevenShellInitWriterGeneratesLifecycleHooks(t *testing.T) {
	paths := newRedevenShellInitPaths(t.TempDir())
	writer := redevenShellInitWriter{BaseDir: paths.BaseDir()}

	if err := writer.EnsureShellInitFiles(""); err != nil {
		t.Fatalf("EnsureShellInitFiles() error = %v", err)
	}

	assertFileContains(t, paths.BashRC(), "__redeven_terminal_command_start")
	assertFileContains(t, paths.BashRC(), "__redeven_terminal_precmd")
	assertFileContains(t, paths.BashRC(), "P;Cwd=$PWD")
	assertFileContains(t, paths.ZshRC(), "__redeven_terminal_preexec")
	assertFileContains(t, paths.ZshRC(), "add-zsh-hook preexec __redeven_terminal_preexec")
	assertFileContains(t, paths.ZshRC(), "P;Cwd=$PWD")
	assertFileContains(t, paths.FishConfig(), "function __redeven_terminal_fish_preexec --on-event fish_preexec")
	assertFileContains(t, paths.FishConfig(), "function fish_prompt")
	assertFileContains(t, paths.FishConfig(), "P;Cwd=$PWD")
	assertFileContains(t, paths.PosixRC(), "do not inject command lifecycle markers")
	assertFileContains(t, paths.BashRC(), redevenShellInitPathPrependSentinel)
}

func TestNewTerminalGoManagerConfigUsesRedevenShellIntegration(t *testing.T) {
	cfg := newTerminalGoManagerConfig("/bin/zsh", nil)

	if _, ok := cfg.EnvProvider.(redevenShellInitEnvProvider); !ok {
		t.Fatalf("EnvProvider = %T, want redevenShellInitEnvProvider", cfg.EnvProvider)
	}

	argsProvider, ok := cfg.ShellArgsProvider.(termgo.DefaultShellArgsProvider)
	if !ok {
		t.Fatalf("ShellArgsProvider = %T, want termgo.DefaultShellArgsProvider", cfg.ShellArgsProvider)
	}
	if strings.TrimSpace(argsProvider.ShellInitBaseDir) == "" {
		t.Fatalf("expected ShellArgsProvider.ShellInitBaseDir to be set")
	}

	writer, ok := cfg.ShellInitWriter.(redevenShellInitWriter)
	if !ok {
		t.Fatalf("ShellInitWriter = %T, want redevenShellInitWriter", cfg.ShellInitWriter)
	}
	if writer.BaseDir != argsProvider.ShellInitBaseDir {
		t.Fatalf("shell init base dir mismatch: writer=%q args=%q", writer.BaseDir, argsProvider.ShellInitBaseDir)
	}
}

func newQuietTestManager(t *testing.T, root string) *Manager {
	t.Helper()

	shellPath := filepath.Join(root, "sleep-shell.sh")
	content := []byte("#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n")
	if err := os.WriteFile(shellPath, content, 0o755); err != nil {
		t.Fatalf("WriteFile(%q): %v", shellPath, err)
	}

	return NewManager(shellPath, root, nil)
}

func waitForPTYSize(t *testing.T, session *termgo.Session, expectedCols int, expectedRows int, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if session.IsActive() && session.PTY != nil {
			rows, cols, err := pty.Getsize(session.PTY)
			if err == nil && cols == expectedCols && rows == expectedRows {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for PTY size %dx%d", expectedCols, expectedRows)
}

func assertFileContains(t *testing.T, path string, needle string) {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q): %v", path, err)
	}
	if !strings.Contains(string(content), needle) {
		t.Fatalf("expected %q to contain %q", path, needle)
	}
}

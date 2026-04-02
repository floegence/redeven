package terminal

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/flowersec/flowersec-go/rpc"
)

const (
	shellLifecycleReadyMarker = "\x1b]633;A\x07"
	shellLifecycleStartMarker = "\x1b]633;B\x07"
)

func TestRealShellIntegrationEmitsLifecycleMarkersForBashAndZsh(t *testing.T) {
	for _, shellPath := range []string{"/bin/bash", "/bin/zsh"} {
		shellPath := shellPath
		t.Run(filepath.Base(shellPath), func(t *testing.T) {
			if _, err := os.Stat(shellPath); err != nil {
				t.Skipf("shell %q unavailable: %v", shellPath, err)
			}

			t.Setenv("HOME", newIsolatedShellHome(t))

			root := t.TempDir()
			manager := newShellLifecycleTestManager(t, root, shellPath)
			t.Cleanup(func() {
				manager.Cleanup()
			})

			session, err := manager.createSession("test", "")
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			if err := manager.attachSession(session.ID, "conn-1", 80, 24, nil); err != nil {
				t.Fatalf("attachSession() error = %v", err)
			}

			time.Sleep(250 * time.Millisecond)

			successStartSeq := nextHistorySequence(t, session)
			if err := session.WriteData("printf '__REDEVEN_OK__\\n'\n"); err != nil {
				t.Fatalf("WriteData(success) error = %v", err)
			}

			successOutput := waitForHistoryContains(
				t,
				session,
				successStartSeq,
				5*time.Second,
				shellLifecycleStartMarker,
				"\x1b]633;D;0\x07",
				shellLifecycleReadyMarker,
				"__REDEVEN_OK__",
			)
			assertContainsInOrder(t, successOutput, []string{
				shellLifecycleStartMarker,
				"\x1b]633;D;0\x07",
				shellLifecycleReadyMarker,
			})

			failureStartSeq := nextHistorySequence(t, session)
			if err := session.WriteData("false\n"); err != nil {
				t.Fatalf("WriteData(false) error = %v", err)
			}

			failureOutput := waitForHistoryContains(
				t,
				session,
				failureStartSeq,
				5*time.Second,
				shellLifecycleStartMarker,
				"\x1b]633;D;1\x07",
				shellLifecycleReadyMarker,
			)
			assertContainsInOrder(t, failureOutput, []string{
				shellLifecycleStartMarker,
				"\x1b]633;D;1\x07",
				shellLifecycleReadyMarker,
			})
		})
	}
}

func TestRealPosixShellFallbackOmitsLifecycleMarkers(t *testing.T) {
	shellPath := "/bin/sh"
	if _, err := os.Stat(shellPath); err != nil {
		t.Skipf("shell %q unavailable: %v", shellPath, err)
	}

	t.Setenv("HOME", newIsolatedShellHome(t))

	root := t.TempDir()
	manager := newShellLifecycleTestManager(t, root, shellPath)
	t.Cleanup(func() {
		manager.Cleanup()
	})

	session, err := manager.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	if err := manager.attachSession(session.ID, "conn-1", 80, 24, nil); err != nil {
		t.Fatalf("attachSession() error = %v", err)
	}

	time.Sleep(150 * time.Millisecond)

	startSeq := nextHistorySequence(t, session)
	if err := session.WriteData("printf '__REDEVEN_SH__\\n'\n"); err != nil {
		t.Fatalf("WriteData(posix) error = %v", err)
	}

	output := waitForHistoryContains(t, session, startSeq, 5*time.Second, "__REDEVEN_SH__")
	if strings.Contains(output, "\x1b]633;") || strings.Contains(output, "\x1b]133;") {
		t.Fatalf("expected posix fallback to omit lifecycle markers, got %q", output)
	}
}

func newShellLifecycleTestManager(t *testing.T, root string, shellPath string) *Manager {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
	shellInitBaseDir := filepath.Join(t.TempDir(), "shell-init")

	manager := &Manager{
		agentHomeAbs:    root,
		log:             logger,
		writers:         make(map[*rpc.Server]*sinkWriter),
		byServer:        make(map[*rpc.Server]map[string]string),
		bySession:       make(map[string]map[*rpc.Server]string),
		closedSinks:     make(map[*rpc.Server]struct{}),
		deleteRequested: make(map[string]struct{}),
	}

	manager.term = termgo.NewManager(termgo.ManagerConfig{
		Logger:                        slogTerminalLogger{log: logger},
		EnvProvider:                   redevenShellInitEnvProvider{base: termgo.DefaultEnvProvider{}},
		ShellResolver:                 fixedShellResolver{shell: shellPath},
		ShellArgsProvider:             termgo.DefaultShellArgsProvider{ShellInitBaseDir: shellInitBaseDir},
		ShellInitWriter:               redevenShellInitWriter{BaseDir: shellInitBaseDir},
		InitialResizeSuppressDuration: 10 * time.Millisecond,
		ResizeSuppressDuration:        10 * time.Millisecond,
	})
	manager.term.SetEventHandler(&eventHandler{m: manager})

	return manager
}

func newIsolatedShellHome(t *testing.T) string {
	t.Helper()

	homeDir := t.TempDir()
	for _, relativePath := range []string{
		".bashrc",
		".bash_profile",
		".profile",
		".zshrc",
		".zprofile",
	} {
		path := filepath.Join(homeDir, relativePath)
		if err := os.WriteFile(path, []byte("# isolated test shell config\n"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q): %v", path, err)
		}
	}
	return homeDir
}

func nextHistorySequence(t *testing.T, session *termgo.Session) int64 {
	t.Helper()

	chunks, err := session.GetHistoryChunks()
	if err != nil {
		t.Fatalf("GetHistoryChunks() error = %v", err)
	}
	if len(chunks) == 0 {
		return 1
	}
	return chunks[len(chunks)-1].Sequence + 1
}

func waitForHistoryContains(t *testing.T, session *termgo.Session, fromSeq int64, timeout time.Duration, needles ...string) string {
	t.Helper()

	deadline := time.Now().Add(timeout)
	lastOutput := ""
	for time.Now().Before(deadline) {
		output := historyTextFromSequence(t, session, fromSeq)
		lastOutput = output
		if containsAll(output, needles...) {
			return output
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for history from sequence %d to contain %q; last output: %q", fromSeq, needles, lastOutput)
	return ""
}

func historyTextFromSequence(t *testing.T, session *termgo.Session, fromSeq int64) string {
	t.Helper()

	chunks, err := session.GetHistoryFromSequence(fromSeq)
	if err != nil {
		t.Fatalf("GetHistoryFromSequence(%d) error = %v", fromSeq, err)
	}

	var builder strings.Builder
	for _, chunk := range chunks {
		builder.Write(chunk.Data)
	}
	return builder.String()
}

func containsAll(output string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(output, needle) {
			return false
		}
	}
	return true
}

func assertContainsInOrder(t *testing.T, output string, needles []string) {
	t.Helper()

	searchFrom := 0
	for _, needle := range needles {
		index := strings.Index(output[searchFrom:], needle)
		if index < 0 {
			t.Fatalf("expected output to contain %q after offset %d; output=%q", needle, searchFrom, output)
		}
		searchFrom += index + len(needle)
	}
}

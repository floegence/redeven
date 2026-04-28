package terminal

import (
	"encoding/base64"
	"errors"
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

func TestNormalizeTerminalHistoryPageOptionsDefaultsAndClamps(t *testing.T) {
	defaults := normalizeTerminalHistoryPageOptions(&terminalHistoryReq{
		SessionID: "session-1",
		StartSeq:  7,
		EndSeq:    -1,
	})
	if defaults.StartSeq != 7 || defaults.EndSeq != -1 {
		t.Fatalf("unexpected sequence bounds: %+v", defaults)
	}
	if defaults.LimitChunks != defaultTerminalHistoryPageChunks {
		t.Fatalf("LimitChunks=%d, want default %d", defaults.LimitChunks, defaultTerminalHistoryPageChunks)
	}
	if defaults.MaxBytes != defaultTerminalHistoryPageBytes {
		t.Fatalf("MaxBytes=%d, want default %d", defaults.MaxBytes, defaultTerminalHistoryPageBytes)
	}

	clamped := normalizeTerminalHistoryPageOptions(&terminalHistoryReq{
		SessionID:   "session-1",
		StartSeq:    3,
		EndSeq:      9,
		LimitChunks: maxTerminalHistoryPageChunks + 100,
		MaxBytes:    maxTerminalHistoryPageBytes + 1024,
	})
	if clamped.LimitChunks != maxTerminalHistoryPageChunks {
		t.Fatalf("LimitChunks=%d, want max %d", clamped.LimitChunks, maxTerminalHistoryPageChunks)
	}
	if clamped.MaxBytes != maxTerminalHistoryPageBytes {
		t.Fatalf("MaxBytes=%d, want max %d", clamped.MaxBytes, maxTerminalHistoryPageBytes)
	}
}

func TestTerminalHistoryRespFromPageIncludesCursorMetadata(t *testing.T) {
	resp := terminalHistoryRespFromPage(termgo.HistoryPage{
		Chunks: []termgo.TerminalDataChunk{
			{Sequence: 4, Timestamp: 1000, Data: []byte("hello")},
			{Sequence: 5, Timestamp: 1100, Data: []byte("world")},
		},
		FirstSequence: 4,
		LastSequence:  5,
		NextStartSeq:  6,
		HasMore:       true,
		CoveredBytes:  10,
		TotalBytes:    32,
	})

	if len(resp.Chunks) != 2 {
		t.Fatalf("len(resp.Chunks)=%d, want 2", len(resp.Chunks))
	}
	if resp.Chunks[0].DataB64 != base64.StdEncoding.EncodeToString([]byte("hello")) {
		t.Fatalf("first chunk data_b64=%q", resp.Chunks[0].DataB64)
	}
	if !resp.HasMore || resp.NextStartSeq != 6 || resp.FirstSequence != 4 || resp.LastSequence != 5 {
		t.Fatalf("unexpected cursor metadata: %+v", resp)
	}
	if resp.CoveredBytes != 10 || resp.TotalBytes != 32 {
		t.Fatalf("unexpected byte metadata: %+v", resp)
	}
}

func TestDeleteSessionHidesImmediatelyWhileCleanupRuns(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	releaseDelete := make(chan struct{})
	m.deleteSessionFunc = func(sessionID string) error {
		<-releaseDelete
		return m.deleteSessionNow(sessionID)
	}

	if err := m.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
	defer close(releaseDelete)

	if got := m.visibleSessionInfos(); len(got) != 0 {
		t.Fatalf("visibleSessionInfos() = %#v, want hidden closing session", got)
	}
	if err := m.attachSession(sess.ID, "conn-closed", 80, 24, nil); err == nil {
		t.Fatalf("attachSession() succeeded for hidden closing session")
	}
	if err := m.resize(sess.ID, "conn-closed", 80, 24); err == nil {
		t.Fatalf("resize() succeeded for hidden closing session")
	}
	if err := m.write(sess.ID, "conn-closed", ""); err == nil {
		t.Fatalf("write() succeeded for hidden closing session")
	}
	waitForLifecycle(t, m, sess.ID, SessionLifecycleClosing, time.Second)
}

func TestDeleteSessionFailureStaysHiddenAndCanRetry(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	m.deleteSessionFunc = func(string) error {
		return errors.New("delete failed")
	}
	if err := m.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}

	waitForLifecycle(t, m, sess.ID, SessionLifecycleCloseFailedHidden, time.Second)
	if got := m.visibleSessionInfos(); len(got) != 0 {
		t.Fatalf("visibleSessionInfos() = %#v, want failed hidden session omitted", got)
	}
	if err := m.attachSession(sess.ID, "conn-hidden", 80, 24, nil); err == nil {
		t.Fatalf("attachSession() succeeded for failed hidden session")
	}
	if err := m.resize(sess.ID, "conn-hidden", 80, 24); err == nil {
		t.Fatalf("resize() succeeded for failed hidden session")
	}

	m.deleteSessionFunc = m.deleteSessionNow
	if err := m.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession(retry) error = %v", err)
	}
	waitForSessionGone(t, m, sess.ID, time.Second)
}

func TestSessionLifecycleHookReceivesHiddenDeleteEvent(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	events := make(chan SessionLifecycleEvent, 8)
	removeHook := m.AddSessionLifecycleHook(func(event SessionLifecycleEvent) {
		events <- event
	})
	defer removeHook()

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	releaseDelete := make(chan struct{})
	m.deleteSessionFunc = func(sessionID string) error {
		<-releaseDelete
		return m.deleteSessionNow(sessionID)
	}
	defer close(releaseDelete)

	if err := m.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}

	event := waitForLifecycleEvent(t, events, sess.ID, SessionLifecycleClosing, time.Second)
	if !event.Hidden {
		t.Fatalf("hidden=%v, want true for closing event", event.Hidden)
	}
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

func waitForLifecycle(t *testing.T, m *Manager, sessionID string, lifecycle SessionLifecycle, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		record, ok := m.lifecycleRecord(sessionID)
		if ok && record.Lifecycle == lifecycle {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	record, ok := m.lifecycleRecord(sessionID)
	t.Fatalf("timeout waiting for lifecycle %q, got record=%#v ok=%v", lifecycle, record, ok)
}

func waitForSessionGone(t *testing.T, m *Manager, sessionID string, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, ok := m.term.GetSession(sessionID); !ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("timeout waiting for session %q to be removed", sessionID)
}

func waitForLifecycleEvent(
	t *testing.T,
	events <-chan SessionLifecycleEvent,
	sessionID string,
	lifecycle SessionLifecycle,
	timeout time.Duration,
) SessionLifecycleEvent {
	t.Helper()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			if event.SessionID == sessionID && event.Lifecycle == lifecycle {
				return event
			}
		case <-timer.C:
			t.Fatalf("timeout waiting for lifecycle event %q for session %q", lifecycle, sessionID)
		}
	}
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

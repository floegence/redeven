package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/creack/pty"
	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/session"
)

func TestRequireProcessLaunchPermissionRejectsExecuteWithoutWrite(t *testing.T) {
	t.Parallel()

	err := requireProcessLaunchPermission(&session.Meta{CanRead: true, CanExecute: true})
	rpcErr, ok := err.(*rpc.Error)
	if !ok {
		t.Fatalf("error = %#v, want rpc error", err)
	}
	if rpcErr.Code != 403 || !strings.Contains(rpcErr.Message, "write and execute permissions") {
		t.Fatalf("error = (%d, %q), want process permission denial", rpcErr.Code, rpcErr.Message)
	}
	if err := requireProcessLaunchPermission(&session.Meta{CanWrite: true, CanExecute: true}); err != nil {
		t.Fatalf("write+execute error = %v", err)
	}
}

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

	got, err = m.resolveWorkingDir("/")
	if err != nil {
		t.Fatalf("resolveWorkingDir(computer root) error: %v", err)
	}
	if got != "/" {
		t.Fatalf("resolveWorkingDir(computer root) = %q, want /", got)
	}
}

func mustTestFilesystemScope(t *testing.T, root string) *filesystemscope.Registry {
	t.Helper()
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatalf("NewDefaultRegistry(%q): %v", root, err)
	}
	return scope
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

func TestCreateOneHundredSessionsHasNoCountLimit(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	const sessionCount = 100
	for index := range sessionCount {
		if _, err := m.createSession(fmt.Sprintf("terminal-%d", index+1), ""); err != nil {
			t.Fatalf("createSession(%d) error = %v", index+1, err)
		}
	}
	if got := len(m.visibleSessionInfos()); got != sessionCount {
		t.Fatalf("visible sessions = %d, want %d", got, sessionCount)
	}
}

func TestConcurrentCreateFiftySessionsHasNoCountLimit(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	const sessionCount = 50
	results := make(chan error, sessionCount)
	for index := range sessionCount {
		go func() {
			_, err := m.createSession(fmt.Sprintf("terminal-%d", index+1), "")
			results <- err
		}()
	}
	for range sessionCount {
		if err := <-results; err != nil {
			t.Fatalf("concurrent createSession() error = %v", err)
		}
	}
	if got := len(m.visibleSessionInfos()); got != sessionCount {
		t.Fatalf("visible sessions = %d, want %d", got, sessionCount)
	}
}

func TestCreateSessionReportsWorkingDirErrors(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(func() {
		m.Cleanup()
	})

	filePath := filepath.Join(root, "plain.txt")
	if err := os.WriteFile(filePath, []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q): %v", filePath, err)
	}

	homeOnlyScope, err := filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: root,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "home",
			Roots: []config.FilesystemRootPolicy{
				{
					ID:          "home",
					Label:       "Home",
					Path:        root,
					Kind:        config.FilesystemRootHome,
					Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry() error = %v", err)
	}
	outsideManager := NewManagerWithScope(filepath.Join(root, "sleep-shell.sh"), homeOnlyScope, nil)
	t.Cleanup(func() {
		outsideManager.Cleanup()
	})

	tests := []struct {
		name    string
		manager *Manager
		path    string
		code    uint32
		message string
	}{
		{name: "outside scope", manager: outsideManager, path: outside, code: 403, message: "working_dir outside filesystem scope"},
		{name: "not found", manager: m, path: filepath.Join(root, "missing"), code: 404, message: "working_dir not found"},
		{name: "not directory", manager: m, path: filePath, code: 400, message: "working_dir is not a directory"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.manager.createSession("test", tt.path)
			rpcErr, ok := err.(*rpc.Error)
			if !ok {
				t.Fatalf("createSession() error = %#v, want rpc error", err)
			}
			if rpcErr.Code != tt.code || rpcErr.Message != tt.message {
				t.Fatalf("createSession() error = (%d, %q), want (%d, %q)", rpcErr.Code, rpcErr.Message, tt.code, tt.message)
			}
		})
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
		SessionID:         "session-1",
		StartSeq:          3,
		EndSeq:            9,
		HistoryGeneration: 12,
		LimitChunks:       maxTerminalHistoryPageChunks + 100,
		MaxBytes:          maxTerminalHistoryPageBytes + 1024,
	})
	if clamped.HistoryGeneration != 12 {
		t.Fatalf("HistoryGeneration=%d, want 12", clamped.HistoryGeneration)
	}
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
		FirstSequence:          4,
		LastSequence:           5,
		FirstRetainedSequence:  3,
		CoveredThroughSequence: 5,
		SnapshotEndSequence:    8,
		HistoryGeneration:      12,
		HistoryReset:           true,
		HistoryTruncated:       true,
		NextStartSeq:           6,
		HasMore:                true,
		CoveredBytes:           10,
		TotalBytes:             32,
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
	if resp.FirstRetainedSequence != 3 || resp.CoveredThroughSequence != 5 || resp.SnapshotEndSequence != 8 || resp.HistoryGeneration != 12 {
		t.Fatalf("unexpected history contract metadata: %+v", resp)
	}
	if !resp.HistoryReset || !resp.HistoryTruncated {
		t.Fatalf("unexpected history reset/truncation metadata: %+v", resp)
	}
}

func TestTerminalHistoryRespAlwaysSerializesHistoryContractZeroValues(t *testing.T) {
	payload, err := json.Marshal(terminalHistoryRespFromPage(termgo.HistoryPage{}))
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	want := map[string]string{
		"first_retained_sequence":  "0",
		"covered_through_sequence": "0",
		"snapshot_end_sequence":    "0",
		"history_generation":       "0",
		"history_reset":            "false",
		"history_truncated":        "false",
	}
	for field, value := range want {
		got, ok := fields[field]
		if !ok {
			t.Fatalf("serialized response is missing %q: %s", field, payload)
		}
		if string(got) != value {
			t.Fatalf("serialized %s = %s, want %s", field, got, value)
		}
	}
}

func TestTerminalHistoryRPCRejectsNegativeGeneration(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})

	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)
	router := rpc.NewRouter()
	m.RegisterWithAccessGate(router, &session.Meta{CanWrite: true, CanExecute: true}, nil, nil)
	server := rpc.NewServer(serverConn, router)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go func() {
		_ = server.Serve(ctx)
	}()

	request, err := json.Marshal(terminalHistoryReq{
		SessionID:         "session-does-not-need-to-exist",
		HistoryGeneration: -1,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	_, rpcErr, err := rpc.NewClient(clientConn).Call(ctx, TypeID_TERMINAL_HISTORY, request)
	if err != nil {
		t.Fatalf("Call() transport error = %v", err)
	}
	if rpcErr == nil || rpcErr.Code != 400 || rpcErr.Message == nil || *rpcErr.Message != "history_generation must be non-negative" {
		t.Fatalf("Call() rpc error = %#v, want code 400 negative generation rejection", rpcErr)
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

	deleteResult := make(chan error, 1)
	go func() {
		deleteResult <- m.DeleteSession(sess.ID)
	}()
	waitForLifecycle(t, m, sess.ID, SessionLifecycleClosing, time.Second)

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
	close(releaseDelete)
	if err := <-deleteResult; err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
}

func TestConcurrentDeleteSessionStartsOneCleanup(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	var cleanupCalls atomic.Int32
	cleanupStarted := make(chan struct{}, 1)
	releaseCleanup := make(chan struct{})
	m.deleteSessionFunc = func(sessionID string) error {
		cleanupCalls.Add(1)
		select {
		case cleanupStarted <- struct{}{}:
		default:
		}
		<-releaseCleanup
		return m.deleteSessionNow(sessionID)
	}

	const callers = 32
	var wg sync.WaitGroup
	errorsByCaller := make(chan error, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errorsByCaller <- m.DeleteSession(sess.ID)
		}()
	}
	select {
	case <-cleanupStarted:
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for cleanup to start")
	}
	if got := cleanupCalls.Load(); got != 1 {
		t.Fatalf("cleanup calls = %d, want 1", got)
	}
	waitForDeleteParticipants(t, m, sess.ID, callers, time.Second)
	close(releaseCleanup)
	wg.Wait()
	close(errorsByCaller)
	for err := range errorsByCaller {
		if err != nil {
			t.Fatalf("concurrent DeleteSession() error = %v", err)
		}
	}
	waitForSessionGone(t, m, sess.ID, time.Second)
	if err := m.DeleteSession(sess.ID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("DeleteSession(after success) error = %v, want ErrSessionNotFound", err)
	}
}

func TestDeleteSessionFailureReturnsSharedErrorAndCanRetry(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	deleteErr := errors.New("delete failed")
	m.deleteSessionFunc = func(string) error {
		return deleteErr
	}
	if err := m.DeleteSession(sess.ID); !errors.Is(err, deleteErr) {
		t.Fatalf("DeleteSession() error = %v, want %v", err, deleteErr)
	}

	waitForLifecycle(t, m, sess.ID, SessionLifecycleOpen, time.Second)
	if got := m.visibleSessionInfos(); len(got) != 1 || got[0].ID != sess.ID {
		t.Fatalf("visibleSessionInfos() = %#v, want retryable open session", got)
	}
	record, ok := m.lifecycleRecord(sess.ID)
	if !ok || record.FailureCode != "DELETE_FAILED" || record.FailureMessage != deleteErr.Error() {
		t.Fatalf("lifecycleRecord() = %+v, %v, want retry diagnostics", record, ok)
	}

	m.deleteSessionFunc = m.deleteSessionNow
	if err := m.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession(retry) error = %v", err)
	}
	waitForSessionGone(t, m, sess.ID, time.Second)
}

func TestConcurrentDeleteSessionFailureSharesOneResult(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	deleteErr := errors.New("shared delete failure")
	releaseDelete := make(chan struct{})
	var cleanupCalls atomic.Int32
	m.deleteSessionFunc = func(string) error {
		cleanupCalls.Add(1)
		<-releaseDelete
		return deleteErr
	}

	const callers = 32
	results := make(chan error, callers)
	for range callers {
		go func() {
			results <- m.DeleteSession(sess.ID)
		}()
	}
	waitForDeleteParticipants(t, m, sess.ID, callers, time.Second)
	close(releaseDelete)

	for range callers {
		if err := <-results; !errors.Is(err, deleteErr) {
			t.Fatalf("concurrent DeleteSession() error = %v, want %v", err, deleteErr)
		}
	}
	if got := cleanupCalls.Load(); got != 1 {
		t.Fatalf("cleanup calls = %d, want 1", got)
	}
	waitForLifecycle(t, m, sess.ID, SessionLifecycleOpen, time.Second)
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
	deleteResult := make(chan error, 1)
	go func() {
		deleteResult <- m.DeleteSession(sess.ID)
	}()

	event := waitForLifecycleEvent(t, events, sess.ID, SessionLifecycleClosing, time.Second)
	if !event.Hidden {
		t.Fatalf("hidden=%v, want true for closing event", event.Hidden)
	}
	close(releaseDelete)
	if err := <-deleteResult; err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
}

func TestNewTerminalGoManagerConfigUsesRedevenShellIntegration(t *testing.T) {
	cfg := newTerminalGoManagerConfig("/bin/zsh", nil)

	if _, ok := cfg.EnvProvider.(termgo.DefaultEnvProvider); !ok {
		t.Fatalf("EnvProvider = %T, want termgo.DefaultEnvProvider", cfg.EnvProvider)
	}

	argsProvider, ok := cfg.ShellArgsProvider.(termgo.DefaultShellArgsProvider)
	if !ok {
		t.Fatalf("ShellArgsProvider = %T, want termgo.DefaultShellArgsProvider", cfg.ShellArgsProvider)
	}
	if strings.TrimSpace(argsProvider.ShellInitBaseDir) == "" {
		t.Fatalf("expected ShellArgsProvider.ShellInitBaseDir to be set")
	}
	if !argsProvider.EnableCommandLifecycle {
		t.Fatalf("expected command lifecycle integration to be enabled")
	}

	writer, ok := cfg.ShellInitWriter.(termgo.DefaultShellInitWriter)
	if !ok {
		t.Fatalf("ShellInitWriter = %T, want termgo.DefaultShellInitWriter", cfg.ShellInitWriter)
	}
	if writer.BaseDir != argsProvider.ShellInitBaseDir {
		t.Fatalf("shell init base dir mismatch: writer=%q args=%q", writer.BaseDir, argsProvider.ShellInitBaseDir)
	}
	if !writer.EnableCommandLifecycle {
		t.Fatalf("expected writer command lifecycle integration to be enabled")
	}
	if cfg.HistoryBufferMaxBytes != terminalHistoryBufferMaxBytes {
		t.Fatalf("HistoryBufferMaxBytes = %d, want %d", cfg.HistoryBufferMaxBytes, terminalHistoryBufferMaxBytes)
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

func waitForDeleteParticipants(t *testing.T, m *Manager, sessionID string, expected int, timeout time.Duration) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		operation := m.deleteOperations[sessionID]
		participants := 0
		if operation != nil {
			participants = operation.participants
		}
		m.mu.Unlock()
		if participants == expected {
			return
		}
		time.Sleep(time.Millisecond)
	}

	t.Fatalf("timeout waiting for %d delete participants", expected)
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

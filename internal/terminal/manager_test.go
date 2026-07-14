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

	if _, err := m.attachSession(sess.ID, "conn-1", 111, 33, nil, 0); err != nil {
		t.Fatalf("attachSession() error = %v", err)
	}

	waitForPTYSize(t, sess, 111, 33, 2*time.Second)

	if err := m.resize(sess.ID, "conn-1", 95, 29); err != nil {
		t.Fatalf("resize() error = %v", err)
	}

	waitForPTYSize(t, sess, 95, 29, 2*time.Second)
}

func TestTerminalAttachRespAlwaysSerializesZeroHistoryBoundary(t *testing.T) {
	payload, err := json.Marshal(terminalAttachResp{OK: true})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if got, ok := fields["history_boundary_sequence"]; !ok || string(got) != "0" {
		t.Fatalf("history_boundary_sequence = %s, present=%v, want explicit 0", got, ok)
	}
}

func TestAttachSessionReturnsCommittedHistoryBoundary(t *testing.T) {
	root := t.TempDir()
	shellPath := filepath.Join(root, "history-shell.sh")
	content := []byte("#!/bin/sh\nprintf 'history-before-second-attach\\n'\ntrap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n")
	if err := os.WriteFile(shellPath, content, 0o755); err != nil {
		t.Fatalf("WriteFile(%q): %v", shellPath, err)
	}
	m := NewManager(shellPath, root, nil)
	t.Cleanup(m.Cleanup)

	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}
	firstBoundary, err := m.attachSession(sess.ID, "conn-1", 80, 24, nil, 0)
	if err != nil {
		t.Fatalf("attachSession(first) error = %v", err)
	}
	if firstBoundary != 0 {
		t.Fatalf("first boundary = %d, want 0 for dormant session", firstBoundary)
	}

	var expectedBoundary int64
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		page, pageErr := sess.GetHistoryPage(termgo.HistoryPageOptions{StartSeq: 1})
		if pageErr != nil {
			t.Fatalf("GetHistoryPage() error = %v", pageErr)
		}
		if page.SnapshotEndSequence > 0 {
			expectedBoundary = page.SnapshotEndSequence
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if expectedBoundary == 0 {
		t.Fatal("timeout waiting for committed terminal history")
	}

	secondBoundary, err := m.attachSession(sess.ID, "conn-2", 80, 24, nil, 0)
	if err != nil {
		t.Fatalf("attachSession(second) error = %v", err)
	}
	if secondBoundary != expectedBoundary {
		t.Fatalf("second boundary = %d, want committed history boundary %d", secondBoundary, expectedBoundary)
	}
}

func TestBroadcastUsesPerSinkHistoryBoundary(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	oldServerConn, oldClientConn := net.Pipe()
	newServerConn, newClientConn := net.Pipe()
	t.Cleanup(func() {
		_ = oldServerConn.Close()
		_ = oldClientConn.Close()
		_ = newServerConn.Close()
		_ = newClientConn.Close()
	})
	oldServer := rpc.NewServer(oldServerConn, rpc.NewRouter())
	newServer := rpc.NewServer(newServerConn, rpc.NewRouter())
	oldClient := rpc.NewClient(oldClientConn)
	newClient := rpc.NewClient(newClientConn)
	t.Cleanup(func() {
		_ = oldClient.Close()
		_ = newClient.Close()
	})

	oldSequences := make(chan int64, 4)
	newSequences := make(chan int64, 4)
	oldClient.OnNotify(TypeID_TERMINAL_OUTPUT, func(payload json.RawMessage) {
		var output terminalOutputPayload
		if json.Unmarshal(payload, &output) == nil {
			oldSequences <- output.Sequence
		}
	})
	newClient.OnNotify(TypeID_TERMINAL_OUTPUT, func(payload json.RawMessage) {
		var output terminalOutputPayload
		if json.Unmarshal(payload, &output) == nil {
			newSequences <- output.Sequence
		}
	})

	const sessionID = "session-boundaries"
	m.mu.Lock()
	if _, _, err := m.attachSinkLocked(sessionID, "old-conn", oldServer, 1, func() int64 { return 1 }, nil); err != nil {
		m.mu.Unlock()
		t.Fatalf("attachSinkLocked(old) error = %v", err)
	}
	if _, _, err := m.attachSinkLocked(sessionID, "new-conn", newServer, 1, func() int64 { return 3 }, nil); err != nil {
		m.mu.Unlock()
		t.Fatalf("attachSinkLocked(new) error = %v", err)
	}
	m.mu.Unlock()

	for _, sequence := range []int64{1, 2, 4} {
		payload, err := json.Marshal(terminalOutputPayload{SessionID: sessionID, Sequence: sequence})
		if err != nil {
			t.Fatalf("Marshal(sequence=%d) error = %v", sequence, err)
		}
		m.broadcast(sessionID, sequence, payload)
	}

	waitForTerminalOutputSequences(t, oldSequences, []int64{2, 4})
	waitForTerminalOutputSequences(t, newSequences, []int64{4})
	assertNoTerminalOutputSequence(t, oldSequences)
	assertNoTerminalOutputSequence(t, newSequences)

	m.DetachSink(oldServer)
	m.DetachSink(newServer)
	m.mu.Lock()
	_, retained := m.bySession[sessionID]
	m.mu.Unlock()
	if retained {
		t.Fatal("DetachSink retained per-sink history boundaries")
	}
}

func TestAttachSinkRejectsSupersededGenerationWithoutRaisingLiveFloor(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	sequences := make(chan int64, 2)
	client.OnNotify(TypeID_TERMINAL_OUTPUT, func(payload json.RawMessage) {
		var output terminalOutputPayload
		if json.Unmarshal(payload, &output) == nil {
			sequences <- output.Sequence
		}
	})

	const sessionID = "session-generation-order"
	m.mu.Lock()
	if _, _, err := m.attachSinkLocked(sessionID, "new-conn", server, 2, func() int64 { return 3 }, nil); err != nil {
		m.mu.Unlock()
		t.Fatalf("attachSinkLocked(new) error = %v", err)
	}
	staleBoundaryCaptured := false
	_, _, staleErr := m.attachSinkLocked(sessionID, "old-conn", server, 1, func() int64 {
		staleBoundaryCaptured = true
		return 5
	}, nil)
	attachment := m.bySession[sessionID][server]
	m.mu.Unlock()

	if !errors.Is(staleErr, errTerminalAttachSuperseded) {
		t.Fatalf("stale attach error = %v, want superseded", staleErr)
	}
	if staleBoundaryCaptured {
		t.Fatal("stale attach captured a newer history boundary")
	}
	if attachment.generation != 2 || attachment.connID != "new-conn" || attachment.liveAfterSequence != 3 {
		t.Fatalf("attachment = %+v, want generation 2 at boundary 3", attachment)
	}

	payload, err := json.Marshal(terminalOutputPayload{SessionID: sessionID, Sequence: 4})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	m.broadcast(sessionID, 4, payload)
	waitForTerminalOutputSequences(t, sequences, []int64{4})
	m.DetachSink(server)
}

func TestAttachSinkRejectsGenerationOlderThanFailedAttachmentHighWater(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	const sessionID = "session-failed-generation-high-water"
	m.mu.Lock()
	attachment, created, err := m.attachSinkLocked(sessionID, "conn-2", server, 2, func() int64 { return 4 }, nil)
	m.mu.Unlock()
	if err != nil || !created {
		t.Fatalf("attachSinkLocked() = created:%v err:%v, want created attachment", created, err)
	}
	m.rollbackSessionAttachment(sessionID, server, attachment, nil)

	staleBoundaryCaptured := false
	m.mu.Lock()
	_, _, staleErr := m.attachSinkLocked(sessionID, "conn-1", server, 1, func() int64 {
		staleBoundaryCaptured = true
		return 7
	}, nil)
	highWater := m.attachGenerations[server][sessionID]
	_, retained := m.bySession[sessionID][server]
	m.mu.Unlock()

	if !errors.Is(staleErr, errTerminalAttachSuperseded) {
		t.Fatalf("stale attach error = %v, want superseded", staleErr)
	}
	if staleBoundaryCaptured {
		t.Fatal("stale attach captured a boundary after the newer attachment failed")
	}
	if highWater != 2 || retained {
		t.Fatalf("failed attachment state = highWater:%d retained:%v, want tombstone 2 without active mapping", highWater, retained)
	}
	m.DetachSink(server)
}

func TestAttachSinkRejectsClosedStreamBeforeRegisteringConnection(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	m.DetachSink(server)

	boundaryCaptured := false
	m.mu.Lock()
	_, _, err := m.attachSinkLocked("session-closed", "conn-closed", server, 1, func() int64 {
		boundaryCaptured = true
		return 7
	}, nil)
	_, serverRetained := m.byServer[server]
	_, sessionRetained := m.bySession["session-closed"]
	m.mu.Unlock()

	if !errors.Is(err, errTerminalAttachSinkClosed) {
		t.Fatalf("closed sink attach error = %v, want sink closed", err)
	}
	if boundaryCaptured {
		t.Fatal("closed sink attach registered a terminal connection")
	}
	if serverRetained || sessionRetained {
		t.Fatalf("closed sink attach retained mappings: byServer=%v bySession=%v", serverRetained, sessionRetained)
	}
}

func TestAttachSinkReplacesAlternatingConnectionIDsUnderRoutingLock(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	connections := make(map[string]bool)

	m.mu.Lock()
	if _, _, err := m.attachSinkLocked("session-alternating", "conn-a", server, 1, func() int64 {
		connections["conn-a"] = true
		return 1
	}, func(connID string) {
		delete(connections, connID)
	}); err != nil {
		m.mu.Unlock()
		t.Fatalf("initial attachSinkLocked() error = %v", err)
	}
	m.mu.Unlock()

	removalStarted := make(chan struct{})
	releaseRemoval := make(chan struct{})
	secondDone := make(chan error, 1)
	go func() {
		m.mu.Lock()
		_, _, err := m.attachSinkLocked("session-alternating", "conn-b", server, 2, func() int64 {
			connections["conn-b"] = true
			return 2
		}, func(connID string) {
			close(removalStarted)
			<-releaseRemoval
			delete(connections, connID)
		})
		m.mu.Unlock()
		secondDone <- err
	}()
	<-removalStarted
	if m.mu.TryLock() {
		m.mu.Unlock()
		t.Fatal("routing lock released before previous connection removal completed")
	}

	thirdDone := make(chan error, 1)
	go func() {
		m.mu.Lock()
		_, _, err := m.attachSinkLocked("session-alternating", "conn-a", server, 3, func() int64 {
			connections["conn-a"] = true
			return 3
		}, func(connID string) {
			delete(connections, connID)
		})
		m.mu.Unlock()
		thirdDone <- err
	}()

	close(releaseRemoval)
	if err := <-secondDone; err != nil {
		t.Fatalf("second attachSinkLocked() error = %v", err)
	}
	if err := <-thirdDone; err != nil {
		t.Fatalf("third attachSinkLocked() error = %v", err)
	}

	m.mu.Lock()
	attachment := m.bySession["session-alternating"][server]
	connAExists := connections["conn-a"]
	connBExists := connections["conn-b"]
	m.mu.Unlock()
	if attachment.generation != 3 || attachment.connID != "conn-a" {
		t.Fatalf("final attachment = %+v, want generation 3 conn-a", attachment)
	}
	if !connAExists || connBExists {
		t.Fatalf("connection ownership = conn-a:%v conn-b:%v, want only conn-a", connAExists, connBExists)
	}
	m.DetachSink(server)
}

func TestDetachSinkWinsAfterInFlightAttachBoundaryCapture(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	captureStarted := make(chan struct{})
	releaseCapture := make(chan struct{})
	attachDone := make(chan error, 1)
	go func() {
		m.mu.Lock()
		_, _, err := m.attachSinkLocked("session-detach-race", "conn-1", server, 1, func() int64 {
			close(captureStarted)
			<-releaseCapture
			return 4
		}, nil)
		m.mu.Unlock()
		attachDone <- err
	}()
	<-captureStarted

	detachDone := make(chan struct{})
	go func() {
		m.DetachSink(server)
		close(detachDone)
	}()
	close(releaseCapture)
	if err := <-attachDone; err != nil {
		t.Fatalf("attachSinkLocked() error = %v", err)
	}
	<-detachDone

	m.mu.Lock()
	_, closed := m.closedSinks[server]
	_, serverRetained := m.byServer[server]
	_, sessionRetained := m.bySession["session-detach-race"]
	_, writerRetained := m.writers[server]
	m.mu.Unlock()
	if !closed || serverRetained || sessionRetained || writerRetained {
		t.Fatalf(
			"detach race state: closed=%v byServer=%v bySession=%v writer=%v",
			closed,
			serverRetained,
			sessionRetained,
			writerRetained,
		)
	}
}

func TestAttachActivationFailureClearsSinkBoundary(t *testing.T) {
	root := t.TempDir()
	invalidShell := filepath.Join(root, "invalid-shell")
	if err := os.WriteFile(invalidShell, []byte("not an executable format\n"), 0o755); err != nil {
		t.Fatalf("WriteFile(%q): %v", invalidShell, err)
	}
	m := NewManager(invalidShell, root, nil)
	t.Cleanup(m.Cleanup)
	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	if _, err := m.attachSession(sess.ID, "failed-conn", 80, 24, server, 1); err == nil {
		t.Fatal("attachSession() succeeded with invalid shell executable")
	}

	m.mu.Lock()
	_, sessionRetained := m.bySession[sess.ID]
	_, serverRetained := m.byServer[server]
	m.mu.Unlock()
	if sessionRetained || serverRetained {
		t.Fatalf("activation failure retained sink boundary: bySession=%v byServer=%v", sessionRetained, serverRetained)
	}
}

func TestStaleActivationFailureDoesNotDetachNewerAttachment(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)
	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())

	firstActivationStarted := make(chan struct{})
	releaseFirstActivation := make(chan struct{})
	var activationCalls atomic.Int32
	m.activateSessionFunc = func(string, int, int) error {
		if activationCalls.Add(1) == 1 {
			close(firstActivationStarted)
			<-releaseFirstActivation
			return errors.New("old activation failed")
		}
		return nil
	}

	oldResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "old-conn", 80, 24, server, 1)
		oldResult <- attachErr
	}()
	<-firstActivationStarted

	if _, err := m.attachSession(sess.ID, "new-conn", 100, 30, server, 2); err != nil {
		t.Fatalf("new attachSession() error = %v", err)
	}
	close(releaseFirstActivation)
	if err := <-oldResult; err == nil {
		t.Fatal("old attachSession() succeeded after activation failure")
	}

	m.mu.Lock()
	attachment, sessionRetained := m.bySession[sess.ID][server]
	indexed, serverRetained := m.byServer[server][sess.ID]
	m.mu.Unlock()
	if !sessionRetained || !serverRetained {
		t.Fatalf("new attachment removed by stale failure: bySession=%v byServer=%v", sessionRetained, serverRetained)
	}
	if attachment.generation != 2 || attachment.connID != "new-conn" || !sameSinkAttachment(indexed, attachment) {
		t.Fatalf("retained attachment = %+v indexed=%+v, want newer generation", attachment, indexed)
	}

	m.DetachSink(server)
}

func TestActivationFailureRollbackSerializesSameConnectionReattach(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	const sessionID = "session-same-connection-rollback"
	connections := make(map[string]bool)
	m.mu.Lock()
	attachment, _, err := m.attachSinkLocked(sessionID, "shared-conn", server, 1, func() int64 {
		connections["shared-conn"] = true
		return 1
	}, nil)
	m.mu.Unlock()
	if err != nil {
		t.Fatalf("attachSinkLocked(initial) error = %v", err)
	}

	removalStarted := make(chan struct{})
	releaseRemoval := make(chan struct{})
	rollbackDone := make(chan struct{})
	go func() {
		m.rollbackSessionAttachment(sessionID, server, attachment, func(connID string) {
			close(removalStarted)
			<-releaseRemoval
			delete(connections, connID)
		})
		close(rollbackDone)
	}()
	<-removalStarted

	reattachDone := make(chan error, 1)
	go func() {
		m.mu.Lock()
		_, _, attachErr := m.attachSinkLocked(sessionID, "shared-conn", server, 2, func() int64 {
			connections["shared-conn"] = true
			return 2
		}, nil)
		m.mu.Unlock()
		reattachDone <- attachErr
	}()
	if m.mu.TryLock() {
		m.mu.Unlock()
		t.Fatal("routing lock released before failed attachment connection removal completed")
	}

	close(releaseRemoval)
	<-rollbackDone
	if err := <-reattachDone; err != nil {
		t.Fatalf("reattach error = %v", err)
	}
	m.mu.Lock()
	current := m.bySession[sessionID][server]
	connectionRetained := connections["shared-conn"]
	m.mu.Unlock()
	if current.generation != 2 || !connectionRetained {
		t.Fatalf("reattach state = attachment:%+v connection:%v, want generation 2 with connection", current, connectionRetained)
	}
	m.DetachSink(server)
}

func TestDuplicateGenerationDoesNotSharePendingActivation(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)
	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	activationStarted := make(chan struct{})
	releaseActivation := make(chan struct{})
	var activationCalls atomic.Int32
	m.activateSessionFunc = func(string, int, int) error {
		if activationCalls.Add(1) == 1 {
			close(activationStarted)
			<-releaseActivation
			return errors.New("transient activation failure")
		}
		return nil
	}

	firstResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		firstResult <- attachErr
	}()
	<-activationStarted

	_, duplicateErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
	duplicateRPCError, ok := duplicateErr.(*rpc.Error)
	if !ok || duplicateRPCError.Code != 409 || duplicateRPCError.Message != "terminal attach in progress" {
		t.Fatalf("duplicate attach error = %#v, want 409 attach in progress", duplicateErr)
	}
	if got := activationCalls.Load(); got != 1 {
		t.Fatalf("activation calls while duplicate pending = %d, want 1", got)
	}

	close(releaseActivation)
	if err := <-firstResult; err == nil {
		t.Fatal("first attach succeeded after injected activation failure")
	}
	if _, err := m.attachSession(sess.ID, "conn-1", 80, 24, server, 2); err != nil {
		t.Fatalf("new generation attach after failure = %v", err)
	}
	if got := activationCalls.Load(); got != 2 {
		t.Fatalf("activation calls after new generation = %d, want 2", got)
	}
	m.DetachSink(server)
}

func TestTerminalSessionClosedClearsRoutingAndGenerationHighWater(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	const sessionID = "session-natural-close"
	m.mu.Lock()
	if _, _, err := m.attachSinkLocked(sessionID, "conn-1", server, 3, func() int64 { return 5 }, nil); err != nil {
		m.mu.Unlock()
		t.Fatalf("attachSinkLocked() error = %v", err)
	}
	m.mu.Unlock()

	(&eventHandler{m: m}).OnTerminalSessionClosed(sessionID)
	m.mu.Lock()
	_, sessionRetained := m.bySession[sessionID]
	_, serverRetained := m.byServer[server][sessionID]
	_, generationRetained := m.attachGenerations[server][sessionID]
	m.mu.Unlock()
	if sessionRetained || serverRetained || generationRetained {
		t.Fatalf(
			"closed session retained routing: bySession=%v byServer=%v generation=%v",
			sessionRetained,
			serverRetained,
			generationRetained,
		)
	}
	m.DetachSink(server)
}

func TestSinkWriterConcurrentTrySendAndClose(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())
	client := rpc.NewClient(clientConn)
	t.Cleanup(func() { _ = client.Close() })

	writer := newSinkWriter(server, nil)
	start := make(chan struct{})
	stop := make(chan struct{})
	var senders sync.WaitGroup
	for range 8 {
		senders.Add(1)
		go func() {
			defer senders.Done()
			<-start
			for {
				select {
				case <-stop:
					return
				default:
					writer.TrySend(sinkMsg{TypeID: TypeID_TERMINAL_OUTPUT, Payload: json.RawMessage(`{}`)})
				}
			}
		}()
	}
	close(start)

	closeDone := make(chan struct{})
	go func() {
		writer.Close()
		close(closeDone)
	}()
	<-closeDone
	close(stop)
	senders.Wait()
}

func TestStaleActivationFailurePreservesSameConnectionOwnedByNewerGeneration(t *testing.T) {
	root := t.TempDir()
	m := newQuietTestManager(t, root)
	t.Cleanup(m.Cleanup)
	sess, err := m.createSession("test", "")
	if err != nil {
		t.Fatalf("createSession() error = %v", err)
	}

	serverConn, clientConn := net.Pipe()
	t.Cleanup(func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
	})
	server := rpc.NewServer(serverConn, rpc.NewRouter())

	firstActivationStarted := make(chan struct{})
	releaseFirstActivation := make(chan struct{})
	var activationCalls atomic.Int32
	m.activateSessionFunc = func(string, int, int) error {
		if activationCalls.Add(1) == 1 {
			close(firstActivationStarted)
			<-releaseFirstActivation
			return errors.New("old activation failed")
		}
		return nil
	}

	oldResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "shared-conn", 80, 24, server, 1)
		oldResult <- attachErr
	}()
	<-firstActivationStarted

	if _, err := m.attachSession(sess.ID, "shared-conn", 100, 30, server, 2); err != nil {
		t.Fatalf("new attachSession() error = %v", err)
	}
	close(releaseFirstActivation)
	if err := <-oldResult; err == nil {
		t.Fatal("old attachSession() succeeded after activation failure")
	}

	if err := m.term.ActivateSession(sess.ID, 100, 30); err != nil {
		t.Fatalf("ActivateSession() error = %v", err)
	}
	if err := m.resize(sess.ID, "shared-conn", 113, 37); err != nil {
		t.Fatalf("resize() error = %v", err)
	}
	waitForPTYSize(t, sess, 113, 37, 2*time.Second)
	m.DetachSink(server)
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
	if _, err := m.attachSession(sess.ID, "conn-closed", 80, 24, nil, 0); err == nil {
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

func waitForTerminalOutputSequences(t *testing.T, sequences <-chan int64, expected []int64) {
	t.Helper()

	for index, want := range expected {
		select {
		case got := <-sequences:
			if got != want {
				t.Fatalf("output sequence[%d] = %d, want %d", index, got, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timeout waiting for output sequence[%d] = %d", index, want)
		}
	}
}

func assertNoTerminalOutputSequence(t *testing.T, sequences <-chan int64) {
	t.Helper()

	select {
	case got := <-sequences:
		t.Fatalf("unexpected terminal output sequence %d", got)
	case <-time.After(25 * time.Millisecond):
	}
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

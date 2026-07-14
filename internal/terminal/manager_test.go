package terminal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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

func TestTerminalHistoryDeterministicFixtureMatrix(t *testing.T) {
	type fixtureReport struct {
		FixtureID              string `json:"fixture_id"`
		RequestedBytes         int    `json:"requested_bytes"`
		ActualBytes            int64  `json:"actual_bytes"`
		PageCount              int    `json:"page_count"`
		ChunkCount             int    `json:"chunk_count"`
		AllocatedChunks        int    `json:"allocated_chunks"`
		UsedChunks             int    `json:"used_chunks"`
		ReplayedBytes          int64  `json:"replayed_bytes"`
		SnapshotEndSequence    int64  `json:"snapshot_end_sequence"`
		CoveredThroughSequence int64  `json:"covered_through_sequence"`
		HistoryGeneration      int64  `json:"history_generation"`
		AttachMilliseconds     int64  `json:"attach_ms"`
		ReplayMilliseconds     int64  `json:"replay_ms"`
	}

	fixtures := []struct {
		name       string
		bytes      int
		clearAfter bool
	}{
		{name: "0B", clearAfter: true},
		{name: "64KiB", bytes: 64 * 1024},
		{name: "512KiB", bytes: 512 * 1024},
		{name: "8MiB", bytes: 8 * 1024 * 1024},
	}
	reports := make([]fixtureReport, 0, len(fixtures))

	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			root := t.TempDir()
			shellPath := filepath.Join(root, "fixture-shell.sh")
			script := "#!/bin/sh\n"
			if fixture.bytes > 0 {
				script += fmt.Sprintf("dd if=/dev/zero bs=4096 count=%d 2>/dev/null\n", fixture.bytes/4096)
			}
			script += "trap 'exit 0' TERM INT\nwhile true; do sleep 1; done\n"
			if err := os.WriteFile(shellPath, []byte(script), 0o755); err != nil {
				t.Fatalf("WriteFile(%q): %v", shellPath, err)
			}
			logger := slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
			m := NewManager(shellPath, root, logger)
			t.Cleanup(m.Cleanup)

			sess, err := m.createSession("fixture", "")
			if err != nil {
				t.Fatalf("createSession() error = %v", err)
			}
			attachStarted := time.Now()
			if _, err := m.attachSession(sess.ID, "fixture-conn", 80, 24, nil, 0); err != nil {
				t.Fatalf("attachSession() error = %v", err)
			}

			deadline := time.Now().Add(8 * time.Second)
			var stats termgo.RingBufferStats
			for time.Now().Before(deadline) {
				stats, err = sess.GetHistoryStats()
				if err != nil {
					t.Fatalf("GetHistoryStats() error = %v", err)
				}
				if fixture.bytes == 0 || stats.TotalBytes >= int64(fixture.bytes) {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if fixture.bytes == 0 {
				if err := sess.ClearHistory(); err != nil {
					t.Fatalf("ClearHistory() error = %v", err)
				}
				stats, err = sess.GetHistoryStats()
				if err != nil {
					t.Fatalf("GetHistoryStats(after clear) error = %v", err)
				}
			}
			if stats.TotalBytes != int64(fixture.bytes) {
				t.Fatalf("fixture history bytes = %d, want exactly %d", stats.TotalBytes, fixture.bytes)
			}

			replayStarted := time.Now()
			startSeq := int64(1)
			snapshotEnd := int64(0)
			historyGeneration := int64(0)
			coveredThrough := int64(0)
			lastChunkSequence := int64(0)
			pageCount := 0
			chunkCount := 0
			replayedBytes := int64(0)
			for {
				page, pageErr := sess.GetHistoryPage(termgo.HistoryPageOptions{
					StartSeq:          startSeq,
					EndSeq:            snapshotEnd,
					HistoryGeneration: historyGeneration,
					MaxBytes:          maxTerminalHistoryPageBytes,
				})
				if pageErr != nil {
					t.Fatalf("GetHistoryPage(start=%d) error = %v", startSeq, pageErr)
				}
				pageCount++
				if pageCount == 1 {
					snapshotEnd = page.SnapshotEndSequence
					historyGeneration = page.HistoryGeneration
				} else if page.SnapshotEndSequence != snapshotEnd || page.HistoryGeneration != historyGeneration {
					t.Fatalf("page snapshot changed: end=%d/%d generation=%d/%d", page.SnapshotEndSequence, snapshotEnd, page.HistoryGeneration, historyGeneration)
				}
				if page.HistoryReset || page.HistoryTruncated {
					t.Fatalf("fixture replay unexpectedly rebased: reset=%v truncated=%v", page.HistoryReset, page.HistoryTruncated)
				}
				for _, chunk := range page.Chunks {
					if chunk.Sequence <= lastChunkSequence {
						t.Fatalf("chunk sequence = %d after %d", chunk.Sequence, lastChunkSequence)
					}
					lastChunkSequence = chunk.Sequence
					chunkCount++
					replayedBytes += int64(len(chunk.Data))
				}
				coveredThrough = page.CoveredThroughSequence
				if !page.HasMore {
					if coveredThrough != snapshotEnd {
						t.Fatalf("terminal coverage = %d, want snapshot end %d", coveredThrough, snapshotEnd)
					}
					break
				}
				if page.NextStartSeq <= startSeq {
					t.Fatalf("next start sequence = %d after %d", page.NextStartSeq, startSeq)
				}
				startSeq = page.NextStartSeq
			}
			if replayedBytes != stats.TotalBytes {
				t.Fatalf("replayed bytes = %d, want retained bytes %d", replayedBytes, stats.TotalBytes)
			}

			report := fixtureReport{
				FixtureID:              fixture.name,
				RequestedBytes:         fixture.bytes,
				ActualBytes:            stats.TotalBytes,
				PageCount:              pageCount,
				ChunkCount:             chunkCount,
				AllocatedChunks:        stats.TotalChunks,
				UsedChunks:             stats.UsedChunks,
				ReplayedBytes:          replayedBytes,
				SnapshotEndSequence:    snapshotEnd,
				CoveredThroughSequence: coveredThrough,
				HistoryGeneration:      historyGeneration,
				AttachMilliseconds:     time.Since(attachStarted).Milliseconds(),
				ReplayMilliseconds:     time.Since(replayStarted).Milliseconds(),
			}
			reports = append(reports, report)
			t.Logf("fixture=%s total_bytes=%d pages=%d chunks=%d attach_ms=%d replay_ms=%d snapshot_end=%d covered_through=%d", fixture.name, report.ActualBytes, report.PageCount, report.ChunkCount, report.AttachMilliseconds, report.ReplayMilliseconds, report.SnapshotEndSequence, report.CoveredThroughSequence)
		})
	}

	if reportPath := strings.TrimSpace(os.Getenv("REDEVEN_TERMINAL_HISTORY_REPORT")); reportPath != "" {
		payload, err := json.MarshalIndent(map[string]any{
			"schema_version": 1,
			"status":         "passed",
			"fixtures":       reports,
		}, "", "  ")
		if err != nil {
			t.Fatalf("MarshalIndent(report): %v", err)
		}
		if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err != nil {
			t.Fatalf("MkdirAll(report): %v", err)
		}
		if err := os.WriteFile(reportPath, append(payload, '\n'), 0o644); err != nil {
			t.Fatalf("WriteFile(report): %v", err)
		}
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
	highWater := m.attachStates[server][sessionID].latest.generation
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
	m.activateSessionFunc = func(context.Context, string, int, int) error {
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

func TestNewAttachGenerationCancelsPreviousOwnerWait(t *testing.T) {
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

	firstActivationStarted := make(chan struct{})
	var activationCalls atomic.Int32
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		if activationCalls.Add(1) == 1 {
			close(firstActivationStarted)
			<-ctx.Done()
			return ctx.Err()
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
	select {
	case attachErr := <-oldResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 409 {
			t.Fatalf("old attach error = %#v, want superseded 409", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("old attach owner remained blocked after newer generation admission")
	}
	if got := activationCalls.Load(); got != 2 {
		t.Fatalf("activation calls = %d, want 2", got)
	}
	m.DetachSink(server)
}

func TestAttachCallerCancellationDoesNotCancelSharedActivation(t *testing.T) {
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

	activationStarted := make(chan struct{})
	releaseActivation := make(chan struct{})
	var activationCalls atomic.Int32
	m.activateSessionFunc = func(context.Context, string, int, int) error {
		activationCalls.Add(1)
		close(activationStarted)
		<-releaseActivation
		return nil
	}

	ownerCtx, cancelOwner := context.WithCancel(context.Background())
	ownerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSessionContext(ownerCtx, sess.ID, "conn-1", 80, 24, server, 1)
		ownerResult <- attachErr
	}()
	<-activationStarted
	cancelOwner()

	select {
	case attachErr := <-ownerResult:
		if !errors.Is(attachErr, context.Canceled) {
			t.Fatalf("owner attach error = %v, want context canceled", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("owner attach remained blocked after caller cancellation")
	}

	joinerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		joinerResult <- attachErr
	}()
	select {
	case attachErr := <-joinerResult:
		t.Fatalf("joiner completed before shared activation: %v", attachErr)
	case <-time.After(25 * time.Millisecond):
	}

	close(releaseActivation)
	select {
	case attachErr := <-joinerResult:
		if attachErr != nil {
			t.Fatalf("joiner attach error = %v", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("joiner remained blocked after shared activation completed")
	}
	if got := activationCalls.Load(); got != 1 {
		t.Fatalf("activation calls = %d, want 1", got)
	}
	m.DetachSink(server)
}

func TestRPCServeCancellationUnblocksAttachBeforeDetach(t *testing.T) {
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
	router := rpc.NewRouter()
	server := rpc.NewServer(serverConn, router)
	m.RegisterWithAccessGate(router, &session.Meta{CanWrite: true, CanExecute: true}, server, nil)

	activationStarted := make(chan struct{})
	activationCanceled := make(chan struct{})
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		close(activationStarted)
		<-ctx.Done()
		close(activationCanceled)
		return ctx.Err()
	}

	serveCtx, cancelServe := context.WithCancel(context.Background())
	serveDone := make(chan error, 1)
	go func() {
		serveErr := server.Serve(serveCtx)
		m.DetachSink(server)
		serveDone <- serveErr
	}()

	request, err := json.Marshal(terminalAttachReq{
		SessionID:        sess.ID,
		ConnID:           "conn-1",
		Cols:             80,
		Rows:             24,
		AttachGeneration: 1,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	callDone := make(chan error, 1)
	go func() {
		_, _, callErr := rpc.NewClient(clientConn).Call(context.Background(), TypeID_TERMINAL_SESSION_ATTACH, request)
		callDone <- callErr
	}()

	<-activationStarted
	cancelServe()
	select {
	case serveErr := <-serveDone:
		if !errors.Is(serveErr, context.Canceled) {
			t.Fatalf("Serve() error = %v, want context canceled", serveErr)
		}
	case <-time.After(time.Second):
		t.Fatal("Serve() remained blocked by terminal attach handler")
	}
	select {
	case <-activationCanceled:
	case <-time.After(time.Second):
		t.Fatal("DetachSink did not cancel the session-owned activation")
	}
	select {
	case <-callDone:
	case <-time.After(time.Second):
		t.Fatal("terminal attach client remained blocked after stream cancellation")
	}
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

func TestDuplicateGenerationJoinsPendingActivationFailure(t *testing.T) {
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
	m.activateSessionFunc = func(context.Context, string, int, int) error {
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

	duplicateResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		duplicateResult <- attachErr
	}()
	select {
	case duplicateErr := <-duplicateResult:
		t.Fatalf("duplicate attach completed before activation result: %v", duplicateErr)
	case <-time.After(25 * time.Millisecond):
	}
	if got := activationCalls.Load(); got != 1 {
		t.Fatalf("activation calls while duplicate waits = %d, want 1", got)
	}

	close(releaseActivation)
	firstErr := <-firstResult
	duplicateErr := <-duplicateResult
	for label, attachErr := range map[string]error{"first": firstErr, "duplicate": duplicateErr} {
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 500 || rpcErr.Message != "failed to attach terminal session" {
			t.Fatalf("%s attach error = %#v, want shared activation failure", label, attachErr)
		}
	}
	if _, replayErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1); replayErr != firstErr {
		t.Fatalf("completed failure replay error = %#v, want original error %#v", replayErr, firstErr)
	}
	if got := activationCalls.Load(); got != 1 {
		t.Fatalf("activation calls after completed failure replay = %d, want 1", got)
	}
	if _, err := m.attachSession(sess.ID, "conn-1", 80, 24, server, 2); err != nil {
		t.Fatalf("new generation attach after failure = %v", err)
	}
	if got := activationCalls.Load(); got != 2 {
		t.Fatalf("activation calls after new generation = %d, want 2", got)
	}
	m.DetachSink(server)
}

func TestDuplicateGenerationJoinsPendingActivationSuccess(t *testing.T) {
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
	m.activateSessionFunc = func(context.Context, string, int, int) error {
		activationCalls.Add(1)
		close(activationStarted)
		<-releaseActivation
		return nil
	}

	type attachResult struct {
		boundary int64
		err      error
	}
	firstResult := make(chan attachResult, 1)
	go func() {
		boundary, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		firstResult <- attachResult{boundary: boundary, err: attachErr}
	}()
	<-activationStarted

	duplicateResult := make(chan attachResult, 1)
	go func() {
		boundary, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		duplicateResult <- attachResult{boundary: boundary, err: attachErr}
	}()
	select {
	case result := <-duplicateResult:
		t.Fatalf("duplicate attach completed before activation result: %#v", result)
	case <-time.After(25 * time.Millisecond):
	}
	if got := activationCalls.Load(); got != 1 {
		t.Fatalf("activation calls while duplicate waits = %d, want 1", got)
	}

	close(releaseActivation)
	first := <-firstResult
	duplicate := <-duplicateResult
	if first.err != nil || duplicate.err != nil {
		t.Fatalf("joined attach errors = first:%v duplicate:%v", first.err, duplicate.err)
	}
	if duplicate.boundary != first.boundary {
		t.Fatalf("duplicate boundary = %d, want %d", duplicate.boundary, first.boundary)
	}
	m.DetachSink(server)
}

func TestDetachSinkCompletesPendingAttachOwnerAndJoiner(t *testing.T) {
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
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		close(activationStarted)
		<-ctx.Done()
		return ctx.Err()
	}

	ownerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		ownerResult <- attachErr
	}()
	<-activationStarted
	joinerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		joinerResult <- attachErr
	}()

	m.DetachSink(server)
	select {
	case attachErr := <-joinerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 410 {
			t.Fatalf("joiner error after sink close = %#v, want 410", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("joiner remained blocked after sink close")
	}
	select {
	case attachErr := <-ownerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 410 {
			t.Fatalf("owner error after sink close = %#v, want 410", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("owner remained blocked after activation returned")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.attachStates[server]; ok {
		t.Fatal("sink close retained attach state")
	}
	if _, ok := m.byServer[server]; ok {
		t.Fatal("sink close retained server routes")
	}
}

func TestDetachSinkCompletesSupersededAndLatestPendingAttachOperations(t *testing.T) {
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

	const sessionID = "session-multi-generation-pending"
	m.mu.Lock()
	oldAttachment, created, err := m.attachSinkLocked(sessionID, "conn-1", server, 1, func() int64 { return 3 }, nil)
	if err != nil || !created {
		m.mu.Unlock()
		t.Fatalf("old attach = created:%v err:%v", created, err)
	}
	latestAttachment, created, err := m.attachSinkLocked(sessionID, "conn-1", server, 2, func() int64 { return 4 }, nil)
	if err != nil || !created {
		m.mu.Unlock()
		t.Fatalf("latest attach = created:%v err:%v", created, err)
	}
	if got := len(m.attachStates[server][sessionID].pending); got != 1 {
		m.mu.Unlock()
		t.Fatalf("pending operation count = %d, want 1", got)
	}
	m.mu.Unlock()

	result := oldAttachment.activation.wait()
	if rpcErr, ok := result.(*rpc.Error); !ok || rpcErr.Code != 409 {
		t.Fatalf("superseded operation error = %#v, want 409", result)
	}
	latestResult := make(chan error, 1)
	go func() { latestResult <- latestAttachment.activation.wait() }()

	m.DetachSink(server)
	select {
	case result := <-latestResult:
		rpcErr, ok := result.(*rpc.Error)
		if !ok || rpcErr.Code != 410 {
			t.Fatalf("latest generation error after sink close = %#v, want 410", result)
		}
	case <-time.After(time.Second):
		t.Fatal("latest generation remained blocked after sink close")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.attachStates[server]; ok {
		t.Fatal("sink close retained multi-generation attach state")
	}
}

func TestSessionCloseCompletesPendingAttachAndClearsState(t *testing.T) {
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
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		close(activationStarted)
		<-ctx.Done()
		return ctx.Err()
	}

	ownerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		ownerResult <- attachErr
	}()
	<-activationStarted
	joinerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		joinerResult <- attachErr
	}()

	if err := m.term.DeleteSession(sess.ID); err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
	select {
	case attachErr := <-joinerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 404 {
			t.Fatalf("joiner error after session close = %#v, want 404", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("joiner remained blocked after session close")
	}
	select {
	case attachErr := <-ownerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 404 {
			t.Fatalf("owner error after session close = %#v, want 404", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("owner remained blocked after activation returned")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.bySession[sess.ID]; ok {
		t.Fatal("session close retained session routes")
	}
	if states := m.attachStates[server]; states != nil {
		if _, ok := states[sess.ID]; ok {
			t.Fatal("session close retained attach state")
		}
	}
}

func TestDeleteSessionCompletesPendingAttachBeforeCleanupResult(t *testing.T) {
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
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		close(activationStarted)
		<-ctx.Done()
		return ctx.Err()
	}

	ownerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		ownerResult <- attachErr
	}()
	<-activationStarted
	joinerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		joinerResult <- attachErr
	}()
	select {
	case attachErr := <-joinerResult:
		t.Fatalf("joiner completed before delete: %v", attachErr)
	case <-time.After(25 * time.Millisecond):
	}

	deleteStarted := make(chan struct{})
	releaseDelete := make(chan struct{})
	deleteErr := errors.New("delete failed")
	m.deleteSessionFunc = func(string) error {
		close(deleteStarted)
		<-releaseDelete
		return deleteErr
	}
	deleteResult := make(chan error, 1)
	go func() {
		deleteResult <- m.DeleteSession(sess.ID)
	}()
	<-deleteStarted

	select {
	case attachErr := <-joinerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 404 {
			t.Fatalf("joiner error after delete admission = %#v, want 404", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("joiner remained blocked after delete admission")
	}
	select {
	case attachErr := <-ownerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 404 {
			t.Fatalf("owner error after delete admission = %#v, want 404", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("owner remained blocked after activation returned")
	}

	close(releaseDelete)
	if err := <-deleteResult; !errors.Is(err, deleteErr) {
		t.Fatalf("DeleteSession() error = %v, want %v", err, deleteErr)
	}
	waitForLifecycle(t, m, sess.ID, SessionLifecycleOpen, time.Second)
	if _, replayErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1); replayErr == nil {
		t.Fatal("completed deleted generation replay succeeded without a live route")
	} else if rpcErr, ok := replayErr.(*rpc.Error); !ok || rpcErr.Code != 404 {
		t.Fatalf("completed deleted generation replay error = %#v, want 404", replayErr)
	}
	m.DetachSink(server)
}

func TestCleanupCompletesPendingAttachAndClearsSinkState(t *testing.T) {
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
	m.activateSessionFunc = func(ctx context.Context, _ string, _ int, _ int) error {
		close(activationStarted)
		<-ctx.Done()
		return ctx.Err()
	}

	ownerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		ownerResult <- attachErr
	}()
	<-activationStarted
	joinerResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-1", 80, 24, server, 1)
		joinerResult <- attachErr
	}()
	select {
	case attachErr := <-joinerResult:
		t.Fatalf("joiner completed before cleanup: %v", attachErr)
	case <-time.After(25 * time.Millisecond):
	}

	cleanupDone := make(chan struct{})
	go func() {
		m.Cleanup()
		close(cleanupDone)
	}()
	select {
	case attachErr := <-joinerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 410 {
			t.Fatalf("joiner error after cleanup = %#v, want 410", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("joiner remained blocked after cleanup")
	}
	select {
	case <-cleanupDone:
	case <-time.After(time.Second):
		t.Fatal("Cleanup() remained blocked by pending activation")
	}
	select {
	case attachErr := <-ownerResult:
		rpcErr, ok := attachErr.(*rpc.Error)
		if !ok || rpcErr.Code != 410 {
			t.Fatalf("owner error after cleanup = %#v, want 410", attachErr)
		}
	case <-time.After(time.Second):
		t.Fatal("owner remained blocked after activation returned")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.attachStates[server]; ok {
		t.Fatal("cleanup retained attach state")
	}
	if _, ok := m.byServer[server]; ok {
		t.Fatal("cleanup retained server routes")
	}
	if _, ok := m.writers[server]; ok {
		t.Fatal("cleanup retained sink writer")
	}
}

func TestAttachAdmissionRejectsSessionRemovedBeforeManagerLock(t *testing.T) {
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

	m.mu.Lock()
	attachResult := make(chan error, 1)
	go func() {
		_, attachErr := m.attachSession(sess.ID, "conn-late", 80, 24, server, 1)
		attachResult <- attachErr
	}()
	deleteResult := make(chan error, 1)
	go func() {
		deleteResult <- m.term.DeleteSession(sess.ID)
	}()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if _, exists := m.term.GetSession(sess.ID); !exists {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if _, exists := m.term.GetSession(sess.ID); exists {
		m.mu.Unlock()
		t.Fatal("session remained registered while delete awaited close callback")
	}
	m.mu.Unlock()

	if err := <-deleteResult; err != nil {
		t.Fatalf("DeleteSession() error = %v", err)
	}
	attachErr := <-attachResult
	rpcErr, ok := attachErr.(*rpc.Error)
	if !ok || rpcErr.Code != 404 {
		t.Fatalf("late attach error = %#v, want 404", attachErr)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.bySession[sess.ID]; ok {
		t.Fatal("late attach recreated session routes")
	}
	if states := m.attachStates[server]; states != nil {
		if _, ok := states[sess.ID]; ok {
			t.Fatal("late attach created attach state")
		}
	}
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
	_, generationRetained := m.attachStates[server][sessionID]
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
	m.activateSessionFunc = func(context.Context, string, int, int) error {
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
	if cfg.HistoryBufferSize != terminalHistoryBufferSize {
		t.Fatalf("HistoryBufferSize = %d, want %d", cfg.HistoryBufferSize, terminalHistoryBufferSize)
	}
	if cfg.HistoryBufferMaxChunks != terminalHistoryBufferMaxChunks {
		t.Fatalf("HistoryBufferMaxChunks = %d, want %d", cfg.HistoryBufferMaxChunks, terminalHistoryBufferMaxChunks)
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

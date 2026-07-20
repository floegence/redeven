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
	created := make([]*termgo.Session, 0, sessionCount)
	for index := range sessionCount {
		sess, err := m.createSession(fmt.Sprintf("terminal-%d", index+1), "")
		if err != nil {
			t.Fatalf("createSession(%d) error = %v", index+1, err)
		}
		created = append(created, sess)
	}
	if got := len(m.visibleSessionInfos()); got != sessionCount {
		t.Fatalf("visible sessions = %d, want %d", got, sessionCount)
	}
	for index, sess := range created {
		if sess.IsActive() || sess.PTY != nil || sess.Cmd != nil {
			t.Fatalf("session %d activated before attach: active=%t pty=%v cmd=%v", index+1, sess.IsActive(), sess.PTY, sess.Cmd)
		}
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
			sess.AddConnectionWithHistoryBoundary("fixture-conn", 80, 24)
			if err := m.activateSessionFunc(context.Background(), sess.ID, 80, 24); err != nil {
				t.Fatalf("ActivateSessionContext() error = %v", err)
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
	if m.sessionAvailableForInteraction(sess.ID) {
		t.Fatal("hidden closing session remained available to live transport")
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

func TestNameUpdateReachesEveryAuthorizedControlClient(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	type clientHarness struct {
		serverConn net.Conn
		clientConn net.Conn
		client     *rpc.Client
		detach     func()
		updates    chan terminalNameUpdatePayload
	}
	newHarness := func() *clientHarness {
		serverConn, clientConn := net.Pipe()
		router := rpc.NewRouter()
		server := rpc.NewServer(serverConn, router)
		client := rpc.NewClient(clientConn)
		updates := make(chan terminalNameUpdatePayload, 1)
		client.OnNotify(TypeID_TERMINAL_NAME_UPDATE, func(payload json.RawMessage) {
			var update terminalNameUpdatePayload
			if json.Unmarshal(payload, &update) == nil {
				updates <- update
			}
		})
		detach := m.RegisterWithAccessGate(
			router,
			&session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
			server,
			nil,
		)
		return &clientHarness{
			serverConn: serverConn,
			clientConn: clientConn,
			client:     client,
			detach:     detach,
			updates:    updates,
		}
	}
	clients := []*clientHarness{newHarness(), newHarness()}
	for _, harness := range clients {
		harness := harness
		t.Cleanup(func() {
			harness.detach()
			_ = harness.client.Close()
			_ = harness.serverConn.Close()
			_ = harness.clientConn.Close()
		})
	}

	m.broadcastNameUpdate("shared-session", "repo", "/workspace/repo")
	for index, harness := range clients {
		select {
		case update := <-harness.updates:
			if update.SessionID != "shared-session" || update.NewName != "repo" || update.WorkingDir != "/workspace/repo" {
				t.Fatalf("client %d update = %#v", index, update)
			}
		case <-time.After(time.Second):
			t.Fatalf("client %d did not receive terminal name update", index)
		}
	}
}

func TestForegroundCommandUpdateReachesEveryAuthorizedControlClient(t *testing.T) {
	m := newQuietTestManager(t, t.TempDir())
	t.Cleanup(m.Cleanup)

	type clientHarness struct {
		serverConn net.Conn
		clientConn net.Conn
		client     *rpc.Client
		detach     func()
		updates    chan terminalForegroundCommandUpdatePayload
	}
	newHarness := func() *clientHarness {
		serverConn, clientConn := net.Pipe()
		router := rpc.NewRouter()
		server := rpc.NewServer(serverConn, router)
		client := rpc.NewClient(clientConn)
		updates := make(chan terminalForegroundCommandUpdatePayload, 1)
		client.OnNotify(TypeID_TERMINAL_FOREGROUND_COMMAND_UPDATE, func(payload json.RawMessage) {
			var update terminalForegroundCommandUpdatePayload
			if json.Unmarshal(payload, &update) == nil {
				updates <- update
			}
		})
		detach := m.RegisterWithAccessGate(
			router,
			&session.Meta{CanRead: true, CanWrite: true, CanExecute: true},
			server,
			nil,
		)
		return &clientHarness{
			serverConn: serverConn,
			clientConn: clientConn,
			client:     client,
			detach:     detach,
			updates:    updates,
		}
	}
	clients := []*clientHarness{newHarness(), newHarness()}
	for _, harness := range clients {
		harness := harness
		t.Cleanup(func() {
			harness.detach()
			_ = harness.client.Close()
			_ = harness.serverConn.Close()
			_ = harness.clientConn.Close()
		})
	}

	command := termgo.TerminalForegroundCommandInfo{
		Phase:       termgo.ForegroundCommandRunning,
		DisplayName: "top",
		Revision:    3,
		UpdatedAt:   42,
	}
	m.broadcastForegroundCommandUpdate("shared-session", command)
	for index, harness := range clients {
		select {
		case update := <-harness.updates:
			if update.SessionID != "shared-session" {
				t.Fatalf("client %d session = %q, want shared-session", index, update.SessionID)
			}
			if update.ForegroundCommand.Phase != "running" || update.ForegroundCommand.DisplayName != "top" || update.ForegroundCommand.Revision != 3 || update.ForegroundCommand.UpdatedAtMs != 42 {
				t.Fatalf("client %d command = %#v", index, update.ForegroundCommand)
			}
		case <-time.After(time.Second):
			t.Fatalf("client %d did not receive terminal command update", index)
		}
	}
}

func TestWireSessionInfoIncludesForegroundCommandSnapshot(t *testing.T) {
	wire := toWireSessionInfo(termgo.TerminalSessionInfo{
		ID:         "session-1",
		Name:       "repo",
		WorkingDir: "/workspace/repo",
		ForegroundCommand: termgo.TerminalForegroundCommandInfo{
			Phase:       termgo.ForegroundCommandRunning,
			DisplayName: "top",
			Revision:    7,
			UpdatedAt:   99,
		},
	})

	if wire.ForegroundCommand.Phase != "running" || wire.ForegroundCommand.DisplayName != "top" || wire.ForegroundCommand.Revision != 7 || wire.ForegroundCommand.UpdatedAtMs != 99 {
		t.Fatalf("foreground command = %#v", wire.ForegroundCommand)
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

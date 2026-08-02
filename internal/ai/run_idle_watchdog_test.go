package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/session"
)

type idleWatchdogFloretHost struct {
	*todoTestHost
	readApprovalQueue func(context.Context) (flruntime.ApprovalQueue, error)
	readCount         atomic.Int64
}

func (h *idleWatchdogFloretHost) ReadApprovalQueue(ctx context.Context) (flruntime.ApprovalQueue, error) {
	h.readCount.Add(1)
	return h.readApprovalQueue(ctx)
}

func TestRunIdleWatchdog_DoesNotCancelWhileCanonicalApprovalIsPending(t *testing.T) {
	t.Parallel()

	now := time.Now()
	record := flruntime.ApprovalRecord{
		ApprovalID: "approval_idle", RootThreadID: "th_idle_approval", EffectAttemptID: "effect_idle",
		ToolCallID: "tool_idle", ToolName: "terminal.exec", ToolKind: "local",
		RunID: "run_idle_approval", ThreadID: "th_idle_approval", TurnID: "turn_idle_approval",
		Step: 1, BatchIndex: 0, BatchSize: 1, State: "requested", Revision: 1, QueueSequence: 1,
		RequestedAt: now, UpdatedAt: now, ArgsHash: "args_idle", RequestFingerprint: "fingerprint_idle",
	}
	host := &idleWatchdogFloretHost{
		todoTestHost: &todoTestHost{},
		readApprovalQueue: func(context.Context) (flruntime.ApprovalQueue, error) {
			return flruntime.ApprovalQueue{
				RootThreadID: identity.ThreadID("th_idle_approval"), Generation: 1, Revision: 1,
				CurrentApprovalID: record.ApprovalID, Items: []flruntime.ApprovalRecord{record}, GeneratedAt: now,
			}, nil
		},
	}
	r, cancel, done := startIdleWatchdogTestRun(t, host, "th_idle_approval")
	defer cancel()

	waitForIdleWatchdogReads(t, host, 2)
	if reason := strings.TrimSpace(r.getCancelReason()); reason != "" {
		t.Fatalf("canonical approval wait cancel reason=%q, want empty", reason)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("idle watchdog did not stop after context cancellation")
	}
}

func TestRunIdleWatchdog_CancelsWhenCanonicalApprovalQueueIsEmpty(t *testing.T) {
	t.Parallel()

	host := &idleWatchdogFloretHost{
		todoTestHost: &todoTestHost{},
		readApprovalQueue: func(context.Context) (flruntime.ApprovalQueue, error) {
			return flruntime.ApprovalQueue{RootThreadID: "th_idle_empty", GeneratedAt: time.Now()}, nil
		},
	}
	r, cancel, done := startIdleWatchdogTestRun(t, host, "th_idle_empty")
	defer cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("idle watchdog did not cancel an idle run with an empty canonical approval queue")
	}
	if reason := strings.TrimSpace(r.getCancelReason()); reason != "timed_out" {
		t.Fatalf("empty canonical queue cancel reason=%q, want timed_out", reason)
	}
}

func TestRunIdleWatchdog_DoesNotCancelWhenCanonicalApprovalReadFails(t *testing.T) {
	t.Parallel()

	host := &idleWatchdogFloretHost{
		todoTestHost: &todoTestHost{},
		readApprovalQueue: func(ctx context.Context) (flruntime.ApprovalQueue, error) {
			<-ctx.Done()
			return flruntime.ApprovalQueue{}, errors.Join(errors.New("approval store unavailable"), ctx.Err())
		},
	}
	r, cancel, done := startIdleWatchdogTestRun(t, host, "th_idle_read_error")
	defer cancel()

	waitForIdleWatchdogReads(t, host, 2)
	if reason := strings.TrimSpace(r.getCancelReason()); reason != "" {
		t.Fatalf("failed canonical approval read cancel reason=%q, want empty", reason)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("idle watchdog did not stop after context cancellation")
	}
}

func startIdleWatchdogTestRun(t *testing.T, host floretActiveRunHost, threadID string) (*run, context.CancelFunc, <-chan struct{}) {
	t.Helper()
	r := newRun(runOptions{
		Log:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		RunID:       "run_idle_watchdog",
		ThreadID:    threadID,
		TurnID:      "turn_idle_watchdog",
		MessageID:   "turn_idle_watchdog",
		IdleTimeout: 25 * time.Millisecond,
	})
	r.host.authorityThreadID = threadID
	r.setActiveFloretHost(host)
	ctx, cancel := context.WithCancel(context.Background())
	r.cancelFn = cancel
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.runIdleWatchdog(ctx)
	}()
	return r, cancel, done
}

func waitForIdleWatchdogReads(t *testing.T, host *idleWatchdogFloretHost, count int64) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for host.readCount.Load() < count {
		if time.Now().After(deadline) {
			t.Fatalf("approval queue reads=%d, want at least %d", host.readCount.Load(), count)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestRunIdleWatchdog_DoesNotCancelWhileToolBusy(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	svc := &Service{terminalProcesses: newTerminalProcessManager()}
	t.Cleanup(func() { _ = svc.terminalProcesses.Close(context.Background()) })

	r := newRun(runOptions{
		Log:              slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir:     root,
		Shell:            "bash",
		HostCapabilities: bindTestRunHostCapabilities(t, svc, "env_test", "th_test"),
		SessionMeta:      meta,
		RunID:            "run_test_idle_watchdog",
		ChannelID:        "ch_test",
		EndpointID:       "env_test",
		ThreadID:         "th_test",
		TurnID:           "turn_test",
		MessageID:        "m_test",
		IdleTimeout:      150 * time.Millisecond,
	})
	owner := &terminalProcessTestOwner{}
	r.permissionType = FlowerPermissionFullAccess
	allowToolsForTest(t, r, "terminal.exec")
	r.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return owner })

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	r.cancelFn = cancel

	go r.runIdleWatchdog(ctx)

	outcome, err := r.handleToolCall(authorizedToolContextForTestFrom(t, ctx, r, "tool_1", "terminal.exec"), "tool_1", "terminal.exec", map[string]any{
		"command":  "sleep 0.3; echo ok",
		"yield_ms": 1000,
	})
	if err != nil {
		t.Fatalf("handleToolCall error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("expected tool success outcome=%#v", outcome)
	}
	if reason := strings.TrimSpace(r.getCancelReason()); reason != "" {
		t.Fatalf("expected no cancel reason, got %q", reason)
	}
}

func TestHandleToolCall_FileWriteDoesNotRequireWorkspaceCheckpoint(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	stateRoot := t.TempDir()
	stateFile := filepath.Join(stateRoot, "state-file")
	if err := os.WriteFile(stateFile, []byte("x"), 0o600); err != nil {
		t.Fatalf("WriteFile stateFile: %v", err)
	}

	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     stateFile,
		AgentHomeDir: root,
		WorkingDir:   root,
		Shell:        "bash",
		SessionMeta:  meta,
		RunID:        "run_test_no_workspace_checkpoint",
		ChannelID:    "ch_test",
		EndpointID:   "env_test",
		ThreadID:     "th_test",
		MessageID:    "m_test_no_workspace_checkpoint",
	})
	r.permissionType = FlowerPermissionFullAccess
	allowToolsForTest(t, r, "file.write")

	outcome, err := r.handleToolCall(authorizedToolContextForTest(t, r, "tool_file_write_1", "file.write"), "tool_file_write_1", "file.write", map[string]any{
		"file_path": "note.txt",
		"content":   "ok\n",
	})
	if err != nil {
		t.Fatalf("handleToolCall error: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("expected tool success outcome=%#v", outcome)
	}
	content, err := os.ReadFile(filepath.Join(root, "note.txt"))
	if err != nil {
		t.Fatalf("ReadFile note.txt: %v", err)
	}
	if string(content) != "ok\n" {
		t.Fatalf("note.txt=%q, want ok", string(content))
	}
}

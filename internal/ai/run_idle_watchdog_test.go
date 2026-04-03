package ai

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/session"
)

func TestRunIdleWatchdog_DoesNotCancelWhileToolBusy(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		AgentHomeDir: root,
		Shell:        "bash",
		SessionMeta:  meta,
		RunID:        "run_test_idle_watchdog",
		ChannelID:    "ch_test",
		EndpointID:   "env_test",
		ThreadID:     "th_test",
		MessageID:    "m_test",
		IdleTimeout:  150 * time.Millisecond,
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	r.cancelFn = cancel

	go r.runIdleWatchdog(ctx)

	outcome, err := r.handleToolCall(ctx, "tool_1", "terminal.exec", map[string]any{
		"command":    "sleep 0.3; echo ok",
		"timeout_ms": 5_000,
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

func TestRunIdleWatchdog_DoesNotCancelWhileWorkspaceCheckpointBusy(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	checkpointStarted := make(chan struct{}, 1)

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		StateDir:     t.TempDir(),
		AgentHomeDir: root,
		WorkingDir:   root,
		Shell:        "bash",
		SessionMeta:  meta,
		RunID:        "run_test_idle_watchdog_checkpoint",
		ChannelID:    "ch_test",
		EndpointID:   "env_test",
		ThreadID:     "th_test",
		MessageID:    "m_test_checkpoint",
		IdleTimeout:  150 * time.Millisecond,
		createWorkspaceCheckpoint: func(ctx context.Context, stateDir string, checkpointID string, workingDirAbs string) (workspaceCheckpointMeta, error) {
			select {
			case checkpointStarted <- struct{}{}:
			default:
			}
			select {
			case <-time.After(350 * time.Millisecond):
				return workspaceCheckpointMeta{}, nil
			case <-ctx.Done():
				return workspaceCheckpointMeta{}, ctx.Err()
			}
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	r.cancelFn = cancel

	go r.runIdleWatchdog(ctx)

	type result struct {
		outcome *toolCallOutcome
		err     error
	}
	done := make(chan result, 1)
	go func() {
		outcome, err := r.handleToolCall(ctx, "tool_checkpoint_1", "file.write", map[string]any{
			"file_path": "note.txt",
			"content":   "ok\n",
		})
		done <- result{outcome: outcome, err: err}
	}()

	select {
	case <-checkpointStarted:
	case <-time.After(2 * time.Second):
		t.Fatalf("checkpoint hook did not start")
	}

	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("handleToolCall error: %v", res.err)
		}
		if res.outcome == nil || !res.outcome.Success {
			t.Fatalf("expected tool success outcome=%#v", res.outcome)
		}
	case <-time.After(4 * time.Second):
		t.Fatalf("timed out waiting for tool result")
	}

	if reason := strings.TrimSpace(r.getCancelReason()); reason != "" {
		t.Fatalf("expected no cancel reason, got %q", reason)
	}
}

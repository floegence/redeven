package ai

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
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

	outcome, err := r.handleToolCall(context.Background(), "tool_file_write_1", "file.write", map[string]any{
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

package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestRedactAnyForPersist_TerminalExec_RedactsStdinAndPreservesNewlines(t *testing.T) {
	t.Parallel()

	args := map[string]any{
		"command": "line1\nline2",
		"stdin":   "secret\nvalue",
	}

	redacted := redactToolArgsForPersist("terminal.exec", args)

	if got := redacted["command"]; got != "line1\nline2" {
		t.Fatalf("command=%q, want %q", got, "line1\nline2")
	}

	stdinAny, ok := redacted["stdin"]
	if !ok {
		t.Fatalf("stdin missing")
	}
	stdinMap, ok := stdinAny.(map[string]any)
	if !ok {
		t.Fatalf("stdin type=%T, want map[string]any", stdinAny)
	}
	if redactedFlag, _ := stdinMap["redacted"].(bool); !redactedFlag {
		t.Fatalf("stdin.redacted=%v, want true", stdinMap["redacted"])
	}
	if bytes, _ := stdinMap["bytes"].(int); bytes == 0 {
		t.Fatalf("stdin.bytes=%v, want >0", stdinMap["bytes"])
	}
	if lines, _ := stdinMap["lines"].(int); lines != 2 {
		t.Fatalf("stdin.lines=%v, want 2", stdinMap["lines"])
	}

	if !isSensitiveLogKey("stdin") {
		t.Fatalf("stdin should be treated as sensitive")
	}
	if s, _ := redactAnyForLog("stdin", "secret\nvalue", 0).(string); !strings.HasPrefix(s, "[redacted:") {
		t.Fatalf("redactAnyForLog(stdin)=%q, want redacted placeholder", s)
	}
}

func TestMarshalPersistJSON_TerminalExecArgs_JSONIsValid(t *testing.T) {
	t.Parallel()

	args := map[string]any{
		"command": "line1\nline2",
		"stdin":   "secret\nvalue",
	}
	argsJSON := marshalPersistJSON(redactAnyForPersist("args", args, 0), 4000)
	if !json.Valid([]byte(argsJSON)) {
		t.Fatalf("argsJSON must be valid JSON, got: %q", argsJSON)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &parsed); err != nil {
		t.Fatalf("unmarshal argsJSON: %v", err)
	}
	if parsed["command"] != "line1\nline2" {
		t.Fatalf("parsed.command=%q, want %q", parsed["command"], "line1\nline2")
	}
	stdinAny, ok := parsed["stdin"]
	if !ok {
		t.Fatalf("parsed.stdin missing")
	}
	if _, ok := stdinAny.(map[string]any); !ok {
		t.Fatalf("parsed.stdin type=%T, want map[string]any", stdinAny)
	}
}

func TestPersistToolCallSnapshot_TerminalExecResult_NotTruncated(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_1",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}

	r := &run{
		id:               "run_1",
		endpointID:       "env_1",
		threadID:         "th_1",
		threadsDB:        store,
		persistOpTimeout: 5 * time.Second,
	}

	longStdout := strings.Repeat("x", 5200)
	startedAt := time.Now().Add(-2 * time.Second)
	endedAt := time.Now()
	r.persistToolCallSnapshot(
		"tool_1",
		"terminal.exec",
		ToolCallStatusSuccess,
		map[string]any{"command": "printf test"},
		map[string]any{
			"stdout":      longStdout,
			"stderr":      "",
			"exit_code":   0,
			"duration_ms": 120,
			"timed_out":   false,
			"truncated":   false,
		},
		nil,
		"",
		startedAt,
		endedAt,
	)

	rec, err := store.GetToolCall(ctx, "env_1", "run_1", "tool_1")
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec == nil {
		t.Fatalf("GetToolCall returned nil")
	}
	if len(rec.ResultJSON) <= 4000 {
		t.Fatalf("ResultJSON length=%d, want >4000", len(rec.ResultJSON))
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(rec.ResultJSON), &parsed); err != nil {
		t.Fatalf("result json invalid: %v", err)
	}
	if got := parsed["stdout"]; got != longStdout {
		t.Fatalf("stdout length=%d, want=%d", len(anyToString(got)), len(longStdout))
	}
}

func TestHandleToolCall_TerminalExec_AlwaysEmitsOutputRefForStatusFrames(t *testing.T) {
	t.Parallel()

	runID := "run_terminal_output_ref"
	toolID := "tool_terminal_output_ref"
	workspace := t.TempDir()

	var (
		mu         sync.Mutex
		toolFrames []ToolCallBlock
	)

	r := newRun(runOptions{
		Log:    slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:  runID,
		FSRoot: workspace,
		Shell:  "bash",
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		},
		MessageID: "msg_terminal_output_ref",
		OnStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			block, ok := bs.Block.(ToolCallBlock)
			if !ok {
				return
			}
			if strings.TrimSpace(block.ToolID) != toolID || strings.TrimSpace(block.ToolName) != "terminal.exec" {
				return
			}
			mu.Lock()
			toolFrames = append(toolFrames, block)
			mu.Unlock()
		},
	})

	outcome, err := r.handleToolCall(context.Background(), toolID, "terminal.exec", map[string]any{
		"command": "printf ok",
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("tool outcome should be success, got %+v", outcome)
	}

	mu.Lock()
	frames := append([]ToolCallBlock(nil), toolFrames...)
	mu.Unlock()

	if len(frames) == 0 {
		t.Fatalf("expected tool block-set frames")
	}

	foundStatus := map[ToolCallStatus]bool{}
	for _, frame := range frames {
		if frame.Status != ToolCallStatusPending && frame.Status != ToolCallStatusRunning && frame.Status != ToolCallStatusSuccess {
			continue
		}
		foundStatus[frame.Status] = true
		resultMap, ok := frame.Result.(map[string]any)
		if !ok || resultMap == nil {
			t.Fatalf("status=%s missing result map for output_ref", frame.Status)
		}
		outputRef, ok := resultMap["output_ref"].(map[string]any)
		if !ok || outputRef == nil {
			t.Fatalf("status=%s missing output_ref", frame.Status)
		}
		if got := strings.TrimSpace(anyToString(outputRef["run_id"])); got != runID {
			t.Fatalf("status=%s output_ref.run_id=%q, want %q", frame.Status, got, runID)
		}
		if got := strings.TrimSpace(anyToString(outputRef["tool_id"])); got != toolID {
			t.Fatalf("status=%s output_ref.tool_id=%q, want %q", frame.Status, got, toolID)
		}
	}

	for _, status := range []ToolCallStatus{ToolCallStatusPending, ToolCallStatusRunning, ToolCallStatusSuccess} {
		if !foundStatus[status] {
			t.Fatalf("missing tool frame for status=%s", status)
		}
	}
}

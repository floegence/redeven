package ai

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
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
		toolCallStatusSuccess,
		map[string]any{"command": "printf test"},
		map[string]any{
			"stdout":      longStdout,
			"stderr":      "",
			"exit_code":   0,
			"duration_ms": 120,
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

func TestHandleToolCall_TerminalExecPending_PersistsProcessHandle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_terminal_pending",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}

	workspace := t.TempDir()
	toolID := "tool_terminal_pending"
	manager := newTerminalProcessManager(nil)
	defer manager.Close()

	r := newTerminalProcessTestRun(workspace, &Service{terminalProcesses: manager}, store, "env_1", "th_1", "run_terminal_pending", "msg_1")

	outcome, err := r.handleToolCall(context.Background(), toolID, "terminal.exec", map[string]any{
		"command":  "sleep 5",
		"yield_ms": 1,
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil {
		t.Fatalf("missing tool outcome")
	}
	if outcome.Pending == nil {
		t.Fatalf("missing pending result: %#v", outcome)
	}

	resultMap, _ := outcome.Result.(map[string]any)
	if resultMap == nil {
		t.Fatalf("pending outcome should preserve terminal result payload")
	}
	processID := strings.TrimSpace(anyToString(resultMap["process_id"]))
	if processID == "" {
		t.Fatalf("missing process_id: %#v", resultMap)
	}
	if got := strings.TrimSpace(anyToString(resultMap["status"])); got != terminalProcessStatusRunning {
		t.Fatalf("status=%q, want running", got)
	}
	if got := strings.TrimSpace(anyToString(resultMap["pending_handle"])); got != outcome.Pending.Handle {
		t.Fatalf("pending_handle=%q, want %q", got, outcome.Pending.Handle)
	}

	rec, err := store.GetToolCall(ctx, "env_1", "run_terminal_pending", toolID)
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec == nil {
		t.Fatalf("GetToolCall returned nil")
	}
	if rec.Status != toolCallStatusRunning {
		t.Fatalf("tool call status=%q, want %q", rec.Status, toolCallStatusRunning)
	}

	var persisted map[string]any
	if err := json.Unmarshal([]byte(rec.ResultJSON), &persisted); err != nil {
		t.Fatalf("result json invalid: %v", err)
	}
	if got := strings.TrimSpace(anyToString(persisted["process_id"])); got != processID {
		t.Fatalf("persisted process_id=%q, want %q", got, processID)
	}
	if got := strings.TrimSpace(anyToString(persisted["status"])); got != terminalProcessStatusRunning {
		t.Fatalf("persisted status=%q, want running", got)
	}
	if _, ok := persisted["timeout_ms"]; ok {
		t.Fatalf("persisted timeout_ms should be absent: %#v", persisted)
	}
	if _, err := manager.Terminate(processID); err != nil {
		t.Fatalf("Terminate: %v", err)
	}
}

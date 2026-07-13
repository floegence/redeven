package ai

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func TestGetTerminalToolOutput(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	ensureThreadstoreThreadForTest(t, store, "env_1", "th_1")
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_1",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := store.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:      "run_1",
		ToolID:     "tool_1",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd","cwd":"/tmp"}`,
		ResultJSON: `{"status":"success","process_id":"tp_1","output":"/tmp\n","stdout":"/tmp\n","stderr":"","exit_code":0,"duration_ms":8,"first_seq":1,"last_seq":2,"total_bytes":5,"truncated":false,"execution_location":"local_runtime"}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	svc := &Service{threadsDB: store}
	meta := &session.Meta{
		EndpointID: "env_1",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}

	out, err := svc.GetTerminalToolOutput(ctx, meta, "run_1", "tool_1")
	if err != nil {
		t.Fatalf("GetTerminalToolOutput: %v", err)
	}
	if out == nil {
		t.Fatalf("GetTerminalToolOutput returned nil")
	}
	if got := strings.TrimSpace(out.Stdout); got != "/tmp" {
		t.Fatalf("stdout=%q, want /tmp", got)
	}
	if out.ExitCode != 0 {
		t.Fatalf("exit_code=%d, want 0", out.ExitCode)
	}
	if out.Cwd != "/tmp" {
		t.Fatalf("cwd=%q, want /tmp", out.Cwd)
	}
	if out.ProcessID != "tp_1" {
		t.Fatalf("process_id=%q, want tp_1", out.ProcessID)
	}
	if out.FirstSeq != 1 || out.LastSeq != 2 || out.TotalBytes != 5 {
		t.Fatalf("seq fields=%d/%d bytes=%d", out.FirstSeq, out.LastSeq, out.TotalBytes)
	}
}

func TestGetTerminalToolOutput_RawFallbackForInvalidJSON(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	ensureThreadstoreThreadForTest(t, store, "env_1", "th_1")
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_1",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := store.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:      "run_1",
		ToolID:     "tool_1",
		ToolName:   "terminal.exec",
		Status:     "success",
		ArgsJSON:   `{"command":"pwd"}`,
		ResultJSON: `{"stdout":"x"`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	svc := &Service{threadsDB: store}
	meta := &session.Meta{
		EndpointID: "env_1",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}

	out, err := svc.GetTerminalToolOutput(ctx, meta, "run_1", "tool_1")
	if err != nil {
		t.Fatalf("GetTerminalToolOutput: %v", err)
	}
	if out == nil {
		t.Fatalf("GetTerminalToolOutput returned nil")
	}
	if strings.TrimSpace(out.RawResult) == "" {
		t.Fatalf("RawResult should not be empty for invalid result_json")
	}
}

func TestGetTerminalToolOutput_UsesRunningProcessMetadata(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	ensureThreadstoreThreadForTest(t, store, "env_1", "th_1")
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_1",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := store.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:      "run_1",
		ToolID:     "tool_1",
		ToolName:   "terminal.exec",
		Status:     "running",
		ArgsJSON:   `{"command":"go test ./..."}`,
		ResultJSON: `{"status":"running","process_id":"tp_running","output":"partial","latest_output":"partial","cwd":"/workspace","first_seq":3,"last_seq":4,"total_bytes":7,"started_at_ms":1700000000000,"truncated":false}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	svc := &Service{threadsDB: store}
	meta := &session.Meta{
		EndpointID: "env_1",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}

	out, err := svc.GetTerminalToolOutput(ctx, meta, "run_1", "tool_1")
	if err != nil {
		t.Fatalf("GetTerminalToolOutput: %v", err)
	}
	if out == nil {
		t.Fatalf("GetTerminalToolOutput returned nil")
	}
	if out.Status != toolCallStatusRunning {
		t.Fatalf("status=%q, want running", out.Status)
	}
	if out.ProcessID != "tp_running" {
		t.Fatalf("process_id=%q, want tp_running", out.ProcessID)
	}
	if out.Output != "partial" || out.LatestOutput != "partial" {
		t.Fatalf("output=%q latest=%q", out.Output, out.LatestOutput)
	}
	if out.Cwd != "/workspace" {
		t.Fatalf("cwd=%q, want /workspace", out.Cwd)
	}
	if out.FirstSeq != 3 || out.LastSeq != 4 || out.TotalBytes != 7 || out.StartedAtUnixMs != 1700000000000 {
		t.Fatalf("metadata=%+v", out)
	}
}

func TestGetTerminalToolOutput_RejectsNonTerminalTool(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	ensureThreadstoreThreadForTest(t, store, "env_1", "th_1")
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_1",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := store.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:    "run_1",
		ToolID:   "tool_1",
		ToolName: "apply_patch",
		Status:   "success",
		ArgsJSON: `{"patch":"diff --git a/a b/b"}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	svc := &Service{threadsDB: store}
	meta := &session.Meta{
		EndpointID: "env_1",
		CanRead:    true,
		CanWrite:   true,
		CanExecute: true,
	}
	if _, err := svc.GetTerminalToolOutput(ctx, meta, "run_1", "tool_1"); err == nil {
		t.Fatalf("expected error for non-terminal tool")
	}
}

func TestGetTerminalToolOutput_RequiresRWX(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	svc := &Service{threadsDB: store}
	meta := &session.Meta{
		EndpointID: "env_1",
		CanRead:    true,
		CanWrite:   false,
		CanExecute: true,
	}
	if _, err := svc.GetTerminalToolOutput(context.Background(), meta, "run_1", "tool_1"); !errors.Is(err, errRWXPermissionDenied) {
		t.Fatalf("err=%v, want errRWXPermissionDenied", err)
	}
}

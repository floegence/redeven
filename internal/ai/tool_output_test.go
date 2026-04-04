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
		ArgsJSON:   `{"command":"pwd","cwd":"/tmp","timeout_ms":60000}`,
		ResultJSON: `{"stdout":"/tmp\n","stderr":"","exit_code":0,"duration_ms":8,"timed_out":false,"truncated":false}`,
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
	if out.TimeoutMS != 60000 {
		t.Fatalf("timeout_ms=%d, want 60000", out.TimeoutMS)
	}
	if out.RequestedTimeoutMS != 60000 {
		t.Fatalf("requested_timeout_ms=%d, want 60000", out.RequestedTimeoutMS)
	}
	if out.TimeoutSource != terminalExecTimeoutSourceRequested {
		t.Fatalf("timeout_source=%q, want %q", out.TimeoutSource, terminalExecTimeoutSourceRequested)
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

func TestGetTerminalToolOutput_UsesResultTimeoutMetadataWhenArgsOmitTimeout(t *testing.T) {
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
	if err := store.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:      "run_1",
		ToolID:     "tool_1",
		ToolName:   "terminal.exec",
		Status:     "running",
		ArgsJSON:   `{"command":"go test ./..."}`,
		ResultJSON: `{"timeout_ms":120000,"timeout_source":"default"}`,
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
	if out.TimeoutMS != 120000 {
		t.Fatalf("timeout_ms=%d, want 120000", out.TimeoutMS)
	}
	if out.RequestedTimeoutMS != 0 {
		t.Fatalf("requested_timeout_ms=%d, want 0", out.RequestedTimeoutMS)
	}
	if out.TimeoutSource != terminalExecTimeoutSourceDefault {
		t.Fatalf("timeout_source=%q, want %q", out.TimeoutSource, terminalExecTimeoutSourceDefault)
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

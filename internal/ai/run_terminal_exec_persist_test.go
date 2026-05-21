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

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
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

func TestHandleToolCall_TerminalExec_EmitsActivityTimelineFrames(t *testing.T) {
	t.Parallel()

	runID := "run_terminal_output_ref"
	toolID := "tool_terminal_output_ref"
	workspace := t.TempDir()

	var (
		mu        sync.Mutex
		timelines []ActivityTimelineBlock
	)

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:        runID,
		AgentHomeDir: workspace,
		Shell:        "bash",
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
			block, ok := bs.Block.(ActivityTimelineBlock)
			if !ok {
				return
			}
			if _, ok := findActivityItemForTest(block, toolID); !ok {
				return
			}
			mu.Lock()
			timelines = append(timelines, block)
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
	frames := append([]ActivityTimelineBlock(nil), timelines...)
	mu.Unlock()

	if len(frames) == 0 {
		t.Fatalf("expected activity timeline frames")
	}

	foundStatus := map[string]bool{}
	for _, frame := range frames {
		item, ok := findActivityItemForTest(frame, toolID)
		if !ok {
			continue
		}
		switch item.Status {
		case string(ToolCallStatusPending), string(ToolCallStatusRunning), string(ToolCallStatusSuccess):
			foundStatus[item.Status] = true
		default:
			continue
		}
		ref, ok := findActivityDetailRefForTest(item, "terminal_output")
		if !ok {
			t.Fatalf("status=%s missing terminal_output detail ref", item.Status)
		}
		if !strings.Contains(ref.Endpoint, runID) || !strings.Contains(ref.Endpoint, toolID) {
			t.Fatalf("status=%s detail endpoint=%q, want run/tool ids", item.Status, ref.Endpoint)
		}
		if strings.TrimSpace(item.ToolName) != "terminal.exec" || strings.TrimSpace(item.Renderer) != "command" {
			t.Fatalf("unexpected terminal activity item: %+v", item)
		}
	}

	for _, status := range []string{string(ToolCallStatusPending), string(ToolCallStatusRunning), string(ToolCallStatusSuccess)} {
		if !foundStatus[status] {
			t.Fatalf("missing tool frame for status=%s", status)
		}
	}
}

func TestHandleToolCall_PendingFrameVisibleInSnapshotImmediately(t *testing.T) {
	t.Parallel()

	runID := "run_terminal_snapshot_consistency"
	toolID := "tool_terminal_snapshot_consistency"
	workspace := t.TempDir()

	var (
		mu                 sync.Mutex
		checkedPending     bool
		snapshotConsistent = true
	)

	var r *run
	r = newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:        runID,
		AgentHomeDir: workspace,
		Shell:        "bash",
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		},
		MessageID: "msg_terminal_snapshot_consistency",
		OnStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			block, ok := bs.Block.(ActivityTimelineBlock)
			if !ok {
				return
			}
			item, ok := findActivityItemForTest(block, toolID)
			if !ok || item.Status != string(ToolCallStatusPending) {
				return
			}

			raw, _, _, err := r.snapshotAssistantMessageJSON()

			mu.Lock()
			defer mu.Unlock()
			checkedPending = true
			if err != nil {
				snapshotConsistent = false
				return
			}
			var snapshot struct {
				Blocks []json.RawMessage `json:"blocks"`
			}
			if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
				snapshotConsistent = false
				return
			}
			if bs.BlockIndex < 0 || bs.BlockIndex >= len(snapshot.Blocks) {
				snapshotConsistent = false
				return
			}
			rawBlock := snapshot.Blocks[bs.BlockIndex]
			if len(rawBlock) == 0 || strings.EqualFold(strings.TrimSpace(string(rawBlock)), "null") {
				snapshotConsistent = false
				return
			}
			var persisted ActivityTimelineBlock
			if err := json.Unmarshal(rawBlock, &persisted); err != nil {
				snapshotConsistent = false
				return
			}
			item, ok = findActivityItemForTest(persisted, toolID)
			if !ok || item.Status != string(ToolCallStatusPending) {
				snapshotConsistent = false
			}
		},
	})

	outcome, err := r.handleToolCall(context.Background(), toolID, "terminal.exec", map[string]any{
		"command": "printf snapshot-consistency",
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil || !outcome.Success {
		t.Fatalf("tool outcome should be success, got %+v", outcome)
	}

	mu.Lock()
	defer mu.Unlock()
	if !checkedPending {
		t.Fatalf("expected to inspect pending block-set frame")
	}
	if !snapshotConsistent {
		t.Fatalf("snapshot did not include the emitted pending tool block")
	}
}

func TestHandleToolCall_TerminalExecTimeout_PersistsErrorWithOutputRefAndResult(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	store, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("threadstore.Open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	if err := store.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_terminal_timeout",
		EndpointID: "env_1",
		ThreadID:   "th_1",
		MessageID:  "msg_1",
		State:      "running",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}

	workspace := t.TempDir()
	toolID := "tool_terminal_timeout"

	var (
		mu         sync.Mutex
		errorFrame ActivityTimelineBlock
	)

	r := newRun(runOptions{
		Log:          slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		RunID:        "run_terminal_timeout",
		EndpointID:   "env_1",
		ThreadID:     "th_1",
		MessageID:    "msg_1",
		AgentHomeDir: workspace,
		Shell:        "bash",
		ThreadsDB:    store,
		SessionMeta: &session.Meta{
			CanRead:    true,
			CanWrite:   true,
			CanExecute: true,
		},
		PersistOpTimeout: 5 * time.Second,
		OnStreamEvent: func(ev any) {
			bs, ok := ev.(streamEventBlockSet)
			if !ok {
				return
			}
			block, ok := bs.Block.(ActivityTimelineBlock)
			if !ok {
				return
			}
			item, ok := findActivityItemForTest(block, toolID)
			if !ok || item.Status != string(ToolCallStatusError) {
				return
			}
			mu.Lock()
			errorFrame = block
			mu.Unlock()
		},
	})

	outcome, err := r.handleToolCall(context.Background(), toolID, "terminal.exec", map[string]any{
		"command":    "printf partial-output && sleep 0.1",
		"timeout_ms": 20,
	})
	if err != nil {
		t.Fatalf("handleToolCall: %v", err)
	}
	if outcome == nil {
		t.Fatalf("missing tool outcome")
	}
	if outcome.Success {
		t.Fatalf("expected timeout to surface as tool error, got success outcome=%+v", outcome)
	}
	if outcome.ToolError == nil {
		t.Fatalf("missing timeout tool error")
	}
	if outcome.ToolError.Code != "TIMEOUT" {
		t.Fatalf("tool error code=%q, want TIMEOUT", outcome.ToolError.Code)
	}

	resultMap, _ := outcome.Result.(map[string]any)
	if resultMap == nil {
		t.Fatalf("timeout outcome should preserve terminal result payload")
	}
	if !readBoolField(resultMap, "timed_out", "timedOut") {
		t.Fatalf("timed_out=%v, want true", resultMap["timed_out"])
	}
	if got := readInt64Field(resultMap, "timeout_ms", "timeoutMs"); got != 20 {
		t.Fatalf("timeout_ms=%d, want 20", got)
	}
	if got := strings.TrimSpace(anyToString(resultMap["timeout_source"])); got != terminalExecTimeoutSourceRequested {
		t.Fatalf("timeout_source=%q, want %q", got, terminalExecTimeoutSourceRequested)
	}

	mu.Lock()
	frame := errorFrame
	mu.Unlock()
	item, ok := findActivityItemForTest(frame, toolID)
	if !ok || item.Status != string(ToolCallStatusError) {
		t.Fatalf("missing error activity, got block=%+v", frame)
	}
	ref, ok := findActivityDetailRefForTest(item, "terminal_output")
	if !ok {
		t.Fatalf("error activity missing terminal_output detail ref: %+v", item)
	}
	if !strings.Contains(ref.Endpoint, "run_terminal_timeout") || !strings.Contains(ref.Endpoint, toolID) {
		t.Fatalf("terminal detail endpoint=%q, want run/tool ids", ref.Endpoint)
	}
	if !activityItemHasChipForTest(item, "status", "Error", "") {
		t.Fatalf("error activity missing status chip: %+v", item.Chips)
	}

	rec, err := store.GetToolCall(ctx, "env_1", "run_terminal_timeout", toolID)
	if err != nil {
		t.Fatalf("GetToolCall: %v", err)
	}
	if rec == nil {
		t.Fatalf("GetToolCall returned nil")
	}
	if rec.Status != string(ToolCallStatusError) {
		t.Fatalf("tool call status=%q, want %q", rec.Status, ToolCallStatusError)
	}
	if rec.ErrorCode != "TIMEOUT" {
		t.Fatalf("tool call error_code=%q, want TIMEOUT", rec.ErrorCode)
	}

	var persisted map[string]any
	if err := json.Unmarshal([]byte(rec.ResultJSON), &persisted); err != nil {
		t.Fatalf("result json invalid: %v", err)
	}
	if !readBoolField(persisted, "timed_out", "timedOut") {
		t.Fatalf("persisted timed_out=%v, want true", persisted["timed_out"])
	}
	if got := readInt64Field(persisted, "timeout_ms", "timeoutMs"); got != 20 {
		t.Fatalf("persisted timeout_ms=%d, want 20", got)
	}
	if got := strings.TrimSpace(anyToString(persisted["timeout_source"])); got != terminalExecTimeoutSourceRequested {
		t.Fatalf("persisted timeout_source=%q, want %q", got, terminalExecTimeoutSourceRequested)
	}

	events, err := store.ListRunEvents(ctx, "env_1", "run_terminal_timeout", 200)
	if err != nil {
		t.Fatalf("ListRunEvents: %v", err)
	}
	for _, eventType := range []string{"activity.item.projected", "activity.group.updated", "activity.timeline.persisted"} {
		if !hasRunEventForTest(events, eventType) {
			t.Fatalf("missing activity projection event %q in %#v", eventType, events)
		}
	}
}

func findActivityItemForTest(block ActivityTimelineBlock, toolID string) (ActivityItem, bool) {
	toolID = strings.TrimSpace(toolID)
	for _, group := range block.Groups {
		for _, item := range group.Items {
			if strings.TrimSpace(item.ToolID) == toolID {
				return item, true
			}
		}
	}
	return ActivityItem{}, false
}

func findActivityDetailRefForTest(item ActivityItem, kind string) (ActivityDetailRef, bool) {
	kind = strings.TrimSpace(kind)
	for _, ref := range item.DetailRefs {
		if strings.TrimSpace(ref.Kind) == kind {
			return ref, true
		}
	}
	return ActivityDetailRef{}, false
}

func activityItemHasChipForTest(item ActivityItem, kind string, label string, value string) bool {
	kind = strings.TrimSpace(kind)
	label = strings.TrimSpace(label)
	value = strings.TrimSpace(value)
	for _, chip := range item.Chips {
		if strings.TrimSpace(chip.Kind) != kind || strings.TrimSpace(chip.Label) != label {
			continue
		}
		if value == "" || strings.TrimSpace(chip.Value) == value {
			return true
		}
	}
	return false
}

func hasRunEventForTest(events []threadstore.RunEventRecord, eventType string) bool {
	eventType = strings.TrimSpace(eventType)
	for _, event := range events {
		if strings.TrimSpace(event.EventType) == eventType {
			return true
		}
	}
	return false
}

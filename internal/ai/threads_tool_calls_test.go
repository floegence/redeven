package ai

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

func TestService_ListRecentThreadToolCalls(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "tool thread", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.threadsDB.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_tool_calls_1",
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		State:      "success",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := svc.threadsDB.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:    "run_tool_calls_1",
		ToolID:   "tool_1",
		ToolName: "terminal.exec",
		Status:   "success",
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}

	recs, err := svc.ListRecentThreadToolCalls(ctx, meta, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("len(recs)=%d, want 1", len(recs))
	}
	if recs[0].ToolName != "terminal.exec" {
		t.Fatalf("tool_name=%q", recs[0].ToolName)
	}
}

func TestService_DeleteThreadRemovesThreadScopedRunArtifacts(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{
		ChannelID:         "ch_test",
		EndpointID:        "env_test",
		UserPublicID:      "u_test",
		UserEmail:         "u_test@example.com",
		NamespacePublicID: "ns_test",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
	}

	th, err := svc.CreateThread(ctx, meta, "tool cleanup", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	if err := svc.threadsDB.UpsertRun(ctx, threadstore.RunRecord{
		RunID:      "run_cleanup_1",
		EndpointID: meta.EndpointID,
		ThreadID:   th.ThreadID,
		State:      "success",
	}); err != nil {
		t.Fatalf("UpsertRun: %v", err)
	}
	if err := svc.threadsDB.UpsertToolCall(ctx, threadstore.ToolCallRecord{
		RunID:      "run_cleanup_1",
		ToolID:     "tool_cleanup_1",
		ToolName:   "terminal.exec",
		Status:     "success",
		ResultJSON: `{"stdout":"ok"}`,
	}); err != nil {
		t.Fatalf("UpsertToolCall: %v", err)
	}
	if err := svc.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  meta.EndpointID,
		ThreadID:    th.ThreadID,
		RunID:       "run_cleanup_1",
		EventType:   "tool.result",
		StreamKind:  "tool",
		PayloadJSON: `{"ok":true}`,
	}); err != nil {
		t.Fatalf("AppendRunEvent: %v", err)
	}
	if _, err := svc.threadsDB.CreateThreadCheckpoint(ctx, meta.EndpointID, th.ThreadID, "cp_cleanup_1", "run_cleanup_1", threadstore.CheckpointKindPreRun); err != nil {
		t.Fatalf("CreateThreadCheckpoint: %v", err)
	}
	if err := svc.threadsDB.UpsertProviderCapability(ctx, threadstore.ProviderCapabilityRecord{
		ProviderID:     "openai",
		ModelName:      "gpt-5-mini",
		CapabilityJSON: `{"supports_reasoning":true}`,
	}); err != nil {
		t.Fatalf("UpsertProviderCapability: %v", err)
	}

	if err := svc.DeleteThread(ctx, meta, th.ThreadID, false); err != nil {
		t.Fatalf("DeleteThread: %v", err)
	}

	recs, err := svc.ListRecentThreadToolCalls(ctx, meta, th.ThreadID, 10)
	if err != nil {
		t.Fatalf("ListRecentThreadToolCalls after delete: %v", err)
	}
	if len(recs) != 0 {
		t.Fatalf("tool calls after delete=%v, want none", recs)
	}

	runEvents, err := svc.ListRunEvents(ctx, meta, "run_cleanup_1", 10)
	if err != nil {
		t.Fatalf("ListRunEvents after delete: %v", err)
	}
	if len(runEvents.Events) != 0 {
		t.Fatalf("run events after delete=%v, want none", runEvents.Events)
	}

	if _, err := svc.GetTerminalToolOutput(ctx, meta, "run_cleanup_1", "tool_cleanup_1"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("GetTerminalToolOutput err=%v, want %v", err, sql.ErrNoRows)
	}

	capability, err := svc.threadsDB.GetProviderCapability(ctx, "openai", "gpt-5-mini")
	if err != nil {
		t.Fatalf("GetProviderCapability: %v", err)
	}
	if capability == nil {
		t.Fatalf("provider capability should be retained as global cache")
	}
}

func TestMarshalQueuedTurnOptions_PreservesNoUserInteraction(t *testing.T) {
	t.Parallel()

	raw := marshalQueuedTurnOptions(RunOptions{
		MaxSteps:          3,
		Mode:              "plan",
		NoUserInteraction: true,
	})
	opts := unmarshalQueuedTurnOptions(raw)
	if !opts.NoUserInteraction {
		t.Fatalf("expected no_user_interaction to round-trip")
	}
	if opts.Mode != "plan" {
		t.Fatalf("mode=%q, want plan", opts.Mode)
	}
}

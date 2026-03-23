package ai

import (
	"context"
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

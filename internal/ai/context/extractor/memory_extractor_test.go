package extractor

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	contextmodel "github.com/floegence/redeven-agent/internal/ai/context/model"
	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestMemoryExtractor_BlockerCreatedForFailedToolSpan(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	if err := db.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "test"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	now := time.Now().UnixMilli()
	if err := db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          "span_fail",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "apply_patch",
		Status:          "failed",
		PayloadJSON:     `{"tool_id":"tool_1","tool_name":"apply_patch","status":"failed","error":{"code":"PERMISSION_DENIED","message":"permission denied"}}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 1,
		UpdatedAtUnixMs: now + 1,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan failed: %v", err)
	}

	repo := contextstore.NewRepository(db)
	extractor := New(repo)
	_, err = extractor.Extract(ctx, ExtractInput{
		EndpointID:         "env_1",
		ThreadID:           "th_1",
		RunID:              "run_1",
		Objective:          "Fix build",
		AssistantText:      "I found one blocked step.",
		FinalizationReason: "implicit_complete_backpressure",
	})
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}

	blockers, err := repo.ListThreadBlockers(ctx, "env_1", "th_1", 20)
	if err != nil {
		t.Fatalf("ListThreadBlockers: %v", err)
	}
	if len(blockers) != 1 {
		t.Fatalf("len(blockers)=%d, want 1", len(blockers))
	}
	if blockers[0].Kind != contextmodel.MemoryKindBlocker {
		t.Fatalf("blocker kind=%q, want %q", blockers[0].Kind, contextmodel.MemoryKindBlocker)
	}
	if blockers[0].Content == "" {
		t.Fatalf("blocker content should not be empty")
	}
	if got, want := blockers[0].Content, "Tool blocked: apply_patch"; !strings.HasPrefix(got, want) {
		t.Fatalf("blocker content=%q, want prefix %q", got, want)
	}
}

func TestMemoryExtractor_BlockerClearedIfToolSucceededInSameRun(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "threads.sqlite")
	db, err := threadstore.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	if err := db.CreateThread(ctx, threadstore.Thread{ThreadID: "th_1", EndpointID: "env_1", Title: "test"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	now := time.Now().UnixMilli()
	if err := db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          "span_fail",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "apply_patch",
		Status:          "failed",
		PayloadJSON:     `{"tool_id":"tool_1","tool_name":"apply_patch","status":"failed","error":{"code":"PERMISSION_DENIED","message":"permission denied"}}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 1,
		UpdatedAtUnixMs: now + 1,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan failed: %v", err)
	}
	if err := db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          "span_ok",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "apply_patch",
		Status:          "success",
		PayloadJSON:     `{"tool_id":"tool_2","tool_name":"apply_patch","status":"success"}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 2,
		UpdatedAtUnixMs: now + 2,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan success: %v", err)
	}

	repo := contextstore.NewRepository(db)
	extractor := New(repo)
	_, err = extractor.Extract(ctx, ExtractInput{
		EndpointID:         "env_1",
		ThreadID:           "th_1",
		RunID:              "run_1",
		Objective:          "Fix build",
		AssistantText:      "I found one blocked step.",
		FinalizationReason: "implicit_complete_backpressure",
	})
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}

	blockers, err := repo.ListThreadBlockers(ctx, "env_1", "th_1", 20)
	if err != nil {
		t.Fatalf("ListThreadBlockers: %v", err)
	}
	if len(blockers) != 0 {
		t.Fatalf("len(blockers)=%d, want 0", len(blockers))
	}
}

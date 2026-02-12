package extractor

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	contextstore "github.com/floegence/redeven-agent/internal/ai/context/store"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func TestMemoryExtractor_ExtractFromExecutionSpans(t *testing.T) {
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
		SpanID:          "span_ok",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "terminal.exec",
		Status:          "success",
		PayloadJSON:     `{"summary":"go test ./... passed"}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 1,
		UpdatedAtUnixMs: now + 1,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan success: %v", err)
	}
	if err := db.UpsertExecutionSpan(ctx, threadstore.ExecutionSpanRecord{
		SpanID:          "span_fail",
		EndpointID:      "env_1",
		ThreadID:        "th_1",
		RunID:           "run_1",
		Kind:            "tool",
		Name:            "fs.write_file",
		Status:          "failed",
		PayloadJSON:     `{"error":"permission denied"}`,
		StartedAtUnixMs: now,
		EndedAtUnixMs:   now + 1,
		UpdatedAtUnixMs: now + 1,
	}); err != nil {
		t.Fatalf("UpsertExecutionSpan failed: %v", err)
	}

	repo := contextstore.NewRepository(db)
	extractor := New(repo)
	items, err := extractor.Extract(ctx, ExtractInput{
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
	if len(items) < 3 {
		t.Fatalf("len(items)=%d, want >= 3", len(items))
	}
	stored, err := repo.ListRecentMemoryItems(ctx, "env_1", "th_1", 20)
	if err != nil {
		t.Fatalf("ListRecentMemoryItems: %v", err)
	}
	if len(stored) == 0 {
		t.Fatalf("expected stored memory items")
	}
}

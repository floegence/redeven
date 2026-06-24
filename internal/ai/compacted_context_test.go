package ai

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func TestFloretTurnResultToThreadCompactedContext(t *testing.T) {
	t.Parallel()

	compacted := floretTurnResultToThreadCompactedContext(flruntime.ProjectedTurnResult{
		RunID:    "run-active-compact",
		ThreadID: "thread-active-compact",
		TurnID:   "turn-active-compact",
		Status:   flruntime.TurnStatusCompleted,
		Transcript: []flruntime.TranscriptMessage{
			{
				Role:                 "user",
				Kind:                 flruntime.TranscriptMessageKindCompactionSummary,
				Content:              "summary of earlier work",
				CompactionID:         "cmp-active",
				CompactionGeneration: 2,
				CompactionWindowID:   "window-active",
			},
			{Role: "assistant", Content: "continued after manual compaction"},
		},
	}, observation.CompactionEvent{
		OperationID:             "run-active-compact:compact:2:manual:manual-active",
		RequestID:               "manual-active",
		Source:                  "slash_command",
		CompactionID:            "cmp-active",
		CompactionGeneration:    2,
		CompactionWindowID:      "window-active",
		CompactedThroughEntryID: "entry-before-tail",
		ObservedAt:              time.UnixMilli(12_345),
	})

	if compacted.IsZero() {
		t.Fatalf("compacted context is zero")
	}
	if compacted.OperationID != "run-active-compact:compact:2:manual:manual-active" ||
		compacted.RequestID != "manual-active" ||
		compacted.Source != "slash_command" ||
		compacted.CompactionID != "cmp-active" ||
		compacted.CompactionGeneration != 2 ||
		compacted.CompactionWindowID != "window-active" ||
		compacted.CompactedThroughEntryID != "entry-before-tail" {
		t.Fatalf("metadata=%#v", compacted)
	}
	if len(compacted.Transcript) != 2 || compacted.Transcript[0].Kind != flruntime.TranscriptMessageKindCompactionSummary {
		t.Fatalf("transcript=%#v", compacted.Transcript)
	}
	if compacted.CreatedAtUnixMs != 12_345 || compacted.UpdatedAtUnixMs <= 0 {
		t.Fatalf("timestamps=%#v", compacted)
	}
}

func TestApplyThreadCompactedContextToPromptPackUsesCheckpoint(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := threadstore.Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	endpointID := "env_compacted_prompt_pack"
	threadID := "thread_compacted_prompt_pack"
	if err := store.CreateThread(ctx, threadstore.Thread{EndpointID: endpointID, ThreadID: threadID, Title: "compacted prompt pack"}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if err := store.SetThreadCompactedContext(ctx, endpointID, threadID, threadstore.ThreadCompactedContext{
		OperationID:          "compact-operation",
		RequestID:            "manual-compact",
		Source:               "slash_command",
		CompactionID:         "compact-id",
		CompactionGeneration: 1,
		CompactionWindowID:   "compact-window",
		Transcript: []threadstore.ThreadCompactedMessage{{
			Role:    "user",
			Kind:    flruntime.TranscriptMessageKindCompactionSummary,
			Content: "summary checkpoint",
		}},
		CoveredThroughTurnRowID: 10,
		CoveredThroughMessageID: 20,
		CreatedAtUnixMs:         10_000,
		UpdatedAtUnixMs:         20_000,
	}); err != nil {
		t.Fatalf("SetThreadCompactedContext: %v", err)
	}

	svc := &Service{threadsDB: store, persistOpTO: 2 * time.Second}
	pack := svc.applyThreadCompactedContextToPromptPack(ctx, endpointID, threadID, contextmodel.PromptPack{
		ThreadID: threadID,
		RunID:    "run_after_compact",
		RecentDialogue: []contextmodel.DialogueTurn{
			{TurnRowID: 9, UserMessageRowID: 18, AssistantRowID: 19, UserText: "old", AssistantText: "old answer", CreatedAtUnixMs: 20_000},
			{TurnRowID: 11, UserMessageRowID: 21, AssistantRowID: 22, UserText: "new", AssistantText: "new answer", CreatedAtUnixMs: 20_000},
		},
	})

	if len(pack.CompactedHistory) != 1 || pack.CompactedHistory[0].Content != "summary checkpoint" {
		t.Fatalf("compacted history=%#v", pack.CompactedHistory)
	}
	if len(pack.RecentDialogue) != 1 || pack.RecentDialogue[0].UserText != "new" {
		t.Fatalf("recent dialogue=%#v", pack.RecentDialogue)
	}
}

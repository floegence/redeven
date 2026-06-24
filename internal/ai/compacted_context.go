package ai

import (
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

func compactedContextToPromptMessages(compacted threadstore.ThreadCompactedContext) []contextmodel.CompactedMessage {
	compacted = compacted.Normalized()
	if compacted.IsZero() {
		return nil
	}
	out := make([]contextmodel.CompactedMessage, 0, len(compacted.Transcript))
	for _, msg := range compacted.Transcript {
		out = append(out, contextmodel.CompactedMessage{
			Role:                 strings.TrimSpace(msg.Role),
			Content:              strings.TrimSpace(msg.Content),
			Reasoning:            strings.TrimSpace(msg.Reasoning),
			ToolCallID:           strings.TrimSpace(msg.ToolCallID),
			ToolName:             strings.TrimSpace(msg.ToolName),
			ToolArgs:             strings.TrimSpace(msg.ToolArgs),
			Kind:                 strings.TrimSpace(msg.Kind),
			EntryID:              strings.TrimSpace(msg.EntryID),
			ParentEntryID:        strings.TrimSpace(msg.ParentEntryID),
			CompactionID:         strings.TrimSpace(msg.CompactionID),
			CompactionGeneration: msg.CompactionGeneration,
			CompactionWindowID:   strings.TrimSpace(msg.CompactionWindowID),
		})
	}
	return out
}

func floretTranscriptToThreadCompactedMessages(messages []flruntime.TranscriptMessage) []threadstore.ThreadCompactedMessage {
	out := make([]threadstore.ThreadCompactedMessage, 0, len(messages))
	for _, msg := range messages {
		projected := threadstore.ThreadCompactedMessage{
			Role:                 strings.TrimSpace(msg.Role),
			Content:              strings.TrimSpace(msg.Content),
			Reasoning:            strings.TrimSpace(msg.Reasoning),
			ToolCallID:           strings.TrimSpace(msg.ToolCallID),
			ToolName:             strings.TrimSpace(msg.ToolName),
			ToolArgs:             strings.TrimSpace(msg.ToolArgs),
			Kind:                 strings.TrimSpace(msg.Kind),
			EntryID:              strings.TrimSpace(msg.EntryID),
			ParentEntryID:        strings.TrimSpace(msg.ParentEntryID),
			CompactionID:         strings.TrimSpace(msg.CompactionID),
			CompactionGeneration: msg.CompactionGeneration,
			CompactionWindowID:   strings.TrimSpace(msg.CompactionWindowID),
		}
		out = append(out, projected)
	}
	return out
}

func floretProjectedCompactionToThreadCompactedContext(result flruntime.ProjectedContextCompactionResult) threadstore.ThreadCompactedContext {
	if result.Compaction == nil {
		return threadstore.ThreadCompactedContext{}
	}
	createdAt := result.Compaction.CreatedAt.UnixMilli()
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	return threadstore.ThreadCompactedContext{
		OperationID:             strings.TrimSpace(result.Compaction.OperationID),
		RequestID:               strings.TrimSpace(result.Compaction.RequestID),
		Source:                  strings.TrimSpace(result.Compaction.Source),
		CompactionID:            strings.TrimSpace(result.Compaction.CompactionID),
		PreviousCompactionID:    strings.TrimSpace(result.Compaction.PreviousCompactionID),
		CompactionGeneration:    result.Compaction.CompactionGeneration,
		CompactionWindowID:      strings.TrimSpace(result.Compaction.CompactionWindowID),
		FirstKeptEntryID:        strings.TrimSpace(result.Compaction.FirstKeptEntryID),
		CompactedThroughEntryID: strings.TrimSpace(result.Compaction.CompactedThroughEntryID),
		Transcript:              floretTranscriptToThreadCompactedMessages(result.ActiveTranscript),
		CreatedAtUnixMs:         createdAt,
		UpdatedAtUnixMs:         time.Now().UnixMilli(),
	}.Normalized()
}

func floretTurnResultToThreadCompactedContext(result flruntime.ProjectedTurnResult, compaction observation.CompactionEvent) threadstore.ThreadCompactedContext {
	operationID := strings.TrimSpace(compaction.OperationID)
	compactionID := strings.TrimSpace(compaction.CompactionID)
	if operationID == "" || compactionID == "" || len(result.Transcript) == 0 {
		return threadstore.ThreadCompactedContext{}
	}
	createdAt := compaction.ObservedAt.UnixMilli()
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	return threadstore.ThreadCompactedContext{
		OperationID:             operationID,
		RequestID:               strings.TrimSpace(compaction.RequestID),
		Source:                  strings.TrimSpace(compaction.Source),
		CompactionID:            compactionID,
		CompactionGeneration:    compaction.CompactionGeneration,
		CompactionWindowID:      strings.TrimSpace(compaction.CompactionWindowID),
		CompactedThroughEntryID: strings.TrimSpace(compaction.CompactedThroughEntryID),
		Transcript:              floretTranscriptToThreadCompactedMessages(result.Transcript),
		CreatedAtUnixMs:         createdAt,
		UpdatedAtUnixMs:         time.Now().UnixMilli(),
	}.Normalized()
}

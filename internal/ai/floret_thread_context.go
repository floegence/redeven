package ai

import (
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
)

type flowerCanonicalContextProjection struct {
	ModelContext *flruntime.ThreadModelContext
	Usage        *FlowerContextUsage
	Compactions  []FlowerContextCompaction
	Decorations  []FlowerTimelineDecoration
}

func flowerCurrentContextProjection(current flruntime.ThreadView) (flowerCanonicalContextProjection, error) {
	if current.Context == nil {
		return flowerCanonicalContextProjection{}, errors.New("Floret current view is missing its context snapshot")
	}
	return flowerThreadContextProjection(*current.Context, current)
}

func flowerThreadContextProjection(snapshot flruntime.ThreadContextSnapshot, current flruntime.ThreadView) (flowerCanonicalContextProjection, error) {
	projection := flowerCanonicalContextProjection{}
	if snapshot.ModelContext != nil {
		modelContext := *snapshot.ModelContext
		modelContext.Snapshot.Sections = append([]flruntime.ModelContextSection{}, modelContext.Snapshot.Sections...)
		modelContext.ChangedKeys = append([]string{}, modelContext.ChangedKeys...)
		modelContext.RemovedKeys = append([]string{}, modelContext.RemovedKeys...)
		projection.ModelContext = &modelContext
	}
	if snapshot.ContextUsage != nil || snapshot.UsageTotals != nil {
		usage, err := flowerContextUsageFromFloret(snapshot.ContextUsage, snapshot.UsageTotals)
		if err != nil {
			return flowerCanonicalContextProjection{}, fmt.Errorf("project Floret context usage: %w", err)
		}
		projection.Usage = &usage
	}
	compactions := make([]FlowerContextCompaction, 0, len(snapshot.Compactions))
	decorations := make([]FlowerTimelineDecoration, 0, len(snapshot.Compactions))
	for _, canonical := range snapshot.Compactions {
		projected, err := flowerContextCompactionFromFloret(&observation.CompactionEvent{
			Decision: canonical.Decision, RunID: canonical.RunID, ThreadID: canonical.ThreadID, TurnID: canonical.TurnID,
			Step: canonical.Step, OperationID: canonical.OperationID, RequestID: canonical.RequestID,
			Phase: observation.CompactionPhase(canonical.Phase), Status: observation.CompactionStatus(canonical.Status),
			Trigger: canonical.Trigger, Reason: canonical.Reason, Source: canonical.Source,
			TokensBefore: canonical.TokensBefore, TokensAfterEstimate: canonical.TokensAfterEstimate,
			Error: canonical.Error, ObservedAt: canonical.ObservedAt,
		})
		if err != nil {
			return flowerCanonicalContextProjection{}, err
		}
		if canonical.ThreadID != current.ThreadID || canonical.TurnID == "" || canonical.CanonicalOrdinal == 0 {
			return flowerCanonicalContextProjection{}, errors.New("Floret compaction has invalid canonical identity or order")
		}
		projected.CanonicalOrdinal = canonical.CanonicalOrdinal
		compactions = append(compactions, projected)
		if strings.TrimSpace(canonical.AfterItemID) == "" {
			continue
		}
		anchor := FlowerTimelineAnchor{TargetKind: "message", MessageID: canonical.AfterItemID, Edge: "after"}
		decoration := FlowerTimelineDecoration{
			DecorationID: "context-compaction:" + strings.TrimSpace(projected.OperationID),
			Kind:         FlowerTimelineDecorationContextCompaction, Anchor: anchor,
			Ordinal: len(decorations), Compaction: projected, compactionPresent: true,
		}
		if err := decoration.Validate(); err != nil {
			return flowerCanonicalContextProjection{}, err
		}
		decorations = append(decorations, decoration)
	}
	projection.Compactions = compactions
	projection.Decorations = decorations
	return projection, nil
}

func flowerThreadTokenUsageFromFloret(totals *flruntime.ThreadTokenUsageTotals) (*FlowerThreadTokenUsage, error) {
	if totals == nil {
		return nil, nil
	}
	if totals.InputTokens < 0 || totals.OutputTokens < 0 || totals.CacheReadTokens < 0 || totals.CacheWriteTokens < 0 {
		return nil, errors.New("floret thread token usage contains a negative count")
	}
	return &FlowerThreadTokenUsage{
		InputTokens: totals.InputTokens, OutputTokens: totals.OutputTokens,
		CacheReadTokens: totals.CacheReadTokens, CacheWriteTokens: totals.CacheWriteTokens,
	}, nil
}

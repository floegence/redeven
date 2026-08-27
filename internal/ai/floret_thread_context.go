package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flruntime "github.com/floegence/floret/v5/runtime"
)

type flowerCanonicalContextProjection struct {
	Usage       *FlowerContextUsage
	Compactions []FlowerContextCompaction
	Decorations []FlowerTimelineDecoration
}

func (s *Service) readCanonicalThreadContextProjection(ctx context.Context, current flruntime.ThreadView) (flowerCanonicalContextProjection, error) {
	if s == nil || s.threadRuntime == nil {
		return flowerCanonicalContextProjection{}, errors.New("Flower thread runtime is unavailable")
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadContextReader)
	if !ok {
		return flowerCanonicalContextProjection{}, errors.New("published Floret runtime does not expose canonical thread context reads")
	}
	snapshot, err := reader.Context(ctxOrBackground(ctx), current.ThreadID)
	if err != nil {
		return flowerCanonicalContextProjection{}, fmt.Errorf("read canonical Floret thread context: %w", err)
	}
	return flowerThreadContextProjection(snapshot, current)
}

func flowerThreadContextProjection(snapshot flruntime.ThreadContextSnapshot, current flruntime.ThreadView) (flowerCanonicalContextProjection, error) {
	projection := flowerCanonicalContextProjection{}
	if snapshot.Usage != nil {
		usage, err := flowerContextUsageFromFloret(snapshot.Usage)
		if err != nil {
			return flowerCanonicalContextProjection{}, fmt.Errorf("project Floret context usage: %w", err)
		}
		threadUsage, err := flowerThreadTokenUsageFromFloret(snapshot.UsageTotals)
		if err != nil {
			return flowerCanonicalContextProjection{}, fmt.Errorf("project Floret thread token usage: %w", err)
		}
		usage.ThreadUsage = threadUsage
		projection.Usage = &usage
	}
	compactions := make([]FlowerContextCompaction, 0, len(snapshot.Compactions))
	decorations := make([]FlowerTimelineDecoration, 0, len(snapshot.Compactions))
	for _, canonical := range snapshot.Compactions {
		projected, err := flowerContextCompactionFromFloret(&observation.CompactionEvent{
			RunID: canonical.RunID, ThreadID: canonical.ThreadID, TurnID: canonical.TurnID,
			Step: canonical.Step, OperationID: canonical.OperationID, RequestID: canonical.RequestID,
			Phase: observation.CompactionPhase(canonical.Phase), Status: observation.CompactionStatus(canonical.Status),
			Trigger: canonical.Trigger, Reason: canonical.Reason, Source: canonical.Source,
			TokensBefore: canonical.TokensBefore, TokensAfterEstimate: canonical.TokensAfterEstimate,
			Error: canonical.Error, ObservedAt: canonical.ObservedAt,
		})
		if err != nil {
			return flowerCanonicalContextProjection{}, err
		}
		anchor, err := canonicalCompactionTimelineAnchor(current.Items, canonical.TurnID)
		if err != nil {
			return flowerCanonicalContextProjection{}, fmt.Errorf("project Floret compaction %q: %w", canonical.OperationID, err)
		}
		decoration := FlowerTimelineDecoration{
			DecorationID: "context-compaction:" + strings.TrimSpace(projected.OperationID),
			Kind:         FlowerTimelineDecorationContextCompaction, Anchor: anchor,
			Ordinal: len(decorations), Compaction: projected, compactionPresent: true,
		}
		if err := decoration.Validate(); err != nil {
			return flowerCanonicalContextProjection{}, err
		}
		compactions = append(compactions, projected)
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
		return nil, errors.New("Floret thread token usage contains a negative count")
	}
	return &FlowerThreadTokenUsage{
		InputTokens: totals.InputTokens, OutputTokens: totals.OutputTokens,
		CacheReadTokens: totals.CacheReadTokens, CacheWriteTokens: totals.CacheWriteTokens,
	}, nil
}

func canonicalCompactionTimelineAnchor(items []flruntime.ThreadItem, turnID identity.TurnID) (FlowerTimelineAnchor, error) {
	for index := len(items) - 1; index >= 0; index-- {
		item := items[index]
		if item.Kind != flruntime.ThreadItemUser || item.TurnID != turnID || strings.TrimSpace(item.ID) == "" {
			continue
		}
		return FlowerTimelineAnchor{TargetKind: "message", MessageID: strings.TrimSpace(item.ID), Edge: "after"}, nil
	}
	return FlowerTimelineAnchor{}, errors.New("canonical compaction turn has no user message anchor")
}

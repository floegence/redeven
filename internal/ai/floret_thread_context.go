package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/floret/v4/observation"
	flruntime "github.com/floegence/floret/v4/runtime"
)

func (s *Service) readCanonicalThreadContextProjection(ctx context.Context, current flruntime.ThreadView) ([]FlowerContextCompaction, []FlowerTimelineDecoration, error) {
	if s == nil || s.threadRuntime == nil {
		return nil, nil, errors.New("Flower thread runtime is unavailable")
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadContextReader)
	if !ok {
		return nil, nil, errors.New("published Floret runtime does not expose canonical thread context reads")
	}
	snapshot, err := reader.Context(ctxOrBackground(ctx), current.ThreadID)
	if err != nil {
		return nil, nil, fmt.Errorf("read canonical Floret thread context: %w", err)
	}
	return flowerThreadContextProjection(snapshot, current)
}

func flowerThreadContextProjection(snapshot flruntime.ThreadContextSnapshot, current flruntime.ThreadView) ([]FlowerContextCompaction, []FlowerTimelineDecoration, error) {
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
			return nil, nil, err
		}
		anchor, err := canonicalCompactionTimelineAnchor(current.Items, canonical.TurnID)
		if err != nil {
			return nil, nil, fmt.Errorf("project Floret compaction %q: %w", canonical.OperationID, err)
		}
		decoration := FlowerTimelineDecoration{
			DecorationID: "context-compaction:" + strings.TrimSpace(projected.OperationID),
			Kind:         FlowerTimelineDecorationContextCompaction, Anchor: anchor,
			Ordinal: len(decorations), Compaction: projected, compactionPresent: true,
		}
		if err := decoration.Validate(); err != nil {
			return nil, nil, err
		}
		compactions = append(compactions, projected)
		decorations = append(decorations, decoration)
	}
	return compactions, decorations, nil
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

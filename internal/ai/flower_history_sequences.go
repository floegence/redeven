package ai

import (
	"context"
	"errors"
	"slices"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage/spi"
	"github.com/floegence/floret/v7/threadquery"
)

// Explicit bounded windows alone acquire evidence. Ordinary streamed batches
// never run this query. Reuse a maximal range across islands; cap indexed reads
// per baseline, without retries, history materialization or a second observer.
func flowerHistorySequenceGaps(ctx context.Context, runtime flruntime.ThreadService, scope threadquery.Scope, update flruntime.ThreadUpdate, window *FlowerHistoryWindow) error {
	if window.LeafID == "" || update.Window == nil || update.Window.Value == nil {
		return nil
	}
	items := update.Window.Value.Items
	hasGap := false
	for i := 1; i < len(items); i++ {
		if items[i].Ordinal > items[i-1].Ordinal+1 {
			hasGap = true
			break
		}
	}
	if !hasGap {
		return nil
	}
	selected := window.SkippedRange
	var compactions []uint64
	if update.Context != nil && update.Context.Value != nil {
		for _, value := range update.Context.Value.Compactions {
			compactions = append(compactions, value.CanonicalOrdinal)
		}
		slices.Sort(compactions)
	}
	reads := 0
	const exclude = flruntime.ThreadItemRangeUncertainEffect | flruntime.ThreadItemRangeErrorWithoutFailure | flruntime.ThreadItemRangeUnknownActivity | flruntime.ThreadItemRangeDeclined | flruntime.ThreadItemRangeCanceled | flruntime.ThreadItemRangeApproval | flruntime.ThreadItemRangeInputRequired
	eligible := func(item flruntime.ThreadItem) bool {
		return !item.Live && item.CanonicalOrdinal > 0 && (item.Kind == flruntime.ThreadItemTool || item.Kind == flruntime.ThreadItemThinking)
	}
	covers := func(first, last flruntime.ThreadItem) bool {
		if selected == nil || selected.LeafID != window.LeafID || selected.TurnID != first.TurnID || selected.RunID != first.RunID || selected.FirstOrdinal > first.Ordinal || selected.LastOrdinal < last.Ordinal || selected.Facts&exclude != 0 {
			return false
		}
		c := selected.Counts
		a := selected.Activity
		return c.User == 0 && c.Assistant == 0 && c.Interaction == 0 && c.Goal == 0 && c.Steering == 0 && uint64(c.Tool+c.Thinking) == selected.LastOrdinal-selected.FirstOrdinal+1 && a.Pending == 0 && a.Running == 0 && a.Waiting == 0 && a.Unknown == 0 && a.Declined == 0 && a.Canceled == 0
	}
	for i := 1; i < len(items); i++ {
		before, after := items[i-1], items[i]
		if after.Ordinal <= before.Ordinal+1 || !eligible(before) || !eligible(after) || before.TurnID != after.TurnID || before.RunID != after.RunID {
			continue
		}
		// Context is still the canonical baseline here, before host filtering by
		// mounted anchors. A compaction hidden in the gap must remain a boundary.
		position, _ := slices.BinarySearch(compactions, before.CanonicalOrdinal+1)
		if position < len(compactions) && compactions[position] < after.CanonicalOrdinal {
			continue
		}
		if !covers(before, after) {
			if reads == 8 {
				break
			}
			reader, ok := runtime.(flruntime.ThreadItemRangeReader)
			if !ok {
				return errors.New("published Floret range contract is unavailable")
			}
			reads++
			value, err := reader.ItemRange(ctx, scope, flruntime.ThreadItemRangeInput{ThreadID: update.ThreadID, LeafID: window.LeafID, AnchorID: before.ID, Kinds: []flruntime.ThreadItemKind{flruntime.ThreadItemTool, flruntime.ThreadItemThinking}, Exclude: exclude})
			if errors.Is(err, spi.ErrConflict) || errors.Is(err, threadquery.ErrRecordUnavailable) {
				break
			}
			if errors.Is(err, threadquery.ErrInvalidQuery) {
				continue
			}
			if err != nil {
				return err
			}
			selected = &value
		}
		if covers(before, after) {
			window.SequenceGaps = append(window.SequenceGaps, FlowerHistorySequenceGap{BeforeID: before.ID, AfterID: after.ID, First: before.Ordinal + 1, Last: after.Ordinal, TurnID: before.TurnID, RunID: before.RunID})
		}
	}
	return nil
}

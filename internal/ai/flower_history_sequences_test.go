package ai

import (
	"context"
	"fmt"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage/spi"
	"github.com/floegence/floret/v7/threadquery"
)

type sequenceRangeRuntime struct {
	flruntime.ThreadService
	calls int
	read  func(flruntime.ThreadItemRangeInput) (flruntime.ThreadItemRange, error)
}

func (r *sequenceRangeRuntime) ItemRange(_ context.Context, scope threadquery.Scope, input flruntime.ThreadItemRangeInput) (flruntime.ThreadItemRange, error) {
	if scope.Authority != "authorized" || input.ThreadID != "thread" || input.LeafID != "leaf" {
		panic("range lost authorized snapshot")
	}
	r.calls++
	return r.read(input)
}
func sequenceWindow() flruntime.ThreadUpdate {
	items := make([]flruntime.ThreadItem, 0, 150)
	for i := range 150 {
		items = append(items, flruntime.ThreadItem{ID: fmt.Sprint(i*10 + 1), Kind: flruntime.ThreadItemTool, TurnID: "turn", RunID: "run", Ordinal: uint64(i*10 + 1), CanonicalOrdinal: uint64(i*10 + 1)})
	}
	return flruntime.ThreadUpdate{ThreadID: "thread", Window: &flruntime.ThreadComponent[*flruntime.ThreadWindowSnapshot]{Value: &flruntime.ThreadWindowSnapshot{LeafID: "leaf", Items: items}}}
}
func TestFlowerHistorySequenceProofUsesOneIndexedRangeAcrossIslands(t *testing.T) {
	update := sequenceWindow()
	r := &sequenceRangeRuntime{read: func(input flruntime.ThreadItemRangeInput) (flruntime.ThreadItemRange, error) {
		if input.Exclude&flruntime.ThreadItemRangeErrorWithoutFailure == 0 || input.Exclude&flruntime.ThreadItemRangeInputRequired == 0 || input.Exclude&flruntime.ThreadItemRangeUncertainEffect == 0 {
			t.Fatal("classification differs from failed tool sequences")
		}
		return flruntime.ThreadItemRange{LeafID: "leaf", TurnID: "turn", RunID: "run", FirstOrdinal: 1, LastOrdinal: 1491, Counts: flruntime.ThreadItemKindCounts{Tool: 1491}, Activity: flruntime.ThreadItemActivityCounts{Error: 1491}, Facts: flruntime.ThreadItemRangeErrorPayload}, nil
	}}
	w := &FlowerHistoryWindow{LeafID: "leaf"}
	if err := flowerHistorySequenceGaps(t.Context(), r, threadquery.Scope{Authority: "authorized"}, update, w); err != nil {
		t.Fatal(err)
	}
	if r.calls != 1 || len(w.SequenceGaps) != 149 {
		t.Fatalf("reads=%d gaps=%d", r.calls, len(w.SequenceGaps))
	}
}
func TestFlowerHistorySequenceProofBoundsQueriesAndRejectsUnprovenContinuity(t *testing.T) {
	for _, mode := range []string{"prose", "compaction", "conflict", "approval", "active"} {
		t.Run(mode, func(t *testing.T) {
			update := sequenceWindow()
			r := &sequenceRangeRuntime{read: func(input flruntime.ThreadItemRangeInput) (flruntime.ThreadItemRange, error) {
				if mode == "conflict" {
					return flruntime.ThreadItemRange{}, spi.ErrConflict
				}
				v := flruntime.ThreadItemRange{LeafID: "leaf", TurnID: "turn", RunID: "run", FirstOrdinal: 1, LastOrdinal: 1491, Counts: flruntime.ThreadItemKindCounts{Tool: 1491}, Activity: flruntime.ThreadItemActivityCounts{Success: 1491}}
				if mode == "prose" {
					v.Counts.Assistant = 1
					v.Counts.Tool--
				}
				if mode == "approval" {
					v.Facts = flruntime.ThreadItemRangeApproval
				}
				if mode == "active" {
					v.Activity.Running = 1
					v.Activity.Success--
				}
				return v, nil
			}}
			if mode == "compaction" {
				snapshot := &flruntime.ThreadContextSnapshot{}
				for i := range 149 {
					snapshot.Compactions = append(snapshot.Compactions, flruntime.ThreadContextCompaction{CanonicalOrdinal: uint64(i*10 + 5)})
				}
				update.Context = &flruntime.ThreadComponent[*flruntime.ThreadContextSnapshot]{Value: snapshot}
			}
			w := &FlowerHistoryWindow{LeafID: "leaf"}
			if err := flowerHistorySequenceGaps(t.Context(), r, threadquery.Scope{Authority: "authorized"}, update, w); err != nil {
				t.Fatal(err)
			}
			if len(w.SequenceGaps) != 0 || r.calls > 8 {
				t.Fatalf("reads=%d gaps=%d", r.calls, len(w.SequenceGaps))
			}
			if mode == "compaction" && r.calls != 0 || mode == "conflict" && r.calls != 1 {
				t.Fatal("unexpected query or conflict retry")
			}
		})
	}
}

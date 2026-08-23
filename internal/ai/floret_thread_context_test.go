package ai

import (
	"testing"
	"time"

	"github.com/floegence/floret/v5/config"
	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flruntime "github.com/floegence/floret/v5/runtime"
)

func TestFlowerThreadContextProjectionRestoresOneTerminalCompactionDivider(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	threadID := identity.ThreadID("thread-context")
	turnID := identity.TurnID("turn-context")
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: threadID, TurnID: turnID, Step: 1,
			OperationID: "compact-operation", RequestID: "compact-request",
			Phase: "noop", Status: "noop", Trigger: "manual", Reason: "manual",
			Source: flowerManualCompactionSourceName, TokensBefore: 6354, ObservedAt: observedAt,
		}},
	}, flruntime.ThreadView{ThreadID: threadID, Items: []flruntime.ThreadItem{
		{ID: "message-before", Kind: flruntime.ThreadItemUser, TurnID: "turn-before"},
		{ID: "message-compact", Kind: flruntime.ThreadItemUser, TurnID: turnID},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Compactions) != 1 || len(projection.Decorations) != 1 {
		t.Fatalf("compactions=%#v decorations=%#v", projection.Compactions, projection.Decorations)
	}
	if got := projection.Compactions[0]; got.OperationID != "compact-operation" || got.Status != "noop" || got.UpdatedAtMs != observedAt.UnixMilli() {
		t.Fatalf("compaction=%#v", got)
	}
	if got := projection.Decorations[0]; got.DecorationID != "context-compaction:compact-operation" || got.Anchor.MessageID != "message-compact" || got.Anchor.Edge != "after" {
		t.Fatalf("decoration=%#v", got)
	}
}

func TestFlowerThreadContextProjectionIncludesCanonicalUsage(t *testing.T) {
	observedAt := time.Unix(1_723_800_000, 0).UTC()
	projection, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Usage: &observation.ContextStatus{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-context", Step: 2,
			Phase: observation.ContextPhaseProviderUsage, ObservedAt: observedAt,
			Usage:           observation.ProviderUsage{WindowInputTokens: 500},
			ContextPressure: config.ContextPressure{ContextWindowTokens: 1000},
			UsedRatio:       0.5, Status: observation.ContextStatusStable,
		},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err != nil {
		t.Fatal(err)
	}
	if projection.Usage == nil || projection.Usage.InputTokens != 500 || projection.Usage.ContextWindowTokens != 1000 || projection.Usage.UpdatedAtMs != observedAt.UnixMilli() {
		t.Fatalf("usage=%#v", projection.Usage)
	}
}

func TestFlowerThreadContextProjectionFailsClosedWithoutCanonicalAnchor(t *testing.T) {
	_, err := flowerThreadContextProjection(flruntime.ThreadContextSnapshot{
		Compactions: []flruntime.ThreadContextCompaction{{
			RunID: "run-context", ThreadID: "thread-context", TurnID: "turn-missing",
			OperationID: "compact-operation", RequestID: "compact-request",
			Phase: "noop", Status: "noop", Source: flowerManualCompactionSourceName, ObservedAt: time.Now(),
		}},
	}, flruntime.ThreadView{ThreadID: "thread-context"})
	if err == nil {
		t.Fatal("missing canonical message anchor must fail closed")
	}
}

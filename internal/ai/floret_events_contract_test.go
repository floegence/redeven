package ai

import (
	"context"
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

func TestValidateFloretRuntimeEventRequiresConfiguredProductAssociation(t *testing.T) {
	t.Parallel()

	r := &run{}
	r.expectFloretRuntimeEventIdentity("run-1", "thread-1", "turn-1", true)
	valid := flruntime.Event{
		Type:     observation.EventTypeStepStart,
		RunID:    "run-1",
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Step:     1,
	}
	if err := r.validateFloretRuntimeEvent(valid); err != nil {
		t.Fatalf("validate matching event: %v", err)
	}
	wrongRun := valid
	wrongRun.RunID = "run-2"
	if err := r.validateFloretRuntimeEvent(wrongRun); err == nil {
		t.Fatal("event from another run was accepted")
	}
	wrongThread := valid
	wrongThread.ThreadID = "thread-2"
	if err := r.validateFloretRuntimeEvent(wrongThread); err == nil {
		t.Fatal("event from another thread was accepted")
	}

	r.expectFloretRuntimeEventIdentity("", "thread-1", "", false)
	standaloneCompaction := valid
	standaloneCompaction.RunID = "floret-generated-run"
	standaloneCompaction.TurnID = ""
	if err := r.validateFloretRuntimeEvent(standaloneCompaction); err != nil {
		t.Fatalf("validate standalone compaction association: %v", err)
	}
}

func TestFloretEventSinkStartsLiveDraftAfterCanonicalIdentityValidation(t *testing.T) {
	t.Parallel()

	var events []any
	r := newRun(runOptions{
		RunID:     "run-live-admission",
		ThreadID:  "thread-live-admission",
		MessageID: "turn-live-admission",
		OnStreamEvent: func(event any) {
			events = append(events, event)
		},
	})
	r.expectFloretRuntimeEventIdentity("run-live-admission", "thread-live-admission", "turn-live-admission", true)

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeThreadEntryCommitted,
		RunID:    "run-live-admission",
		ThreadID: "thread-live-admission",
		TurnID:   "turn-live-admission",
		Committed: &flruntime.ThreadDetailEvent{
			ID:       "entry-live-admission",
			ThreadID: "thread-live-admission",
			TurnID:   "turn-live-admission",
			RunID:    "run-live-admission",
			Kind:     flruntime.ThreadDetailEventUserMessage,
		},
	})
	if len(events) != 2 {
		t.Fatalf("validated event emitted %d live-start events, want 2", len(events))
	}

	var rejectedEvents []any
	rejected := newRun(runOptions{
		RunID:     "run-live-admission",
		ThreadID:  "thread-live-admission",
		MessageID: "turn-live-admission",
		OnStreamEvent: func(event any) {
			rejectedEvents = append(rejectedEvents, event)
		},
	})
	rejected.expectFloretRuntimeEventIdentity("run-live-admission", "thread-live-admission", "turn-live-admission", true)
	floretEventSink{run: rejected}.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeStepStart,
		RunID:    "other-run",
		ThreadID: "thread-live-admission",
		TurnID:   "turn-live-admission",
		Step:     1,
	})
	if len(rejectedEvents) != 0 {
		t.Fatalf("mismatched event created live draft events: %#v", rejectedEvents)
	}
	if rejected.floretContractError() == nil {
		t.Fatal("mismatched event did not abort Floret contract processing")
	}
}

func TestFloretEventSinkCancelsRunAfterContractRejection(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	r := &run{
		id:        "run-1",
		threadID:  "thread-1",
		messageID: "turn-1",
		cancelFn:  cancel,
	}

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     observation.EventType("assistant_delta"),
		RunID:    "run-other",
		ThreadID: "thread-1",
		TurnID:   "turn-1",
	})

	select {
	case <-ctx.Done():
	default:
		t.Fatal("malformed Floret event did not cancel the active run context")
	}
}

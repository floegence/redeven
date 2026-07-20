package ai

import (
	"context"
	"errors"
	"testing"
	"time"

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

func TestValidateFloretRuntimeEventAcceptsCanonicalTitleLifecycleIdentity(t *testing.T) {
	t.Parallel()

	r := &run{}
	r.expectFloretRuntimeEventIdentity("run-1", "thread-1", "turn-1", true)
	titleEvent := flruntime.Event{
		Type:     observation.EventTypeThreadTitleUpdated,
		ThreadID: "thread-1",
		TurnID:   "turn-1",
		Message:  "Canonical title",
	}
	if err := r.validateFloretRuntimeEvent(titleEvent); err != nil {
		t.Fatalf("validate canonical title event: %v", err)
	}

	wrongTurn := titleEvent
	wrongTurn.TurnID = "turn-2"
	if err := r.validateFloretRuntimeEvent(wrongTurn); err == nil {
		t.Fatal("title event from another turn was accepted")
	}
	wrongRun := titleEvent
	wrongRun.RunID = "run-2"
	if err := r.validateFloretRuntimeEvent(wrongRun); err == nil {
		t.Fatal("title event from another run was accepted")
	}

	manualTitleEvent := titleEvent
	manualTitleEvent.TurnID = ""
	if err := r.validateFloretRuntimeEvent(manualTitleEvent); err != nil {
		t.Fatalf("validate thread-scoped manual title event: %v", err)
	}
}

func TestFloretEventSinkStartsLiveDraftAfterCanonicalIdentityValidation(t *testing.T) {
	t.Parallel()

	var events []any
	var admissionSteps []string
	r := newRun(runOptions{
		RunID:     "run-live-admission",
		ThreadID:  "thread-live-admission",
		TurnID:    "turn-live-admission",
		MessageID: "turn-live-admission",
		HostCapabilities: runHostCapabilities{
			broadcastThreadSummary: func() error {
				admissionSteps = append(admissionSteps, "thread_snapshot")
				return nil
			},
			replaceLiveDraftWithCanonicalTimeline: func(context.Context, string, string, string, string) error {
				admissionSteps = append(admissionSteps, "canonical_timeline")
				return nil
			},
		},
		OnStreamEvent: func(event any) {
			events = append(events, event)
		},
	})
	r.awaitFloretAdmission.Store(true)
	r.expectFloretRuntimeEventIdentity("run-live-admission", "thread-live-admission", "turn-live-admission", true)

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeThreadEntryCommitted,
		RunID:    "run-live-admission",
		ThreadID: "thread-live-admission",
		TurnID:   "turn-live-admission",
		Committed: &flruntime.ThreadDetailEvent{
			ID: "entry-live-admission", ThreadID: "thread-live-admission", TurnID: "turn-live-admission", RunID: "run-live-admission",
			Kind: flruntime.ThreadDetailEventUserMessage, CreatedAt: time.Now(),
			Message: &flruntime.ThreadDetailMessage{Role: "user", Content: "canonical input"},
		},
	})
	admitted, err := r.waitForUserTurnAdmission(context.Background())
	if err != nil || admitted.TurnID != "turn-live-admission" || admitted.RunID != "run-live-admission" {
		t.Fatalf("admission outcome=%#v err=%v", admitted, err)
	}
	if len(admissionSteps) != 2 || admissionSteps[0] != "thread_snapshot" || admissionSteps[1] != "canonical_timeline" {
		t.Fatalf("admission steps=%#v", admissionSteps)
	}
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

func TestFloretEventSinkReturnsAdmittedIdentityWithoutPublishingAssistantWhenCanonicalPresentationFails(t *testing.T) {
	t.Parallel()

	var events []any
	presentationErr := errors.New("canonical timeline unavailable")
	r := newRun(runOptions{
		RunID:     "run-presentation-failure",
		ThreadID:  "thread-presentation-failure",
		TurnID:    "turn-presentation-failure",
		MessageID: "turn-presentation-failure",
		HostCapabilities: runHostCapabilities{
			broadcastThreadSummary: func() error { return nil },
			replaceLiveDraftWithCanonicalTimeline: func(context.Context, string, string, string, string) error {
				return presentationErr
			},
		},
		OnStreamEvent: func(event any) { events = append(events, event) },
	})
	r.awaitFloretAdmission.Store(true)
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, r.turnID, true)

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type: observation.EventTypeThreadEntryCommitted, RunID: flruntime.RunID(r.id), ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID),
		Committed: &flruntime.ThreadDetailEvent{
			ID: "entry-presentation-failure", ThreadID: flruntime.ThreadID(r.threadID), TurnID: flruntime.TurnID(r.turnID), RunID: flruntime.RunID(r.id),
			Kind: flruntime.ThreadDetailEventUserMessage, CreatedAt: time.Now(),
			Message: &flruntime.ThreadDetailMessage{Role: "user", Content: "canonical input"},
		},
	})

	admitted, err := r.waitForUserTurnAdmission(context.Background())
	if err != nil || admitted.TurnID != r.turnID || admitted.RunID != r.id {
		t.Fatalf("admission outcome=%#v err=%v", admitted, err)
	}
	if len(events) != 0 {
		t.Fatalf("presentation failure published assistant events: %#v", events)
	}
	if !r.floretAdmitted.Load() || r.floretPresentationReady.Load() {
		t.Fatalf("admitted=%t presentation_ready=%t", r.floretAdmitted.Load(), r.floretPresentationReady.Load())
	}
	if contractErr := r.floretContractError(); contractErr == nil || !errors.Is(contractErr, presentationErr) {
		t.Fatalf("contract error=%v, want %v", contractErr, presentationErr)
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

package ai

import (
	"context"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

func TestFloretEngineLifecycleEventsAreNotMirroredToProductRunEvents(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := &session.Meta{EndpointID: "env_typed_reasons", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := svc.CreateThread(ctx, meta, "typed reasons", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	r := &run{
		id:               "run_typed_reasons",
		endpointID:       meta.EndpointID,
		threadID:         thread.ThreadID,
		messageID:        "turn_typed_reasons",
		threadsDB:        svc.threadsDB,
		persistOpTimeout: time.Second,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		Type:             observation.EventTypeStepEnd,
		RunID:            flruntime.RunID(r.id),
		ThreadID:         flruntime.ThreadID(thread.ThreadID),
		TurnID:           flruntime.TurnID(r.messageID),
		Step:             1,
		FinishReason:     observation.FinishReasonStop,
		RawFinishReason:  "end_turn",
		FinishInferred:   true,
		CompletionReason: observation.CompletionReasonNaturalStop,
		Metadata: map[string]any{
			"completion_reason":   "hook_stop",
			"continuation_reason": "hook",
		},
	})
	sink.EmitEvent(flruntime.Event{
		Type:               observation.EventTypeContextContinue,
		RunID:              flruntime.RunID(r.id),
		ThreadID:           flruntime.ThreadID(thread.ThreadID),
		TurnID:             flruntime.TurnID(r.messageID),
		Step:               1,
		ContinuationReason: observation.ContinuationReasonHook,
	})

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, r.id, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("engine lifecycle events were mirrored into product run events: %#v", events)
	}
}

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

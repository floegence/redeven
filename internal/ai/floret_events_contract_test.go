package ai

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

func TestFloretLifecycleEventsUseTypedReasonsInsteadOfMetadata(t *testing.T) {
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
		threadsDB:        svc.threadsDB,
		persistOpTimeout: time.Second,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{
		Type:             observation.EventTypeStepEnd,
		RunID:            flruntime.RunID(r.id),
		ThreadID:         flruntime.ThreadID(thread.ThreadID),
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
		Type:     observation.EventTypeContextContinue,
		RunID:    flruntime.RunID(r.id),
		ThreadID: flruntime.ThreadID(thread.ThreadID),
		Metadata: map[string]any{"continuation_reason": "hook"},
	})

	events, err := svc.threadsDB.ListRunEvents(ctx, meta.EndpointID, r.id, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %#v", events)
	}
	var stepPayload map[string]any
	if err := json.Unmarshal([]byte(events[0].PayloadJSON), &stepPayload); err != nil {
		t.Fatal(err)
	}
	if stepPayload["finish_reason"] != "stop" || stepPayload["raw_finish_reason"] != "end_turn" || stepPayload["finish_inferred"] != true || stepPayload["completion_reason"] != "natural_stop" || stepPayload["continuation_reason"] != "" {
		t.Fatalf("step payload = %#v", stepPayload)
	}
	var continuePayload map[string]any
	if err := json.Unmarshal([]byte(events[1].PayloadJSON), &continuePayload); err != nil {
		t.Fatal(err)
	}
	if continuePayload["continuation_reason"] != "" {
		t.Fatalf("metadata-only continuation leaked into payload: %#v", continuePayload)
	}
}

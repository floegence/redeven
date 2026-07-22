package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
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
		RunID:    "run-1",
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
	manualTitleEvent.RunID = ""
	manualTitleEvent.TurnID = ""
	if err := r.validateFloretRuntimeEvent(manualTitleEvent); err != nil {
		t.Fatalf("validate thread-scoped manual title event: %v", err)
	}

	pendingTitleEvent := titleEvent
	pendingTitleEvent.Type = observation.EventTypeThreadTitlePending
	pendingTitleEvent.Message = ""
	if err := r.validateFloretRuntimeEvent(pendingTitleEvent); err != nil {
		t.Fatalf("validate canonical pending title event: %v", err)
	}

	partialIdentity := titleEvent
	partialIdentity.RunID = ""
	if err := r.validateFloretRuntimeEvent(partialIdentity); err == nil {
		t.Fatal("title event with partial execution identity was accepted")
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

func TestFloretEventSinkPublishesCanonicalEmptyApprovalQueueAfterDetach(t *testing.T) {
	t.Parallel()

	host := &recordingFloretHost{approvalQueue: flruntime.ApprovalQueue{
		RootThreadID: "thread-detached-approval",
		Generation:   2,
		Revision:     4,
		Items:        []flruntime.ApprovalRecord{},
		GeneratedAt:  time.Now(),
	}}
	var events []any
	var stateBroadcasts, summaryBroadcasts int
	r := newRun(runOptions{
		RunID:     "run-detached-approval",
		ThreadID:  "thread-detached-approval",
		TurnID:    "turn-detached-approval",
		MessageID: "turn-detached-approval",
		HostCapabilities: runHostCapabilities{
			authorityThreadID: "thread-detached-approval",
			broadcastThreadState: func(string, string, string, string) {
				stateBroadcasts++
			},
			broadcastThreadSummary: func() error {
				summaryBroadcasts++
				return nil
			},
		},
		OnStreamEvent: func(event any) { events = append(events, event) },
	})
	r.setActiveFloretHost(host)
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, r.turnID, true)
	r.markDetached()

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeToolApprovalCanceled,
		RunID:    flruntime.RunID(r.id),
		ThreadID: flruntime.ThreadID(r.threadID),
		TurnID:   flruntime.TurnID(r.turnID),
		ToolID:   "tool-canceled",
		ToolName: "terminal.exec",
	})

	if len(events) != 1 {
		t.Fatalf("detached approval events=%#v, want one canonical queue replacement", events)
	}
	queueEvent, ok := events[0].(streamEventApprovalQueue)
	if !ok || len(queueEvent.Actions) != 0 || queueEvent.ApprovalQueue.Generation != 2 || queueEvent.ApprovalQueue.Revision != 4 {
		t.Fatalf("detached approval event=%T %#v", events[0], events[0])
	}
	if queueEvent.Actions == nil {
		t.Fatal("detached approval event actions must be an explicit empty slice")
	}
	r.sendStreamEvent(streamEventBlockDelta{Type: "text-delta", MessageID: r.messageID, BlockIndex: 0, Delta: "must stay hidden"})
	if len(events) != 1 {
		t.Fatalf("detached non-authoritative presentation leaked: %#v", events)
	}
	if stateBroadcasts != 0 || summaryBroadcasts != 0 {
		t.Fatalf("detached queue replacement broadcast state=%d summary=%d", stateBroadcasts, summaryBroadcasts)
	}
}

func TestFlowerLiveStreamProjectionEncodesCanonicalEmptyApprovalQueueAsArray(t *testing.T) {
	t.Parallel()

	events := (&Service{}).flowerLiveEventsFromStreamEvent(RealtimeEvent{
		EventType: RealtimeEventTypeStream,
		StreamEvent: streamEventApprovalQueue{
			Type:    "approval-queue",
			Actions: []FlowerApprovalAction{},
			ApprovalQueue: FlowerApprovalQueue{
				Generation: 2,
				Revision:   4,
			},
		},
	}, func(kind FlowerLiveKind, payload any) FlowerLiveEvent {
		return FlowerLiveEvent{Kind: kind, Payload: mustFlowerPayload(payload)}
	})
	if len(events) != 1 || events[0].Kind != FlowerLiveApprovalQueueReplaced {
		t.Fatalf("live events=%#v, want one canonical queue replacement", events)
	}
	raw := string(events[0].Payload)
	if !strings.Contains(raw, `"actions":[]`) || strings.Contains(raw, `"actions":null`) {
		t.Fatalf("canonical empty stream replacement must encode actions as an array: %s", raw)
	}
}

func TestApprovalThreadStateAggregatesCanonicalQueueAndControlConfirmation(t *testing.T) {
	t.Parallel()

	var statuses []string
	r := newRun(runOptions{
		EndpointID: "env-approval-state",
		RunID:      "run-approval-state",
		ThreadID:   "thread-approval-state",
		HostCapabilities: runHostCapabilities{
			broadcastThreadState: func(_ string, status string, _ string, _ string) {
				statuses = append(statuses, status)
			},
			broadcastThreadSummary: func() error { return nil },
		},
	})
	r.mu.Lock()
	r.toolApprovals["control-1"] = &toolApprovalRequest{decision: make(chan bool, 1)}
	r.mu.Unlock()

	r.publishThreadApprovalStateForCanonicalQueue(nil)
	r.mu.Lock()
	r.toolApprovals["control-1"].resolved = true
	r.mu.Unlock()
	r.publishThreadApprovalStateForCanonicalQueue([]FlowerApprovalAction{{ActionID: "canonical-1"}})
	r.publishThreadApprovalStateForCanonicalQueue(nil)
	r.markDetached()
	r.publishThreadApprovalStateForCanonicalQueue([]FlowerApprovalAction{{ActionID: "canonical-detached"}})

	want := []string{string(RunStateWaitingApproval), string(RunStateWaitingApproval), string(RunStateRunning)}
	if !reflect.DeepEqual(statuses, want) {
		t.Fatalf("approval state broadcasts=%#v, want %#v", statuses, want)
	}

	var raced *run
	var racedStatuses []string
	raced = newRun(runOptions{
		EndpointID: "env-approval-race",
		RunID:      "run-approval-race",
		ThreadID:   "thread-approval-race",
		HostCapabilities: runHostCapabilities{
			broadcastThreadState: func(_ string, status string, _ string, _ string) {
				racedStatuses = append(racedStatuses, status)
				if status == string(RunStateRunning) {
					raced.mu.Lock()
					raced.toolApprovals["control-race"] = &toolApprovalRequest{decision: make(chan bool, 1)}
					raced.mu.Unlock()
				}
			},
			broadcastThreadSummary: func() error { return nil },
		},
	})
	raced.publishThreadApprovalStateForCanonicalQueue(nil)
	if wantRace := []string{string(RunStateRunning), string(RunStateWaitingApproval)}; !reflect.DeepEqual(racedStatuses, wantRace) {
		t.Fatalf("raced approval state broadcasts=%#v, want %#v", racedStatuses, wantRace)
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

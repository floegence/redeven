package ai

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v3/identity"
	"github.com/floegence/floret/v3/observation"
	flruntime "github.com/floegence/floret/v3/runtime"
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

func TestFloretEventSinkStartsLiveDraftOnlyAfterReceiptAdmissionPresentation(t *testing.T) {
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

	waitCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	admitted, err := r.waitForUserTurnAdmission(waitCtx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) || admitted != (admittedUserTurn{}) {
		t.Fatalf("event-only admission outcome=%#v err=%v, want deadline waiting for receipt", admitted, err)
	}
	if len(admissionSteps) != 0 || len(events) != 0 || r.floretAdmitted.Load() || r.floretPresentationReady.Load() {
		t.Fatalf("event-only admission steps=%#v events=%#v admitted=%t ready=%t", admissionSteps, events, r.floretAdmitted.Load(), r.floretPresentationReady.Load())
	}

	if err := r.bindFloretCanonicalAdmissionReceipt("logical-live-admission", flruntime.AdmitTurnResult{
		ThreadID:    "thread-live-admission",
		TurnID:      "turn-live-admission",
		RunID:       "run-live-admission",
		UserEntryID: "entry-live-admission",
		Receipt: flruntime.TurnAdmissionReceipt{
			LogicalRequestID: "logical-live-admission",
			ThreadID:         "thread-live-admission",
			TurnID:           "turn-live-admission",
			RunID:            "run-live-admission",
			UserEntryID:      "entry-live-admission",
			Revision:         1,
		},
	}, flruntime.TurnInput{Text: "canonical input"}); err != nil {
		t.Fatalf("bind receipt admission: %v", err)
	}
	r.floretAdmitted.Store(true)
	if err := r.publishCanonicalUserAdmission(); err != nil {
		t.Fatalf("publish receipt admission: %v", err)
	}
	r.floretPresentationReady.Store(true)
	r.completeUserTurnAdmission(nil)

	admitted, err = r.waitForUserTurnAdmission(context.Background())
	if err != nil || admitted.TurnID != "turn-live-admission" || admitted.RunID != "run-live-admission" {
		t.Fatalf("receipt admission outcome=%#v err=%v", admitted, err)
	}
	if len(admissionSteps) != 2 || admissionSteps[0] != "thread_snapshot" || admissionSteps[1] != "canonical_timeline" {
		t.Fatalf("admission steps=%#v", admissionSteps)
	}
	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     observation.EventTypeProviderDelta,
		RunID:    "run-live-admission",
		ThreadID: "thread-live-admission",
		TurnID:   "turn-live-admission",
		Stream:   &flruntime.StreamObservation{Type: flruntime.StreamObservationAssistantDelta, Text: "answer"},
	})
	if len(events) != 2 {
		t.Fatalf("post-admission delta emitted %d live-start events, want 2", len(events))
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
		RunID:    identity.RunID(r.id),
		ThreadID: identity.ThreadID(r.threadID),
		TurnID:   identity.TurnID(r.turnID),
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
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, "turn-approval-state", true)
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
	raced.expectFloretRuntimeEventIdentity(raced.id, raced.threadID, "turn-approval-race", true)
	raced.publishThreadApprovalStateForCanonicalQueue(nil)
	if wantRace := []string{string(RunStateRunning), string(RunStateWaitingApproval)}; !reflect.DeepEqual(racedStatuses, wantRace) {
		t.Fatalf("raced approval state broadcasts=%#v, want %#v", racedStatuses, wantRace)
	}
}

func TestReceiptAdmissionPresentationFailureDoesNotPublishAssistant(t *testing.T) {
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

	if err := r.bindFloretCanonicalAdmissionReceipt("logical-presentation-failure", flruntime.AdmitTurnResult{
		ThreadID:    identity.ThreadID(r.threadID),
		TurnID:      identity.TurnID(r.turnID),
		RunID:       identity.RunID(r.id),
		UserEntryID: "entry-presentation-failure",
		Receipt: flruntime.TurnAdmissionReceipt{
			LogicalRequestID: "logical-presentation-failure",
			ThreadID:         identity.ThreadID(r.threadID),
			TurnID:           identity.TurnID(r.turnID),
			RunID:            identity.RunID(r.id),
			UserEntryID:      "entry-presentation-failure",
			Revision:         1,
		},
	}, flruntime.TurnInput{Text: "canonical input"}); err != nil {
		t.Fatalf("bind receipt admission: %v", err)
	}
	r.floretAdmitted.Store(true)
	if err := r.publishCanonicalUserAdmission(); !errors.Is(err, presentationErr) {
		t.Fatalf("presentation error=%v, want %v", err, presentationErr)
	} else {
		r.completeUserTurnAdmission(err)
	}
	if len(events) != 0 {
		t.Fatalf("presentation failure published assistant events: %#v", events)
	}
	if !r.floretAdmitted.Load() || r.floretPresentationReady.Load() {
		t.Fatalf("admitted=%t presentation_ready=%t", r.floretAdmitted.Load(), r.floretPresentationReady.Load())
	}
	admitted, err := r.waitForUserTurnAdmission(context.Background())
	if !errors.Is(err, presentationErr) || admitted != (admittedUserTurn{}) {
		t.Fatalf("admission outcome=%#v err=%v, want presentation error", admitted, err)
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

func TestFloretProviderAttemptActivationPreservesCanonicalToolPrefixAndFencesStaleSuffix(t *testing.T) {
	const (
		runID     = "run-tool-continuity"
		threadID  = "thread-tool-continuity"
		turnID    = "turn-tool-continuity"
		messageID = "assistant-tool-continuity"
	)
	var events []any
	r := newRun(runOptions{
		RunID: runID, ThreadID: threadID, TurnID: turnID, MessageID: messageID,
		OnStreamEvent: func(event any) { events = append(events, event) },
	})
	if err := r.observeFloretCanonicalIdentity(runID, threadID, turnID); err != nil {
		t.Fatal(err)
	}

	accepted, err := r.activateFloretProviderAttempt(map[string]any{
		"logical_request_id": "logical-1",
		"attempt_id":         "logical-1:attempt:1",
		"attempt_epoch":      1,
	})
	if err != nil || !accepted {
		t.Fatalf("activate first attempt accepted=%v err=%v", accepted, err)
	}
	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: threadID, TurnID: turnID, RunID: runID, TraceID: runID,
		Status: flruntime.TurnStatusRunning, ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionTimeline(runID, threadID, turnID, "tool-1", "terminal.exec"),
		}},
	}) {
		t.Fatal("canonical tool projection was not applied")
	}

	events = nil
	accepted, err = r.activateFloretProviderAttempt(map[string]any{
		"logical_request_id": "logical-1",
		"attempt_id":         "logical-1:attempt:2",
		"attempt_epoch":      2,
	})
	if err != nil || !accepted {
		t.Fatalf("activate next provider step accepted=%v err=%v", accepted, err)
	}
	r.muAssistant.Lock()
	if len(r.assistantBlocks) != 1 {
		r.muAssistant.Unlock()
		t.Fatalf("next provider step discarded canonical tool prefix: %#v", r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		r.muAssistant.Unlock()
		t.Fatalf("assistantBlocks[0]=%T, want canonical activity", r.assistantBlocks[0])
	}
	r.muAssistant.Unlock()
	if r.nextBlockIndex != 1 {
		t.Fatalf("nextBlockIndex=%d, want append after canonical prefix", r.nextBlockIndex)
	}
	if len(events) != 1 {
		t.Fatalf("activation events=%#v, want only message start when canonical prefix is unchanged", events)
	}
	if started, ok := events[0].(streamEventMessageStart); !ok || started.AttemptEpoch != 2 {
		t.Fatalf("activation event=%T %#v, want epoch 2 message start", events[0], events[0])
	}

	stale := &flruntime.StreamObservation{
		Type:             flruntime.StreamObservationAssistantDelta,
		Text:             "stale output",
		LogicalRequestID: "logical-1",
		AttemptID:        "logical-1:attempt:1",
		AttemptEpoch:     1,
	}
	if r.acceptsFloretStreamAttempt(stale) {
		t.Fatal("stale attempt stream was accepted")
	}
	if err := r.appendThinkingDelta("continuing after tool"); err != nil {
		t.Fatal(err)
	}
	if err := r.appendTextDelta("final live answer"); err != nil {
		t.Fatal(err)
	}
	r.muAssistant.Lock()
	if len(r.assistantBlocks) != 3 {
		r.muAssistant.Unlock()
		t.Fatalf("assistantBlocks=%#v, want activity, thinking, and markdown", r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[1].(*persistedThinkingBlock); !ok {
		r.muAssistant.Unlock()
		t.Fatalf("assistantBlocks[1]=%T, want thinking appended after activity", r.assistantBlocks[1])
	}
	if block, ok := r.assistantBlocks[2].(*persistedMarkdownBlock); !ok || block.Content != "final live answer" {
		r.muAssistant.Unlock()
		t.Fatalf("assistantBlocks[2]=%T %#v, want live markdown", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	r.muAssistant.Unlock()

	events = nil
	accepted, err = r.activateFloretProviderAttempt(map[string]any{
		"logical_request_id": "logical-1",
		"attempt_id":         "logical-1:attempt:3",
		"attempt_epoch":      3,
	})
	if err != nil || !accepted {
		t.Fatalf("activate retry accepted=%v err=%v", accepted, err)
	}
	r.muAssistant.Lock()
	if len(r.assistantBlocks) != 1 {
		r.muAssistant.Unlock()
		t.Fatalf("retry did not discard only the transient suffix: %#v", r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		r.muAssistant.Unlock()
		t.Fatalf("retry discarded canonical activity: %#v", r.assistantBlocks)
	}
	r.muAssistant.Unlock()
	if len(events) != 3 {
		t.Fatalf("retry activation events=%#v, want message start and two suffix clears", events)
	}
	for index, wantBlockIndex := range []int{1, 2} {
		cleared, ok := events[index+1].(streamEventBlockSet)
		if !ok || cleared.BlockIndex != wantBlockIndex {
			t.Fatalf("retry clear event %d=%T %#v, want block %d", index, events[index+1], events[index+1], wantBlockIndex)
		}
	}
	if err := r.appendTextDelta("retried answer"); err != nil {
		t.Fatal(err)
	}
	r.muAssistant.Lock()
	if len(r.assistantBlocks) != 2 {
		r.muAssistant.Unlock()
		t.Fatalf("retried output did not append after canonical prefix: %#v", r.assistantBlocks)
	}
	if block, ok := r.assistantBlocks[1].(*persistedMarkdownBlock); !ok || block.Content != "retried answer" {
		r.muAssistant.Unlock()
		t.Fatalf("retried assistantBlocks[1]=%T %#v", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	r.muAssistant.Unlock()

	accepted, err = r.activateFloretProviderAttempt(map[string]any{
		"logical_request_id": "logical-1",
		"attempt_id":         "logical-1:attempt:2",
		"attempt_epoch":      2,
	})
	if err != nil || accepted {
		t.Fatalf("stale provider attempt accepted=%v err=%v, want dropped", accepted, err)
	}

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: threadID, TurnID: turnID, RunID: runID, TraceID: runID,
		Status: flruntime.TurnStatusCompleted, ThroughOrdinal: 2,
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{
				Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
				ActivityTimeline: floretProjectionTimeline(runID, threadID, turnID, "tool-1", "terminal.exec"),
			},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "canonical final answer"},
		},
	}) {
		t.Fatal("terminal canonical projection was not applied")
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("terminal assistantBlocks=%#v, want one activity and one answer", r.assistantBlocks)
	}
	activity, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok || len(activity.Items) != 1 || activity.Items[0].ToolID != "tool-1" {
		t.Fatalf("terminal activity=%T %#v, want one canonical tool row", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if answer, ok := r.assistantBlocks[1].(*persistedMarkdownBlock); !ok || answer.Content != "canonical final answer" {
		t.Fatalf("terminal answer=%T %#v", r.assistantBlocks[1], r.assistantBlocks[1])
	}
}

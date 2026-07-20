package ai

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/config"
)

type floretModelGatewayFunc func(context.Context, flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error)

func (f floretModelGatewayFunc) StreamModel(ctx context.Context, req flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
	return f(ctx, req)
}

type capturingFloretEventSink struct {
	mu         sync.Mutex
	events     []flruntime.Event
	downstream flruntime.EventSink
}

func (s *capturingFloretEventSink) EmitEvent(ev flruntime.Event) {
	s.mu.Lock()
	s.events = append(s.events, ev)
	s.mu.Unlock()
	if s.downstream != nil {
		s.downstream.EmitEvent(ev)
	}
}

func (s *capturingFloretEventSink) snapshot() []flruntime.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]flruntime.Event(nil), s.events...)
}

type blockingProjectionToolArgs struct {
	Value string `json:"value"`
}

func TestFloretThreadProjectionPersistsFullAssistantContentAfterActivity(t *testing.T) {
	const fullAnswer = "Here is the complete Redeven summary.\n\n- **Gateway** - `redeven-gateway` exposes the full gateway contract through OpenAPI.\n\nWhich part of Redeven would you like to explore next?"
	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_full_projection"
	r.threadID = "thread_full_projection"
	r.messageID = "msg_full_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_full_projection",
		TurnID:         "msg_full_projection",
		RunID:          "run_full_projection",
		TraceID:        "run_full_projection",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{
				Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
				ActivityTimeline: floretProjectionTimeline("run_full_projection", "thread_full_projection", "msg_full_projection", "call-okf", "okf.open"),
			},
			{
				Kind: flruntime.ThreadTurnProjectionSegmentAssistantText,
				Text: fullAnswer,
			},
		},
	}) {
		t.Fatalf("projection returned false")
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want activity plus final markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	block, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || block.Content != fullAnswer {
		t.Fatalf("assistantBlocks[1]=%T %+v, want full markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != fullAnswer {
		t.Fatalf("assistantText=%q, want full answer", assistantText)
	}
	var msg struct {
		Blocks []json.RawMessage `json:"blocks"`
	}
	if err := json.Unmarshal([]byte(rawJSON), &msg); err != nil {
		t.Fatalf("json.Unmarshal snapshot: %v", err)
	}
	var markdown persistedMarkdownBlock
	if err := json.Unmarshal(msg.Blocks[1], &markdown); err != nil {
		t.Fatalf("json.Unmarshal markdown block: %v", err)
	}
	if markdown.Content != fullAnswer {
		t.Fatalf("snapshot markdown=%q, want full answer", markdown.Content)
	}
}

func TestFloretTurnResultProjectionDoesNotDowngradeFullAssistantMarkdown(t *testing.T) {
	fullAnswer := "Here are browser desktop options:\n\n" +
		"### 1. **HeyPuter/puter**\n" +
		"### 2. **linuxserver/docker-webtop**\n" +
		"The Webtop image can be based on Ubuntu/Alpine/Arch/Fedora and still stay readable in Flower.\n\n" +
		strings.Repeat("This sentence keeps the answer longer than the Floret preview budget. ", 12) +
		"Final sentence that must survive the completed turn projection."
	if len([]rune(fullAnswer)) <= 500 {
		t.Fatalf("test fixture must exceed preview budget, got %d runes", len([]rune(fullAnswer)))
	}

	ctx := context.Background()
	floretStore := flruntime.NewMemoryStore()
	defer floretStore.Close()
	adapter := testFloretBootstrap(t, floretStore)
	create, err := adapter.newThreadCreate("thread_full_result_projection", "create-thread-full-result-projection")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := create.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: "thread_full_result_projection", CreateIntentID: "create-thread-full-result-projection"}); err != nil {
		t.Fatal(err)
	}
	threadRuntime, err := adapter.bindThreadRuntime("thread_full_result_projection")
	if err != nil {
		t.Fatal(err)
	}
	host, err := threadRuntime.Turn(ctx, flruntime.TurnExecutionHostOptions{
		Config: flconfig.Config{
			Provider:     flconfig.ProviderFake,
			Model:        "fake-model",
			FakeResponse: fullAnswer,
			SystemPrompt: "test",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		RunID:    "run_full_result_projection",
		ThreadID: "thread_full_result_projection",
		TurnID:   "msg_full_result_projection",
		Input:    flruntime.TurnInput{Text: "find options"},
	})
	if err != nil {
		t.Fatal(err)
	}

	r := newRun(runOptions{})
	r.id = "run_full_result_projection"
	r.threadID = "thread_full_result_projection"
	r.messageID = "msg_full_result_projection"
	r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_full_result_projection",
		TurnID:         "msg_full_result_projection",
		RunID:          "run_full_result_projection",
		TraceID:        "run_full_result_projection",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: fullAnswer},
		},
	})
	if result.Projection == nil || !r.applyFloretThreadProjection(*result.Projection) {
		t.Fatalf("completed turn projection was not applied: %#v", result.Projection)
	}
	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != fullAnswer {
		t.Fatalf("assistantText length=%d, want full %d\ntext=%q", len([]rune(assistantText)), len([]rune(fullAnswer)), assistantText)
	}
	if strings.Contains(rawJSON, "HeyPuterputer") ||
		strings.Contains(rawJSON, "linuxserverdocker-webtop") ||
		strings.Contains(rawJSON, "UbuntuFedora") ||
		strings.Contains(rawJSON, " L...") {
		t.Fatalf("snapshot contains downgraded preview text: %s", rawJSON)
	}
}

func TestFloretEventProjectionReplacesDuplicateLiveActivityTail(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_live_projection"
	r.threadID = "thread_live_projection"
	r.messageID = "msg_live_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		activityTimelinePlaceholder("run_live_projection"),
		&persistedMarkdownBlock{Type: "markdown", Content: "live text"},
		activityTimelinePlaceholder("run_live_projection"),
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	floretEventSink{run: r}.EmitEvent(flruntime.Event{
		Type:     "thread_entry_committed",
		RunID:    "run_live_projection",
		ThreadID: "thread_live_projection",
		TurnID:   "msg_live_projection",
		Projection: &flruntime.ThreadTurnProjection{
			ThreadID:       "thread_live_projection",
			TurnID:         "msg_live_projection",
			RunID:          "run_live_projection",
			TraceID:        "run_live_projection",
			Status:         flruntime.TurnStatusCompleted,
			ThroughOrdinal: 1,
			Segments: []flruntime.ThreadTurnProjectionSegment{
				{
					Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
					ActivityTimeline: floretProjectionTimeline("run_live_projection", "thread_live_projection", "msg_live_projection", "exec-1", "terminal.exec"),
				},
				{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "live text"},
			},
		},
	})

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want canonical activity plus markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	if block, ok := r.assistantBlocks[1].(*persistedMarkdownBlock); !ok || block.Content != "live text" {
		t.Fatalf("assistantBlocks[1]=%T %#v, want canonical markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}
	if len(events) != 3 {
		t.Fatalf("stream events=%d, want two canonical block sets plus stale tail clear: %#v", len(events), events)
	}
	cleared, ok := events[2].(streamEventBlockSet)
	if !ok || cleared.BlockIndex != 2 {
		t.Fatalf("events[2]=%T %#v, want stale duplicate clear at index 2", events[2], events[2])
	}
}

func TestFloretHostPublishesRunningToolProjectionToFlowerLiveEvents(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "live Floret projection", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	const (
		runID  = "run_floret_host_live_projection"
		turnID = "turn_floret_host_live_projection"
		toolID = "call_blocking_projection"
	)
	r := newRunWithProductStoreForTest(t, runOptions{
		Log:              svc.log,
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, thread.ThreadID),
		RunID:            runID,
		EndpointID:       meta.EndpointID,
		ThreadID:         thread.ThreadID,
		MessageID:        turnID,
		PersistOpTimeout: time.Second,
		OnStreamEvent: func(ev any) {
			svc.broadcastStreamEvent(meta.EndpointID, thread.ThreadID, runID, ev)
		},
	}, svc.threadsDB)

	started := make(chan struct{})
	release := make(chan struct{})
	registry := fltools.NewRegistry()
	if err := registry.Register(fltools.Define[blockingProjectionToolArgs](
		fltools.Definition{
			Name:        "blocking_projection_tool",
			Title:       "Blocking projection tool",
			Description: "Wait until the test releases the tool.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"value": map[string]any{"type": "string"},
				},
				"required":             []any{"value"},
				"additionalProperties": false,
			},
			ReadOnly: true,
			Activity: func(flinv fltools.Invocation[any]) (*observation.ActivityPresentation, error) {
				return &observation.ActivityPresentation{
					Label:    "Waiting for release",
					Renderer: observation.ActivityRendererTerminal,
					Payload:  map[string]any{"command": "blocking_projection_tool"},
				}, nil
			},
		},
		nil,
		nil,
		func(toolCtx context.Context, inv fltools.Invocation[blockingProjectionToolArgs]) (fltools.Result, error) {
			close(started)
			select {
			case <-release:
				return fltools.Result{
					Text: "released " + inv.Args.Value,
					Activity: &observation.ActivityPresentation{
						Label:    "Release completed",
						Renderer: observation.ActivityRendererTerminal,
						Payload:  map[string]any{"command": "blocking_projection_tool", "output": "released"},
					},
				}, nil
			case <-toolCtx.Done():
				return fltools.Result{}, toolCtx.Err()
			}
		},
	)); err != nil {
		t.Fatalf("register blocking tool: %v", err)
	}

	gateway := floretModelGatewayFunc(func(_ context.Context, req flruntime.ModelRequest) (<-chan flruntime.ModelEvent, error) {
		events := make(chan flruntime.ModelEvent, 3)
		if req.Step == 1 {
			events <- flruntime.ModelEvent{Type: flruntime.ModelEventToolCalls, ToolCalls: []fltools.ToolCall{{ID: toolID, Name: "blocking_projection_tool", Args: `{"value":"work"}`}}}
			events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "tool_calls"}
		} else {
			events <- flruntime.ModelEvent{Type: flruntime.ModelEventDelta, Text: "Tool finished."}
			events <- flruntime.ModelEvent{Type: flruntime.ModelEventDone, Reason: "stop"}
		}
		close(events)
		return events, nil
	})
	capture := &capturingFloretEventSink{downstream: floretEventSink{run: r}}
	floretStore := flruntime.NewMemoryStore()
	defer floretStore.Close()
	adapter := testFloretBootstrap(t, floretStore)
	create, err := adapter.newThreadCreate(flruntime.ThreadID(thread.ThreadID), flruntime.CreateIntentID("create-"+thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := create.CreateThread(ctx, flruntime.CreateThreadRequest{ThreadID: flruntime.ThreadID(thread.ThreadID), CreateIntentID: flruntime.CreateIntentID("create-" + thread.ThreadID)}); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	threadRuntime, err := adapter.bindThreadRuntime(flruntime.ThreadID(thread.ThreadID))
	if err != nil {
		t.Fatal(err)
	}
	host, err := threadRuntime.Turn(ctx, flruntime.TurnExecutionHostOptions{
		Config: flconfig.Config{
			SystemPrompt: "test",
			ContextPolicy: flconfig.ContextPolicy{
				ContextWindowTokens: flconfig.DefaultContextWindowTokens,
			},
		},
		ModelGateway:            gateway,
		ModelGatewayIdentity:    flruntime.ModelGatewayIdentity{Provider: "fake", Model: "fake-model", StateCompatibilityKey: "fake-model:test"},
		Tools:                   registry,
		EffectAuthorizationGate: allowFloretEffectGateForTest{},
		Sink:                    capture,
	})
	if err != nil {
		t.Fatalf("NewHost: %v", err)
	}

	type turnOutcome struct {
		result flruntime.TurnResult
		err    error
	}
	outcomeCh := make(chan turnOutcome, 1)
	go func() {
		result, runErr := host.RunTurn(ctx, flruntime.RunTurnRequest{
			RunID:    flruntime.RunID(runID),
			ThreadID: flruntime.ThreadID(thread.ThreadID),
			TurnID:   flruntime.TurnID(turnID),
			Input:    flruntime.TurnInput{Text: "run the blocking tool"},
			Limits:   flruntime.TurnLimits{MaxToolCalls: 4},
		})
		outcomeCh <- turnOutcome{result: result, err: runErr}
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for blocking tool")
	}

	live, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 100)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents while tool is running: %v", err)
	}
	runningBlock, ok := lastActivityBlockFromFlowerLiveEvents(live.Events)
	if !ok {
		t.Fatalf("live events do not contain a running activity block: %#v", live.Events)
	}
	runningItem := activityBlockItemByToolID(t, runningBlock, toolID)
	if runningItem.Status != observation.ActivityStatusRunning {
		t.Fatalf("running tool status=%q, want running: %#v", runningItem.Status, runningItem)
	}

	close(release)
	var outcome turnOutcome
	select {
	case outcome = <-outcomeCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for Floret turn completion")
	}
	if outcome.err != nil {
		t.Fatalf("RunTurn: %v", outcome.err)
	}
	if err := outcome.result.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if outcome.result.Projection == nil || outcome.result.Projection.Status != flruntime.TurnStatusCompleted {
		t.Fatalf("terminal projection=%#v", outcome.result.Projection)
	}

	toolRows := 0
	for _, rawBlock := range r.assistantBlocks {
		block, ok := activityTimelineBlockFromValue(rawBlock)
		if !ok {
			continue
		}
		for _, item := range block.Items {
			if item.ToolID != toolID {
				continue
			}
			toolRows++
			if item.Status != observation.ActivityStatusSuccess {
				t.Fatalf("terminal tool status=%q, want success: %#v", item.Status, item)
			}
		}
	}
	if toolRows != 1 {
		t.Fatalf("terminal assistant blocks contain %d rows for %s, want one: %#v", toolRows, toolID, r.assistantBlocks)
	}

	publicEvents := capture.snapshot()
	if len(publicEvents) == 0 {
		t.Fatal("Floret Host emitted no public runtime events")
	}
	for _, ev := range publicEvents {
		if err := ev.Validate(); err != nil {
			t.Fatalf("public runtime event %q failed validation: %v", ev.Type, err)
		}
		switch strings.TrimSpace(string(ev.Type)) {
		case "entry_appended", "thread_resumed", "thread_started":
			t.Fatalf("private harness event reached public EventSink: %#v", ev)
		}
		if ev.Projection != nil && !ev.Projection.Status.IsTerminal() && ev.Projection.Status != flruntime.TurnStatusRunning {
			t.Fatalf("live projection status=%q, want running before terminal", ev.Projection.Status)
		}
	}
}

func lastActivityBlockFromFlowerLiveEvents(events []FlowerLiveEvent) (ActivityTimelineBlock, bool) {
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Kind != FlowerLiveMessageBlockSet {
			continue
		}
		var payload FlowerLiveMessageBlockSetPayload
		if !decodeFlowerPayload(events[i].Payload, &payload) {
			continue
		}
		raw, err := json.Marshal(payload.Block)
		if err != nil {
			continue
		}
		var block ActivityTimelineBlock
		if json.Unmarshal(raw, &block) == nil && block.Type == activityTimelineBlockType {
			return block, true
		}
	}
	return ActivityTimelineBlock{}, false
}

func TestFlowerBlocksFromFloretThreadProjectionInterleavesTextAndActivity(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	blocks, err := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run",
		ThreadID: "thread",
		TurnID:   "turn",
		TraceID:  "run",
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Before first tool."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run", "thread", "turn", "call-1", "inspect_once")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "After first tool, before second tool."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run", "thread", "turn", "call-2", "inspect_twice")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Final answer."},
		},
	})
	if err != nil {
		t.Fatalf("flowerBlocksFromFloretThreadProjection: %v", err)
	}

	if len(blocks) != 5 {
		t.Fatalf("blocks len=%d, want markdown/activity/markdown/activity/markdown: %#v", len(blocks), blocks)
	}
	wantMarkdown := map[int]string{
		0: "Before first tool.",
		2: "After first tool, before second tool.",
		4: "Final answer.",
	}
	for idx, want := range wantMarkdown {
		block, ok := blocks[idx].(*persistedMarkdownBlock)
		if !ok || block.Content != want {
			t.Fatalf("blocks[%d]=%T %+v, want markdown %q", idx, blocks[idx], blocks[idx], want)
		}
	}
	firstActivity, ok := blocks[1].(ActivityTimelineBlock)
	if !ok || len(firstActivity.Items) != 1 || firstActivity.Items[0].ToolID != "call-1" {
		t.Fatalf("blocks[1]=%T %#v, want first activity segment", blocks[1], blocks[1])
	}
	secondActivity, ok := blocks[3].(ActivityTimelineBlock)
	if !ok || len(secondActivity.Items) != 1 || secondActivity.Items[0].ToolID != "call-2" {
		t.Fatalf("blocks[3]=%T %#v, want second activity segment", blocks[3], blocks[3])
	}
}

func TestFlowerBlocksFromFloretThreadProjectionKeepsRequestedApprovalWaiting(t *testing.T) {
	t.Parallel()

	now := time.Unix(250, 0)
	projection := flruntime.ProjectThreadTurn(flruntime.ProjectThreadTurnRequest{
		RunID:    "run_waiting_approval",
		ThreadID: "thread_waiting_approval",
		TurnID:   "msg_waiting_approval",
		TraceID:  "run_waiting_approval",
		Events: []flruntime.ThreadDetailEvent{
			{
				ID:        "approval-requested",
				Ordinal:   1,
				ThreadID:  "thread_waiting_approval",
				TurnID:    "msg_waiting_approval",
				Kind:      flruntime.ThreadDetailEventApproval,
				Type:      string(observation.EventTypeToolApprovalRequested),
				CreatedAt: now,
				Approval:  &flruntime.ThreadDetailApproval{State: "requested", ToolID: "exec-1", ToolName: "terminal.exec"},
				ActivityTimeline: floretProjectionApprovalTimeline(
					"run_waiting_approval",
					"thread_waiting_approval",
					"msg_waiting_approval",
					"exec-1",
					"curl -s https://example.test",
				),
			},
			{
				ID:        "turn-success",
				Ordinal:   2,
				ThreadID:  "thread_waiting_approval",
				TurnID:    "msg_waiting_approval",
				Kind:      flruntime.ThreadDetailEventTurnMarker,
				CreatedAt: now.Add(time.Second),
				TurnMarker: &flruntime.ThreadDetailTurnMarker{
					Status: string(observation.ActivityStatusSuccess),
				},
			},
		},
	})

	r := newRun(runOptions{})
	blocks, err := r.flowerBlocksFromFloretThreadProjection(projection)
	if err != nil {
		t.Fatalf("flowerBlocksFromFloretThreadProjection: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("blocks len=%d, want one activity block: %#v", len(blocks), blocks)
	}
	block, ok := blocks[0].(ActivityTimelineBlock)
	if !ok || len(block.Items) != 1 {
		t.Fatalf("blocks[0]=%T %#v, want activity timeline", blocks[0], blocks[0])
	}
	item := block.Items[0]
	if block.Summary.Status != observation.ActivityStatusWaiting ||
		block.Summary.Counts.Success != 0 ||
		item.Status != observation.ActivityStatusWaiting ||
		item.ApprovalState != "requested" ||
		item.EndedAtUnixMS != 0 ||
		item.Label != "curl -s https://example.test" {
		t.Fatalf("approval activity should remain waiting: summary=%#v item=%#v", block.Summary, item)
	}
}

func TestFlowerBlocksFromFloretThreadProjectionKeepsQueuedSiblingPending(t *testing.T) {
	t.Parallel()

	now := time.Unix(275, 0)
	newsCommand := "curl -s https://newsapi.example.test"
	searchCommand := "curl -sL https://search.example.test"
	projection := flruntime.ProjectThreadTurn(flruntime.ProjectThreadTurnRequest{
		RunID:    "run_batch_approval",
		ThreadID: "thread_batch_approval",
		TurnID:   "msg_batch_approval",
		TraceID:  "run_batch_approval",
		Events: []flruntime.ThreadDetailEvent{
			{
				ID:        "call-newsapi",
				Ordinal:   1,
				ThreadID:  "thread_batch_approval",
				TurnID:    "msg_batch_approval",
				Kind:      flruntime.ThreadDetailEventToolCall,
				CreatedAt: now,
				Message: &flruntime.ThreadDetailMessage{Role: "assistant", Activity: &observation.ActivityPresentation{
					Label:    newsCommand,
					Renderer: observation.ActivityRendererTerminal,
					Payload:  map[string]any{"command": newsCommand},
				}},
				ToolCall: &flruntime.ThreadDetailToolCall{ID: "call-newsapi", Name: "terminal.exec"},
			},
			{
				ID:        "call-search",
				Ordinal:   2,
				ThreadID:  "thread_batch_approval",
				TurnID:    "msg_batch_approval",
				Kind:      flruntime.ThreadDetailEventToolCall,
				CreatedAt: now.Add(5 * time.Millisecond),
				Message: &flruntime.ThreadDetailMessage{Role: "assistant", Activity: &observation.ActivityPresentation{
					Label:    searchCommand,
					Renderer: observation.ActivityRendererTerminal,
					Payload:  map[string]any{"command": searchCommand},
				}},
				ToolCall: &flruntime.ThreadDetailToolCall{ID: "call-search", Name: "terminal.exec"},
			},
			{
				ID:        "approval-newsapi",
				Ordinal:   3,
				ThreadID:  "thread_batch_approval",
				TurnID:    "msg_batch_approval",
				Kind:      flruntime.ThreadDetailEventApproval,
				Type:      string(observation.EventTypeToolApprovalRequested),
				CreatedAt: now.Add(10 * time.Millisecond),
				Approval:  &flruntime.ThreadDetailApproval{State: "requested", ToolID: "call-newsapi", ToolName: "terminal.exec"},
			},
		},
	})

	r := newRun(runOptions{})
	blocks, err := r.flowerBlocksFromFloretThreadProjection(projection)
	if err != nil {
		t.Fatalf("flowerBlocksFromFloretThreadProjection: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("blocks len=%d, want one activity block: %#v", len(blocks), blocks)
	}
	block, ok := blocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("blocks[0]=%T %#v, want activity timeline", blocks[0], blocks[0])
	}
	if block.Summary.Counts.Waiting != 1 || block.Summary.Counts.Pending != 1 || block.Summary.Counts.Running != 0 {
		t.Fatalf("summary should contain one waiting approval and one queued tool: %#v", block.Summary)
	}
	waiting := activityBlockItemByToolID(t, block, "call-newsapi")
	if waiting.Status != observation.ActivityStatusWaiting ||
		waiting.ApprovalState != "requested" ||
		!waiting.RequiresApproval ||
		waiting.Label != newsCommand {
		t.Fatalf("waiting tool mismatch: %#v", waiting)
	}
	queued := activityBlockItemByToolID(t, block, "call-search")
	if queued.Status != observation.ActivityStatusPending ||
		queued.RequiresApproval ||
		queued.Label != searchCommand {
		t.Fatalf("queued sibling mismatch: %#v", queued)
	}
}

func TestFlowerBlocksFromFloretThreadProjectionKeepsPendingApprovalAsSingleToolRow(t *testing.T) {
	t.Parallel()

	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         "run_weather",
		ThreadID:      "thread_weather",
		TurnID:        "msg_weather",
		TraceID:       "run_weather",
		Summary: observation.ActivitySummary{
			Status:         observation.ActivityStatusWaiting,
			Severity:       observation.ActivitySeverityBlocking,
			NeedsAttention: true,
			TotalItems:     2,
			Counts:         observation.ActivityCounts{Success: 1, Waiting: 1, Approval: 1},
		},
		Items: []observation.ActivityItem{
			{
				ItemID:          "tool:fetch-weather-once",
				ToolID:          "fetch-weather-once",
				ToolName:        "terminal.exec",
				Kind:            observation.ActivityKindTool,
				Status:          observation.ActivityStatusSuccess,
				Severity:        observation.ActivitySeverityNormal,
				Label:           `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | head -200`,
				Renderer:        observation.ActivityRendererTerminal,
				Payload:         map[string]any{"command": `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | head -200`},
				StartedAtUnixMS: 10,
				EndedAtUnixMS:   20,
			},
			{
				ItemID:           "tool:format-weather",
				ToolID:           "format-weather",
				ToolName:         "terminal.exec",
				Kind:             observation.ActivityKindTool,
				Status:           observation.ActivityStatusWaiting,
				Severity:         observation.ActivitySeverityBlocking,
				NeedsAttention:   true,
				AttentionReasons: []observation.ActivityAttentionReason{observation.ActivityAttentionWaiting, observation.ActivityAttentionApproval},
				RequiresApproval: true,
				ApprovalState:    "requested",
				Label:            `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | python3 -c "import json, sys"`,
				Renderer:         observation.ActivityRendererTerminal,
				Payload:          map[string]any{"command": `curl -s "wttr.in/Changsha?format=j1" 2>/dev/null | python3 -c "import json, sys"`},
				StartedAtUnixMS:  30,
			},
		},
	}
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		t.Fatalf("timeline should validate: %v", err)
	}

	r := newRun(runOptions{})
	blocks, err := r.flowerBlocksFromFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:    "run_weather",
		ThreadID: "thread_weather",
		TurnID:   "msg_weather",
		TraceID:  "run_weather",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: &timeline,
		}},
	})
	if err != nil {
		t.Fatalf("flowerBlocksFromFloretThreadProjection: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("blocks len=%d, want one activity block: %#v", len(blocks), blocks)
	}
	block, ok := blocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("blocks[0]=%T %#v, want activity timeline", blocks[0], blocks[0])
	}
	if len(block.Items) != 2 ||
		block.Items[0].Status != observation.ActivityStatusSuccess ||
		block.Items[1].Status != observation.ActivityStatusWaiting ||
		block.Items[1].ApprovalState != "requested" ||
		block.Items[1].ItemID != "tool:format-weather" {
		t.Fatalf("activity rows should be historical done plus one waiting tool: %#v", block.Items)
	}
}

func TestValidateFloretThreadProjectionRejectsInvalidActivityTimeline(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_invalid_projection"
	r.threadID = "thread_invalid_projection"
	r.messageID = "msg_invalid_projection"
	err := r.validateFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:          "run_invalid_projection",
		ThreadID:       "thread_invalid_projection",
		TurnID:         "msg_invalid_projection",
		TraceID:        "run_invalid_projection",
		Status:         flruntime.TurnStatusRunning,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionInvalidRequestedApprovalTimeline(
				"run_invalid_projection",
				"thread_invalid_projection",
				"msg_invalid_projection",
			),
		}},
	})
	if err == nil {
		t.Fatal("validateFloretThreadProjection accepted invalid activity timeline")
	}
}

func TestApplyFloretThreadProjectionRejectsInvalidActivityWithoutClearingLiveBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := newRun(runOptions{})
	r.id = "run_invalid_projection"
	r.threadID = "thread_invalid_projection"
	r.messageID = "msg_invalid_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		activityTimelinePlaceholder("run_invalid_projection"),
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	applied := r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:          "run_invalid_projection",
		ThreadID:       "thread_invalid_projection",
		TurnID:         "msg_invalid_projection",
		TraceID:        "run_invalid_projection",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionInvalidRequestedApprovalTimeline(
				"run_invalid_projection",
				"thread_invalid_projection",
				"msg_invalid_projection",
			),
		}},
	})
	if applied {
		t.Fatalf("invalid projection should not apply")
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks len=%d, want existing live block retained: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[0]=%T, want existing activity block", r.assistantBlocks[0])
	}
	if len(events) != 0 {
		t.Fatalf("invalid projection should not emit block updates: %#v", events)
	}
}

func TestApplyFloretThreadProjectionAdvancesOrdinalOnlyAfterSuccessfulMapping(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_projection_cursor"
	r.threadID = "thread_projection_cursor"
	r.messageID = "turn_projection_cursor"
	invalid := flruntime.ThreadTurnProjection{
		RunID:          "run_projection_cursor",
		ThreadID:       "thread_projection_cursor",
		TurnID:         "turn_projection_cursor",
		TraceID:        "run_projection_cursor",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 2,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind: "unknown",
		}},
	}
	if r.applyFloretThreadProjection(invalid) {
		t.Fatalf("invalid projection applied")
	}
	valid := invalid
	valid.Segments = []flruntime.ThreadTurnProjectionSegment{{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "ordinal two"}}
	if !r.applyFloretThreadProjection(valid) {
		t.Fatalf("valid projection at rejected ordinal was not applied")
	}
	if r.applyFloretThreadProjection(valid) {
		t.Fatalf("equal ordinal projection applied twice")
	}
	newer := valid
	newer.ThroughOrdinal = 3
	newer.Segments = []flruntime.ThreadTurnProjectionSegment{{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "ordinal three"}}
	if !r.applyFloretThreadProjection(newer) {
		t.Fatalf("newer projection was not applied")
	}
	block, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || block.Content != "ordinal three" {
		t.Fatalf("assistant block=%T %#v", r.assistantBlocks[0], r.assistantBlocks[0])
	}
}

func TestApplyFloretThreadProjectionAcceptsUpstreamControlSignalWithoutBodyBlock(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_unknown_projection_signal"
	r.threadID = "thread_unknown_projection_signal"
	r.messageID = "turn_unknown_projection_signal"
	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:          "run_unknown_projection_signal",
		ThreadID:       "thread_unknown_projection_signal",
		TurnID:         "turn_unknown_projection_signal",
		Status:         flruntime.TurnStatusRunning,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind: flruntime.ThreadTurnProjectionSegmentControlSignal,
			Signal: &flruntime.ThreadTurnProjectionSignal{
				Name:   "upstream_signal",
				CallID: "call_unknown_projection_signal",
			},
		}},
	}) {
		t.Fatalf("valid upstream control signal projection was rejected")
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("control signal created assistant body blocks: %#v", r.assistantBlocks)
	}
}

func TestPendingToolSettlementUnavailableDoesNotReadOrSynthesizeProjection(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "projection unavailable", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	target := flruntime.PendingToolSettlementTarget{
		ThreadID:   flruntime.ThreadID(thread.ThreadID),
		TurnID:     "turn_unavailable",
		RunID:      "run_unavailable",
		ToolCallID: "tool_unavailable",
		ToolName:   "terminal.exec",
		Handle:     "process_unavailable",
	}
	err = svc.applyFloretPendingToolSettlementProjection(ctx, meta.EndpointID, thread.ThreadID, "run_unavailable", "turn_unavailable", pendingToolSettlementResultForTest(target, flruntime.TurnProjectionAvailabilityUnavailable, nil, "detail read failed"))
	if err != nil {
		t.Fatalf("apply unavailable settlement: %v", err)
	}
	resp, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 20)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	for _, event := range resp.Events {
		if event.Kind == FlowerLiveTimelineReplaced {
			t.Fatalf("unavailable settlement synthesized timeline replacement: %#v", event)
		}
	}
}

func TestApplyFloretThreadProjectionReplacesStreamedBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 8)
	r := newRun(runOptions{})
	r.id = "run_projection"
	r.threadID = "thread_projection"
	r.messageID = "msg_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		&persistedMarkdownBlock{Type: "markdown", Content: "streamed partial"},
		activityTimelinePlaceholder("run_projection"),
		&persistedMarkdownBlock{Type: "markdown", Content: "late streamed"},
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:          "run_projection",
		ThreadID:       "thread_projection",
		TurnID:         "msg_projection",
		TraceID:        "run_projection",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Canonical intro."},
			{Kind: flruntime.ThreadTurnProjectionSegmentActivityTimeline, ActivityTimeline: floretProjectionTimeline("run_projection", "thread_projection", "msg_projection", "call-1", "terminal.exec")},
			{Kind: flruntime.ThreadTurnProjectionSegmentAssistantText, Text: "Canonical close."},
		},
	}) {
		t.Fatalf("projection returned false")
	}
	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want 3: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	first, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || first.Content != "Canonical intro." {
		t.Fatalf("assistantBlocks[0]=%T %+v", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	last, ok := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if !ok || last.Content != "Canonical close." {
		t.Fatalf("assistantBlocks[2]=%T %+v", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	if len(events) != 3 {
		t.Fatalf("stream events=%d, want block-set for each canonical block: %#v", len(events), events)
	}
}

func TestApplyFloretThreadProjectionClearsStreamedBlocksWhenEmpty(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_empty_projection"
	r.threadID = "thread_empty_projection"
	r.messageID = "msg_empty_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.assistantBlocks = []any{
		&persistedMarkdownBlock{Type: "markdown", Content: "streamed text"},
		activityTimelinePlaceholder("run_empty_projection"),
	}
	r.nextBlockIndex = len(r.assistantBlocks)

	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		RunID:          "run_empty_projection",
		ThreadID:       "thread_empty_projection",
		TurnID:         "msg_empty_projection",
		TraceID:        "run_empty_projection",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
	}) {
		t.Fatalf("projection returned false")
	}
	if len(r.assistantBlocks) != 0 {
		t.Fatalf("assistantBlocks=%#v, want no synthesized cache block", r.assistantBlocks)
	}
	if len(events) != 2 {
		t.Fatalf("stream events=%d, want both stale blocks cleared: %#v", len(events), events)
	}
	first, ok := events[0].(streamEventBlockSet)
	if !ok || first.BlockIndex != 0 {
		t.Fatalf("events[0]=%T %#v, want block-set index 0", events[0], events[0])
	}
	cleared, ok := events[1].(streamEventBlockSet)
	if !ok || cleared.BlockIndex != 1 {
		t.Fatalf("events[1]=%T %#v, want stale block clear at index 1", events[1], events[1])
	}
}

func TestApplyFloretThreadProjectionRejectsMissingOrMismatchedIdentityWithoutClearingLiveBlocks(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		projection flruntime.ThreadTurnProjection
	}{
		{name: "missing identity", projection: flruntime.ThreadTurnProjection{}},
		{name: "wrong run", projection: flruntime.ThreadTurnProjection{RunID: "other", ThreadID: "thread_projection_identity", TurnID: "msg_projection_identity"}},
		{name: "wrong thread", projection: flruntime.ThreadTurnProjection{RunID: "run_projection_identity", ThreadID: "other", TurnID: "msg_projection_identity"}},
		{name: "wrong turn", projection: flruntime.ThreadTurnProjection{RunID: "run_projection_identity", ThreadID: "thread_projection_identity", TurnID: "other"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRun(runOptions{})
			r.id = "run_projection_identity"
			r.threadID = "thread_projection_identity"
			r.messageID = "msg_projection_identity"
			r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: "streamed reply"}}
			var events []any
			r.onStreamEvent = func(ev any) { events = append(events, ev) }

			if r.applyFloretThreadProjection(tc.projection) {
				t.Fatalf("projection applied: %#v", tc.projection)
			}
			if len(r.assistantBlocks) != 1 {
				t.Fatalf("assistant blocks mutated: %#v", r.assistantBlocks)
			}
			block, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
			if !ok || block.Content != "streamed reply" {
				t.Fatalf("assistant block = %T %#v", r.assistantBlocks[0], r.assistantBlocks[0])
			}
			if len(events) != 0 {
				t.Fatalf("projection emitted events: %#v", events)
			}
		})
	}
}

func TestApplyFloretThreadProjectionIgnoresOlderOrdinalAfterSettlement(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_terminal_ordinal"
	r.threadID = "thread_terminal_ordinal"
	r.messageID = "msg_terminal_ordinal"

	settledTimeline := floretProjectionTimeline("run_terminal_ordinal", "thread_terminal_ordinal", "msg_terminal_ordinal", "exec-1", "terminal.exec")
	settledTimeline.Items[0].Label = "printf done"
	settledTimeline.Items[0].Renderer = observation.ActivityRendererTerminal
	settledTimeline.Items[0].Payload = map[string]any{"command": "printf done", "output": "done"}
	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_terminal_ordinal",
		TurnID:         "msg_terminal_ordinal",
		RunID:          "run_terminal_ordinal",
		TraceID:        "run_terminal_ordinal",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 2,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: settledTimeline,
		}},
	}) {
		t.Fatalf("settled projection was not applied")
	}

	runningTimeline := floretRunningProjectionTimeline("run_terminal_ordinal", "thread_terminal_ordinal", "msg_terminal_ordinal", "exec-1")
	if r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_terminal_ordinal",
		TurnID:         "msg_terminal_ordinal",
		RunID:          "run_terminal_ordinal",
		TraceID:        "run_terminal_ordinal",
		Status:         flruntime.TurnStatusRunning,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: runningTimeline,
		}},
	}) {
		t.Fatalf("older running projection was applied")
	}

	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("assistant block=%T, want activity timeline", r.assistantBlocks[0])
	}
	item := activityBlockItemByToolID(t, block, "exec-1")
	if item.Status != observation.ActivityStatusSuccess || anyToString(item.Payload["output"]) != "done" {
		t.Fatalf("terminal item=%#v, want settled result preserved by ordinal", item)
	}
}

func TestApplyFloretThreadProjectionAcceptsSettlementIdentityForChildRun(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_child_audit"
	r.threadID = "thread_child"
	r.messageID = "turn_child_audit"
	r.settlementThreadID = "thread_child"
	r.settlementRunID = "run_floret_execution"
	r.settlementTurnID = "turn_floret_execution"

	timeline := floretProjectionTimeline("run_floret_execution", "thread_child", "turn_floret_execution", "exec-1", "terminal.exec")
	timeline.Items[0].Label = "printf child"
	if !r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_child",
		TurnID:         "turn_floret_execution",
		RunID:          "run_floret_execution",
		TraceID:        "run_floret_execution",
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: timeline,
		}},
	}) {
		t.Fatalf("settlement identity projection was not applied")
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks=%#v, want one activity block", r.assistantBlocks)
	}
	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("assistant block=%T, want activity timeline", r.assistantBlocks[0])
	}
	item := activityBlockItemByToolID(t, block, "exec-1")
	if item.Status != observation.ActivityStatusSuccess || item.Label != "printf child" {
		t.Fatalf("terminal item=%#v, want Floret settlement projection", item)
	}
	if block.RunID != "run_child_audit" || block.TurnID != "turn_child_audit" || block.TraceID != "run_child_audit" {
		t.Fatalf("public activity identity run=%q turn=%q trace=%q, want Redeven audit identity", block.RunID, block.TurnID, block.TraceID)
	}
	rawBlock, err := json.Marshal(block)
	if err != nil {
		t.Fatalf("json.Marshal activity block: %v", err)
	}
	for _, forbidden := range []string{"run_floret_execution", "turn_floret_execution"} {
		if strings.Contains(string(rawBlock), forbidden) {
			t.Fatalf("public activity block leaked Floret execution identity %q: %s", forbidden, rawBlock)
		}
	}

	mixed := floretProjectionTimeline("run_floret_execution", "other_thread", "turn_floret_execution", "exec-2", "terminal.exec")
	if r.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID: "other_thread",
		TurnID:   "turn_floret_execution",
		RunID:    "run_floret_execution",
		TraceID:  "run_floret_execution",
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: mixed,
		}},
	}) {
		t.Fatalf("mixed settlement identity projection was applied")
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks mutated by mixed identity: %#v", r.assistantBlocks)
	}
	block, ok = r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok || len(block.Items) != 1 || block.Items[0].ToolID != "exec-1" {
		t.Fatalf("assistantBlocks mutated by mixed identity: %#v", r.assistantBlocks)
	}
}

func TestActivityTimelineBlockWithoutPublicIdentityStripsFloretExecutionIDs(t *testing.T) {
	t.Parallel()

	timeline := floretProjectionTimeline("run_floret_private", "thread_floret_private", "turn_floret_private", "exec-1", "terminal.exec")
	timeline.TraceID = "trace_floret_private"
	block := newActivityTimelineBlock(*timeline, nil)
	if block.RunID != "" || block.ThreadID != "" || block.TurnID != "" || block.TraceID != "" {
		t.Fatalf("activity block identity run=%q thread=%q turn=%q trace=%q, want stripped public identity", block.RunID, block.ThreadID, block.TurnID, block.TraceID)
	}
	rawBlock, err := json.Marshal(block)
	if err != nil {
		t.Fatalf("json.Marshal activity block: %v", err)
	}
	for _, forbidden := range []string{"run_floret_private", "thread_floret_private", "turn_floret_private", "trace_floret_private"} {
		if strings.Contains(string(rawBlock), forbidden) {
			t.Fatalf("public activity block leaked Floret execution identity %q: %s", forbidden, rawBlock)
		}
	}
}

func TestFloretTerminalThreadProjectionUpdatesDetachedSnapshotWithoutStream(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := newRun(runOptions{})
	r.id = "run_terminal_projection"
	r.threadID = "thread_terminal_projection"
	r.messageID = "msg_terminal_projection"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.markDetached()

	timeline := floretProjectionTimeline("run_terminal_projection", "thread_terminal_projection", "msg_terminal_projection", "exec-1", "terminal.exec")
	timeline.Summary.Status = observation.ActivityStatusCanceled
	timeline.Summary.Counts = observation.ActivityCounts{Canceled: 1}
	timeline.Items[0].Status = observation.ActivityStatusCanceled
	timeline.Items[0].Severity = observation.ActivitySeverityWarning

	if !r.applyFloretThreadProjectionInternal(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_terminal_projection",
		TurnID:         "msg_terminal_projection",
		RunID:          "run_terminal_projection",
		TraceID:        "run_terminal_projection",
		Status:         flruntime.TurnStatusCancelled,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: timeline,
		}},
	}, false, true) {
		t.Fatalf("terminal projection returned false")
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none for detached terminal projection: %#v", len(events), events)
	}
	if len(r.assistantBlocks) != 1 {
		t.Fatalf("assistantBlocks=%#v, want one activity block", r.assistantBlocks)
	}
	block, ok := r.assistantBlocks[0].(ActivityTimelineBlock)
	if !ok || block.Summary.Status != observation.ActivityStatusCanceled || block.Items[0].Status != observation.ActivityStatusCanceled {
		t.Fatalf("assistant block=%T %#v, want canceled activity timeline", r.assistantBlocks[0], r.assistantBlocks[0])
	}
}

func TestFloretTerminalThreadProjectionRejectsMismatchedRun(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{})
	r.id = "run_terminal_projection"
	r.threadID = "thread_terminal_projection"
	r.messageID = "msg_terminal_projection"
	r.assistantBlocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: "canceled"}}
	r.markDetached()

	if r.applyFloretThreadProjectionInternal(flruntime.ThreadTurnProjection{
		ThreadID:       "thread_terminal_projection",
		TurnID:         "msg_terminal_projection",
		RunID:          "other_run",
		TraceID:        "other_run",
		Status:         flruntime.TurnStatusCancelled,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionTimeline("other_run", "thread_terminal_projection", "msg_terminal_projection", "exec-1", "terminal.exec"),
		}},
	}, false, true) {
		t.Fatalf("terminal projection with mismatched run returned true")
	}
	block, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || block.Content != "canceled" {
		t.Fatalf("assistantBlocks mutated by mismatched terminal projection: %#v", r.assistantBlocks)
	}
}

func TestApplyFloretPendingToolSettlementProjectionPublishesTimelineReplacement(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "terminal settlement live", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_terminal_settlement_live"
	messageID := "msg_terminal_settlement_live"
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "canonical terminal output")
	if _, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		ThreadID: flruntime.ThreadID(thread.ThreadID),
		TurnID:   flruntime.TurnID(messageID),
		RunID:    flruntime.RunID(runID),
		Input:    flruntime.TurnInput{Text: "run terminal command"},
	}); err != nil {
		t.Fatalf("seed canonical turn: %v", err)
	}
	activeRun := newRun(runOptions{
		HostCapabilities: bindTestRunHostCapabilities(t, svc, meta.EndpointID, thread.ThreadID),
		RunID:            runID,
		EndpointID:       meta.EndpointID,
		ThreadID:         thread.ThreadID,
		MessageID:        messageID,
		OnStreamEvent: func(ev any) {
			svc.broadcastStreamEvent(meta.EndpointID, thread.ThreadID, runID, ev)
		},
	})
	svc.mu.Lock()
	if svc.runs == nil {
		svc.runs = map[string]*run{}
	}
	if svc.activeRunByTh == nil {
		svc.activeRunByTh = map[string]string{}
	}
	svc.runs[runID] = activeRun
	svc.activeRunByTh[runThreadKey(meta.EndpointID, thread.ThreadID)] = runID
	svc.mu.Unlock()
	svc.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: meta.EndpointID,
		ThreadID:   thread.ThreadID,
		RunID:      runID,
		Kind:       FlowerLiveRunStarted,
		Payload:    mustFlowerPayload(FlowerLiveRunStartedPayload{RunID: runID, TurnID: messageID, MessageID: messageID, Status: string(RunStateRunning)}),
	})
	activeRun.applyFloretThreadProjection(flruntime.ThreadTurnProjection{
		ThreadID:       flruntime.ThreadID(thread.ThreadID),
		TurnID:         flruntime.TurnID(messageID),
		RunID:          flruntime.RunID(runID),
		TraceID:        flruntime.TraceID(runID),
		Status:         flruntime.TurnStatusRunning,
		ThroughOrdinal: 1,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretRunningProjectionTimeline(runID, thread.ThreadID, messageID, "exec-1"),
		}},
	})

	settledProjection := flruntime.ThreadTurnProjection{
		ThreadID:       flruntime.ThreadID(thread.ThreadID),
		TurnID:         flruntime.TurnID(messageID),
		RunID:          flruntime.RunID(runID),
		TraceID:        flruntime.TraceID(runID),
		Status:         flruntime.TurnStatusCompleted,
		ThroughOrdinal: 2,
		Segments: []flruntime.ThreadTurnProjectionSegment{{
			Kind:             flruntime.ThreadTurnProjectionSegmentActivityTimeline,
			ActivityTimeline: floretProjectionTimeline(runID, thread.ThreadID, messageID, "exec-1", "terminal.exec"),
		}},
	}
	settlementTarget := flruntime.PendingToolSettlementTarget{
		ThreadID:   flruntime.ThreadID(thread.ThreadID),
		TurnID:     flruntime.TurnID(messageID),
		RunID:      flruntime.RunID(runID),
		ToolCallID: "exec-1",
		ToolName:   "terminal.exec",
		Handle:     "process-1",
	}
	err = svc.applyFloretPendingToolSettlementProjection(ctx, meta.EndpointID, thread.ThreadID, runID, messageID, pendingToolSettlementResultForTest(settlementTarget, flruntime.TurnProjectionAvailabilityReady, &settledProjection, ""))
	if err != nil {
		t.Fatalf("apply settlement projection: %v", err)
	}

	resp, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 50)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var replacement *FlowerLiveEvent
	for i := range resp.Events {
		if resp.Events[i].Kind == FlowerLiveTimelineReplaced {
			replacement = &resp.Events[i]
			break
		}
	}
	if replacement == nil {
		t.Fatalf("events=%#v, want timeline.replaced", resp.Events)
	}
	var payload FlowerLiveTimelineReplacedPayload
	if !decodeFlowerPayload(replacement.Payload, &payload) {
		t.Fatalf("replacement payload decode failed: %#v", replacement)
	}
	if len(payload.Messages) != 2 || payload.Messages[1].MessageID != messageID || payload.Messages[1].Content != "canonical terminal output" {
		t.Fatalf("replacement messages=%#v, want canonical Floret turn", payload.Messages)
	}
	if _, ok := payload.LiveState.Messages[messageID]; ok {
		t.Fatalf("terminal canonical projection left live draft: %#v", payload.LiveState.Messages[messageID])
	}
}

func TestRunFloretHostedTurnTerminalProjectionPublishesCanonicalReplacement(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(ctx, meta, "ordinary terminal replacement", "", "", "")
	if err != nil {
		t.Fatalf("CreateThread: %v", err)
	}

	runID := "run_ordinary_terminal_replacement"
	turnID := "turn_ordinary_terminal_replacement"
	floretRuntime, err := svc.bindFloretThreadRuntime(thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	r := newRunWithProductStoreForTest(t, runOptions{
		HostCapabilities:  bindTestRunHostCapabilities(t, svc, meta.EndpointID, thread.ThreadID),
		FloretHostFactory: floretRuntime.Turn,
		StateDir:          svc.stateDir,
		AgentHomeDir:      t.TempDir(),
		WorkingDir:        t.TempDir(),
		Shell:             "bash",
		AIConfig:          &config.AIConfig{},
		SessionMeta:       meta,
		RunID:             runID,
		EndpointID:        meta.EndpointID,
		ThreadID:          thread.ThreadID,
		MessageID:         turnID,
		OnStreamEvent: func(event any) {
			svc.broadcastStreamEvent(meta.EndpointID, thread.ThreadID, runID, event)
		},
	}, svc.threadsDB)
	provider := &capturingTurnProvider{result: ModelGatewayResult{FinishReason: "stop", Text: "canonical final answer"}}
	if err := r.runFloretHostedTurn(ctx, RunRequest{
		Model: "compat/gpt-5-mini",
		Input: RunInput{Text: "finish normally"},
		Options: RunOptions{
			PermissionType: config.AIPermissionApprovalRequired,
		},
	}, config.AIProvider{ID: "compat", Type: "openai_compatible", BaseURL: "https://example.test/v1"}, "sk-test", "ordinary terminal replacement", provider); err != nil {
		t.Fatalf("runFloretHostedTurn: %v", err)
	}

	response, err := svc.ListFlowerThreadLiveEvents(ctx, meta, thread.ThreadID, 0, 100)
	if err != nil {
		t.Fatalf("ListFlowerThreadLiveEvents: %v", err)
	}
	var replacements []FlowerLiveTimelineReplacedPayload
	for _, event := range response.Events {
		if event.Kind != FlowerLiveTimelineReplaced {
			continue
		}
		var payload FlowerLiveTimelineReplacedPayload
		if !decodeFlowerPayload(event.Payload, &payload) {
			t.Fatalf("decode timeline replacement: %s", string(event.Payload))
		}
		replacements = append(replacements, payload)
	}
	if len(replacements) != 1 {
		t.Fatalf("timeline replacements = %d, want 1; events=%#v", len(replacements), response.Events)
	}
	replacement := replacements[0]
	if len(replacement.Messages) != 2 || replacement.Messages[0].Role != "user" || replacement.Messages[1].MessageID != turnID || replacement.Messages[1].Content != "canonical final answer" {
		t.Fatalf("replacement messages = %#v", replacement.Messages)
	}
	if _, exists := replacement.LiveState.Messages[turnID]; exists {
		t.Fatalf("terminal replacement retained live draft: %#v", replacement.LiveState.Messages[turnID])
	}
}

func floretProjectionTimeline(runID string, threadID string, turnID string, toolID string, toolName string) *observation.ActivityTimeline {
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      threadID,
		TurnID:        turnID,
		TraceID:       runID,
		Summary:       observation.ActivitySummary{Status: observation.ActivityStatusSuccess, Severity: observation.ActivitySeverityNormal, TotalItems: 1},
		Items: []observation.ActivityItem{{
			ItemID:   "tool:" + toolID,
			ToolID:   toolID,
			ToolName: toolName,
			Kind:     observation.ActivityKindTool,
			Status:   observation.ActivityStatusSuccess,
			Severity: observation.ActivitySeverityNormal,
		}},
	}
	return &timeline
}

func floretRunningProjectionTimeline(runID string, threadID string, turnID string, toolID string) *observation.ActivityTimeline {
	timeline := floretProjectionTimeline(runID, threadID, turnID, toolID, "terminal.exec")
	timeline.Summary = observation.ActivitySummary{
		Status:     observation.ActivityStatusRunning,
		Severity:   observation.ActivitySeverityNormal,
		TotalItems: 1,
		Counts:     observation.ActivityCounts{Running: 1},
	}
	timeline.Items[0].Status = observation.ActivityStatusRunning
	timeline.Items[0].Payload = map[string]any{"command": "sleep 5"}
	return timeline
}

func floretProjectionApprovalTimeline(runID string, threadID string, turnID string, toolID string, label string) *observation.ActivityTimeline {
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      threadID,
		TurnID:        turnID,
		TraceID:       runID,
		Summary: observation.ActivitySummary{
			Status:         observation.ActivityStatusWaiting,
			Severity:       observation.ActivitySeverityBlocking,
			NeedsAttention: true,
			TotalItems:     1,
			Counts:         observation.ActivityCounts{Waiting: 1, Approval: 1},
		},
		Items: []observation.ActivityItem{{
			ItemID:           "tool:" + toolID,
			ToolID:           toolID,
			ToolName:         "terminal.exec",
			Kind:             observation.ActivityKindTool,
			Status:           observation.ActivityStatusWaiting,
			Severity:         observation.ActivitySeverityBlocking,
			NeedsAttention:   true,
			RequiresApproval: true,
			ApprovalState:    "requested",
			Label:            label,
			Renderer:         observation.ActivityRendererTerminal,
			Payload:          map[string]any{"command": label},
		}},
	}
	return &timeline
}

func floretProjectionInvalidRequestedApprovalTimeline(runID string, threadID string, turnID string) *observation.ActivityTimeline {
	timeline := floretProjectionApprovalTimeline(runID, threadID, turnID, "exec-1", "curl -s https://example.test")
	timeline.Summary.Status = observation.ActivityStatusSuccess
	timeline.Summary.Severity = observation.ActivitySeverityNormal
	timeline.Summary.NeedsAttention = false
	timeline.Summary.Counts = observation.ActivityCounts{Success: 1, Approval: 1}
	timeline.Items[0].Status = observation.ActivityStatusSuccess
	timeline.Items[0].Severity = observation.ActivitySeverityNormal
	timeline.Items[0].NeedsAttention = false
	timeline.Items[0].EndedAtUnixMS = 20
	return timeline
}

func activityBlockItemByToolID(t *testing.T, block ActivityTimelineBlock, toolID string) observation.ActivityItem {
	t.Helper()
	for _, item := range block.Items {
		if item.ToolID == toolID {
			return item
		}
	}
	t.Fatalf("activity item for tool %q not found: %#v", toolID, block.Items)
	return observation.ActivityItem{}
}

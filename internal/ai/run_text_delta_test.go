package ai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
)

func TestTrimMarkdownDeltaOverlap_RemovesLargePrefixOverlap(t *testing.T) {
	t.Parallel()

	overlap := "The wind moved slowly across the moonlit forest."
	existing := "Prelude paragraph.\n" + overlap
	delta := overlap + " A new chapter begins."
	got := trimMarkdownDeltaOverlap(existing, delta)
	want := " A new chapter begins."
	if got != want {
		t.Fatalf("trimMarkdownDeltaOverlap got=%q want=%q", got, want)
	}
}

func TestTrimMarkdownDeltaOverlap_DropsExactTinyDuplicateSuffix(t *testing.T) {
	t.Parallel()

	existing := "hello world"
	delta := "world"
	if got := trimMarkdownDeltaOverlap(existing, delta); got != "" {
		t.Fatalf("trimMarkdownDeltaOverlap tiny duplicate got=%q want empty", got)
	}
}

func TestTrimMarkdownDeltaOverlap_LeavesDifferentDeltaUntouched(t *testing.T) {
	t.Parallel()

	existing := "chapter one"
	delta := "\nchapter two"
	if got := trimMarkdownDeltaOverlap(existing, delta); got != delta {
		t.Fatalf("trimMarkdownDeltaOverlap got=%q want=%q", got, delta)
	}
}

func activityTimelinePlaceholder(runID string) ActivityTimelineBlock {
	return newActivityTimelineBlock(observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		RunID:         runID,
		ThreadID:      "thread_" + runID,
		TurnID:        "msg_" + runID,
		TraceID:       runID,
		Summary: observation.ActivitySummary{
			Status:     observation.ActivityStatusSuccess,
			Severity:   observation.ActivitySeverityQuiet,
			TotalItems: 0,
			Counts:     observation.ActivityCounts{},
		},
		Items: []observation.ActivityItem{},
	}, nil)
}

func TestAssistantMarkdownTextSnapshot_JoinsMarkdownBlocksOnly(t *testing.T) {
	t.Parallel()

	r := &run{
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "first part"},
			activityTimelinePlaceholder("run_snapshot"),
			&persistedMarkdownBlock{Type: "markdown", Content: "second part"},
		},
	}
	got := r.assistantMarkdownTextSnapshot()
	want := "first part\n\nsecond part"
	if got != want {
		t.Fatalf("assistantMarkdownTextSnapshot got=%q want=%q", got, want)
	}
}

func TestAppendThinkingDelta_PreservesInitialMarkdownBlock(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID:                 "msg_reasoning",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		nextBlockIndex:            1,
		currentTextBlockIndex:     0,
		currentThinkingBlockIndex: -1,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: ""},
		},
	}

	if err := r.appendThinkingDelta("Inspecting repository layout."); err != nil {
		t.Fatalf("appendThinkingDelta: %v", err)
	}

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want 2", len(r.assistantBlocks))
	}
	initialBlock, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || initialBlock == nil {
		t.Fatalf("assistantBlocks[0]=%T, want *persistedMarkdownBlock", r.assistantBlocks[0])
	}
	if initialBlock.Content != "" {
		t.Fatalf("initial markdown content=%q, want empty", initialBlock.Content)
	}
	block, ok := r.assistantBlocks[1].(*persistedThinkingBlock)
	if !ok || block == nil {
		t.Fatalf("assistantBlocks[1]=%T, want *persistedThinkingBlock", r.assistantBlocks[1])
	}
	if block.Content != "Inspecting repository layout." {
		t.Fatalf("thinking content=%q", block.Content)
	}
	if !r.needNewTextBlock {
		t.Fatalf("needNewTextBlock=%v, want true", r.needNewTextBlock)
	}
	if len(events) != 2 {
		t.Fatalf("stream events=%d, want 2", len(events))
	}
	evStart, ok := events[0].(streamEventBlockStart)
	if !ok {
		t.Fatalf("event[0]=%T, want streamEventBlockStart", events[0])
	}
	if evStart.BlockIndex != 1 || evStart.BlockType != "thinking" || evStart.MessageID != "msg_reasoning" {
		t.Fatalf("block-start=%+v, want thinking block at index 1", evStart)
	}
	ev, ok := events[1].(streamEventBlockDelta)
	if !ok {
		t.Fatalf("event[1]=%T, want streamEventBlockDelta", events[1])
	}
	if ev.BlockIndex != 1 || ev.Delta != "Inspecting repository layout." {
		t.Fatalf("block-delta=%+v", ev)
	}
}

func TestCanonicalMarkdownTextSnapshot_UsesLatestCandidate(t *testing.T) {
	t.Parallel()

	r := &run{}
	r.setCanonicalMarkdownCandidate("first section")
	r.setCanonicalMarkdownCandidate("second section")

	if got, want := r.canonicalMarkdownTextSnapshot(""), "second section"; got != want {
		t.Fatalf("canonicalMarkdownTextSnapshot got=%q want=%q", got, want)
	}
}

func TestReconcileCanonicalMarkdownMessage_ReplacesPureMarkdownBlock(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		messageID: "msg_test",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "broken output"},
		},
	}
	r.setCanonicalMarkdownCandidate("clean output")

	if !r.reconcileCanonicalMarkdownMessage("") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned false, want true")
	}

	block, _ := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if block == nil || block.Content != "clean output" {
		t.Fatalf("assistant block=%+v, want clean output", block)
	}
	if len(events) != 1 {
		t.Fatalf("stream events=%d, want 1", len(events))
	}
	ev, ok := events[0].(streamEventBlockSet)
	if !ok {
		t.Fatalf("event type=%T, want streamEventBlockSet", events[0])
	}
	if ev.BlockIndex != 0 || ev.MessageID != "msg_test" {
		t.Fatalf("block-set=%+v, want index 0 and message id", ev)
	}
}

func TestReconcileCanonicalMarkdownMessage_AppendsCanonicalWithoutClearingEarlierMarkdown(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := &run{
		messageID: "msg_mixed",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "intro"},
			activityTimelinePlaceholder("run_mixed"),
			&persistedMarkdownBlock{Type: "markdown", Content: "teaser"},
		},
	}
	r.setCanonicalMarkdownCandidate("canonical")

	if !r.reconcileCanonicalMarkdownMessage("") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned false, want true")
	}

	first, _ := r.assistantBlocks[0].(*persistedMarkdownBlock)
	middle, _ := r.assistantBlocks[2].(*persistedMarkdownBlock)
	last, _ := r.assistantBlocks[3].(*persistedMarkdownBlock)
	if first == nil || first.Content != "intro" {
		t.Fatalf("assistantBlocks[0]=%+v, want preserved intro markdown block", first)
	}
	if middle == nil || middle.Content != "teaser" {
		t.Fatalf("assistantBlocks[2]=%+v, want preserved teaser markdown block", middle)
	}
	if last == nil || last.Content != "canonical" {
		t.Fatalf("assistantBlocks[3]=%+v, want appended canonical markdown block", last)
	}
	if len(events) != 2 {
		t.Fatalf("stream events=%d, want 2", len(events))
	}
	if _, ok := events[0].(streamEventBlockStart); !ok {
		t.Fatalf("event[0]=%T, want streamEventBlockStart", events[0])
	}
	firstEvent, ok := events[0].(streamEventBlockSet)
	if !ok {
		firstEvent, ok = events[1].(streamEventBlockSet)
		if !ok {
			t.Fatalf("event[1]=%T, want streamEventBlockSet", events[1])
		}
	}
	if firstEvent.BlockIndex != 3 {
		t.Fatalf("block-set=%+v, want canonical append at index 3", firstEvent)
	}
	firstBlock, ok := firstEvent.Block.(persistedMarkdownBlock)
	if !ok || firstBlock.Content != "canonical" {
		t.Fatalf("block-set block=%T %+v, want canonical markdown block", firstEvent.Block, firstEvent.Block)
	}
}

func TestReconcileCanonicalMarkdownMessage_AppendsMarkdownWhenNoMarkdownBlocksExist(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID: "msg_append",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedThinkingBlock{Type: "thinking", Content: "thinking"},
			activityTimelinePlaceholder("run_append"),
		},
		nextBlockIndex: 2,
	}
	r.setCanonicalMarkdownCandidate("canonical")

	if !r.reconcileCanonicalMarkdownMessage("") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned false, want true")
	}

	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want 3", len(r.assistantBlocks))
	}
	block, _ := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if block == nil || block.Content != "canonical" {
		t.Fatalf("assistantBlocks[2]=%+v, want appended canonical markdown block", block)
	}
	if len(events) != 2 {
		t.Fatalf("stream events=%d, want 2", len(events))
	}
	if _, ok := events[0].(streamEventBlockStart); !ok {
		t.Fatalf("event[0]=%T, want streamEventBlockStart", events[0])
	}
	if ev, ok := events[1].(streamEventBlockSet); !ok || ev.BlockIndex != 2 {
		t.Fatalf("event[1]=%+v, want block-set for index 2", events[1])
	}
}

func TestReconcileCanonicalMarkdownMessage_UpdatesPersistedAssistantSnapshotText(t *testing.T) {
	t.Parallel()

	r := &run{
		messageID:                "msg_snapshot",
		assistantCreatedAtUnixMs: 123,
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "intro"},
			activityTimelinePlaceholder("run_snapshot"),
			&persistedMarkdownBlock{Type: "markdown", Content: "teaser"},
		},
	}
	r.setCanonicalMarkdownCandidate("canonical final answer")

	if !r.reconcileCanonicalMarkdownMessage("") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned false, want true")
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "canonical final answer" {
		t.Fatalf("assistantText=%q, want canonical final answer", assistantText)
	}

	var msg persistedMessage
	if err := json.Unmarshal([]byte(rawJSON), &msg); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if len(msg.Blocks) != 4 {
		t.Fatalf("blocks len=%d, want 4", len(msg.Blocks))
	}

	first, ok := msg.Blocks[0].(map[string]any)
	if !ok || first["type"] != "markdown" || first["content"] != "intro" {
		t.Fatalf("blocks[0]=%T %+v, want preserved intro markdown block", msg.Blocks[0], msg.Blocks[0])
	}
	middle, ok := msg.Blocks[2].(map[string]any)
	if !ok || middle["type"] != "markdown" || middle["content"] != "teaser" {
		t.Fatalf("blocks[2]=%T %+v, want preserved teaser markdown block", msg.Blocks[2], msg.Blocks[2])
	}
	last, ok := msg.Blocks[3].(map[string]any)
	if !ok || last["type"] != "markdown" || last["content"] != "canonical final answer" {
		t.Fatalf("blocks[3]=%T %+v, want canonical final answer", msg.Blocks[3], msg.Blocks[3])
	}
}

func TestRecordTaskCompleteSignalPublishesActivityTimelineWithoutChangingAssistantText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		id:                       "run_task_complete_projection",
		messageID:                "msg_task_complete_projection",
		assistantCreatedAtUnixMs: 1700000000123,
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "Final user-visible answer."},
		},
		nextBlockIndex:        1,
		currentTextBlockIndex: 0,
	}

	r.recordTaskCompleteSignal("call_task_complete_1", "Final user-visible answer.", []string{" https://example.test/source ", ""})

	if len(events) != 1 {
		t.Fatalf("stream events=%d, want one activity update", len(events))
	}
	ev, ok := events[0].(streamEventBlockSet)
	if !ok {
		t.Fatalf("event type=%T, want streamEventBlockSet", events[0])
	}
	timeline, ok := ev.Block.(ActivityTimelineBlock)
	if !ok {
		t.Fatalf("event block=%T, want ActivityTimelineBlock", ev.Block)
	}
	if timeline.Type != activityTimelineBlockType || timeline.Summary.Status != observation.ActivityStatusSuccess {
		t.Fatalf("timeline=%#v, want successful activity timeline", timeline)
	}
	item, ok := findActivityItemInTimeline(timeline, "task_complete")
	if !ok {
		t.Fatalf("timeline missing task_complete item: %#v", timeline.Items)
	}
	if item.Status != observation.ActivityStatusSuccess || item.ToolID != "call_task_complete_1" || item.Kind != observation.ActivityKindControl {
		t.Fatalf("task_complete item=%#v, want successful original call id", item)
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Final user-visible answer." {
		t.Fatalf("assistantText=%q, want visible markdown only", assistantText)
	}
	if !json.Valid([]byte(rawJSON)) {
		t.Fatalf("assistant JSON invalid: %q", rawJSON)
	}
	if !strings.Contains(rawJSON, `"tool_name":"task_complete"`) {
		t.Fatalf("assistant JSON missing task_complete timeline: %s", rawJSON)
	}
}

func findActivityItemInTimeline(timeline ActivityTimelineBlock, toolName string) (observation.ActivityItem, bool) {
	for _, item := range timeline.Items {
		if item.ToolName == toolName {
			return item, true
		}
	}
	return observation.ActivityItem{}, false
}

func TestReconcileCanonicalWaitingUserMessage_ClearsProvisionalMarkdownBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	prompt := normalizeRequestUserInputPrompt(&RequestUserInputPrompt{
		PromptID:   "rui_msg_waiting_user_tool_waiting",
		MessageID:  "msg_waiting_user",
		ToolID:     "tool_waiting",
		ToolName:   "ask_user",
		ReasonCode: AskUserReasonUserDecisionRequired,
		Questions: []RequestUserInputQuestion{{
			ID:                "question_1",
			Header:            "Need input",
			Question:          "Choose the next direction.",
			ResponseMode:      requestUserInputResponseModeSelect,
			ChoicesExhaustive: testBoolPtr(true),
			Choices: []RequestUserInputChoice{{
				ChoiceID: "choice_1",
				Label:    "Option 1",
				Kind:     requestUserInputChoiceKindSelect,
			}},
		}},
	})
	if prompt == nil {
		t.Fatalf("prompt should not be nil")
	}
	r := &run{
		messageID: "msg_waiting_user",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "Provisional question text"},
			activityTimelinePlaceholder("run_waiting_user"),
		},
	}
	r.setWaitingPrompt(prompt)

	if !r.reconcileCanonicalWaitingUserMessage() {
		t.Fatalf("reconcileCanonicalWaitingUserMessage returned false, want true")
	}

	block, _ := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if block == nil || block.Content != "" {
		t.Fatalf("assistantBlocks[0]=%+v, want cleared markdown block", block)
	}
	if len(events) != 1 {
		t.Fatalf("stream events=%d, want 1", len(events))
	}
	ev, ok := events[0].(streamEventBlockSet)
	if !ok {
		t.Fatalf("event type=%T, want streamEventBlockSet", events[0])
	}
	if ev.BlockIndex != 0 || ev.MessageID != "msg_waiting_user" {
		t.Fatalf("block-set=%+v, want markdown clear for index 0", ev)
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "Choose the next direction." {
		t.Fatalf("assistantText=%q, want ask_user summary fallback", assistantText)
	}
	if !json.Valid([]byte(rawJSON)) {
		t.Fatalf("assistant JSON invalid: %q", rawJSON)
	}
}

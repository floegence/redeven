package ai

import (
	"encoding/json"
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

	if !r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
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

func TestReconcileCanonicalMarkdownMessage_PreservesMultipleVisibleMarkdownBlocks(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
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

	if r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned true, want false")
	}

	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want original markdown, activity, and markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	intro, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || intro == nil || intro.Content != "intro" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved intro markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	teaser, ok := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if !ok || teaser == nil || teaser.Content != "teaser" {
		t.Fatalf("assistantBlocks[2]=%T %+v, want preserved teaser markdown", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none: %#v", len(events), events)
	}
}

func TestReconcileCanonicalMarkdownMessage_DoesNotClearEarlierMarkdownWhenTargetMatchesCanonical(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		messageID: "msg_mixed_canonical",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "intro"},
			activityTimelinePlaceholder("run_mixed_canonical"),
			&persistedMarkdownBlock{Type: "markdown", Content: "canonical"},
		},
	}
	r.setCanonicalMarkdownCandidate("canonical")

	if r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned true, want false")
	}

	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want preserved markdown, activity timeline, and canonical markdown: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	intro, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || intro == nil || intro.Content != "intro" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved intro markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	canonical, ok := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if !ok || canonical == nil || canonical.Content != "canonical" {
		t.Fatalf("assistantBlocks[2]=%T %+v, want canonical markdown", r.assistantBlocks[2], r.assistantBlocks[2])
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none: %#v", len(events), events)
	}
}

func TestReconcileCanonicalMarkdownMessage_DoesNotUpdateVisibleMarkdownAfterActivityTimeline(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 1)
	r := &run{
		messageID: "msg_canonical_after_activity",
		onStreamEvent: func(ev any) {
			events = append(events, ev)
		},
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "intro"},
			activityTimelinePlaceholder("run_canonical_after_activity"),
		},
		nextBlockIndex: 2,
	}
	r.setCanonicalMarkdownCandidate("canonical")

	if r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned true, want false")
	}

	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want original markdown and activity timeline: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	intro, ok := r.assistantBlocks[0].(*persistedMarkdownBlock)
	if !ok || intro == nil || intro.Content != "intro" {
		t.Fatalf("assistantBlocks[0]=%T %+v, want preserved intro markdown", r.assistantBlocks[0], r.assistantBlocks[0])
	}
	if _, ok := r.assistantBlocks[1].(ActivityTimelineBlock); !ok {
		t.Fatalf("assistantBlocks[1]=%T, want activity timeline", r.assistantBlocks[1])
	}
	if len(events) != 0 {
		t.Fatalf("stream events=%d, want none: %#v", len(events), events)
	}
}

func TestReconcileCanonicalMarkdownMessage_CreatesCanonicalMarkdownWhenNoMarkdownBlocksExist(t *testing.T) {
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

	if !r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned false, want true")
	}

	if len(r.assistantBlocks) != 3 {
		t.Fatalf("assistantBlocks len=%d, want 3", len(r.assistantBlocks))
	}
	block, _ := r.assistantBlocks[2].(*persistedMarkdownBlock)
	if block == nil || block.Content != "canonical" {
		t.Fatalf("assistantBlocks[2]=%+v, want canonical markdown block", block)
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

func TestReconcileCanonicalMarkdownMessage_SnapshotTextUsesVisibleMarkdownBeforeCanonical(t *testing.T) {
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

	if r.reconcileCanonicalMarkdownMessage(canonicalMarkdownSourceNaturalStop, "") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned true, want false")
	}

	rawJSON, assistantText, _, err := r.snapshotAssistantMessageJSON()
	if err != nil {
		t.Fatalf("snapshotAssistantMessageJSON: %v", err)
	}
	if assistantText != "intro\n\nteaser" {
		t.Fatalf("assistantText=%q, want visible markdown summary", assistantText)
	}

	var msg persistedMessage
	if err := json.Unmarshal([]byte(rawJSON), &msg); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if len(msg.Blocks) != 3 {
		t.Fatalf("blocks len=%d, want visible markdown, activity timeline, and visible markdown", len(msg.Blocks))
	}

	intro, ok := msg.Blocks[0].(map[string]any)
	if !ok || intro["type"] != "markdown" || intro["content"] != "intro" {
		t.Fatalf("blocks[0]=%T %+v, want intro markdown", msg.Blocks[0], msg.Blocks[0])
	}
	activity, ok := msg.Blocks[1].(map[string]any)
	if !ok || activity["type"] != activityTimelineBlockType {
		t.Fatalf("blocks[1]=%T %+v, want activity timeline", msg.Blocks[1], msg.Blocks[1])
	}
	teaser, ok := msg.Blocks[2].(map[string]any)
	if !ok || teaser["type"] != "markdown" || teaser["content"] != "teaser" {
		t.Fatalf("blocks[2]=%T %+v, want teaser markdown", msg.Blocks[2], msg.Blocks[2])
	}
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

package ai

import "testing"

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

func TestAssistantMarkdownTextSnapshot_JoinsMarkdownBlocksOnly(t *testing.T) {
	t.Parallel()

	r := &run{
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "first part"},
			ToolCallBlock{Type: "tool-call", ToolName: "terminal.exec"},
			&persistedMarkdownBlock{Type: "markdown", Content: "second part"},
		},
	}
	got := r.assistantMarkdownTextSnapshot()
	want := "first part\n\nsecond part"
	if got != want {
		t.Fatalf("assistantMarkdownTextSnapshot got=%q want=%q", got, want)
	}
}

func TestAppendThinkingDelta_ReusesInitialMarkdownBlock(t *testing.T) {
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

	block, ok := r.assistantBlocks[0].(*persistedThinkingBlock)
	if !ok || block == nil {
		t.Fatalf("assistantBlocks[0]=%T, want *persistedThinkingBlock", r.assistantBlocks[0])
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
	if _, ok := events[0].(streamEventBlockSet); !ok {
		t.Fatalf("event[0]=%T, want streamEventBlockSet", events[0])
	}
	ev, ok := events[1].(streamEventBlockDelta)
	if !ok {
		t.Fatalf("event[1]=%T, want streamEventBlockDelta", events[1])
	}
	if ev.BlockIndex != 0 || ev.Delta != "Inspecting repository layout." {
		t.Fatalf("block-delta=%+v", ev)
	}
}

func TestCanonicalMarkdownTextSnapshot_JoinsRememberedTurns(t *testing.T) {
	t.Parallel()

	r := &run{}
	r.rememberCanonicalMarkdownTurn("first section")
	r.rememberCanonicalMarkdownTurn("second section")

	if got, want := r.canonicalMarkdownTextSnapshot(""), "first section\n\nsecond section"; got != want {
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
	r.rememberCanonicalMarkdownTurn("clean output")

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

func TestReconcileCanonicalMarkdownMessage_SkipsMixedBlocks(t *testing.T) {
	t.Parallel()

	r := &run{
		assistantBlocks: []any{
			&persistedMarkdownBlock{Type: "markdown", Content: "keep"},
			ToolCallBlock{Type: "tool-call", ToolName: "terminal.exec"},
		},
	}
	r.rememberCanonicalMarkdownTurn("canonical")

	if r.reconcileCanonicalMarkdownMessage("") {
		t.Fatalf("reconcileCanonicalMarkdownMessage returned true, want false")
	}
}

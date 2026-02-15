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

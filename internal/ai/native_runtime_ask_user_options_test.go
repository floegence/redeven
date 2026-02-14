package ai

import (
	"strings"
	"testing"
)

func TestNormalizeAskUserOptions(t *testing.T) {
	tooLong := strings.Repeat("x", 140)
	got := normalizeAskUserOptions([]string{
		"  Keep current strategy  ",
		"",
		"keep current strategy",
		"Show trade-offs first",
		tooLong,
		"Proceed with option D",
		"Proceed with option E",
	})
	if len(got) != 4 {
		t.Fatalf("normalizeAskUserOptions length=%d, want 4, got=%v", len(got), got)
	}
	if got[0] != "Keep current strategy" {
		t.Fatalf("first option=%q, want %q", got[0], "Keep current strategy")
	}
	if got[1] != "Show trade-offs first" {
		t.Fatalf("second option=%q, want %q", got[1], "Show trade-offs first")
	}
	if !strings.Contains(got[2], "(truncated)") {
		t.Fatalf("third option should be truncated marker, got=%q", got[2])
	}
	if got[3] != "Proceed with option D" {
		t.Fatalf("fourth option=%q, want %q", got[3], "Proceed with option D")
	}
}

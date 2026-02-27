package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyUnifiedDiff_AcceptsCodexBeginPatchAddFile(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Add File: note.txt",
		"+hello",
		"+world",
		"*** End Patch",
	}, "\n")

	if _, err := applyUnifiedDiff(workingDir, patch); err != nil {
		t.Fatalf("applyUnifiedDiff: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(workingDir, "note.txt"))
	if err != nil {
		t.Fatalf("read note.txt: %v", err)
	}
	if string(got) != "hello\nworld\n" {
		t.Fatalf("note.txt=%q, want %q", string(got), "hello\nworld\n")
	}
}

func TestApplyUnifiedDiff_CodexUpdateWithoutLineNumbers(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	path := filepath.Join(workingDir, "large.txt")
	lines := make([]string, 0, 240)
	for i := 1; i <= 240; i++ {
		lines = append(lines, fmt.Sprintf("line%03d", i))
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("write large.txt: %v", err)
	}

	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Update File: large.txt",
		"@@",
		" line178",
		"-line179",
		"+line179-updated",
		" line180",
		"*** End Patch",
	}, "\n")

	if _, err := applyUnifiedDiff(workingDir, patch); err != nil {
		t.Fatalf("applyUnifiedDiff: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read large.txt: %v", err)
	}
	text := string(got)
	if !strings.Contains(text, "line179-updated\n") {
		t.Fatalf("missing updated line, content=%q", text)
	}
	if strings.Contains(text, "line179\n") {
		t.Fatalf("old line still present, content=%q", text)
	}
}

func TestSummarizeUnifiedDiff_CodexPatch(t *testing.T) {
	t.Parallel()

	patch := strings.Join([]string{
		"*** Begin Patch",
		"*** Update File: large.txt",
		"@@",
		" line178",
		"-line179",
		"+line179-updated",
		" line180",
		"*** End Patch",
	}, "\n")

	filesChanged, hunks, additions, deletions := summarizeUnifiedDiff(patch)
	if filesChanged != 1 || hunks != 1 || additions != 1 || deletions != 1 {
		t.Fatalf(
			"summary=(files=%d hunks=%d +%d -%d), want (1,1,+1,-1)",
			filesChanged,
			hunks,
			additions,
			deletions,
		)
	}
}

func TestApplyUnifiedDiff_ReportsInputAndNormalizedFormat(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	patch := strings.Join([]string{
		"diff --git a/note.txt b/note.txt",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/note.txt",
		"@@ -0,0 +1 @@",
		"+hello",
	}, "\n")

	parsed, err := applyUnifiedDiff(workingDir, patch)
	if err != nil {
		t.Fatalf("applyUnifiedDiff: %v", err)
	}
	if parsed.inputFormat != patchInputFormatUnifiedDiff {
		t.Fatalf("inputFormat=%q, want %q", parsed.inputFormat, patchInputFormatUnifiedDiff)
	}
	if parsed.normalizedFormat != patchInputFormatBeginPatch {
		t.Fatalf("normalizedFormat=%q, want %q", parsed.normalizedFormat, patchInputFormatBeginPatch)
	}
}

func TestApplyUnifiedDiff_RejectsAbsoluteAndEscapingPatchPaths(t *testing.T) {
	t.Parallel()

	workingDir := t.TempDir()
	absolutePatch := strings.Join([]string{
		"*** Begin Patch",
		"*** Add File: /tmp/escape.txt",
		"+hello",
		"*** End Patch",
	}, "\n")
	if _, err := applyUnifiedDiff(workingDir, absolutePatch); err == nil || !strings.Contains(err.Error(), "invalid path") {
		t.Fatalf("absolute patch err=%v, want invalid path", err)
	}

	escapePatch := strings.Join([]string{
		"*** Begin Patch",
		"*** Add File: ../escape.txt",
		"+hello",
		"*** End Patch",
	}, "\n")
	if _, err := applyUnifiedDiff(workingDir, escapePatch); err == nil || !strings.Contains(err.Error(), "invalid path") {
		t.Fatalf("escape patch err=%v, want invalid path", err)
	}
}

package ai

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyPatchAcceptsUniqueReversedChunks(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "scene.txt")
	before := "debug guard\nkeep render\n" + strings.Repeat("unchanged\n", 20) + "lane=left\nshard=left\n"
	if err := os.WriteFile(path, []byte(before), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: scene.txt\n@@\n-lane=left\n-shard=left\n+lane=center\n+shard=center\n@@\n-debug guard\n keep render\n*** End Patch"
	result, err := applyUnifiedDiff(dir, patch)
	if err != nil {
		t.Fatal(err)
	}
	want := strings.ReplaceAll(strings.TrimPrefix(before, "debug guard\n"), "=left", "=center")
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("contents=%q, error=%v; result=%+v", got, err, result)
	}
}

func TestApplyPatchUniqueChunkPermutations(t *testing.T) {
	t.Parallel()
	chunks := []string{
		"@@\n-top\n+TOP\n+inserted\n keep",
		"@@\n-middle",
		"@@\n-bottom\n+BOTTOM",
	}
	for _, order := range [][3]int{{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}} {
		for _, tc := range []struct{ before, after string }{
			{"top\nkeep\nmiddle\nbottom\n", "TOP\ninserted\nkeep\nBOTTOM\n"},
			{"top\r\nkeep\nmiddle\r\nbottom", "TOP\r\ninserted\r\nkeep\nBOTTOM\r\n"},
		} {
			patch := "*** Begin Patch\n*** Update File: f.txt\n" + chunks[order[0]] + "\n" + chunks[order[1]] + "\n" + chunks[order[2]] + "\n*** End Patch"
			parsed, err := parsePatchText(patch)
			if err != nil {
				t.Fatal(err)
			}
			got, err := applyUnifiedDiffHunksToBytes([]byte(tc.before), parsed.files[0].hunks)
			if err != nil || string(got) != tc.after {
				t.Fatalf("order=%v: got %q, error=%v, want %q", order, got, err, tc.after)
			}
		}
	}
}

func TestApplyPatchRejectsUnsafeReorderingWithoutEffects(t *testing.T) {
	t.Parallel()
	const reverse = "@@\n-late\n+LATE\n@@\n-early\n+EARLY"
	for _, tc := range []struct{ name, before, body string }{
		{"ambiguous_first", "early\nlate\nlate\n", reverse},
		{"ambiguous_later", "early\nearly\nlate\n", reverse},
		{"normalized_first", "early\nlate  \n", reverse},
		{"normalized_later", "early  \nlate\n", reverse},
		{"overlap_after_reorder", "early\nmiddle\nlate\n", reverse + "\n middle\n@@\n-middle\n+MIDDLE"},
		{"stale_later_chunk", "early\nmiddle\nlate\n", reverse + "\n@@\n-absent\n+present"},
		{"depends_on_new_text", "early\nmiddle\nlate\n", reverse + "\n@@\n-LATE\n+later"},
		{"pure_addition", "early\nlate\n", reverse + "\n@@\n+extra"},
		{"anchor", "early\nsection:\nlate\n", strings.Replace(reverse, "@@", "@@ section:", 1)},
		{"eof", "early\nlate\n", strings.Replace(reverse, "+LATE", "+LATE\n*** End of File", 1)},
		{"numeric_range", "early\nlate\n", strings.Replace(reverse, "@@", "@@ -2,1 +2,1 @@", 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "f.txt")
			if err := os.WriteFile(path, []byte(tc.before), 0600); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Add File: first.txt\n+first\n*** Update File: f.txt\n" + tc.body + "\n*** End Patch"
			_, err := applyUnifiedDiff(dir, patch)
			var failure *patchApplyError
			if !errors.As(err, &failure) || patchToolError(failure).Meta["effect"] != "none" {
				t.Fatalf("expected rejection without effects, got %v", err)
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != tc.before {
				t.Fatalf("rejected patch changed file: %q, %v", got, err)
			}
			if _, err := os.Stat(filepath.Join(dir, "first.txt")); !os.IsNotExist(err) {
				t.Fatalf("rejected patch created file: %v", err)
			}
		})
	}
}

func TestApplyPatchReorderedFileStillValidatesWholePlan(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	const before = "early\nlate\n"
	if err := os.WriteFile(path, []byte(before), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: f.txt\n@@\n-late\n+LATE\n@@\n-early\n+EARLY\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch"
	if _, err := applyUnifiedDiff(dir, patch); err == nil {
		t.Fatal("accepted missing file")
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != before {
		t.Fatalf("failed plan committed reordered file: %q, %v", got, err)
	}
}

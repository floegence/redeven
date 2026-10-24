package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyPatchCanonicalChunkSemantics(t *testing.T) {
	t.Parallel()
	cases := []struct{ name, before, body, after string }{
		{"anchor", "alpha:\nsame\nbeta:\nsame\n", "@@ beta:\n-same\n+changed", "alpha:\nsame\nbeta:\nchanged\n"},
		{"eof", "same\nmiddle\nsame\n", "@@\n-same\n+changed\n*** End of File", "same\nmiddle\nchanged\n"},
		{"append", "a\nb\n", "@@\n+c", "a\nb\nc\n"},
		{"forward_original", "a\nb\na\nb\n", "@@\n-a\n+b\n@@\n-b\n+c", "b\nc\na\nb\n"},
		{"crlf", "a\r\nb\r\n", "@@\n-b\n+c", "a\r\nc\r\n"},
		{"mixed_endings", "a\r\nb\nc\r\n", "@@\n a\n-b\n+B\n c", "a\r\nB\r\nc\r\n"},
		{"no_final_newline", "a\nb", "@@\n-b\n+c", "a\nc\n"},
		{"empty_file", "", "@@\n+first", "first\n"},
		{"delete_all", "a\n", "@@\n-a", ""},
		{"trailing_blank_context", "a\n\n", "@@\n-a\n+b\n ", "b\n\n"},
		{"delete_trailing_blank", "a\n\n", "@@\n a\n-\n*** End of File", "a\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "f.txt")
			if err := os.WriteFile(path, []byte(tc.before), 0600); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Update File: f.txt\n" + tc.body + "\n*** End Patch"
			if _, err := applyUnifiedDiff(dir, patch); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tc.after {
				t.Fatalf("got %q, want %q", got, tc.after)
			}
		})
	}
}

func TestApplyPatchAbsolutePathInsideWorkingDirectory(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(path, []byte("before\n"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: " + path + "\n@@\n-before\n+after\n*** End Patch"
	if _, err := applyUnifiedDiff(dir, patch); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "after\n" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyPatchRejectsSymlinkEscapeBeforeAnyWrite(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Add File: safe.txt\n+safe\n*** Add File: link/new.txt\n+escape\n*** End Patch"
	if _, err := applyUnifiedDiff(dir, patch); err == nil {
		t.Fatal("accepted symlink escape")
	}
	for _, path := range []string{filepath.Join(dir, "safe.txt"), filepath.Join(outside, "new.txt")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("unexpected write: %s (%v)", path, err)
		}
	}
}

func TestApplyPatchMissingContextReportsFileAndChunk(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("unchanged\n"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: f.txt\n@@ absent-anchor\n-old\n+new\n*** End Patch"
	_, err := applyUnifiedDiff(dir, patch)
	if err == nil {
		t.Fatal("missing context accepted")
	}
	for _, want := range []string{"f.txt", "chunk 1", "absent-anchor", "read", "no files changed"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q missing %q", err, want)
		}
	}
	got, _ := os.ReadFile(path)
	if string(got) != "unchanged\n" {
		t.Fatalf("failed validation changed file: %q", got)
	}
}

func TestApplyPatchOperationsAndCollisionContract(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	for name, content := range map[string]string{"existing.txt": "old\n", "source.txt": "source\n", "destination.txt": "destination\n", "delete.txt": "delete\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// Preserve the established host behavior: explicit Add and Move may replace
	// existing regular files. Their actual before/after diff must tell the truth.
	patch := "*** Begin Patch\n*** Add File: existing.txt\n+replacement\n*** Update File: source.txt\n*** Move to: destination.txt\n@@\n-source\n+moved\n*** Delete File: delete.txt\n*** End Patch"
	result, err := applyUnifiedDiff(dir, patch)
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{"existing.txt": "replacement\n", "destination.txt": "moved\n"} {
		got, _ := os.ReadFile(filepath.Join(dir, name))
		if string(got) != want {
			t.Fatalf("%s=%q", name, got)
		}
	}
	for _, name := range []string{"source.txt", "delete.txt"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("retained %s: %v", name, err)
		}
	}
	if len(result.mutations) != 3 {
		t.Fatalf("mutations=%+v", result.mutations)
	}
}

func TestApplyPatchRejectsInvalidPlanBeforeWriting(t *testing.T) {
	t.Parallel()
	cases := []struct{ name, body string }{
		{"missing_anchor", "*** Update File: f.txt\n@@ absent\n-old\n+new"},
		{"backwards_eof", "*** Update File: f.txt\n@@\n-tail\n+TAIL\n*** End of File\n@@\n-old\n+NEW"},
		{"duplicate_file", "*** Update File: f.txt\n@@\n-old\n+new\n*** Update File: f.txt\n@@\n-tail\n+TAIL"},
		{"move_outside", "*** Update File: f.txt\n*** Move to: ../outside.txt\n@@\n-old\n+new"},
		{"directory_target", "*** Add File: directory\n+bad"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("old\ntail\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(dir, "directory"), 0700); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Add File: first.txt\n+first\n" + tc.body + "\n*** End Patch"
			if _, err := applyUnifiedDiff(dir, patch); err == nil {
				t.Fatal("accepted invalid plan")
			}
			got, _ := os.ReadFile(filepath.Join(dir, "f.txt"))
			if string(got) != "old\ntail\n" {
				t.Fatalf("mutated file: %q", got)
			}
			if _, err := os.Stat(filepath.Join(dir, "first.txt")); !os.IsNotExist(err) {
				t.Fatal("partial write during validation")
			}
		})
	}
}

func TestApplyPatchPreservesMarkerTextInContext(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	before := "*** Update File: example.txt\nold\n"
	if err := os.WriteFile(path, []byte(before), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: f.txt\n@@\n *** Update File: example.txt\n-old\n+new\n*** End Patch"
	if _, err := applyUnifiedDiff(dir, patch); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "*** Update File: example.txt\nnew\n" {
		t.Fatalf("got=%q", got)
	}
}

func TestApplyPatchNumericInsertionAndMultipleChanges(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("a\nb\nc\nd\n"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,0 +2,1 @@\n+insert\n@@ -3,1 +4,1 @@\n-c\n+C\n"
	if _, err := applyUnifiedDiff(dir, patch); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "a\ninsert\nb\nC\nd\n" {
		t.Fatalf("got=%q", got)
	}
}

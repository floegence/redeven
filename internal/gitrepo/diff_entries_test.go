package gitrepo

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestParseGitDiffEntries_RenameEntryEmbedsPatchText(t *testing.T) {
	t.Parallel()

	raw := strings.Join([]string{
		"diff --git a/src/app.txt b/src/main.txt",
		"similarity index 60%",
		"rename from src/app.txt",
		"rename to src/main.txt",
		"index 1111111..2222222 100644",
		"--- a/src/app.txt",
		"+++ b/src/main.txt",
		"@@ -1 +1 @@",
		"-oldValue",
		"+newValue",
	}, "\n")

	entries := parseGitDiffEntries([]byte(raw))
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	entry := entries[0]
	if entry.ChangeType != "renamed" {
		t.Fatalf("ChangeType=%q, want renamed", entry.ChangeType)
	}
	if entry.OldPath != "src/app.txt" || entry.NewPath != "src/main.txt" || entry.Path != "src/main.txt" {
		t.Fatalf("unexpected rename paths: %+v", entry)
	}
	if entry.DisplayPath != "src/main.txt" {
		t.Fatalf("DisplayPath=%q, want src/main.txt", entry.DisplayPath)
	}
	if entry.Additions != 1 || entry.Deletions != 1 {
		t.Fatalf("additions/deletions=%d/%d, want 1/1", entry.Additions, entry.Deletions)
	}
	if !strings.Contains(entry.PatchText, "rename to src/main.txt") || !strings.Contains(entry.PatchText, "+newValue") {
		t.Fatalf("unexpected patch text: %q", entry.PatchText)
	}
	if entry.PatchTruncated {
		t.Fatalf("PatchTruncated=true, want false")
	}
}

func TestParseGitDiffEntries_HandlesQuotedAndBinaryEntries(t *testing.T) {
	t.Parallel()

	raw := strings.Join([]string{
		"diff --git \"a/docs/My File (draft).md\" \"b/docs/My File (draft).md\"",
		"index 1111111..2222222 100644",
		"--- \"a/docs/My File (draft).md\"",
		"+++ \"b/docs/My File (draft).md\"",
		"@@ -1 +1 @@",
		"-old",
		"+new",
		"diff --git a/bin/data.bin b/bin/data.bin",
		"new file mode 100644",
		"index 0000000..1234567",
		"Binary files /dev/null and b/bin/data.bin differ",
	}, "\n")

	entries := parseGitDiffEntries([]byte(raw))
	if len(entries) != 2 {
		t.Fatalf("entries=%d, want 2", len(entries))
	}

	quoted := entries[0]
	if quoted.Path != "docs/My File (draft).md" || quoted.DisplayPath != "docs/My File (draft).md" {
		t.Fatalf("unexpected quoted-path entry: %+v", quoted)
	}
	if !strings.Contains(quoted.PatchText, "@@ -1 +1 @@") || quoted.Additions != 1 || quoted.Deletions != 1 {
		t.Fatalf("unexpected quoted-path patch payload: %+v", quoted)
	}

	binary := entries[1]
	if binary.Path != "bin/data.bin" || binary.ChangeType != "added" || !binary.IsBinary {
		t.Fatalf("unexpected binary entry: %+v", binary)
	}
	if !strings.Contains(binary.PatchText, "Binary files /dev/null and b/bin/data.bin differ") {
		t.Fatalf("binary patch text missing payload: %q", binary.PatchText)
	}
}

func TestParseGitDiffEntries_HandlesModeOnlyAndCombinedDiff(t *testing.T) {
	t.Parallel()

	raw := strings.Join([]string{
		"diff --git a/scripts/run.sh b/scripts/run.sh",
		"old mode 100644",
		"new mode 100755",
		"diff --cc src/conflict.txt",
		"index 1111111,2222222..3333333",
		"--- a/src/conflict.txt",
		"+++ b/src/conflict.txt",
		"@@@ -1,1 -1,1 +1,1 @@@",
		"-ours",
		" -theirs",
		"++merged",
	}, "\n")

	entries := parseGitDiffEntries([]byte(raw))
	if len(entries) != 2 {
		t.Fatalf("entries=%d, want 2", len(entries))
	}

	modeOnly := entries[0]
	if modeOnly.Path != "scripts/run.sh" || modeOnly.ChangeType != "modified" {
		t.Fatalf("unexpected mode-only entry: %+v", modeOnly)
	}
	if strings.TrimSpace(modeOnly.PatchText) == "" || modeOnly.Additions != 0 || modeOnly.Deletions != 0 {
		t.Fatalf("unexpected mode-only payload: %+v", modeOnly)
	}

	combined := entries[1]
	if combined.Path != "src/conflict.txt" || combined.DisplayPath != "src/conflict.txt" {
		t.Fatalf("unexpected combined entry path: %+v", combined)
	}
	if !strings.Contains(combined.PatchText, "@@@ -1,1 -1,1 +1,1 @@@") || !strings.Contains(combined.PatchText, "++merged") {
		t.Fatalf("combined patch text missing content: %q", combined.PatchText)
	}
}

func TestTruncateEmbeddedPatchText_PreservesUTF8(t *testing.T) {
	t.Parallel()

	text := "diff --git a/a.txt b/a.txt\n+你好世界"
	trimmed, truncated := truncateEmbeddedPatchText(text, len("diff --git a/a.txt b/a.txt\n+")+1)
	if !truncated {
		t.Fatalf("expected truncation")
	}
	if !strings.HasPrefix(trimmed, "diff --git a/a.txt b/a.txt") {
		t.Fatalf("unexpected trimmed prefix: %q", trimmed)
	}
	if !utf8.ValidString(trimmed) {
		t.Fatalf("trimmed text is not valid utf-8: %q", trimmed)
	}
}

package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/filesystemscope"
)

func TestToolFileRead_RespectsLineWindowAndScope(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	if err := os.WriteFile(target, []byte("line-1\nline-2\nline-3\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolFileRead(context.Background(), FileReadArgs{
		FilePath: "note.txt",
		Offset:   2,
		Limit:    1,
	})
	if err != nil {
		t.Fatalf("toolFileRead: %v", err)
	}
	if strings.TrimSpace(out.Content) != "line-2" {
		t.Fatalf("content=%q, want %q", out.Content, "line-2")
	}
	if out.LineOffset != 2 || out.LineCount != 1 || out.TotalLines != 3 || !out.Truncated {
		t.Fatalf("unexpected window=%+v", out)
	}

	if _, err := r.toolFileRead(context.Background(), FileReadArgs{
		FilePath: filepath.Join(string(os.PathSeparator), "tmp", "outside.txt"),
	}); err == nil {
		t.Fatalf("expected out-of-scope read to fail")
	}
}

func TestToolFileRead_RejectsNonRegularBinaryAndLargeFiles(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.Mkdir(filepath.Join(workspace, "dir"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "binary.dat"), []byte{0xff, 0xfe, 0xfd}, 0o644); err != nil {
		t.Fatalf("write binary: %v", err)
	}
	large, err := os.Create(filepath.Join(workspace, "large.txt"))
	if err != nil {
		t.Fatalf("create large: %v", err)
	}
	if err := large.Truncate(maxFileReadBytes + 1); err != nil {
		_ = large.Close()
		t.Fatalf("truncate large: %v", err)
	}
	if err := large.Close(); err != nil {
		t.Fatalf("close large: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	for _, tc := range []struct {
		name     string
		path     string
		wantText string
	}{
		{name: "directory", path: "dir", wantText: "regular file"},
		{name: "binary", path: "binary.dat", wantText: "UTF-8"},
		{name: "large", path: "large.txt", wantText: "too large"},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := r.toolFileRead(context.Background(), FileReadArgs{FilePath: tc.path})
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("toolFileRead(%s) error=%v, want %q", tc.path, err, tc.wantText)
			}
		})
	}
}

func TestToolReadFiles_ReturnsPerFileStatus(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "a.txt"), []byte("alpha\n"), 0o644); err != nil {
		t.Fatalf("write a.txt: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadFiles(context.Background(), []string{"a.txt", "missing.txt"}, 20)
	if err != nil {
		t.Fatalf("toolReadFiles: %v", err)
	}
	if len(out.Files) != 2 {
		t.Fatalf("files=%d, want 2", len(out.Files))
	}
	if out.Files[0].Result == nil || strings.TrimSpace(out.Files[0].Result.Content) != "alpha" || out.Files[0].Error != "" {
		t.Fatalf("first result=%+v, want alpha without error", out.Files[0])
	}
	if out.Files[1].Result != nil || out.Files[1].Error == "" {
		t.Fatalf("second result=%+v, want per-file error", out.Files[1])
	}
}

func TestReadonlyFind_FiltersWithoutFollowingSymlinks(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	srcDir := filepath.Join(workspace, "src")
	if err := os.MkdirAll(filepath.Join(srcDir, ".hidden"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("write main.go: %v", err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, ".hidden", "secret.go"), []byte("package hidden\n"), 0o644); err != nil {
		t.Fatalf("write hidden: %v", err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.go"), []byte("package outside\n"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(srcDir, "outside-link")); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadonlyFind(context.Background(), "src", "*.go", "file", 20, 4, false)
	if err != nil {
		t.Fatalf("toolReadonlyFind: %v", err)
	}
	got := make([]string, 0, len(out.Results))
	for _, item := range out.Results {
		got = append(got, item.DisplayName)
		if strings.Contains(item.Path, "outside.go") {
			t.Fatalf("find followed outside symlink: %+v", item)
		}
	}
	if strings.Join(got, ",") != "main.go" {
		t.Fatalf("results=%v, want main.go only", got)
	}

	hidden, err := r.toolReadonlyFind(context.Background(), "src", "*.go", "file", 20, 4, true)
	if err != nil {
		t.Fatalf("toolReadonlyFind include hidden: %v", err)
	}
	if len(hidden.Results) != 2 {
		t.Fatalf("hidden results=%+v, want main.go and secret.go", hidden.Results)
	}
}

func TestReadonlyFind_StopsAtVisitedEntryBudgetWithoutMatches(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	for i := 0; i < readonlyFindMaxVisitedEntries+5; i++ {
		if err := os.WriteFile(filepath.Join(workspace, fmt.Sprintf("file-%05d.txt", i)), []byte("no match\n"), 0o644); err != nil {
			t.Fatalf("write fixture %d: %v", i, err)
		}
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadonlyFind(context.Background(), ".", "definitely-missing-*.txt", "file", 10, 1, true)
	if err != nil {
		t.Fatalf("toolReadonlyFind: %v", err)
	}
	if len(out.Results) != 0 {
		t.Fatalf("results=%+v, want no matches", out.Results)
	}
	if !out.Truncated {
		t.Fatalf("Truncated=false, want true after visited-entry budget")
	}
	if out.Stats["limit_reason"] != "max_visited_entries" {
		t.Fatalf("stats=%+v, want max_visited_entries limit", out.Stats)
	}
	if visited, ok := out.Stats["visited_entries"].(int); !ok || visited <= readonlyFindMaxVisitedEntries {
		t.Fatalf("visited_entries=%#v, want > %d", out.Stats["visited_entries"], readonlyFindMaxVisitedEntries)
	}
}

func TestReadonlyGrep_TreatsInjectionLikeQueryAsData(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "safe.txt"), []byte("$(touch injected)\nneedle\n"), 0o644); err != nil {
		t.Fatalf("write safe.txt: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadonlyGrep(context.Background(), "$(touch injected)", []string{"."}, []string{"*.txt"}, true, true, 10, 0)
	if err != nil {
		t.Fatalf("toolReadonlyGrep: %v", err)
	}
	if len(out.Matches) != 1 || out.Matches[0].Line != 1 {
		t.Fatalf("matches=%+v, want literal injection-like query match", out.Matches)
	}
	if _, err := os.Stat(filepath.Join(workspace, "injected")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("query appears to have been executed, stat err=%v", err)
	}
}

func TestReadonlyGrep_TreatsPathAndGlobInjectionLikeData(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "safe.txt"), []byte("needle\n"), 0o644); err != nil {
		t.Fatalf("write safe.txt: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	_, err := r.toolReadonlyGrep(context.Background(), "needle", []string{".; touch injected-path"}, nil, true, true, 10, 0)
	if err == nil {
		t.Fatalf("expected injection-like path to be rejected as an invalid scoped path")
	}
	if _, statErr := os.Stat(filepath.Join(workspace, "injected-path")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("path appears to have been executed, stat err=%v", statErr)
	}

	out, err := r.toolReadonlyGrep(context.Background(), "needle", []string{"."}, []string{"--pre=touch injected-glob"}, true, true, 10, 0)
	if err != nil {
		t.Fatalf("toolReadonlyGrep with injection-like glob: %v", err)
	}
	if len(out.Matches) != 0 {
		t.Fatalf("glob injection sample matched files unexpectedly: %+v", out.Matches)
	}
	if _, statErr := os.Stat(filepath.Join(workspace, "injected-glob")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("glob appears to have been executed, stat err=%v", statErr)
	}
}

func TestReadonlyGrep_StopsAtScannedByteBudgetWithoutMatches(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	chunk := bytes.Repeat([]byte("a"), 1<<20)
	for i := 0; i < int(readonlyGrepMaxScannedBytes/(1<<20))+2; i++ {
		if err := os.WriteFile(filepath.Join(workspace, fmt.Sprintf("blob-%02d.txt", i)), chunk, 0o644); err != nil {
			t.Fatalf("write blob %d: %v", i, err)
		}
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadonlyGrep(context.Background(), "needle", []string{"."}, []string{"*.txt"}, true, true, 10, 0)
	if err != nil {
		t.Fatalf("toolReadonlyGrep: %v", err)
	}
	if len(out.Matches) != 0 {
		t.Fatalf("matches=%+v, want no matches", out.Matches)
	}
	if !out.Truncated {
		t.Fatalf("Truncated=false, want true after scanned-byte budget")
	}
	if out.Stats["limit_reason"] != "max_scanned_bytes" {
		t.Fatalf("stats=%+v, want max_scanned_bytes limit", out.Stats)
	}
	if scanned, ok := out.Stats["scanned_bytes"].(int64); !ok || scanned > readonlyGrepMaxScannedBytes {
		t.Fatalf("scanned_bytes=%#v, want <= %d", out.Stats["scanned_bytes"], readonlyGrepMaxScannedBytes)
	}
}

func TestReadonlyGrep_TruncatesLongMatchAndContextLines(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	longContext := strings.Repeat("c", readonlyGrepMaxContextRunes+100)
	longMatch := strings.Repeat("m", readonlyGrepMaxLineRunes+100) + " needle"
	if err := os.WriteFile(filepath.Join(workspace, "long.txt"), []byte(longContext+"\n"+longMatch+"\n"), 0o644); err != nil {
		t.Fatalf("write long fixture: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolReadonlyGrep(context.Background(), "needle", []string{"long.txt"}, nil, true, true, 10, 1)
	if err != nil {
		t.Fatalf("toolReadonlyGrep: %v", err)
	}
	if len(out.Matches) != 1 {
		t.Fatalf("matches=%+v, want one match", out.Matches)
	}
	if !strings.Contains(out.Matches[0].Text, "(truncated)") || len([]rune(out.Matches[0].Text)) > readonlyGrepMaxLineRunes+len("... (truncated)") {
		t.Fatalf("match text was not truncated as expected: len=%d text=%q", len([]rune(out.Matches[0].Text)), out.Matches[0].Text)
	}
	if len(out.Matches[0].Context) != 1 {
		t.Fatalf("context=%+v, want one context line", out.Matches[0].Context)
	}
	if !strings.Contains(out.Matches[0].Context[0].Text, "(truncated)") || len([]rune(out.Matches[0].Context[0].Text)) > readonlyGrepMaxContextRunes+len("... (truncated)") {
		t.Fatalf("context text was not truncated as expected: len=%d text=%q", len([]rune(out.Matches[0].Context[0].Text)), out.Matches[0].Context[0].Text)
	}
}

func TestReadonlyGrep_DeniesOutsideScopePath(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "outside.txt"), []byte("needle\n"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}
	scope, err := filesystemscope.NewRegistry(&config.Config{
		AgentHomeDir: workspace,
		FilesystemScope: &config.FilesystemScope{
			SchemaVersion: config.FilesystemScopeSchemaVersionV1,
			DefaultRootID: "workspace",
			Roots: []config.FilesystemRootPolicy{{
				ID:          "workspace",
				Label:       "Workspace",
				Path:        workspace,
				Kind:        config.FilesystemRootCustom,
				Permissions: config.FilesystemPermissionSet{Read: true, Write: true},
			}},
		},
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace, scope: scope}

	if _, err := r.toolReadonlyGrep(context.Background(), "needle", []string{filepath.Join(outside, "outside.txt")}, nil, true, true, 10, 0); err == nil {
		t.Fatalf("expected outside-scope grep to fail")
	}
}

func TestToolFileEdit_ReplacesExactMatchAndRejectsAmbiguousMatch(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "edit.txt")
	if err := os.WriteFile(target, []byte("alpha\nbeta\nalpha\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	if _, err := r.toolFileEdit(context.Background(), FileEditArgs{
		FilePath:  "edit.txt",
		OldString: "alpha",
		NewString: "omega",
	}); err == nil || !strings.Contains(err.Error(), "replace_all=true") {
		t.Fatalf("expected ambiguous match error, got %v", err)
	}

	out, err := r.toolFileEdit(context.Background(), FileEditArgs{
		FilePath:   "edit.txt",
		OldString:  "alpha",
		NewString:  "omega",
		ReplaceAll: true,
	})
	if err != nil {
		t.Fatalf("toolFileEdit replace_all: %v", err)
	}
	if out.ChangeType != "update" || !strings.Contains(out.UnifiedDiff, "-alpha") || !strings.Contains(out.UnifiedDiff, "+omega") {
		t.Fatalf("unexpected mutation result=%+v", out)
	}
	if out.DisplayName != "edit.txt" || canonicalPath(out.FilePath) != canonicalPath(target) {
		t.Fatalf("mutation path metadata=%+v", out)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read edited file: %v", err)
	}
	if strings.Count(string(got), "omega") != 2 {
		t.Fatalf("edited content=%q, want both replacements", string(got))
	}
}

func TestDisplayNameForFilePathStripsContentRefSuffixes(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"/workspace/a.md#dcbdf9b8c27f#e1703606242a": "a.md",
		"a.md#L47":                       "a.md",
		"notes#literal":                  "notes#literal",
		"/workspace/reference/readme.md": "readme.md",
	}
	for in, want := range cases {
		if got := displayNameForFilePath(in); got != want {
			t.Fatalf("displayNameForFilePath(%q)=%q, want %q", in, got, want)
		}
	}
}

func TestToolFileWrite_CreatesAndNoops(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolFileWrite(context.Background(), FileWriteArgs{
		FilePath: "nested/note.txt",
		Content:  "hello structured write\n",
	})
	if err != nil {
		t.Fatalf("toolFileWrite create: %v", err)
	}
	if out.ChangeType != "create" {
		t.Fatalf("change_type=%q, want create", out.ChangeType)
	}

	noop, err := r.toolFileWrite(context.Background(), FileWriteArgs{
		FilePath: "nested/note.txt",
		Content:  "hello structured write\n",
	})
	if err != nil {
		t.Fatalf("toolFileWrite noop: %v", err)
	}
	if noop.ChangeType != "noop" {
		t.Fatalf("change_type=%q, want noop", noop.ChangeType)
	}
}

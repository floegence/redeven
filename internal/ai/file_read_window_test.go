package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	fltools "github.com/floegence/floret/v7/tools"
)

func TestFileReadWindowLargeFileAndFinalModelPages(t *testing.T) {
	root := t.TempDir()
	// The requested prefix is valid text; the unread suffix must not be scanned.
	body := strings.Repeat("规则完整保留 <>&\"\t\r\n", 500)
	path := filepath.Join(root, "large.txt")
	if err := os.WriteFile(path, []byte(body+string([]byte{255})+strings.Repeat("x", 3<<20)), 0600); err != nil {
		t.Fatal(err)
	}
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	var complete strings.Builder
	for offset := 1; offset <= 500; {
		page, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: path, Offset: offset, Limit: min(400, 501-offset)})
		if err != nil {
			t.Fatal(err)
		}
		result, err := floretToolResultFromFlower(r, ToolResult{ToolID: "read", ToolName: "file_read", Status: toolResultStatusSuccess, Data: page})
		if err != nil {
			t.Fatal(err)
		}
		projection := fltools.BuildOutputProjection(result, fltools.DefaultOutputPolicy())
		var envelope struct {
			Data FileReadResult `json:"data"`
		}
		if err := json.Unmarshal([]byte(projection.VisibleText), &envelope); err != nil {
			t.Fatalf("model received invalid/truncated JSON: %v", err)
		}
		if projection.Truncated || envelope.Data.Content != page.Content || envelope.Data.LineCount != page.LineCount || page.LineCount == 0 {
			t.Fatal("model page differs from continuation facts")
		}
		complete.WriteString(envelope.Data.Content)
		offset = page.LineOffset + page.LineCount
	}
	if complete.String() != body {
		t.Fatalf("model lost bytes: got %d want %d", complete.Len(), len(body))
	}
}

func TestFileReadToolsAvailableWithReadOnlySessionCaps(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.txt"), []byte("known content\n"), 0600); err != nil {
		t.Fatal(err)
	}
	meta := testSendTurnMeta()
	meta.CanWrite, meta.CanExecute = false, false
	for _, mode := range []FlowerPermissionType{FlowerPermissionReadonly, FlowerPermissionApprovalRequired, FlowerPermissionFullAccess} {
		for name, args := range map[string]map[string]any{"file_read": {"path": "note.txt"}, "file_read_many": {"paths": []string{"note.txt"}}, "path_find": {"root": ".", "name": "*.txt"}} {
			t.Run(string(mode)+"/"+name, func(t *testing.T) {
				defs := newPermissionToolFilter(true).FilterTools(mode, builtInToolDefinitions())
				snapshot := buildPermissionSnapshot(mode, defs, nil)
				snapshot.SnapshotID = "file-read-test"
				policy, ok := snapshot.ToolPolicies[name]
				if !ok || policy.ApprovalDecision != ApprovalDecisionAllow {
					t.Fatalf("read operation not available without command approval: %+v", policy)
				}
				ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
				ctx = contextWithFloretToolExecutionAuthorization(ctx, "call", name, "attempt", snapshot, ApprovalDecisionAllow, true, nil)
				r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
				if _, err := r.execTool(ctx, meta, "call", name, args); err != nil {
					t.Fatal(err)
				}
				denied := *meta
				denied.CanRead = false
				if _, err := r.execTool(ctx, &denied, "call", name, args); err == nil {
					t.Fatal("read permission bypassed")
				}
			})
		}
	}
}

func TestFileReadWindowBoundariesAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		name, body                 string
		offset, limit, line, count int
		content                    string
		eof                        bool
		next                       int
		failure                    string
	}{
		{name: "empty", offset: 0, line: 1, eof: true},
		{name: "past EOF", body: "one\ntwo", offset: 99, line: 3, eof: true},
		{name: "zero is first", body: "one\ntwo", line: 1, count: 1, limit: 1, content: "one\n", next: 2},
		{name: "no trailing newline", body: "one\ntwo", offset: 2, line: 2, count: 1, content: "two", eof: true},
		{name: "CRLF", body: "one\r\ntwo\r\n", line: 1, count: 2, content: "one\r\ntwo\r\n", eof: true},
		{name: "exact bytes", body: strings.Repeat("x", 8000), line: 1, count: 1, content: strings.Repeat("x", 8000), eof: true},
		{name: "long line", body: strings.Repeat("x", 8001), failure: "page limit"},
		{name: "long next line", body: "first\n" + strings.Repeat("x", 8001), line: 1, count: 1, content: "first\n", next: 2},
		{name: "encoded next line", body: "first\n" + strings.Repeat("<", 5000), line: 1, count: 1, content: "first\n", next: 2},
		{name: "encoded line", body: strings.Repeat("<", 5000), failure: "encoded page limit"},
		{name: "binary", body: "one\x00two", failure: "binary"},
		{name: "invalid UTF8", body: string([]byte{255}), failure: "UTF-8"},
		{name: "skip long prefix", body: strings.Repeat("x", 3<<20) + "\nlast\n", offset: 2, line: 2, count: 1, content: "last\n", eof: true},
		{name: "bounded prefix", body: strings.Repeat("x", maxFileReadScanBytes+1), offset: 2, failure: "scan exceeds"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "text.txt")
			if err := os.WriteFile(path, []byte(tc.body), 0600); err != nil {
				t.Fatal(err)
			}
			r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
			page, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: path, Offset: tc.offset, Limit: tc.limit})
			if tc.failure != "" {
				if err == nil || !strings.Contains(err.Error(), tc.failure) {
					t.Fatalf("got %v want %s", err, tc.failure)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if page.Content != tc.content || page.LineOffset != tc.line || page.LineCount != tc.count || page.EOF != tc.eof || page.Truncated == tc.eof || page.NextOffset != tc.next {
				t.Fatalf("wrong page: %+v", page)
			}
			if !filepath.IsAbs(page.FilePath) {
				t.Fatalf("noncanonical path %q", page.FilePath)
			}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			if _, err := r.toolFileRead(ctx, FileReadArgs{FilePath: path}); !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation lost: %v", err)
			}
		})
	}
}

func TestFileReadBatchCompleteFinalModelResults(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	paths := []string{}
	body := strings.Repeat("<>&\t\"\r\n", 600)
	for i := 0; i < 50; i++ {
		path := filepath.Join(root, fmt.Sprintf("file-%02d.txt", i))
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	count := 0
	for count < len(paths) {
		batch, err := r.toolReadFiles(t.Context(), paths[count:], 400)
		if err != nil {
			t.Fatal(err)
		}
		if len(batch.Files) == 0 {
			t.Fatal("batch did not progress")
		}
		result, err := floretToolResultFromFlower(r, ToolResult{ToolID: "batch", ToolName: "file_read_many", Status: toolResultStatusSuccess, Data: batch})
		if err != nil {
			t.Fatal(err)
		}
		projection := fltools.BuildOutputProjection(result, fltools.DefaultOutputPolicy())
		var envelope struct {
			Data readonlyReadFilesResult `json:"data"`
		}
		if projection.Truncated || json.Unmarshal([]byte(projection.VisibleText), &envelope) != nil {
			t.Fatal("model batch was clipped")
		}
		for i, item := range envelope.Data.Files {
			if item.Path != paths[count+i] || item.Result == nil || item.Result.Content != batch.Files[i].Result.Content {
				t.Fatal("batch lost content or order")
			}
		}
		if batch.Truncated && batch.NextIndex != len(batch.Files) {
			t.Fatal("wrong batch continuation")
		}
		count += len(batch.Files)
	}
}

func TestFileFindBoundedModelResultsAndPatterns(t *testing.T) {
	root := t.TempDir()
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root})
	for i := 0; i < 500; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("%03d-%s.txt", i, strings.Repeat("n", 100))), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	out, err := r.toolReadonlyFind(t.Context(), root, "*.txt", "file", 1000, 8, false)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Truncated || out.Stats["limit_reason"] != "max_output_bytes" {
		t.Fatalf("missing output limit: %+v", out.Stats)
	}
	result, err := floretToolResultFromFlower(r, ToolResult{ToolID: "path_find", ToolName: "path_find", Status: toolResultStatusSuccess, Data: out})
	if err != nil {
		t.Fatal(err)
	}
	projection := fltools.BuildOutputProjection(result, fltools.DefaultOutputPolicy())
	var envelope struct {
		Data readonlyFindResult `json:"data"`
	}
	if projection.Truncated || json.Unmarshal([]byte(projection.VisibleText), &envelope) != nil || len(envelope.Data.Results) != len(out.Results) {
		t.Fatal("model discovery result clipped")
	}
	if _, err := r.toolReadonlyFind(t.Context(), root, "[", "file", 1, 1, false); err == nil {
		t.Fatal("invalid pattern silently matched nothing")
	}
	out, err = r.toolReadonlyFind(t.Context(), root, "src/**/*.txt", "file", 1000, 8, false)
	if err != nil || len(out.Results) != 0 {
		t.Fatal("basename matcher silently became path glob")
	}
}

func TestFileReadScopeSymlinkAndUnknownAuthorization(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("OUTSIDE_SECRET"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "readable.txt"), []byte("authorized\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "readable.txt"), filepath.Join(root, "inside.txt")); err != nil {
		t.Fatal(err)
	}
	scope := flowerTestFilesystemScope(t, root)
	r := newRun(runOptions{AgentHomeDir: root, WorkingDir: root, FilesystemScope: scope})
	for _, path := range []string{filepath.Join(outside, "secret.txt"), "escape.txt"} {
		if _, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: path}); err == nil {
			t.Fatalf("read escaped scope via %q", path)
		}
	}
	out, err := r.toolFileRead(t.Context(), FileReadArgs{FilePath: "inside.txt"})
	if err != nil || out.Content != "authorized\n" {
		t.Fatalf("authorized symlink: %+v %v", out, err)
	}
	batch, err := r.toolReadFiles(t.Context(), []string{"inside.txt", "escape.txt"}, 2)
	if err != nil || batch.Files[0].Result == nil || batch.Files[1].Result != nil || batch.Files[1].Error == "" {
		t.Fatalf("batch bypassed scope: %+v %v", batch, err)
	}
	for _, name := range []string{"file_read", "file_read_many", "path_find"} {
		if _, err := r.execTool(t.Context(), testSendTurnMeta(), "no-proof", name, map[string]any{"path": "inside.txt"}); err == nil {
			t.Fatalf("%s bypassed authorization snapshot", name)
		}
	}
}

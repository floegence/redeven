package ai

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

func TestTessivenBoundedReadAndExactEdit(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	saved, err := library.Create(t.Context(), "initial", "Original")
	if err != nil {
		t.Fatal(err)
	}
	r := &run{host: runHostCapabilities{tessiven: library}}
	meta := &session.Meta{CanRead: true, CanWrite: true}
	read, err := r.execTessivenTool(t.Context(), meta, "tessiven.read", map[string]any{"canvas_id": saved.Canvas.ID, "start_line": 1, "line_count": 2})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(read)
	var chunk struct {
		DocumentYAML string `json:"document_yaml"`
		TotalLines   int    `json:"total_lines"`
		HasMore      bool   `json:"has_more"`
	}
	if err := json.Unmarshal(raw, &chunk); err != nil {
		t.Fatal(err)
	}
	if !chunk.HasMore || chunk.TotalLines <= 2 || strings.Contains(chunk.DocumentYAML, "Original") {
		t.Fatalf("unbounded read: %s", raw)
	}
	args := map[string]any{"request_id": "edit-title", "canvas_id": saved.Canvas.ID, "expected_version": 1, "summary": "Rename canvas", "edits": []any{map[string]any{"old_string": "Original", "new_string": "Updated"}}}
	result, err := r.execTessivenTool(t.Context(), meta, "tessiven.edit", args)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(result.(map[string]any)["canvas_url"].(string), "&version=2") {
		t.Fatal("missing version in canvas URL")
	}
	if result.(map[string]any)["version"] != int64(2) {
		t.Fatal(result)
	}
	if _, err := r.execTessivenTool(t.Context(), meta, "tessiven.edit", args); err != nil {
		t.Fatalf("exact retry: %v", err)
	}
	if _, err := r.execTessivenTool(t.Context(), &session.Meta{CanRead: true}, "tessiven.edit", args); err == nil {
		t.Fatal("read-only edit admitted")
	}
	versions, _ := library.Versions(t.Context(), saved.Canvas.ID, 0)
	if len(versions) != 2 {
		t.Fatal("retry wrote another version")
	}
	original, _ := library.Version(t.Context(), saved.Canvas.ID, 1)
	current, _ := library.Version(t.Context(), saved.Canvas.ID, 0)
	if strings.Replace(original.DocumentYAML, "Original", "Updated", 1) != current.DocumentYAML {
		t.Fatal("untouched YAML changed")
	}
}

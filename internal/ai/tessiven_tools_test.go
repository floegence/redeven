package ai

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

func TestTessivenToolCanvasLifecycleWithoutModel(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	r := &run{host: runHostCapabilities{tessiven: library}}
	meta := &session.Meta{CanRead: true, CanWrite: true}
	document := "apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Commerce}\n"
	if _, err := r.execTessivenTool(t.Context(), meta, "tessiven.schema", map[string]any{}); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"request_id": "flower-first", "expected_version": 0, "document_yaml": document, "summary": "Map commerce"}
	saved, err := r.execTessivenTool(t.Context(), meta, "tessiven.save", args)
	if err != nil {
		t.Fatal(err)
	}
	result := saved.(map[string]any)
	canvas := result["canvas"].(tessiven.Canvas)
	if !strings.Contains(result["canvas_url"].(string), "surface=tessiven&canvas="+canvas.ID) {
		t.Fatal("missing canvas reference")
	}
	args["canvas_id"] = canvas.ID
	args["expected_version"] = 1
	args["request_id"] = "flower-next"
	args["document_yaml"] = strings.Replace(document, "Commerce", "Commerce / Production", 1)
	if _, err := r.execTessivenTool(t.Context(), meta, "tessiven.save", args); err != nil {
		t.Fatal(err)
	}
	versions, err := library.Versions(t.Context(), canvas.ID, 0)
	if err != nil || len(versions) != 2 {
		t.Fatal(versions, err)
	}
	if versions[0].Source != "flower" {
		t.Fatal("tool source lost")
	}
	if _, err := r.execTessivenTool(t.Context(), &session.Meta{CanRead: true}, "tessiven.save", args); err == nil {
		t.Fatal("read-only caller saved")
	}
	if _, err := r.execTessivenTool(t.Context(), meta, "tessiven.read", map[string]any{"canvas_id": canvas.ID, "before": 1}); err == nil {
		t.Fatal("unrelated field accepted")
	}
}
func TestTessivenContextPreservesHistoryAndBoundedReferenceParts(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	document := "apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Original}\nservices:\n"
	refs := []string{}
	for i := 0; i < 100; i++ {
		id := strings.Repeat("a", 125) + string(rune('A'+i/26)) + string(rune('A'+i%26))
		refs = append(refs, id)
		document += "  - {id: " + id + ", name: service, kind: api}\n"
	}
	saved, err := library.Save(t.Context(), tessiven.SaveRequest{RequestID: "initial", DocumentYAML: document}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"schema_version": 2, "action_id": "assistant.ask.flower", "provider": "flower", "target": map[string]string{"target_id": "local:local", "locality": "current_runtime"}, "source": map[string]string{"surface": "tessiven", "surface_id": saved.Canvas.ID}, "context": []any{map[string]any{"kind": "tessiven_selection", "canvas_id": saved.Canvas.ID, "version_id": 1, "object_refs": refs}}})
	var envelope ContextActionEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	projection, err := floretContextProjectionForInputWithAuthority(RunInput{ContextAction: &envelope}, nil, tessivenContextResolver(t.Context(), library))
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.References) < 2 {
		t.Fatal("large exact selection was not split")
	}
	combined := ""
	for _, ref := range projection.References {
		if err := ref.Validate(); err != nil {
			t.Fatal(err)
		}
		combined += ref.Text
	}
	for _, id := range refs {
		if !strings.Contains(combined, id) {
			t.Fatal("selection identity truncated")
		}
	}
	if !strings.Contains(combined, "Original") || !strings.Contains(combined, "\"version_id\":1") {
		t.Fatal("history identity lost")
	}
	if len(projection.Context) != 2 {
		t.Fatal("missing skill guidance")
	}
}

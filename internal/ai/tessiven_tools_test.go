package ai

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
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

func TestTessivenInspectReturnsStructuredUnavailableForDescriptiveRuntime(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	r := &run{host: runHostCapabilities{
		tessiven:          library,
		tessivenResources: &tessiven.ResourceBackend{},
	}}
	result, err := r.execTessivenTool(t.Context(), &session.Meta{CanRead: true}, "tessiven.inspect", map[string]any{
		"runtime_ref": "demo:application",
		"action":      "list",
	})
	if err != nil {
		t.Fatal(err)
	}
	inspection := result.(tessiven.ResourceResult).Inspection
	if inspection == nil || inspection.RuntimeRef != "demo:application" || inspection.State != "unavailable" || inspection.Binding != nil {
		t.Fatalf("descriptive runtime was not represented safely: %+v", result)
	}
}
func TestTessivenContextPreservesHistoryAndBoundedReferenceParts(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	document := "apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Original}\nnodes: [{id: host, name: Reference host, runtimeRef: 'conceptual:host'}]\nservices:\n"
	refs := []string{}
	for i := 0; i < 100; i++ {
		id := strings.Repeat("a", 125) + string(rune('A'+i/26)) + string(rune('A'+i%26))
		refs = append(refs, id)
		document += "  - {id: " + id + ", name: service, kind: api}\n"
	}
	document += "instances:\n"
	for _, id := range refs {
		document += "  - {id: i-" + id[2:] + ", nodeRef: host, serviceRef: " + id + ", role: standalone}\n"
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

func TestTessivenToolsRejectUnplacedServicesWithoutCreatingVersions(t *testing.T) {
	library, err := tessiven.Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	r := &run{host: runHostCapabilities{tessiven: library}}
	meta := &session.Meta{CanRead: true, CanWrite: true}
	document := "apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Reference architecture}\nservices: [{id: api, name: API, kind: api}]\n"
	result, err := r.execTessivenTool(t.Context(), meta, "tessiven.validate", map[string]any{"document_yaml": document})
	if err != nil {
		t.Fatal(err)
	}
	validation := result.(tessiven.Validation)
	if validation.Valid || len(validation.Diagnostics) != 1 || validation.Diagnostics[0].Path != "/services/0/id" {
		t.Fatalf("missing model-facing placement diagnostic: %+v", validation)
	}
	_, err = r.execTessivenTool(t.Context(), meta, "tessiven.save", map[string]any{"request_id": "unplaced", "expected_version": 0, "document_yaml": document, "summary": "Create"})
	if err == nil {
		t.Fatal("Flower saved an unplaced service")
	}
	toolError := aitools.ClassifyError(aitools.Invocation{ToolName: "tessiven.save"}, err)
	if toolError.Code != aitools.ErrorCodeInvalidArguments || toolError.Retryable || !strings.Contains(toolError.Message, "/services/0/id") {
		t.Fatalf("save failure must identify a repairable document error: %+v", toolError)
	}
	if toolError.Meta["validation_details"].(map[string]any)["path"] != "/services/0/id" {
		t.Fatalf("save failure lost its source location: %+v", toolError)
	}
	payload, err := modelToolResultPayload(ToolResult{ToolName: "tessiven.save", Status: "error", Error: toolError, Data: validation})
	if err != nil {
		t.Fatal(err)
	}
	diagnostics := payload["data"].(map[string]any)["diagnostics"].([]any)
	if payload["truncated"] == true || len(diagnostics) != 1 || diagnostics[0].(map[string]any)["path"] != "/services/0/id" {
		t.Fatalf("model-facing save diagnostics must remain structured: %+v", payload)
	}
	list, err := library.List(t.Context(), "Reference architecture", "", false)
	if err != nil || len(list.Canvases) != 0 {
		t.Fatalf("rejected save created a canvas: %+v %v", list, err)
	}
}

func TestTessivenComposerFileReferences(t *testing.T) {
	for _, extra := range []string{``, `,"root_label":"forged"`, `,"content":"hidden"`} {
		raw := `{"schema_version":2,"action_id":"assistant.ask.flower","provider":"flower","target":{"target_id":"local:local","locality":"current_runtime"},"source":{"surface":"tessiven"},"context":[{"kind":"tessiven_selection","canvas_id":"commerce","version_id":2,"object_refs":["orders"]},{"kind":"file_path","path":"/workspace/orders.ts","is_directory":false` + extra + `}],"presentation":{"label":"Tessiven","priority":100}}`
		var action ContextActionEnvelope
		if err := json.Unmarshal([]byte(raw), &action); err != nil {
			t.Fatal(err)
		}
		_, err := normalizeAskFlowerContextActionEnvelope(&action)
		if extra == "" && err != nil {
			t.Fatalf("canonical file reference rejected: %v", err)
		}
		if extra != "" && err == nil {
			t.Fatal("forged file metadata accepted")
		}
	}
}

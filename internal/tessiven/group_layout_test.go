package tessiven

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGroupLayoutContractAndLegacyMigration(t *testing.T) {
	const base = "apiVersion: redeven.io/tessiven/v1.1.0\nkind: ServiceCanvas\nmetadata: {title: Pool}\nnodes: [{id: host, name: Host, runtimeRef: 'conceptual:host'}]\ngroups: [{id: pool, name: Pool, nodeRefs: [host]}]\npresentation:\n  groupLayouts:\n    pool: {flow: row, maxPerLine: 3}\n"
	result := Validate(base)
	if !result.Valid {
		t.Fatalf("group layout: %+v", result)
	}
	raw, err := json.Marshal(result.Document)
	if err != nil || !strings.Contains(string(raw), `"maxPerLine":3`) {
		t.Fatalf("JSON round trip: %s %v", raw, err)
	}
	yaml, err := documentYAML(result.Document)
	if err != nil || !Validate(yaml).Valid {
		t.Fatalf("YAML round trip: %s %v", yaml, err)
	}
	old := "# Keep the source\napiVersion: 'redeven.io/tessiven/v1.0.0' # identity\nkind: ServiceCanvas\nmetadata: {title: 'redeven.io/tessiven/v1.0.0'}\n"
	upgraded := Validate(old)
	want := strings.Replace(old, "apiVersion: 'redeven.io/tessiven/v1.0.0'", "apiVersion: 'redeven.io/tessiven/v1.1.0'", 1)
	if !upgraded.Valid || upgraded.documentYAML != want || len(upgraded.Migrations) != 1 {
		t.Fatalf("minor upgrade: %+v", upgraded)
	}
	if Validate(strings.Replace(base, "v1.1.0", "v1.0.0", 1)).Valid {
		t.Fatal("a frozen older schema must reject new vocabulary")
	}
	for _, tc := range []struct{ old, next, path string }{
		{"pool: {flow: row, maxPerLine: 3}", "missing: {flow: row}", "/presentation/groupLayouts/missing"},
		{"pool: {flow: row, maxPerLine: 3}", "host: {flow: row}", "/presentation/groupLayouts/host"},
		{"flow: row", "flow: diagonal", "/presentation/groupLayouts/pool/flow"},
		{"maxPerLine: 3", "maxPerLine: 0", "/presentation/groupLayouts/pool/maxPerLine"},
		{"maxPerLine: 3", "maxPerLine: 1.5", "/presentation/groupLayouts/pool/maxPerLine"},
	} {
		invalid := Validate(strings.Replace(base, tc.old, tc.next, 1))
		if invalid.Valid || len(invalid.Diagnostics) != 1 || invalid.Diagnostics[0].Path != tc.path || invalid.Diagnostics[0].Line < 2 {
			t.Fatalf("diagnostic %s: %+v", tc.path, invalid)
		}
	}
}

func TestKubernetesPoolLayoutSaveEditAndReopen(t *testing.T) {
	// This Unicode fixture reproduces the user's actual canvas, including its peer cycle.
	source, err := os.ReadFile("testdata/kubernetes-group-layout.yaml")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "canvases.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := store.Save(t.Context(), SaveRequest{RequestID: "pool-fixture", DocumentYAML: string(source)}, "import")
	if err != nil {
		t.Fatal(err)
	}
	before := saved.Version.DocumentYAML
	next, err := store.Edit(t.Context(), EditRequest{RequestID: "pool-column", CanvasID: saved.Canvas.ID, ExpectedVersion: 1, Edits: []TextEdit{{OldString: "flow: row", NewString: "flow: column"}}})
	if err != nil || next.Version.Number != 2 {
		t.Fatalf("partial edit: %+v %v", next, err)
	}
	store.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	history, err := store.Version(t.Context(), saved.Canvas.ID, 1)
	if err != nil || history.DocumentYAML != before {
		t.Fatal("history changed")
	}
	current, err := store.Version(t.Context(), saved.Canvas.ID, 0)
	if err != nil || !strings.Contains(current.DocumentYAML, "flow: column") || len(current.Document.Relations) != len(saved.Version.Document.Relations) {
		t.Fatalf("reopen: %+v %v", current, err)
	}
}

package tessiven

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestServiceResponsibilityKinds(t *testing.T) {
	for _, kind := range []string{
		"scheduler", "controller", "runtime", "network", "dns", "monitoring",
		"workload", "coordination", "security", "logging", "storage", "analytics", "ai",
		"cloud_controller", "node_agent", "container_runtime", "network_plugin", "service_mesh",
		"ingress", "operator", "registry", "metrics", "tracing", "alerting", "identity",
		"secrets", "certificate", "stream_processor", "metadata",
	} {
		t.Run(kind, func(t *testing.T) {
			source := strings.Replace(exampleDocument, "kind: api", "kind: "+kind, 1)
			result := Validate(source)
			if !result.Valid {
				t.Fatalf("service responsibility rejected: %+v", result.Diagnostics)
			}
			encoded, err := documentYAML(result.Document)
			if err != nil {
				t.Fatal(err)
			}
			roundTrip := Validate(encoded)
			if !roundTrip.Valid || roundTrip.Document.Services[0].Kind != kind {
				t.Fatalf("service responsibility lost on round trip: %+v", roundTrip)
			}
		})
	}
	invalid := Validate(strings.Replace(exampleDocument, "kind: api", "kind: unrecognized", 1))
	if invalid.Valid || len(invalid.Diagnostics) == 0 || invalid.Diagnostics[0].Path != "/services/0/kind" {
		t.Fatalf("unknown service kind must fail at its schema boundary: %+v", invalid)
	}
}

func TestPresentationPositionHints(t *testing.T) {
	var schema map[string]any
	if err := json.Unmarshal(Schema(), &schema); err != nil {
		t.Fatal(err)
	}
	positions := schema["properties"].(map[string]any)["presentation"].(map[string]any)["properties"].(map[string]any)["positions"].(map[string]any)
	if description, _ := positions["description"].(string); !strings.Contains(description, "not fixed constraints") || !strings.Contains(description, "Omit for automatic layout") {
		t.Fatalf("schema must explain preferred coordinates: %v", positions)
	}
	// Geometry depends on projected card sizes. Valid crowded hints are retained
	// as authored data; the published renderer owns their collision resolution.
	source := exampleDocument + "presentation:\n  positions:\n    - {objectRef: core-01, x: 0, y: 0}\n    - {objectRef: assets, x: 0, y: 0}\n"
	result := Validate(source)
	if !result.Valid || len(result.Document.Presentation.Positions) != 2 {
		t.Fatalf("valid hints were lost: %+v", result)
	}
	encoded, err := documentYAML(result.Document)
	if err != nil {
		t.Fatal(err)
	}
	if roundTrip := Validate(encoded); !roundTrip.Valid || roundTrip.Document.Presentation.Positions[1].X != 0 {
		t.Fatalf("hints changed: %+v", roundTrip)
	}
	unplaced := strings.Replace(exampleDocument,
		"services:\n  - {id: orders, name: Orders API, kind: api}",
		"services:\n  - {id: orders, name: Orders API, kind: api}\n  - {id: catalog, name: Catalog API, kind: api}", 1)
	unplaced += "presentation:\n  positions:\n    - {objectRef: catalog, x: 20, y: 40}\n"
	if result := Validate(unplaced); !result.Valid {
		t.Fatalf("unplaced services must accept preferred positions: %+v", result.Diagnostics)
	}
}

func TestPresentationLayers(t *testing.T) {
	valid := strings.Replace(exampleDocument, "evidence:\n", "presentation:\n  direction: RIGHT\n  layers:\n    - [application]\n    - [assets]\nevidence:\n", 1)
	result := Validate(valid)
	if !result.Valid || result.Document.Presentation.Direction != "RIGHT" || len(result.Document.Presentation.Layers) != 2 {
		t.Fatalf("valid root layers rejected: %+v", result.Diagnostics)
	}
	encoded, err := documentYAML(result.Document)
	if err != nil {
		t.Fatal(err)
	}
	if roundTrip := Validate(encoded); !roundTrip.Valid || roundTrip.Document.Presentation.Layers[1][0] != "assets" {
		t.Fatalf("layers changed on round trip: %+v", roundTrip.Diagnostics)
	}
	for _, direction := range []LayoutDirection{"RIGHT", "DOWN", "LEFT", "UP"} {
		result.Document.Presentation.Direction = direction
		result.Document.Presentation.Positions = []Position{{ObjectRef: "application", X: 5000, Y: 3000}}
		jsonSource, err := json.Marshal(result.Document)
		if err != nil {
			t.Fatal(err)
		}
		roundTrip := Validate(string(jsonSource))
		if !roundTrip.Valid || !reflect.DeepEqual(roundTrip.Document.Presentation, result.Document.Presentation) {
			t.Fatalf("JSON layout contract changed for %s: %+v", direction, roundTrip.Diagnostics)
		}
	}
	rootObjects := strings.Replace(exampleDocument,
		"groups:\n  - {id: application, name: Application nodes, nodeRefs: [core-01]}\n", "", 1)
	rootObjects = strings.Replace(rootObjects,
		"services:\n  - {id: orders, name: Orders API, kind: api}",
		"services:\n  - {id: orders, name: Orders API, kind: api}\n  - {id: catalog, name: Catalog API, kind: api}", 1)
	rootObjects = strings.Replace(rootObjects, "evidence:\n",
		"presentation:\n  direction: DOWN\n  layers:\n    - [core-01, catalog]\n    - [assets]\nevidence:\n", 1)
	if result := Validate(rootObjects); !result.Valid {
		t.Fatalf("ungrouped nodes and unplaced services must be valid root layer objects: %+v", result.Diagnostics)
	}
	for _, tc := range []struct {
		name        string
		replacement string
		path        string
	}{
		{"invalid direction", "direction: sideways", "/presentation/direction"},
		{"empty layers list", "layers: []", "/presentation/layers"},
		{"empty layer", "layers:\n    - []", "/presentation/layers/0"},
		{"unknown object", "layers:\n    - [missing]", "/presentation/layers/0/0"},
		{"object repeated across layers", "layers:\n    - [application]\n    - [application]", "/presentation/layers/1/0"},
		{"object repeated within a layer", "layers:\n    - [application, application]", "/presentation/layers/0"},
		{"grouped node", "layers:\n    - [core-01]", "/presentation/layers/0/0"},
		{"placed service", "layers:\n    - [orders]", "/presentation/layers/0/0"},
		{"instance", "layers:\n    - [orders-01]", "/presentation/layers/0/0"},
		{"relation", "layers:\n    - [orders-assets]", "/presentation/layers/0/0"},
		{"evidence", "layers:\n    - [storage-config]", "/presentation/layers/0/0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := strings.Replace(exampleDocument, "evidence:\n", "presentation:\n  "+tc.replacement+"\nevidence:\n", 1)
			invalid := Validate(source)
			if invalid.Valid {
				t.Fatal("invalid layout layer accepted")
			}
			for _, diagnostic := range invalid.Diagnostics {
				if diagnostic.Path == tc.path {
					return
				}
			}
			t.Fatalf("missing diagnostic %s: %+v", tc.path, invalid.Diagnostics)
		})
	}
}

const exampleDocument = `apiVersion: redeven.io/tessiven/v1
kind: ServiceCanvas
metadata:
  title: Commerce / Production
nodes:
  - {id: core-01, name: core-001, runtimeRef: 'local:local'}
groups:
  - {id: application, name: Application nodes, nodeRefs: [core-01]}
services:
  - {id: orders, name: Orders API, kind: api}
instances:
  - {id: orders-01, nodeRef: core-01, serviceRef: orders, role: standalone, binding: {owner: managed_service, resourceId: example-service-id}}
resources:
  - {id: assets, name: Product objects, kind: object_store, endpoint: 's3://product-assets'}
relations:
  - {id: orders-assets, from: orders, to: assets, kind: reads, protocol: S3, evidenceRefs: [storage-config]}
evidence:
  - {id: storage-config, source: configuration, locator: 'repo://commerce/config/storage.yaml', summary: Orders API configuration references this bucket.}
`

func TestDocumentValidation(t *testing.T) {
	valid := Validate(exampleDocument)
	if !valid.Valid {
		t.Fatalf("example: %+v", valid.Diagnostics)
	}
	source, err := documentYAML(valid.Document)
	if err != nil {
		t.Fatal(err)
	}
	if result := Validate(source); !result.Valid {
		t.Fatalf("round trip: %+v", result.Diagnostics)
	}
	for _, tc := range []struct{ name, source, path string }{
		{"duplicate identity", strings.Replace(exampleDocument, "id: assets", "id: orders", 1), "/resources/0/id"},
		{"missing service", strings.Replace(exampleDocument, "serviceRef: orders", "serviceRef: missing", 1), "/instances/0/serviceRef"},
		{"missing evidence", strings.Replace(exampleDocument, "evidenceRefs: [storage-config]", "evidenceRefs: [missing]", 1), "/relations/0/evidenceRefs/0"},
		{"wrong endpoint type", strings.Replace(exampleDocument, "from: orders", "from: application", 1), "/relations/0/from"},
		{"executable field", exampleDocument + "command: rm\n", ""},
		{"duplicate YAML key", exampleDocument + "kind: ServiceCanvas\n", "/kind"},
		{"credential URL", strings.Replace(exampleDocument, "s3://product-assets", "https://user:secret@example.com", 1), "/resources/0/endpoint"},
		{"multiple documents", exampleDocument + "---\n{}\n", ""},
		{"unverified observation", strings.Replace(exampleDocument, "source: configuration", "source: runtime", 1), "/evidence/0"},
		{"alias", strings.Replace(exampleDocument, "[core-01]", "[*core]", 1), ""},
		{"unknown field", strings.Replace(exampleDocument, "role: standalone", "role: standalone, script: hello", 1), "/instances/0"},
		{"container identity", strings.Replace(exampleDocument, "owner: managed_service", "owner: container", 1), "/instances/0/binding"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := Validate(tc.source)
			if r.Valid || len(r.Diagnostics) == 0 {
				t.Fatal("invalid document accepted")
			}
			if tc.path != "" {
				found := false
				for _, d := range r.Diagnostics {
					found = found || d.Path == tc.path
					if d.Line < 1 || d.Column < 1 {
						t.Fatal("missing source position")
					}
				}
				if !found {
					t.Fatalf("want %s: %+v", tc.path, r.Diagnostics)
				}
			}
		})
	}
	cycle := strings.Replace(exampleDocument, "evidence:\n", "  - {id: reverse, from: assets, to: orders, kind: writes, evidenceRefs: [storage-config]}\nevidence:\n", 1)
	if r := Validate(cycle); !r.Valid {
		t.Fatalf("cycle rejected: %+v", r.Diagnostics)
	}
}

func TestSharedHostGroups(t *testing.T) {
	source := strings.Replace(exampleDocument, "nodeRefs: [core-01]}", "nodeRefs: [core-01], instanceRefs: [orders-01]}\n  - {id: shared, name: Shared host, nodeRefs: [core-01], instanceRefs: [orders-01]}", 1)
	result := Validate(source)
	if !result.Valid {
		t.Fatalf("shared host rejected: %+v", result.Diagnostics)
	}
	encoded, err := documentYAML(result.Document)
	if err != nil {
		t.Fatal(err)
	}
	if next := Validate(encoded); !next.Valid || len(next.Document.Groups) != 2 || !strings.Contains(encoded, "instanceRefs") {
		t.Fatalf("membership lost on round trip: %+v", next)
	}
	for _, invalid := range []string{
		strings.Replace(source, "instanceRefs: [orders-01]", "instanceRefs: [missing]", 1),
		strings.Replace(source, "nodeRefs: [core-01], instanceRefs", "nodeRefs: [], instanceRefs", 1),
		strings.Replace(source, "instanceRefs: [orders-01]", "instanceRefs: [orders-01, orders-01]", 1),
	} {
		if next := Validate(invalid); next.Valid {
			t.Fatalf("invalid group membership accepted: %s", invalid)
		}
	}
	// Existing node-only membership continues to include the host's full inventory.
	legacy := strings.Replace(exampleDocument, "name: Application nodes, nodeRefs: [core-01]}", "name: Application nodes, nodeRefs: [core-01]}\n  - {id: shared, name: Shared host, nodeRefs: [core-01]}", 1)
	if next := Validate(legacy); !next.Valid {
		t.Fatalf("node-only shared membership rejected: %+v", next.Diagnostics)
	}
}

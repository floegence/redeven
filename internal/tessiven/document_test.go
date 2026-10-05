package tessiven

import (
	"strings"
	"testing"
)

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

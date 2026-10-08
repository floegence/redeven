package tessiven

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelectionIncludesObservationEvidenceAndPrioritizesRequestedObjects(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	doc := Validate(exampleDocument).Document
	doc.Nodes[0].Observation = &Observation{State: "healthy", ObservedAt: "2026-10-05T00:00:00Z", EvidenceRefs: []string{"node-observation"}}
	doc.Resources[0].Observation = &Observation{State: "healthy", ObservedAt: "2026-10-05T00:00:00Z", EvidenceRefs: []string{"resource-observation"}}
	for _, id := range []string{"node-observation", "resource-observation"} {
		doc.Evidence = append(doc.Evidence, Evidence{ID: id, Source: "runtime", Locator: "runtime://local/status", Summary: "Observed healthy", ObservedAt: "2026-10-05T00:00:00Z"})
	}
	source, err := documentYAML(doc)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "observations", DocumentYAML: source}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ object, evidence string }{{"core-01", "node-observation"}, {"assets", "resource-observation"}} {
		raw, err := s.SelectionContext(t.Context(), Selection{CanvasID: first.Canvas.ID, VersionID: 1, ObjectRefs: []string{tc.object}})
		if err != nil {
			t.Fatal(err)
		}
		var context struct{ Objects []struct{ ID string } }
		if err := json.Unmarshal([]byte(raw), &context); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, object := range context.Objects {
			found = found || object.ID == tc.evidence
		}
		if !found {
			t.Errorf("%s selection omitted its observation evidence", tc.object)
		}
	}
	doc.Groups[0].ID = "zz-selected-group"
	for i := 0; i < 150; i++ {
		id := fmt.Sprintf("member-%03d", i)
		doc.Nodes = append(doc.Nodes, Node{ID: id, Name: id, RuntimeRef: "local:local"})
		doc.Groups[0].NodeRefs = append(doc.Groups[0].NodeRefs, id)
	}
	source, err = documentYAML(doc)
	if err != nil {
		t.Fatal(err)
	}
	large, err := s.Save(t.Context(), SaveRequest{RequestID: "large", DocumentYAML: source}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := s.SelectionContext(t.Context(), Selection{CanvasID: large.Canvas.ID, VersionID: 1, ObjectRefs: []string{"zz-selected-group"}})
	if err != nil {
		t.Fatal(err)
	}
	var context struct {
		Objects   []struct{ ID string }
		Truncated bool
	}
	if err := json.Unmarshal([]byte(raw), &context); err != nil {
		t.Fatal(err)
	}
	if len(context.Objects) == 0 || context.Objects[0].ID != "zz-selected-group" || !context.Truncated {
		t.Fatalf("bounded context must retain the requested object first: %+v", context)
	}
}

func TestSharedHostSelectionContext(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	source := strings.Replace(exampleDocument, "nodeRefs: [core-01]}", "nodeRefs: [core-01], instanceRefs: [orders-01]}\n  - {id: shared, name: Shared host, nodeRefs: [core-01]}", 1)
	saved, err := s.Save(t.Context(), SaveRequest{RequestID: "shared-host", DocumentYAML: source}, "flower")
	if err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{"core-01", "orders-01"} {
		context, err := s.SelectionContext(t.Context(), Selection{CanvasID: saved.Canvas.ID, VersionID: 1, ObjectRefs: []string{ref}})
		if err != nil {
			t.Fatal(err)
		}
		var projection struct {
			Objects []struct {
				ID string `json:"id"`
			} `json:"objects"`
		}
		if err := json.Unmarshal([]byte(context), &projection); err != nil {
			t.Fatal(err)
		}
		ids := map[string]bool{}
		for _, item := range projection.Objects {
			ids[item.ID] = true
		}
		if !ids["application"] || !ids["shared"] || !ids["core-01"] || !ids["orders-01"] {
			t.Fatalf("selected host membership missing for %s: %s", ref, context)
		}
	}
}

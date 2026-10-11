package tessiven

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestExactEditIdentityAndAtomicValidation(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Create(t.Context(), "initial", "Original")
	if err != nil {
		t.Fatal(err)
	}
	request := EditRequest{RequestID: "rename", CanvasID: first.Canvas.ID, ExpectedVersion: 1, Summary: "Rename", Edits: []TextEdit{{OldString: "Original", NewString: "Updated"}}}
	saved, err := s.Edit(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	// The same final document is not the same edit request.
	different := request
	different.Edits = []TextEdit{{OldString: "title: Original", NewString: "title: Updated"}}
	if _, err := s.Edit(t.Context(), different); !errors.Is(err, ErrRequestConflict) {
		t.Fatalf("different edit accepted as retry: %v", err)
	}
	retry, err := s.Edit(t.Context(), request)
	if err != nil || retry.Version.Number != saved.Version.Number {
		t.Fatalf("retry: %+v %v", retry, err)
	}
	if _, err := s.Edit(t.Context(), EditRequest{RequestID: "stale", CanvasID: first.Canvas.ID, ExpectedVersion: 1, Edits: request.Edits}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale edit: %v", err)
	}
	for name, edits := range map[string][]TextEdit{
		"missing":   {{OldString: "absent text", NewString: "x"}},
		"ambiguous": {{OldString: "\n", NewString: "\r\n"}},
		"invalid":   {{OldString: "Updated", NewString: "Changed"}, {OldString: "kind: ServiceCanvas", NewString: "kind: Unknown"}},
	} {
		_, err := s.Edit(t.Context(), EditRequest{RequestID: name, CanvasID: first.Canvas.ID, ExpectedVersion: 2, Edits: edits})
		if err == nil {
			t.Fatalf("%s admitted", name)
		}
		current, err := s.Version(t.Context(), first.Canvas.ID, 0)
		if err != nil || current.Number != 2 || current.DocumentYAML != saved.Version.DocumentYAML {
			t.Fatalf("%s changed saved state", name)
		}
	}
	edits := []TextEdit{{OldString: "Updated", NewString: "Final"}, {OldString: "kind: ServiceCanvas", NewString: "kind: ServiceCanvas # exact batch"}}
	batch, err := s.Edit(t.Context(), EditRequest{RequestID: "batch", CanvasID: first.Canvas.ID, ExpectedVersion: 2, Edits: edits})
	if err != nil || batch.Version.Number != 3 {
		t.Fatalf("batch: %+v %v", batch, err)
	}
	versions, err := s.Versions(t.Context(), first.Canvas.ID, 0)
	if err != nil || len(versions) != 3 {
		t.Fatalf("unexpected versions: %v", err)
	}
}

func TestBoundedEditingLargeCanvas(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	var document strings.Builder
	document.WriteString("apiVersion: redeven.io/tessiven/v1.1.0\nkind: ServiceCanvas\nmetadata:\n  title: Large canvas\nnodes:\n")
	for i := 0; i < 1000; i++ {
		fmt.Fprintf(&document, "  - {id: host-%d, name: '主机 %d', runtimeRef: 'demo:host-%d'}\n", i, i, i)
	}
	document.WriteString("services:\n  - {id: api, name: API, kind: api}\ninstances:\n")
	for i := 0; i < 1000; i++ {
		fmt.Fprintf(&document, "  - {id: api-%d, nodeRef: host-%d, serviceRef: api, role: standalone}\n", i, i)
	}
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "large", DocumentYAML: document.String()}, "flower")
	if err != nil {
		t.Fatal(err)
	}
	read, err := s.Read(t.Context(), ReadRequest{CanvasID: first.Canvas.ID, LineCount: 10})
	if err != nil || !read.HasMore || read.TotalLines < 2000 || len(read.DocumentYAML) > 1000 {
		t.Fatalf("bounded read: %+v %v", read, err)
	}
	found, err := s.Search(t.Context(), SearchRequest{CanvasID: first.Canvas.ID, Query: "host-", Limit: 2})
	if err != nil || len(found.Matches) != 2 || found.NextLine == 0 {
		t.Fatalf("search: %+v %v", found, err)
	}
	next, err := s.Search(t.Context(), SearchRequest{CanvasID: first.Canvas.ID, Version: found.Version, Query: "host-", StartLine: found.NextLine, Limit: 2})
	if err != nil || len(next.Matches) != 2 || next.Matches[0].Line <= found.Matches[1].Line {
		t.Fatalf("continuation: %+v %v", next, err)
	}
	for _, match := range next.Matches {
		if !utf8.ValidString(match.Text) {
			t.Fatal("invalid UTF-8 excerpt")
		}
	}
	target, err := s.Search(t.Context(), SearchRequest{CanvasID: first.Canvas.ID, Query: "主机 777"})
	if err != nil || len(target.Matches) != 1 {
		t.Fatalf("target: %+v %v", target, err)
	}
	saved, err := s.Edit(t.Context(), EditRequest{RequestID: "one-host", CanvasID: first.Canvas.ID, ExpectedVersion: target.Version, Edits: []TextEdit{{OldString: "主机 777", NewString: "Primary host 777"}}})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version.DocumentYAML != strings.Replace(document.String(), "主机 777", "Primary host 777", 1) || len(saved.Version.Document.Nodes) != 1000 || len(saved.Version.Document.Instances) != 1000 {
		t.Fatal("unrelated large canvas content changed")
	}
}

package tessiven

import (
	"path/filepath"
	"testing"
)

func TestLibraryStartsWithOneUnboundExampleAndPreservesUserChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "canvases.sqlite")
	library, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	list, err := library.List(t.Context(), "", "", false)
	if err != nil || len(list.Canvases) != 1 {
		t.Fatalf("expected a starter canvas, got %+v: %v", list, err)
	}
	canvas := list.Canvases[0]
	v, err := library.Version(t.Context(), canvas.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if v.Source != "example" || len(v.Document.Relations) < 3 {
		t.Fatalf("missing example topology: %+v", v)
	}
	for _, instance := range v.Document.Instances {
		if instance.Binding != nil || instance.Observation != nil {
			t.Fatal("example must not claim management identity or health")
		}
	}
	if err := library.Archive(t.Context(), canvas.ID, 1, true); err != nil {
		t.Fatal(err)
	}
	library.Close()
	library, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	list, err = library.List(t.Context(), "", "", false)
	if err != nil || len(list.Canvases) != 0 {
		t.Fatalf("archived example was recreated: %+v %v", list, err)
	}
	archived, err := library.List(t.Context(), "", "", true)
	if err != nil || len(archived.Canvases) != 1 || archived.Canvases[0].ID != canvas.ID {
		t.Fatal("example identity changed on restart")
	}
}

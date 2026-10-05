package tessiven

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/managedwebservice"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
)

type managedFixture struct {
	managedwebservice.Backend
	service managedwebservice.ServiceView
	calls   int
	id      string
}

func (f *managedFixture) List(context.Context) ([]managedwebservice.ServiceView, error) {
	return []managedwebservice.ServiceView{f.service}, nil
}
func (f *managedFixture) Operate(_ context.Context, id string, req managedwebservice.OperationRequest) (*pfregistry.ManagedOperation, error) {
	f.calls++
	f.id = id
	return &pfregistry.ManagedOperation{OperationID: req.RequestID, ServiceID: id, State: "succeeded"}, nil
}
func TestResourceOperationsUseExactVersionIdentityAndOriginalManager(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "initial", DocumentYAML: exampleDocument}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	manager := &managedFixture{service: managedwebservice.ServiceView{ManagedService: pfregistry.ManagedService{ServiceID: "example-service-id", CreatedAtUnixMs: 10}, Name: "Orders", Status: "stopped", Actions: managedwebservice.ServiceActions{}}}
	manager.service.Actions.Start.Available = true
	backend := &ResourceBackend{Library: s, Managed: manager}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	req := ResourceRequest{CanvasID: first.Canvas.ID, VersionID: 1, InstanceID: "orders-01", RuntimeRef: "spoofed", Action: "inspect", Binding: &Binding{Owner: "managed_service", ResourceID: "wrong"}}
	observed, err := backend.Execute(t.Context(), meta, req)
	if err != nil {
		t.Fatal(err)
	}
	if observed.RuntimeRef != "local:local" || observed.Inspection.Binding.ResourceID != "example-service-id" {
		t.Fatalf("untrusted routing was used: %+v", observed)
	}
	req.Action = "start"
	req.Identity = observed.Inspection.Identity
	req.RequestID = "start-1"
	denied := *meta
	denied.CanWrite = false
	if _, err := backend.Execute(t.Context(), &denied, req); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("write denied: %v", err)
	}
	if manager.calls != 0 {
		t.Fatal("denied action executed")
	}
	if _, err := backend.Execute(t.Context(), meta, req); err != nil {
		t.Fatal(err)
	}
	if manager.calls != 1 || manager.id != "example-service-id" {
		t.Fatal("operation was not delegated exactly once")
	}
	manager.service.CreatedAtUnixMs++
	if _, err := backend.Execute(t.Context(), meta, req); !errors.Is(err, ErrResourceChanged) {
		t.Fatalf("recreated resource: %v", err)
	}
	manager.service.CreatedAtUnixMs--
	_, err = s.Save(t.Context(), SaveRequest{RequestID: "next", CanvasID: first.Canvas.ID, ExpectedVersion: 1, DocumentYAML: exampleDocument}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := backend.Execute(t.Context(), meta, req); !errors.Is(err, ErrHistoricalOperation) {
		t.Fatalf("historical action: %v", err)
	}
	if manager.calls != 1 {
		t.Fatal("history or replacement executed an action")
	}
	req.Action = "inspect"
	if _, err := backend.Execute(t.Context(), meta, req); err != nil {
		t.Fatal("historical inspection denied", err)
	}
}
func TestRemoteResourceNeverFallsBackToLocal(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "remote", DocumentYAML: strings.Replace(exampleDocument, "local:local", "ssh:actual-target", 1)}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	manager := &managedFixture{}
	backend := &ResourceBackend{Library: s, Managed: manager}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	req := ResourceRequest{CanvasID: first.Canvas.ID, VersionID: 1, InstanceID: "orders-01", RuntimeRef: "local:local", Action: "inspect"}
	if _, err := backend.Execute(t.Context(), meta, req); !errors.Is(err, ErrTargetUnavailable) {
		t.Fatalf("missing remote: %v", err)
	}
	called := false
	backend.Remote = func(_ context.Context, got *session.Meta, request ResourceRequest) (ResourceResult, error) {
		called = true
		if request.RuntimeRef != "ssh:actual-target" || request.Binding.ResourceID != "example-service-id" || got != meta {
			t.Fatal("remote authority changed")
		}
		return ResourceResult{RuntimeRef: request.RuntimeRef}, nil
	}
	if _, err := backend.Execute(t.Context(), meta, req); err != nil || !called {
		t.Fatal("remote not dispatched", err)
	}
	if manager.calls != 0 {
		t.Fatal("remote executed locally")
	}
}
func TestSelectionReadsImmutableVersionAndRejectsMissingObject(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "first", DocumentYAML: exampleDocument}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	selection := Selection{CanvasID: first.Canvas.ID, VersionID: 1, ObjectRefs: []string{"orders-01"}}
	before, err := s.SelectionContext(t.Context(), selection)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(before, "storage-config") || !strings.Contains(before, "orders-assets") {
		t.Fatal("selection lost evidence", before)
	}
	_, err = s.Rename(t.Context(), first.Canvas.ID, RevisionRequest{RequestID: "renamed", ExpectedVersion: 1, Title: "Another name"})
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.SelectionContext(t.Context(), selection)
	if err != nil || before != after {
		t.Fatal("immutable context changed", err)
	}
	selection.ObjectRefs = []string{"missing"}
	if _, err := s.SelectionContext(t.Context(), selection); !errors.Is(err, ErrNotFound) {
		t.Fatal("missing selection accepted")
	}
}

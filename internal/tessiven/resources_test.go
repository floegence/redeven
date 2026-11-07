package tessiven

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/containerresource"
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
func (f *managedFixture) Inspect(_ context.Context, id string) (*managedwebservice.ServiceView, error) {
	if id != f.service.ServiceID {
		return nil, ErrNotFound
	}
	return &f.service, nil
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
	result, err := backend.Execute(t.Context(), meta, req)
	if err != nil || result.RuntimeRef != "ssh:actual-target" || result.Inspection == nil || result.Inspection.State != "unavailable" || result.Inspection.Binding != nil {
		t.Fatalf("missing remote was not represented as unavailable: result=%+v err=%v", result, err)
	}
	req.Action = "start"
	if _, err := backend.Execute(t.Context(), meta, req); !errors.Is(err, ErrTargetUnavailable) {
		t.Fatalf("missing remote mutation did not remain unavailable: %v", err)
	}
	called := false
	req.Action = "inspect"
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

func TestUnboundLocalInstanceReturnsUnavailableWithoutBinding(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	document := strings.Replace(exampleDocument, "binding: {owner: managed_service, resourceId: example-service-id}", "", 1)
	first, err := s.Save(t.Context(), SaveRequest{RequestID: "unbound", DocumentYAML: document}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	backend := &ResourceBackend{Library: s, Managed: &managedFixture{}}
	result, err := backend.Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{CanvasID: first.Canvas.ID, VersionID: 1, InstanceID: "orders-01", Action: "inspect"})
	if err != nil || result.Inspection == nil || result.Inspection.State != "unavailable" || result.Inspection.Binding != nil {
		t.Fatalf("unbound instance was treated as managed: result=%+v err=%v", result, err)
	}
}

func TestRemoteUnavailableErrorIsStructuredForReadOnlyRequests(t *testing.T) {
	backend := &ResourceBackend{Remote: func(context.Context, *session.Meta, ResourceRequest) (ResourceResult, error) {
		return ResourceResult{}, &ResourceError{Code: "TESSIVEN_TARGET_UNAVAILABLE", Message: "target unavailable", Status: 409}
	}}
	result, err := backend.Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "ssh:missing", Action: "list"})
	if err != nil || result.Inspection == nil || result.Inspection.State != "unavailable" || result.Inspection.Binding != nil {
		t.Fatalf("remote unavailable error was not structured: result=%+v err=%v", result, err)
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

// Exact resource identity must bypass unrelated inventory and canvas discovery.
func TestManagedResourceInspectionUsesExactOwner(t *testing.T) {
	manager := &exactManagedFixture{managedFixture: managedFixture{service: managedwebservice.ServiceView{
		ManagedService: pfregistry.ManagedService{ServiceID: "host-service", TemplateID: "harness-host", WorkspacePath: "/workspace/host", RuntimePort: 51378},
		Name:           "DeepSeek Harness", Description: "Browser coding assistant", Deployment: managedwebservice.DeploymentHost, Status: "running",
	}}}
	backend := &ResourceBackend{Managed: manager}
	result, err := backend.Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "local:local", Action: "inspect", Binding: &Binding{Owner: "managed_service", ResourceID: "host-service"}})
	if err != nil {
		t.Fatal(err)
	}
	if manager.inspected != "host-service" {
		t.Fatal("inspection enumerated unrelated services instead of selecting exact ID")
	}
	raw, _ := json.Marshal(result)
	for _, expected := range []string{`"deployment":"host"`, `"template_id":"harness-host"`, `"workspace_path":"/workspace/host"`, `"runtime_port":51378`, `"description":"Browser coding assistant"`} {
		if !strings.Contains(string(raw), expected) {
			t.Errorf("missing model-visible fact %s: %s", expected, raw)
		}
	}
}

type exactManagedFixture struct {
	managedFixture
	inspected    string
	inspectError error
	substitute   bool
}

func (f *exactManagedFixture) List(context.Context) ([]managedwebservice.ServiceView, error) {
	return nil, errors.New("unrelated inventory failed")
}
func (f *exactManagedFixture) Inspect(_ context.Context, id string) (*managedwebservice.ServiceView, error) {
	f.inspected = id
	if f.inspectError != nil {
		return nil, f.inspectError
	}
	if f.substitute {
		return &managedwebservice.ServiceView{ManagedService: pfregistry.ManagedService{ServiceID: "other"}}, nil
	}
	if id != f.service.ServiceID {
		return nil, ErrNotFound
	}
	return &f.service, nil
}

type resourceInventoryFixture struct {
	*containerengine.CLIClient
	missing   bool
	listError error
}

func (f *resourceInventoryFixture) ListEndpoints(_ context.Context, engine containerengine.Engine) ([]containerengine.EngineEndpoint, error) {
	if engine == containerengine.EnginePodman {
		return nil, containerengine.ErrCLIUnavailable
	}
	return []containerengine.EngineEndpoint{{Engine: engine, EndpointID: "fixture", Default: true}}, nil
}
func (f *resourceInventoryFixture) BindEndpoint(ctx context.Context, engine containerengine.Engine, id containerengine.EndpointID) (context.Context, containerengine.EngineEndpoint, error) {
	return ctx, containerengine.EngineEndpoint{Engine: engine, EndpointID: id, Default: true}, nil
}
func (f *resourceInventoryFixture) EndpointMetadata(_ context.Context, endpoint containerengine.EngineEndpoint) (containerengine.EngineEndpoint, error) {
	return endpoint, nil
}
func (f *resourceInventoryFixture) Status(_ context.Context, engine containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: engine, Available: true}, nil
}
func (f *resourceInventoryFixture) List(_ context.Context, engine containerengine.Engine, _ bool) ([]containerengine.EngineContainer, error) {
	if f.listError != nil {
		return nil, f.listError
	}
	return []containerengine.EngineContainer{{Engine: engine, ContainerID: "gone", Name: "DeepSeek Harness"}, {Engine: engine, ContainerID: "available", Name: "DeepSeek Harness"}}, nil
}
func (f *resourceInventoryFixture) Inspect(_ context.Context, engine containerengine.Engine, id string) (containerengine.EngineContainer, error) {
	if id == "gone" && f.missing {
		return containerengine.EngineContainer{}, containerengine.ErrContainerNotFound
	}
	return containerengine.EngineContainer{Engine: engine, ContainerID: id, Name: "DeepSeek Harness", State: containerengine.ContainerState("running")}, nil
}
func TestResourceInventoryRetainsFactsAndReportsPartialScopes(t *testing.T) {
	for _, scenario := range []string{"missing-container", "failed-endpoint", "complete"} {
		t.Run(scenario, func(t *testing.T) {
			client := &resourceInventoryFixture{missing: scenario == "missing-container"}
			if scenario == "failed-endpoint" {
				client.listError = errors.New("private transport detail")
			}
			engine, err := containerengine.NewAdapter(client)
			if err != nil {
				t.Fatal(err)
			}
			containers, err := containerresource.Open(containerresource.Options{DatabasePath: filepath.Join(t.TempDir(), "containers.sqlite"), Engine: engine})
			if err != nil {
				t.Fatal(err)
			}
			defer containers.Close()
			backend := &ResourceBackend{Managed: &managedFixture{service: managedwebservice.ServiceView{ManagedService: pfregistry.ManagedService{ServiceID: "host"}, Name: "DeepSeek Harness", Deployment: managedwebservice.DeploymentHost}}, Containers: containers}
			result, err := backend.Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "local:local", Action: "list"})
			if err != nil {
				t.Fatal(err)
			}
			want := 3
			if scenario == "missing-container" {
				want = 2
			}
			if scenario == "failed-endpoint" {
				want = 1
			}
			if len(result.Resources) != want || result.Resources[0].Binding.ResourceID != "host" {
				t.Fatalf("independent resources lost: %+v", result)
			}
			if result.Complete == nil || *result.Complete != (scenario == "complete") {
				t.Fatalf("wrong completeness: %+v", result)
			}
			if scenario != "complete" {
				if len(result.Issues) != 1 || result.Issues[0].Owner != "container" || result.Issues[0].EndpointID != "fixture" {
					t.Fatalf("missing issue identity: %+v", result.Issues)
				}
				if scenario == "missing-container" && result.Issues[0].ResourceID != "gone" {
					t.Fatal("missing exact failed resource")
				}
				raw, _ := json.Marshal(result)
				if strings.Contains(string(raw), "private transport detail") {
					t.Fatal("private cause exposed")
				}
			}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			if _, err := backend.Execute(ctx, &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "local:local", Action: "list"}); !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation became partial success: %v", err)
			}
		})
	}
}

func TestManagedResourceRefusalNeverSubstitutesIdentity(t *testing.T) {
	for _, scenario := range []string{"missing", "permission", "changed"} {
		t.Run(scenario, func(t *testing.T) {
			manager := &exactManagedFixture{managedFixture: managedFixture{service: managedwebservice.ServiceView{ManagedService: pfregistry.ManagedService{ServiceID: "target"}}}}
			want := ErrNotFound
			if scenario == "permission" {
				want = ErrPermissionDenied
				manager.inspectError = want
			}
			if scenario == "changed" {
				want = ErrResourceChanged
				manager.substitute = true
			}
			result, err := (&ResourceBackend{Managed: manager}).Execute(t.Context(), &session.Meta{CanRead: true}, ResourceRequest{RuntimeRef: "local:local", Action: "inspect", Binding: &Binding{Owner: "managed_service", ResourceID: "missing"}})
			if !errors.Is(err, want) || result.Inspection != nil || len(result.Resources) != 0 {
				t.Fatalf("refusal substituted a result: %+v %v", result, err)
			}
		})
	}
}

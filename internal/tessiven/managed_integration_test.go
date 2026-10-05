package tessiven_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	templatecontract "github.com/floegence/redeven-service-templates/template"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/managedwebservice"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

// The original manager starts this isolated process with its assigned port.
// It serves no user files and terminates only through the owning manager.
func TestTessivenManagedHTTPFixture(t *testing.T) {
	if os.Getenv("REDEVEN_TESSIVEN_HTTP_FIXTURE") != "1" {
		return
	}
	port := os.Getenv("REDEVEN_SERVICE_PORT")
	if port == "" {
		t.Fatal("manager did not assign a port")
	}
	server := &http.Server{Addr: "127.0.0.1:" + port, Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("Tessiven isolated fixture")) }), ReadHeaderTimeout: time.Second}
	if err := server.ListenAndServe(); err != nil {
		t.Fatal(err)
	}
}
func TestTessivenRoutesRealManagedServiceLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("isolated host process qualification")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(root, "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	manager, err := managedwebservice.New(managedwebservice.ManagerOptions{Registry: registry, Scope: scope, StateDir: root})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	quoted := "'" + strings.ReplaceAll(executable, "'", "'\\''") + "'"
	template, err := manager.CreateTemplate(t.Context(), managedwebservice.TemplateWriteRequest{RequestID: "tessiven-fixture-template", Name: "Tessiven fixture", Spec: managedwebservice.TemplateSpec{SchemaVersion: templatecontract.SpecVersion, Kind: managedwebservice.DeploymentHost, Endpoint: managedwebservice.WebEndpointSpec{Scheme: "http", Path: "/", HealthPath: "/"}, Host: &managedwebservice.HostTemplateSpec{StartScript: "export REDEVEN_TESSIVEN_HTTP_FIXTURE=1; exec " + quoted + " -test.run=^TestTessivenManagedHTTPFixture$"}}})
	if err != nil {
		t.Fatal(err)
	}
	request := managedwebservice.CreateRequest{RequestID: "tessiven-fixture-create", TemplateID: template.TemplateID, Deployment: managedwebservice.DeploymentHost, WorkspacePath: filepath.Join(root, "workspace")}
	plan, err := manager.PreflightInstall(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.PlanDigest = plan.PlanDigest
	created, err := manager.Create(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	wait := func(id string) {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			op, err := manager.Operation(t.Context(), id)
			if err != nil {
				t.Fatal(err)
			}
			switch op.State {
			case "succeeded":
				return
			case "failed", "canceled", "interrupted":
				t.Fatalf("manager operation failed: %+v", op)
			}
			time.Sleep(30 * time.Millisecond)
		}
		t.Fatal("manager operation did not finish")
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		op, err := manager.Operate(ctx, created.Service.ServiceID, managedwebservice.OperationRequest{RequestID: "tessiven-fixture-cleanup", Action: managedwebservice.ActionStop})
		if err == nil {
			wait(op.OperationID)
		}
	}()
	wait(created.Operation.OperationID)
	library, err := tessiven.Open(filepath.Join(root, "canvases.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer library.Close()
	document := fmt.Sprintf("apiVersion: redeven.io/tessiven/v1\nkind: ServiceCanvas\nmetadata: {title: Fixture}\nnodes: [{id: host, name: Fixture, runtimeRef: 'local:local'}]\nservices: [{id: api, name: Fixture, kind: api}]\ninstances: [{id: service, nodeRef: host, serviceRef: api, role: standalone, binding: {owner: managed_service, resourceId: %s}}]\n", created.Service.ServiceID)
	saved, err := library.Save(t.Context(), tessiven.SaveRequest{RequestID: "fixture-canvas", DocumentYAML: document}, "manual")
	if err != nil {
		t.Fatal(err)
	}
	backend := &tessiven.ResourceBackend{Library: library, Managed: manager}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true}
	req := tessiven.ResourceRequest{CanvasID: saved.Canvas.ID, VersionID: 1, InstanceID: "service", RuntimeRef: "local:local", Action: "inspect"}
	for _, action := range []string{"stop", "start", "restart", "stop"} {
		req.Action = "inspect"
		observed, err := backend.Execute(t.Context(), meta, req)
		if err != nil {
			t.Fatal(err)
		}
		req.Identity = observed.Inspection.Identity
		req.Action = action
		req.RequestID = fmt.Sprintf("fixture-%s-%d", action, time.Now().UnixNano())
		result, err := backend.Execute(t.Context(), meta, req)
		if err != nil {
			t.Fatal(action, err)
		}
		operation, ok := result.Operation.(*pfregistry.ManagedOperation)
		if !ok {
			t.Fatalf("original manager operation identity missing: %T", result.Operation)
		}
		wait(operation.OperationID)
		req.Action = "inspect"
		confirmed, err := backend.Execute(t.Context(), meta, req)
		if err != nil {
			t.Fatal(err)
		}
		if confirmed.Inspection.RuntimeRef != "local:local" || confirmed.Inspection.Binding.ResourceID != created.Service.ServiceID {
			t.Fatal("wrong instance result")
		}
		expected := "running"
		if action == "stop" {
			expected = "stopped"
		}
		if confirmed.Inspection.State != expected {
			t.Fatalf("confirmed state=%s, expected %s", confirmed.Inspection.State, expected)
		}
		t.Logf("action=%s state=%s operation=%s state_root=%s", action, confirmed.Inspection.State, operation.OperationID, root)
	}
}

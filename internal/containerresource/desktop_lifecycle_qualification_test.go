package containerresource

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

// Explicit local qualification: this temporarily stops the host Docker Desktop.
// It is excluded from ordinary CI and preserves the host's existing containers.
func TestDockerDesktopHostLifecycleQualification(t *testing.T) {
	if os.Getenv("REDEVEN_TEST_DOCKER_DESKTOP_LIFECYCLE") != "1" {
		t.Skip("requires explicit host Docker Desktop lifecycle qualification")
	}
	if runtime.GOOS != "darwin" {
		t.Skip("macOS Desktop qualification")
	}
	// Exercise the Desktop/dev launch boundary, not only a small shell
	// environment. Runtime metadata must never reach the independent app.
	t.Setenv("REDEVEN_DESKTOP_BUNDLE_METADATA", strings.Repeat("qualification-runtime-metadata", 2048))
	ctx := context.Background()
	client := containerengine.NewCLIClient()
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	services, err := client.ContainerServices(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var desktop containerengine.ContainerService
	for _, item := range services {
		if item.Implementation == containerengine.ContainerServiceDockerDesktop {
			desktop = item
		}
	}
	if desktop.ServiceID == "" {
		t.Fatal("the selected local endpoint must belong to Docker Desktop")
	}
	service, err := Open(Options{DatabasePath: filepath.Join(t.TempDir(), "operations.sqlite"), Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	run := func(method containerengine.Method) {
		t.Helper()
		raw, err := json.Marshal(containerengine.ContainerServiceActionRequest{Engine: containerengine.EngineDocker, ServiceID: desktop.ServiceID, ConfirmationName: desktop.Name})
		if err != nil {
			t.Fatal(err)
		}
		preflight, err := service.Preflight(ctx, PreflightRequest{Method: method, Request: raw})
		if err != nil {
			t.Fatal(err)
		}
		started := time.Now()
		operation, err := service.CreateOperation(ctx, CreateOperationRequest{RequestID: string(method) + "-host-qualification", Method: method, Request: raw, RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash})
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.After(150 * time.Second)
		for !operation.State.Terminal() {
			select {
			case <-deadline:
				t.Fatal("operation did not terminate")
			case <-time.After(250 * time.Millisecond):
			}
			operation, err = service.Operation(ctx, operation.OperationID)
			if err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("%s state=%s duration=%s reconciliation=%s", method, operation.State, time.Since(started).Round(time.Millisecond), operation.Reconciliation)
		if operation.State != OperationSucceeded {
			t.Fatalf("operation failed: %s", operation.ErrorCode)
		}
	}
	if desktop.State == containerengine.ContainerServiceStateRunning {
		run(containerengine.MethodContainerServicesStop)
	}
	run(containerengine.MethodContainerServicesStart)
	run(containerengine.MethodContainerServicesRestart)
	final, err := adapter.ContainerService(ctx, desktop.ServiceID)
	if err != nil || final.State != containerengine.ContainerServiceStateRunning {
		t.Fatalf("final service = %+v, error=%v", final, err)
	}
}

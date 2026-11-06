//go:build darwin || linux

package managedwebservice

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestInstallAdmissionStartsRealHostAndPublishesReadyView(t *testing.T) {
	m, registry, req, _ := admissionFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"versions": map[string]any{"1.0.0": map[string]any{"version": "1.0.0", "dist": map[string]string{"integrity": testNPMIntegrity("reviewed")}}}})
	})
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	record, err := registry.GetManagedTemplate(context.Background(), req.TemplateID)
	if err != nil {
		t.Fatal(err)
	}
	var spec TemplateSpec
	if err := json.Unmarshal([]byte(record.SpecJSON), &spec); err != nil {
		t.Fatal(err)
	}
	spec.Host.StartScript = "exec \"$UPDATE_TEST_EXECUTABLE\" -test.run=^TestHostUpdateHTTPHelper$"
	spec.Host.Environment = map[string]string{"UPDATE_TEST_EXECUTABLE": executable, "UPDATE_HTTP_HELPER": "1"}
	spec.Endpoint.StartupTimeout = 5
	record.SpecJSON, record.SpecSHA256, err = canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.UpdateManagedTemplate(context.Background(), *record); err != nil {
		t.Fatal(err)
	}
	req.TargetReleaseID = "" // Exercise the default selection and durable integrity enrichment.
	req.PlanDigest = ""
	req.WorkspacePath = filepath.Join(filepath.Dir(req.WorkspacePath), "native-install")
	plan, err := m.PreflightInstall(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	req.PlanDigest, req.WorkspacePath = plan.PlanDigest, plan.WorkspacePath
	driver := &nativeVerifiedHostUpdateDriver{&hostScriptDriver{manager: m, processes: map[string]hostProcess{}}}
	m.host = driver
	created, err := m.Create(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	var stored *pfregistry.ManagedService
	t.Cleanup(func() {
		if stored != nil {
			_ = driver.Stop(context.Background(), stored)
		}
	})
	for {
		op, err := registry.GetManagedOperation(ctx, created.Operation.OperationID)
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "failed" {
			t.Fatalf("installation failed: %+v", op)
		}
		if op.State == "succeeded" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	stored, err = registry.GetManagedService(ctx, created.Service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	view, err := m.Inspect(ctx, stored.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != "running" || view.PendingChanges || !view.Actions.Open.Available {
		t.Fatalf("not ready: %+v", view)
	}
	identity, err := decodeReleaseIdentity(stored.ReleaseIdentityJSON, stored.ReleaseIdentitySHA256)
	if err != nil || identity.Integrity != testNPMIntegrity("reviewed") {
		t.Fatalf("release: %+v %v", identity, err)
	}
	state, err := driver.readRunState(stored)
	if err != nil || state.RuntimeSpecSHA256 != stored.RuntimeSpecSHA256 {
		t.Fatalf("runtime digest: %+v %v", state, err)
	}
	// Opening uses the actual host driver after the deterministic package boundary.
	m.host = driver.hostScriptDriver
	entrance, err := m.OpenSession(ctx, stored.ServiceID, OpenSessionRequest{RequestID: "native-install-open"})
	if err != nil || entrance.State != "ready" {
		t.Fatalf("entrance: %+v %v", entrance, err)
	}
	pid := hostPIDFromIdentity(stored.RuntimeIdentity)
	if err := driver.Stop(ctx, stored); err != nil {
		t.Fatal(err)
	}
	if managedProcessRunning(pid) {
		t.Fatal("qualification left a process running")
	}
}

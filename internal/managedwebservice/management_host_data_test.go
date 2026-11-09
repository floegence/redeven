package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagementHostDataOwnershipDiagnosticsAndUninstall(t *testing.T) {
	for _, test := range []struct {
		name                        string
		sharedData, deleteWorkspace bool
	}{
		{name: "retain unverified data and workspace", sharedData: true},
		{name: "retain unverified data and delete reviewed workspace", sharedData: true, deleteWorkspace: true},
		{name: "delete instance data and reviewed workspace", deleteWorkspace: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			m, registry, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "stopped")
			if test.sharedData {
				binding, err := decodeRuntimeBinding(service)
				if err != nil {
					t.Fatal(err)
				}
				binding.Host.DataRoot = "families/" + binding.ServiceFamilyID + "/data"
				raw, err := json.Marshal(binding)
				if err != nil {
					t.Fatal(err)
				}
				sum := sha256.Sum256(raw)
				service.RuntimeBindingJSON, service.RuntimeBindingSHA256 = string(raw), hex.EncodeToString(sum[:])
				if err := registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeBindingJSON: &service.RuntimeBindingJSON, RuntimeBindingSHA256: &service.RuntimeBindingSHA256}); err != nil {
					t.Fatal(err)
				}
			}
			driver := m.host.(*hostScriptDriver)
			identity, err := driver.Start(ctx, service)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = killManagedProcessPID(hostPIDFromIdentity(identity)) })
			service.RuntimeIdentity, service.DesiredState, service.ObservedState = identity, "running", "running"
			if err := registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &identity, DesiredState: &service.DesiredState, ObservedState: &service.ObservedState, RuntimeSpecSHA256: &service.RuntimeSpecSHA256}); err != nil {
				t.Fatal(err)
			}
			data := driver.dataRoot(service)
			for _, path := range []string{filepath.Join(data, "data-marker"), filepath.Join(service.WorkspacePath, "workspace-marker")} {
				if err := os.WriteFile(path, []byte("preserve selected resources"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			plan, err := m.PreflightManagement(ctx, service.ServiceID, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true})
			if err != nil {
				t.Fatal(err)
			}
			if test.sharedData {
				if !slices.Contains(plan.Blockers, "RESOURCE_OWNERSHIP_UNVERIFIED") {
					t.Fatalf("unverified deletion admitted: %+v", plan)
				}
				var resource ServiceResourceFact
				for _, item := range plan.Facts.Resources {
					if item.ResourceID == "host-data" {
						resource = item
					}
				}
				if resource.Identity != data || resource.Ownership != "unverified" || resource.ProblemCode != "RESOURCE_OWNERSHIP_UNVERIFIED" {
					t.Fatalf("data blocker is not attributed to the resource: %+v", resource)
				}
				_, err = m.Operate(ctx, service.ServiceID, OperationRequest{RequestID: "blocked-data-deletion", Action: ActionUninstall, DeleteData: true, DeleteWorkspace: true, PlanDigest: plan.PlanDigest, Administrator: true})
				if managedErrorCode(err) != "RESOURCE_OWNERSHIP_UNVERIFIED" {
					t.Fatalf("blocked request result: %v", err)
				}
				if op, err := registry.GetManagedOperationByRequestID(ctx, "blocked-data-deletion"); err != nil || op != nil {
					t.Fatalf("blocked review created an operation: %+v %v", op, err)
				}
				if !managedProcessRunning(hostPIDFromIdentity(identity)) {
					t.Fatal("blocked review stopped the service")
				}
			}
			op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionUninstall, DeleteData: !test.sharedData, DeleteWorkspace: test.deleteWorkspace})
			if op.State != "succeeded" {
				t.Fatalf("uninstall failed: %+v", op)
			}
			if managedProcessRunning(hostPIDFromIdentity(identity)) {
				t.Fatal("uninstall left its process running")
			}
			forward, err := registry.GetForward(ctx, service.ForwardID)
			if err != nil || forward != nil {
				t.Fatalf("uninstall left an active entrance: %+v %v", forward, err)
			}
			archived, err := registry.GetManagedService(ctx, service.ServiceID)
			if err != nil {
				t.Fatal(err)
			}
			if test.sharedData && (archived == nil || archived.ManagementState != "uninstalled") {
				t.Fatalf("retained resources lost their archive: %+v", archived)
			}
			if !test.sharedData && archived != nil {
				t.Fatalf("complete cleanup retained a service record: %+v", archived)
			}
			for path, retained := range map[string]bool{filepath.Join(data, "data-marker"): test.sharedData, filepath.Join(service.WorkspacePath, "workspace-marker"): !test.deleteWorkspace} {
				_, err := os.Stat(path)
				if retained && err != nil || !retained && !os.IsNotExist(err) {
					t.Fatalf("incorrect resource result: %s retained=%v err=%v", path, retained, err)
				}
			}
		})
	}
}

func TestManagementUninstallResourceDiagnosticsFollowSelection(t *testing.T) {
	for _, test := range []struct {
		name                         string
		present, symlink, deleteData bool
		retain                       bool
		problem                      string
	}{
		{name: "selected unverified directory", present: true, deleteData: true, problem: "RESOURCE_OWNERSHIP_UNVERIFIED"},
		{name: "unselected unverified directory", present: true},
		{name: "explicitly retained directory", present: true, deleteData: true, retain: true},
		{name: "absent unverified directory", deleteData: true},
		{name: "specific unsafe path diagnosis", present: true, symlink: true, deleteData: true, problem: "WORKSPACE_DELETE_UNSAFE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, _, service, _ := newRuntimeResolutionTestService(t, TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}, ReleaseIdentity{Kind: "none"}, "stopped")
			binding, err := decodeRuntimeBinding(service)
			if err != nil {
				t.Fatal(err)
			}
			binding.Host.DataRoot = "families/" + binding.ServiceFamilyID + "/data"
			raw, err := json.Marshal(binding)
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(raw)
			service.RuntimeBindingJSON, service.RuntimeBindingSHA256 = string(raw), hex.EncodeToString(sum[:])
			path := m.resolveBindingPath(binding.Host.DataRoot)
			if test.present {
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if test.symlink {
					err = os.Symlink(t.TempDir(), path)
				} else {
					err = os.Mkdir(path, 0700)
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			req := ManagementPlanRequest{Action: ActionUninstall, DeleteData: test.deleteData}
			if test.retain {
				req.RetainResourceIDs = []string{"host-data"}
			}
			plan, err := m.managementPlan(context.Background(), service, req)
			if err != nil {
				t.Fatal(err)
			}
			index := slices.IndexFunc(plan.Facts.Resources, func(item ServiceResourceFact) bool { return item.ResourceID == "host-data" })
			if index < 0 || plan.Facts.Resources[index].ProblemCode != test.problem {
				t.Fatalf("incorrect resource diagnostic: %+v", plan.Facts.Resources)
			}
			if test.problem == "" && len(plan.Blockers) != 0 || test.problem != "" && !slices.Equal(plan.Blockers, []string{test.problem}) {
				t.Fatalf("incorrect blockers: %v", plan.Blockers)
			}
		})
	}
}

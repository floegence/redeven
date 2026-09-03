package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func newWorkspaceTestManager(t *testing.T) (*Manager, *pfregistry.Registry, string) {
	t.Helper()
	home := t.TempDir()
	homeReal, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	manager, err := New(ManagerOptions{StateDir: filepath.Join(home, ".redeven", "local-environment"), Registry: registry, Scope: scope})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	return manager, registry, homeReal
}

func persistWorkspaceTestService(t *testing.T, registry *pfregistry.Registry, serviceID, workspace, ownership string) pfregistry.ManagedService {
	t.Helper()
	snapshot := `{"schema_version":4,"kind":"host","endpoint":{"scheme":"http"},"host":{"start_script":"true"}}`
	service := pfregistry.ManagedService{
		ServiceID: serviceID, TemplateID: "template-" + serviceID, TemplateSource: "custom", TemplateRevision: 1,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: workspaceTestDigest(snapshot), ServiceFamilyID: "family-" + serviceID,
		Deployment: string(DeploymentHost), WorkspacePath: workspace, WorkspaceOwnership: ownership,
		DesiredState: "stopped", ObservedState: "installing", ForwardID: "pf-" + serviceID, RuntimeManifestJSON: "{}", RuntimePort: 3080,
	}
	setTestRuntimeBinding(t, &service)
	if err := registry.CreateManagedService(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}); err != nil {
		t.Fatal(err)
	}
	return service
}

func workspaceTestDigest(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func TestInstallWorkspaceIsCreatedOnlyByInstallWorker(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "Redeven", "workspaces", "managed-services", "template-one")

	resolved, ownership, err := manager.resolveInstallWorkspace(target)
	if err != nil {
		t.Fatal(err)
	}
	if ownership != workspaceOwnershipPending || resolved.RealAbs != target {
		t.Fatalf("resolved workspace = %+v, ownership=%q", resolved, ownership)
	}
	if _, err := os.Stat(filepath.Join(home, "Redeven")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("request validation created workspace parents: %v", err)
	}

	service := persistWorkspaceTestService(t, registry, "mws-lazy", target, ownership)
	if err := manager.ensureInstallWorkspace(context.Background(), &service); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		t.Fatalf("install worker did not create workspace: info=%v err=%v", info, err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored == nil || stored.WorkspaceOwnership != workspaceOwnershipRedevenCreated {
		t.Fatalf("stored ownership = %#v, err=%v", stored, err)
	}
}

func TestInstallWorkspaceDoesNotClaimDirectoryCreatedAfterRequest(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "existing-before-worker")
	_, ownership, err := manager.resolveInstallWorkspace(target)
	if err != nil || ownership != workspaceOwnershipPending {
		t.Fatalf("request ownership = %q, err=%v", ownership, err)
	}
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "user.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-race", target, ownership)
	if err := manager.ensureInstallWorkspace(context.Background(), &service); err != nil {
		t.Fatal(err)
	}
	if service.WorkspaceOwnership != workspaceOwnershipUserSelected {
		t.Fatalf("ownership = %q, want user_selected", service.WorkspaceOwnership)
	}
	if data, err := os.ReadFile(filepath.Join(target, "user.txt")); err != nil || string(data) != "keep" {
		t.Fatalf("existing workspace content changed: data=%q err=%v", data, err)
	}
}

func TestDeleteServiceWorkspaceRemovesOnlyOwnedDirectoryWithoutFollowingSymlinks(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "workspace-to-delete")
	outside := filepath.Join(home, "outside")
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "keep.txt"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(target, "outside-link")); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-delete", target, workspaceOwnershipRedevenCreated)
	if err := manager.deleteServiceWorkspace(context.Background(), service); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("workspace still exists: %v", err)
	}
	if data, err := os.ReadFile(filepath.Join(outside, "keep.txt")); err != nil || string(data) != "keep" {
		t.Fatalf("nested symlink target changed: data=%q err=%v", data, err)
	}
}

func TestDeleteServiceWorkspaceRejectsRelatedServiceAndProtectedRoot(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	parent := filepath.Join(home, "shared")
	child := filepath.Join(parent, "child")
	if err := os.MkdirAll(child, 0o700); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-parent", parent, workspaceOwnershipUserSelected)
	_ = persistWorkspaceTestService(t, registry, "mws-child", child, workspaceOwnershipUserSelected)
	if err := manager.deleteServiceWorkspace(context.Background(), service); managedErrorCode(err) != "WORKSPACE_IN_USE" {
		t.Fatalf("overlapping workspace error = %v", err)
	}
	service.WorkspacePath = home
	if err := manager.deleteServiceWorkspace(context.Background(), service); managedErrorCode(err) != "WORKSPACE_DELETE_UNSAFE" {
		t.Fatalf("protected root error = %v", err)
	}
}

func TestDeleteServiceWorkspaceTreatsMissingDirectoryAsSuccess(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	service := persistWorkspaceTestService(t, registry, "mws-missing", filepath.Join(home, "already-gone"), workspaceOwnershipRedevenCreated)
	if err := manager.deleteServiceWorkspace(context.Background(), service); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallKeepsUserWorkspaceUnlessExplicitlySelected(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	for _, test := range []struct {
		name            string
		ownership       string
		deleteWorkspace bool
		wantDeleted     bool
	}{
		{name: "user-retained", ownership: workspaceOwnershipUserSelected},
		{name: "user-deleted", ownership: workspaceOwnershipUserSelected, deleteWorkspace: true, wantDeleted: true},
		{name: "redeven-deleted", ownership: workspaceOwnershipRedevenCreated, deleteWorkspace: true, wantDeleted: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			target := filepath.Join(home, test.name)
			if err := os.Mkdir(target, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(target, "content.txt"), []byte("content"), 0o600); err != nil {
				t.Fatal(err)
			}
			service := persistWorkspaceTestService(t, registry, "mws-"+test.name, target, test.ownership)
			now := time.Now().UnixMilli()
			op := pfregistry.ManagedOperation{
				OperationID: "mop-" + test.name, ServiceID: service.ServiceID, RequestID: "request-" + test.name,
				RequestFingerprint: test.name, Action: string(ActionUninstall), DeleteData: true, DeleteWorkspace: test.deleteWorkspace,
				State: "pending", Stage: "stopping", ProgressTotal: operationProgressTotal, CreatedAtUnixMs: now, UpdatedAtUnixMs: now,
			}
			if err := registry.CreateManagedOperation(context.Background(), op); err != nil {
				t.Fatal(err)
			}
			driver := &uninstallOwnershipDriver{}
			if err := manager.runUninstall(context.Background(), &service, &op, driver, true, test.deleteWorkspace, false); err != nil {
				t.Fatal(err)
			}
			_, err := os.Stat(target)
			if test.wantDeleted && !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("workspace was not deleted: %v", err)
			}
			if !test.wantDeleted && err != nil {
				t.Fatalf("workspace was not retained: %v", err)
			}
			if stored, err := registry.GetManagedService(context.Background(), service.ServiceID); err != nil || stored != nil {
				t.Fatalf("uninstalled service = %#v, err=%v", stored, err)
			}
		})
	}
}

func TestRetryUninstallPreservesDeletionIntentAndAuthorization(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "retry-workspace")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-retry-workspace", target, workspaceOwnershipUserSelected)
	failure := pfregistry.ManagedOperation{
		OperationID: "mop-failed-uninstall", ServiceID: service.ServiceID, RequestID: "request-failed-uninstall", RequestFingerprint: "failed",
		Action: string(ActionUninstall), DeleteData: true, DeleteWorkspace: true, State: "failed", Stage: "failed", ErrorCode: "WORKSPACE_DELETE_FAILED",
	}
	if err := registry.CreateManagedOperation(context.Background(), failure); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-retry-without-admin", Action: ActionRetry}); managedErrorCode(err) != "ADMIN_REQUIRED" {
		t.Fatalf("unauthorized retry error = %v", err)
	}
	driver := &uninstallOwnershipDriver{uninstallErr: errors.New("runtime uninstall must not run twice")}
	manager.host = driver
	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-retry-with-admin", Action: ActionRetry, Administrator: true})
	if err != nil {
		t.Fatal(err)
	}
	if !op.DeleteData || !op.DeleteWorkspace || op.RetryOfOperationID != failure.OperationID || op.Action != string(ActionUninstall) {
		t.Fatalf("retry operation lost deletion intent: %+v", op)
	}
	manager.workers.Wait()
	if driver.uninstallCalls != 0 {
		t.Fatalf("workspace-only retry repeated runtime uninstall %d times", driver.uninstallCalls)
	}
	if stored, err := registry.GetManagedService(context.Background(), service.ServiceID); err != nil || stored != nil {
		t.Fatalf("workspace-only retry left service = %#v, err=%v", stored, err)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("workspace-only retry did not delete workspace: %v", err)
	}
}

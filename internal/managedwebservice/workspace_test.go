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

type workspaceLifecycleDriver struct {
	startCalls      int
	stopCalls       int
	workspaceAtStop bool
}

func (*workspaceLifecycleDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	return "", "", errors.New("unexpected install")
}

func (d *workspaceLifecycleDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	d.startCalls++
	return "runtime-workspace-test", nil
}

func (d *workspaceLifecycleDriver) Stop(_ context.Context, service *pfregistry.ManagedService) error {
	d.stopCalls++
	info, err := os.Stat(service.WorkspacePath)
	d.workspaceAtStop = err == nil && info.IsDir()
	return nil
}

func (*workspaceLifecycleDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error {
	return errors.New("unexpected uninstall")
}

func (*workspaceLifecycleDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return nil
}

func (*workspaceLifecycleDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

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

func TestResolveInstallWorkspaceKeepsInvalidRequestStatus(t *testing.T) {
	manager, _, _ := newWorkspaceTestManager(t)
	_, _, err := manager.resolveInstallWorkspace("relative-workspace")
	code, _, status, _ := ErrorDetails(err)
	if code != "WORKSPACE_UNAVAILABLE" || status != 400 {
		t.Fatalf("invalid install workspace error = %v, code=%q status=%d", err, code, status)
	}
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

func TestRetryInstallRecreatesMissingWorkspaceWithoutChangingOwnership(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "missing-retry-install-workspace")
	service := persistWorkspaceTestService(t, registry, "mws-retry-install", target, workspaceOwnershipUserSelected)

	if err := manager.ensureInstallWorkspace(context.Background(), &service); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
		t.Fatalf("recreated install workspace: info=%v err=%v", info, err)
	}
	if service.WorkspaceOwnership != workspaceOwnershipUserSelected {
		t.Fatalf("ownership = %q", service.WorkspaceOwnership)
	}
}

func TestStartRejectsMissingWorkspaceWithoutCreatingIt(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "missing-start-workspace")
	service := persistWorkspaceTestService(t, registry, "mws-missing-start", target, workspaceOwnershipUserSelected)
	driver := &workspaceLifecycleDriver{}
	manager.host = driver
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-missing-start", Action: ActionStart})
	if err != nil {
		t.Fatal(err)
	}
	manager.workers.Wait()
	stored, err := manager.Operation(context.Background(), op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != "failed" || stored.ErrorCode != "WORKSPACE_MISSING" {
		t.Fatalf("start operation = %+v", stored)
	}
	if driver.startCalls != 0 || driver.stopCalls != 0 {
		t.Fatalf("missing workspace reached driver: start=%d stop=%d", driver.startCalls, driver.stopCalls)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("ordinary start created workspace: %v", err)
	}
}

func TestRetryStartRecreatesMissingWorkspaceWithoutChangingOwnership(t *testing.T) {
	for _, test := range []struct {
		name      string
		ownership string
	}{
		{name: "user", ownership: workspaceOwnershipUserSelected},
		{name: "redeven", ownership: workspaceOwnershipRedevenCreated},
	} {
		t.Run(test.name, func(t *testing.T) {
			manager, registry, home := newWorkspaceTestManager(t)
			target := filepath.Join(home, "missing-retry-workspace", test.name)
			service := persistWorkspaceTestService(t, registry, "mws-retry-"+test.name, target, test.ownership)
			failure := pfregistry.ManagedOperation{
				OperationID: "mop-failed-" + test.name, ServiceID: service.ServiceID,
				RequestID: "request-failed-" + test.name, RequestFingerprint: "failed-" + test.name,
				Action: string(ActionStart), State: "failed", Stage: "failed", ErrorCode: "START_FAILED",
				ErrorMessage: "The managed Host process could not be started.", CreatedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(),
				UpdatedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(), FinishedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(),
				ProgressTotal: operationProgressTotal,
			}
			if err := registry.CreateManagedOperation(context.Background(), failure); err != nil {
				t.Fatal(err)
			}
			driver := &workspaceLifecycleDriver{}
			manager.host = driver
			manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }

			op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-retry-" + test.name, Action: ActionRetry})
			if err != nil {
				t.Fatal(err)
			}
			manager.workers.Wait()
			storedOperation, err := manager.Operation(context.Background(), op.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if storedOperation.State != "succeeded" || storedOperation.RetryOfOperationID != failure.OperationID {
				t.Fatalf("retry operation = %+v", storedOperation)
			}
			info, err := os.Stat(target)
			if err != nil || !info.IsDir() || info.Mode().Perm() != 0o700 {
				t.Fatalf("recreated workspace: info=%v err=%v", info, err)
			}
			if driver.startCalls != 1 || driver.stopCalls != 0 {
				t.Fatalf("retry driver calls: start=%d stop=%d", driver.startCalls, driver.stopCalls)
			}
			storedService, err := registry.GetManagedService(context.Background(), service.ServiceID)
			if err != nil || storedService == nil || storedService.WorkspaceOwnership != test.ownership {
				t.Fatalf("stored service = %+v, err=%v", storedService, err)
			}
		})
	}
}

func TestRestartChecksWorkspaceBeforeStoppingRuntime(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "missing-restart-workspace")
	service := persistWorkspaceTestService(t, registry, "mws-missing-restart", target, workspaceOwnershipRedevenCreated)
	driver := &workspaceLifecycleDriver{}
	manager.host = driver

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-missing-restart", Action: ActionRestart})
	if err != nil {
		t.Fatal(err)
	}
	manager.workers.Wait()
	stored, err := manager.Operation(context.Background(), op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != "failed" || stored.ErrorCode != "WORKSPACE_MISSING" {
		t.Fatalf("restart operation = %+v", stored)
	}
	if driver.stopCalls != 0 || driver.startCalls != 0 {
		t.Fatalf("restart touched driver before workspace validation: stop=%d start=%d", driver.stopCalls, driver.startCalls)
	}
}

func TestRetryRestartRepairsWorkspaceBeforeStoppingRuntime(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "missing-retry-restart-workspace")
	service := persistWorkspaceTestService(t, registry, "mws-retry-restart", target, workspaceOwnershipUserSelected)
	failure := pfregistry.ManagedOperation{
		OperationID: "mop-failed-restart", ServiceID: service.ServiceID, RequestID: "request-failed-restart", RequestFingerprint: "failed-restart",
		Action: string(ActionRestart), State: "failed", Stage: "failed", ErrorCode: "START_FAILED", ErrorMessage: "The managed Host process could not be started.",
		CreatedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(), UpdatedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(), FinishedAtUnixMs: time.Now().Add(-time.Minute).UnixMilli(),
		ProgressTotal: operationProgressTotal,
	}
	if err := registry.CreateManagedOperation(context.Background(), failure); err != nil {
		t.Fatal(err)
	}
	driver := &workspaceLifecycleDriver{}
	manager.host = driver
	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-retry-restart", Action: ActionRetry})
	if err != nil {
		t.Fatal(err)
	}
	manager.workers.Wait()
	stored, err := manager.Operation(context.Background(), op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.State != "succeeded" {
		t.Fatalf("retry restart operation = %+v", stored)
	}
	if driver.stopCalls != 1 || driver.startCalls != 1 || !driver.workspaceAtStop {
		t.Fatalf("retry restart order: stop=%d start=%d workspace_at_stop=%v", driver.stopCalls, driver.startCalls, driver.workspaceAtStop)
	}
}

func TestRuntimeWorkspaceValidationRejectsUnsafePaths(t *testing.T) {
	manager, _, home := newWorkspaceTestManager(t)
	valid := filepath.Join(home, "valid-workspace")
	if err := os.Mkdir(valid, 0o700); err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(home, "workspace-file")
	if err := os.WriteFile(filePath, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	realDirectory := filepath.Join(home, "real-workspace")
	if err := os.Mkdir(realDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	symlinkPath := filepath.Join(home, "workspace-link")
	if err := os.Symlink(realDirectory, symlinkPath); err != nil {
		t.Fatal(err)
	}
	outsideScope := filepath.Join(filepath.Dir(home), "outside-workspace")

	for _, test := range []struct {
		name     string
		path     string
		wantCode string
	}{
		{name: "valid", path: valid},
		{name: "file", path: filePath, wantCode: "WORKSPACE_UNAVAILABLE"},
		{name: "symlink", path: symlinkPath, wantCode: "WORKSPACE_UNAVAILABLE"},
		{name: "outside writable scope", path: outsideScope, wantCode: "WORKSPACE_UNAVAILABLE"},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &pfregistry.ManagedService{WorkspacePath: test.path}
			for _, mode := range []workspacePreparationMode{workspaceVerifyExisting, workspaceCreateIfMissing} {
				_, err := manager.prepareWorkspace(service.WorkspacePath, mode)
				if code := managedErrorCode(err); code != test.wantCode {
					t.Fatalf("mode %d validation error = %v, code=%q want=%q", mode, err, code, test.wantCode)
				}
			}
		})
	}
}

func TestOperationWorkspacePreflightCoversRuntimeMutationsOnly(t *testing.T) {
	manager, _, home := newWorkspaceTestManager(t)
	service := &pfregistry.ManagedService{WorkspacePath: filepath.Join(home, "missing-operation-workspace")}

	for _, action := range []OperationAction{ActionStart, ActionRestart, ActionUpdate, ActionReconfigure} {
		op := &pfregistry.ManagedOperation{Action: string(action)}
		if err := manager.prepareOperationWorkspace(service, op); managedErrorCode(err) != "WORKSPACE_MISSING" {
			t.Fatalf("%s preflight error = %v", action, err)
		}
	}
	for _, action := range []OperationAction{ActionStop, ActionUninstall} {
		op := &pfregistry.ManagedOperation{Action: string(action)}
		if err := manager.prepareOperationWorkspace(service, op); err != nil {
			t.Fatalf("%s unexpectedly required workspace: %v", action, err)
		}
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

func TestOperateDeleteDataAlsoDeletesUserSelectedWorkspace(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	target := filepath.Join(home, "user-selected-delete-data-workspace")
	if err := os.Mkdir(target, 0o700); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-user-selected-delete-data", target, workspaceOwnershipUserSelected)
	manager.host = &uninstallOwnershipDriver{}

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{
		RequestID: "request-user-selected-delete-data", Action: ActionUninstall, DeleteData: true, Administrator: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !op.DeleteWorkspace {
		t.Fatalf("delete-data operation did not include workspace deletion: %+v", op)
	}
	manager.workers.Wait()
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("delete-data operation did not delete workspace: %v", err)
	}
}

func TestRunUninstallUsesPersistedWorkspaceDeletionIntent(t *testing.T) {
	manager, registry, home := newWorkspaceTestManager(t)
	for _, test := range []struct {
		name            string
		ownership       string
		deleteWorkspace bool
		wantDeleted     bool
	}{
		{name: "historical-user-retained", ownership: workspaceOwnershipUserSelected},
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

package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	"github.com/floegence/redeven/internal/portforward"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagedForwardIDIsRouteSafe(t *testing.T) {
	t.Parallel()

	id, err := randomManagedForwardID()
	if err != nil {
		t.Fatal(err)
	}
	if !portforward.IsValidForwardID(id) {
		t.Fatalf("managed forward ID %q is not route safe", id)
	}
}

func newManagedServiceTestScope(t *testing.T) (*filesystemscope.Registry, string) {
	t.Helper()
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	return scope, filepath.Join(home, ".redeven", "local-environment", "apps", "managed-web-services")
}

func setTestRuntimeBinding(t *testing.T, service *pfregistry.ManagedService) {
	t.Helper()
	if service.TemplateRevision <= 0 {
		service.TemplateRevision = 1
	}
	if service.TemplateID == "" {
		service.TemplateID = "template-test"
	}
	if service.TemplateSource == "" {
		service.TemplateSource = "custom"
	}
	if service.ServiceFamilyID == "" {
		service.ServiceFamilyID = "family-test"
	}
	if service.WorkspaceOwnership == "" {
		service.WorkspaceOwnership = workspaceOwnershipUserSelected
	}
	raw, digest, err := newRuntimeBinding(service.ServiceID, service.ServiceFamilyID, Deployment(service.Deployment))
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeBindingJSON, service.RuntimeBindingSHA256 = raw, digest
}

func TestCatalogReturnsDedicatedManagedWorkspaceWithoutCreatingIt(t *testing.T) {
	t.Parallel()
	home := t.TempDir()
	scope, err := filesystemscope.NewDefaultRegistry(home)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	managerStateDir := filepath.Join(home, ".redeven", "local-environment")
	manager, err := New(ManagerOptions{
		StateDir: managerStateDir,
		Registry: registry,
		Scope:    scope,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()

	templates, err := manager.Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(templates) == 0 {
		t.Fatal("released catalog has no templates")
	}
	canonicalHome, err := filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	seenWorkspaces := map[string]string{}
	for _, template := range templates {
		wantWorkspace := filepath.Join(canonicalHome, "Redeven", "workspaces", "managed-services", template.TemplateID)
		if template.DefaultWorkspacePath != wantWorkspace || template.DefaultWorkspacePath == canonicalHome {
			t.Fatalf("template %q workspace = %q, want %q", template.TemplateID, template.DefaultWorkspacePath, wantWorkspace)
		}
		if previous := seenWorkspaces[template.DefaultWorkspacePath]; previous != "" {
			t.Fatalf("templates %q and %q share a default workspace", previous, template.TemplateID)
		}
		seenWorkspaces[template.DefaultWorkspacePath] = template.TemplateID
		if _, err := os.Stat(template.DefaultWorkspacePath); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("catalog created workspace %q: err=%v", template.DefaultWorkspacePath, err)
		}
		if template.Deployment == DeploymentHost && template.HostLifecyclePlan == nil {
			t.Fatalf("host template %q has no lifecycle plan", template.TemplateID)
		}
		if template.Deployment != DeploymentHost && template.DataLocation != "" {
			t.Fatalf("non-Host template %q exposes a synthetic data path", template.TemplateID)
		}
	}
}

func TestTemplateFamiliesCanCoexistButCannotDuplicate(t *testing.T) {
	t.Parallel()
	existing := []pfregistry.ManagedService{{
		ServiceID: "mws_first", TemplateID: "template-one", ServiceFamilyID: "family-one",
	}}
	if err := validateServiceFamilyAvailability(existing, Template{TemplateID: "template-two", ServiceFamilyID: "family-two"}); err != nil {
		t.Fatalf("independent template family was rejected: %v", err)
	}
	err := validateServiceFamilyAvailability(existing, Template{TemplateID: "template-one", ServiceFamilyID: "family-one"})
	var managedErr *Error
	if !errors.As(err, &managedErr) || managedErr.Code != "INSTANCE_ALREADY_EXISTS" {
		t.Fatalf("duplicate template family error = %v", err)
	}
}

func TestRetryActionForFailureUsesOneGenericPolicy(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		action   OperationAction
		want     OperationAction
		wantCode string
	}{
		{name: "install", action: ActionInstall, want: ActionRetryInstall},
		{name: "retry install", action: ActionRetryInstall, want: ActionRetryInstall},
		{name: "start", action: ActionStart, want: ActionStart},
		{name: "stop", action: ActionStop, want: ActionStop},
		{name: "restart", action: ActionRestart, want: ActionRestart},
		{name: "uninstall", action: ActionUninstall, want: ActionUninstall},
		{name: "update", action: ActionUpdate, wantCode: "RESELECT_RELEASE_REQUIRED"},
		{name: "reconfigure", action: ActionReconfigure, wantCode: "REFLIGHT_REQUIRED"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := retryActionForFailure(&pfregistry.ManagedOperation{Action: string(test.action)})
			if test.wantCode != "" {
				if code := managedErrorCode(err); code != test.wantCode {
					t.Fatalf("retry error code = %q, want %q", code, test.wantCode)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("retry action = %q, err=%v, want %q", got, err, test.want)
			}
		})
	}
	if _, err := retryActionForFailure(nil); managedErrorCode(err) != "NO_RETRYABLE_FAILURE" {
		t.Fatalf("missing failure error = %v", err)
	}
}

func TestServiceActionCapabilitiesComeFromRuntimeState(t *testing.T) {
	t.Parallel()
	service := pfregistry.ManagedService{
		ServiceID: "mws_actions", TemplateID: "template-actions", TemplateSource: "custom", ServiceFamilyID: "family-actions",
		Deployment: string(DeploymentContainer), ObservedState: "error", RuntimeIdentity: "container-current", LastErrorCode: "START_FAILED",
	}
	setTestRuntimeBinding(t, &service)
	failure := &pfregistry.ManagedOperation{Action: string(ActionStart), State: "failed", ErrorCode: "START_FAILED"}
	actions := serviceActionCapabilities(service, nil, failure)
	if actions.Start.Available || actions.Stop.Available || !actions.Restart.Available || !actions.Retry.Available {
		t.Fatalf("error-state actions = %+v", actions)
	}
	active := &pfregistry.ManagedOperation{Action: string(ActionRestart), State: "running"}
	actions = serviceActionCapabilities(service, active, failure)
	if actions.Start.Available || actions.Stop.Available || actions.Restart.Available || actions.Retry.Available || actions.Retry.ReasonCode != "OPERATION_ACTIVE" {
		t.Fatalf("busy actions = %+v", actions)
	}
}

func TestReleasedCatalogProjectsGenericRuntimeDefinitions(t *testing.T) {
	t.Parallel()
	scope, stateDir := newManagedServiceTestScope(t)
	catalog, err := LoadBuiltinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{
		scope: scope, stateDir: stateDir, downloads: defaultPackageDownloadClient(), catalog: catalog,
	}
	templates, err := manager.Catalog(context.Background())
	if err != nil || len(templates) == 0 {
		t.Fatalf("released catalog = %+v, err=%v", templates, err)
	}
	for _, template := range templates {
		if template.Spec == nil || template.Spec.SchemaVersion != templateSpecSchemaVersion || len(template.Localizations) != 10 || template.Icon == nil {
			t.Fatalf("generic template projection = %+v", template)
		}
		if template.Spec.Container != nil && !strings.Contains(template.Spec.Container.Image, "@sha256:") {
			t.Fatalf("container template %q is not pinned", template.TemplateID)
		}
	}
}

type catalogDockerEngineClient struct{}

type uninstallOwnershipDriver struct {
	stopCalls      int
	uninstallCalls int
	uninstallErr   error
}

func (d *uninstallOwnershipDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	return "", "", errors.New("unexpected install")
}

func (d *uninstallOwnershipDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}

func (d *uninstallOwnershipDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	d.stopCalls++
	return errors.New("unexpected stop")
}

func (d *uninstallOwnershipDriver) Uninstall(_ context.Context, _ *pfregistry.ManagedService, _ bool, progress operationProgress) error {
	d.uninstallCalls++
	progress("stopping", 2)
	progress("uninstalling", 5)
	return d.uninstallErr
}

func (d *uninstallOwnershipDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}

func (d *uninstallOwnershipDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

type successfulStopDriver struct{}

func (*successfulStopDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	return "", "", errors.New("unexpected install")
}

func (*successfulStopDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}

func (*successfulStopDriver) Stop(context.Context, *pfregistry.ManagedService) error { return nil }

func (*successfulStopDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error {
	return errors.New("unexpected uninstall")
}

func (*successfulStopDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}

func (*successfulStopDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func (catalogDockerEngineClient) Status(_ context.Context, engine containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: engine, Available: engine == containerengine.EngineDocker, Version: "test"}, nil
}

func (catalogDockerEngineClient) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return nil, errors.New("not implemented")
}

func (catalogDockerEngineClient) Inspect(context.Context, containerengine.Engine, string) (containerengine.EngineContainer, error) {
	return containerengine.EngineContainer{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) Action(context.Context, containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	return containerengine.EngineActionResult{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) TailLogs(context.Context, containerengine.EngineLogsRequest) (containerengine.EngineLogsResult, error) {
	return containerengine.EngineLogsResult{}, errors.New("not implemented")
}

func (catalogDockerEngineClient) PullImage(context.Context, containerengine.Engine, string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{}, errors.New("not implemented")
}

func TestOperateIsIdempotentAndRejectsConcurrentLifecycleChanges(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{ServiceID: "mws_one", TemplateID: "template-host", TemplateSource: "custom", ServiceFamilyID: "family-host", Deployment: string(DeploymentHost), WorkspacePath: t.TempDir(), DesiredState: "running", ObservedState: "running", ForwardID: "pf-one", RuntimeIdentity: "host:v2:mws_one:boot:4242:" + strings.Repeat("a", 64), ArtifactReference: "/managed/executable", RuntimePort: 3080}
	setTestRuntimeBinding(t, &service)
	if err := registry.CreateManagedService(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}); err != nil {
		t.Fatal(err)
	}
	driver := &blockingStopDriver{started: make(chan struct{})}
	manager := &Manager{registry: registry, host: driver, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}

	op, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionStop})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-driver.started:
	case <-time.After(3 * time.Second):
		t.Fatal("stop operation did not reach driver")
	}

	replayed, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionStop})
	if err != nil || replayed.OperationID != op.OperationID {
		t.Fatalf("idempotent replay = %+v, err=%v", replayed, err)
	}
	if _, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-one", Action: ActionRestart}); managedErrorCode(err) != "IDEMPOTENCY_CONFLICT" {
		t.Fatalf("request id payload conflict error = %v", err)
	}
	if _, err := manager.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "request-stop-two", Action: ActionRestart}); managedErrorCode(err) != "OPERATION_CONFLICT" {
		t.Fatalf("concurrent operation error = %v", err)
	}

	events, unsubscribe, err := manager.Subscribe(op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	if _, err := manager.Cancel(context.Background(), op.OperationID); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case event := <-events:
			if event.State == "cancelled" {
				stored, err := manager.Operation(context.Background(), op.OperationID)
				if err != nil || stored.State != "cancelled" || stored.ErrorCode != "OPERATION_CANCELLED" {
					t.Fatalf("stored cancelled operation = %+v, err=%v", stored, err)
				}
				return
			}
		case <-deadline:
			t.Fatal("cancelled terminal event was not published")
		}
	}
}

func TestRunUninstallDelegatesLifecycleOwnershipOnce(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("stop after uninstall delegation")
	driver := &uninstallOwnershipDriver{uninstallErr: wantErr}
	manager := &Manager{listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	service := &pfregistry.ManagedService{ServiceID: "mws_uninstall_once"}
	op := &pfregistry.ManagedOperation{OperationID: "mop_uninstall_once", ServiceID: service.ServiceID, ProgressTotal: operationProgressTotal}
	if err := manager.runUninstall(context.Background(), service, op, driver, false, false, false); !errors.Is(err, wantErr) {
		t.Fatalf("runUninstall() error = %v", err)
	}
	if driver.stopCalls != 0 || driver.uninstallCalls != 1 {
		t.Fatalf("uninstall lifecycle calls: stop=%d uninstall=%d", driver.stopCalls, driver.uninstallCalls)
	}
}

func TestRunStopClearsPreviousSnapshotError(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	service := pfregistry.ManagedService{
		ServiceID: "mws_stop_clears_error", Deployment: string(DeploymentContainer),
		DesiredState: "running", ObservedState: "error", ForwardID: "pf-stop-clears-error",
		LastErrorCode: "TEMPLATE_SNAPSHOT_IDENTITY_MISMATCH", LastErrorMessage: "stale snapshot error",
	}
	setTestRuntimeBinding(t, &service)
	if err := registry.CreateManagedService(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3000"}); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	op := &pfregistry.ManagedOperation{OperationID: "mop_stop_clears_error", ServiceID: service.ServiceID, ProgressTotal: operationProgressTotal}
	if err := manager.runStop(context.Background(), &service, op, &successfulStopDriver{}); err != nil {
		t.Fatalf("runStop() error = %v", err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.ObservedState != "stopped" || stored.LastErrorCode != "" || stored.LastErrorMessage != "" {
		t.Fatalf("stored service after successful stop = %+v", stored)
	}
}

func TestListProjectsTheCurrentOperationDetail(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{
		ServiceID: "mws_artifact", TemplateID: "template-container", TemplateSource: "custom", ServiceFamilyID: "family-container",
		Deployment: string(DeploymentContainer), WorkspacePath: t.TempDir(),
		DesiredState: "stopped", ObservedState: "error", ForwardID: "pf-artifact", RuntimePort: 3080,
	}
	setTestRuntimeBinding(t, &service)
	artifact := "registry.example.invalid/project/service:1.0.0@sha256:" + strings.Repeat("a", 64)
	operation := pfregistry.ManagedOperation{
		OperationID: "mop_artifact", ServiceID: service.ServiceID, RequestID: "request-artifact",
		RequestFingerprint: "fingerprint-artifact", Action: "retry_install", State: "running", Stage: "pulling",
		ProgressCurrent: 2, ProgressTotal: 7,
		ProgressDetail: &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion, Transfer: &pfregistry.ManagedOperationTransferProgress{ArtifactReference: artifact}},
	}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}, operation); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry}
	views, err := manager.List(context.Background())
	if err != nil || len(views) != 1 {
		t.Fatalf("List() = %+v, err=%v", views, err)
	}
	if views[0].ActiveOperation == nil || views[0].ActiveOperation.OperationID != operation.OperationID {
		t.Fatalf("active operation = %+v", views[0].ActiveOperation)
	}
	if detail := views[0].ActiveOperation.ProgressDetail; detail == nil || detail.Transfer == nil || detail.Transfer.ArtifactReference != artifact {
		t.Fatalf("operation detail = %+v", detail)
	}
}

func TestListProjectsStructuredLastFailureFromPersistedOperation(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{ServiceID: "mws_failed", TemplateID: "template", TemplateSource: "custom", Deployment: string(DeploymentContainer), WorkspacePath: t.TempDir(), DesiredState: "stopped", ObservedState: "error", ForwardID: "pf-failed", RuntimePort: 3080, LastErrorCode: "IMAGE_PULL_FAILED", LastErrorMessage: "The container image could not be pulled."}
	service.ServiceFamilyID = "family-failed"
	setTestRuntimeBinding(t, &service)
	operation := pfregistry.ManagedOperation{OperationID: "mop_failed", ServiceID: service.ServiceID, RequestID: "request-failed", RequestFingerprint: "fingerprint", Action: "install", State: "failed", Stage: "pulling", ProgressCurrent: 2, ProgressTotal: 7, ErrorCode: service.LastErrorCode, ErrorMessage: service.LastErrorMessage, FinishedAtUnixMs: 123, ProgressDetail: &pfregistry.ManagedOperationProgressDetail{SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion, Transfer: &pfregistry.ManagedOperationTransferProgress{ArtifactReference: "example.invalid/app:1"}}}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}, operation); err != nil {
		t.Fatal(err)
	}
	views, err := (&Manager{registry: registry}).List(context.Background())
	if err != nil || len(views) != 1 {
		t.Fatalf("List()=%+v err=%v", views, err)
	}
	failure := views[0].LastFailure
	if failure == nil || failure.Action != "install" || failure.Stage != "pulling" || failure.ErrorCode != service.LastErrorCode || failure.ArtifactReference != "example.invalid/app:1" || failure.OperationID != operation.OperationID || failure.OccurredAtUnixMs != 123 {
		t.Fatalf("last failure=%+v", failure)
	}
}

func TestServiceFailureViewOmitsUnprovenHistoricalContext(t *testing.T) {
	t.Parallel()
	service := pfregistry.ManagedService{
		LastErrorCode: "IMAGE_PULL_FAILED", LastErrorMessage: "The current image pull failed.", UpdatedAtUnixMs: 20,
	}
	operation := &pfregistry.ManagedOperation{
		OperationID: "mop_older", Action: "install", Stage: "pulling", ErrorCode: service.LastErrorCode,
		ErrorMessage: "An older image pull failed.", UpdatedAtUnixMs: 10,
		ProgressDetail: &pfregistry.ManagedOperationProgressDetail{
			SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion,
			Transfer:      &pfregistry.ManagedOperationTransferProgress{ArtifactReference: "example.invalid/older:1"},
		},
	}
	failure := serviceFailureView(service, operation)
	if failure == nil || failure.ErrorCode != service.LastErrorCode || failure.Message != service.LastErrorMessage {
		t.Fatalf("failure=%+v", failure)
	}
	if failure.Action != "" || failure.Stage != "" || failure.OperationID != "" || failure.ArtifactReference != "" || failure.OccurredAtUnixMs != 0 {
		t.Fatalf("historical operation context was guessed: %+v", failure)
	}
}

func TestServiceFailureViewNeverExposesHostArtifactPath(t *testing.T) {
	t.Parallel()
	service := pfregistry.ManagedService{
		Deployment: string(DeploymentHost), LastErrorCode: "HOST_LOG_PREPARE_FAILED",
		LastErrorMessage: "The managed Host log could not be prepared.", UpdatedAtUnixMs: 20,
	}
	operation := &pfregistry.ManagedOperation{
		OperationID: "mop_host", Action: "start", Stage: "failed", ErrorCode: service.LastErrorCode,
		ErrorMessage: service.LastErrorMessage, UpdatedAtUnixMs: service.UpdatedAtUnixMs,
		ProgressDetail: &pfregistry.ManagedOperationProgressDetail{
			SchemaVersion: pfregistry.ManagedOperationProgressDetailSchemaVersion,
			Transfer:      &pfregistry.ManagedOperationTransferProgress{ArtifactReference: "/Users/private/managed/bin/service"},
		},
	}
	failure := serviceFailureView(service, operation)
	if failure == nil || failure.OperationID != operation.OperationID || failure.ArtifactReference != "" {
		t.Fatalf("host failure exposed its managed artifact path: %+v", failure)
	}
}

func TestSubscribeReturnsTerminalSnapshotWithoutWaiting(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	op := pfregistry.ManagedOperation{OperationID: "mop_done", ServiceID: "mws_removed", RequestID: "request-done", RequestFingerprint: "fingerprint", Action: "uninstall", State: "succeeded", Stage: "completed", ProgressCurrent: 7, ProgressTotal: 7}
	if err := registry.CreateManagedOperation(context.Background(), op); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	events, unsubscribe, err := manager.Subscribe(op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	defer unsubscribe()
	select {
	case snapshot := <-events:
		if snapshot.State != "succeeded" || snapshot.Stage != "completed" {
			t.Fatalf("terminal snapshot = %+v", snapshot)
		}
	case <-time.After(time.Second):
		t.Fatal("terminal snapshot was not delivered")
	}
}

func TestOperationProgressIsNotPublishedWhenPersistenceFails(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	events := make(chan pfregistry.ManagedOperation, 1)
	manager := &Manager{
		registry: registry,
		listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{
			"mop_missing": {1: events},
		},
	}
	op := pfregistry.ManagedOperation{OperationID: "mop_missing", ServiceID: "mws_missing", State: "running", Stage: "pulling"}
	manager.saveAndPublish(&op)
	select {
	case event := <-events:
		t.Fatalf("unpersisted operation progress was published: %+v", event)
	default:
	}
}

func TestInterruptedInstallIsCleanedAndWaitsForRetry(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service := pfregistry.ManagedService{ServiceID: "mws_interrupted", TemplateID: "template-host", TemplateSource: "custom", ServiceFamilyID: "family-interrupted", Deployment: string(DeploymentHost), WorkspacePath: t.TempDir(), DesiredState: "running", ObservedState: "installing", ForwardID: "pf-interrupted", RuntimeIdentity: "host:v2:mws_interrupted:boot:99:" + strings.Repeat("a", 64), RuntimePort: 3080}
	setTestRuntimeBinding(t, &service)
	op := pfregistry.ManagedOperation{OperationID: "mop_interrupted", ServiceID: service.ServiceID, RequestID: "request-interrupted", RequestFingerprint: "fingerprint", Action: string(ActionInstall), State: "running", Stage: "downloading"}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3080"}, op); err != nil {
		t.Fatal(err)
	}

	manager := &Manager{registry: registry, host: &recoveryDriver{}, cancelByOp: map[string]context.CancelFunc{}, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	views, err := manager.List(context.Background())
	if err != nil || len(views) != 1 || views[0].ActiveOperation == nil || views[0].ActiveOperation.OperationID != op.OperationID {
		t.Fatalf("active operation view = %+v, err=%v", views, err)
	}
	if err := registry.MarkManagedOperationsInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	manager.Start(context.Background())

	updated, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if updated == nil || updated.DesiredState != "stopped" || updated.ObservedState != "error" || updated.LastErrorCode != "OPERATION_INTERRUPTED" || updated.RuntimeIdentity != "" {
		t.Fatalf("interrupted service = %+v", updated)
	}
	driver := manager.host.(*recoveryDriver)
	if driver.cleanupCalls != 1 || driver.startCalls != 0 {
		t.Fatalf("recovery calls: cleanup=%d start=%d", driver.cleanupCalls, driver.startCalls)
	}
}

func TestCurrentHostIdentityParsingAndCredentialRedaction(t *testing.T) {
	t.Parallel()
	if got := hostPIDFromIdentity("host:v2:mws_one:boot:4242:" + strings.Repeat("a", 64)); got != 4242 {
		t.Fatalf("Host PID = %d, want 4242", got)
	}
	for _, invalid := range []string{"", "host:v1:mws_one:boot:4242:fingerprint", "container:v2:mws_one:boot:4242:fingerprint", "host:v2:mws_one:boot:not-a-pid:fingerprint"} {
		if got := hostPIDFromIdentity(invalid); got != 0 {
			t.Fatalf("hostPIDFromIdentity(%q) = %d, want 0", invalid, got)
		}
	}
	redacted := strings.Join([]string{
		redactLogLine("Authorization: Bearer credential-one"),
		redactLogLine(`{"api_key":"credential-two","model":"demo"}`),
		redactLogLine("access-token:credential-three secret = credential-four"),
	}, "\n")
	for _, secret := range []string{"credential-one", "credential-two", "credential-three", "credential-four"} {
		if strings.Contains(redacted, secret) {
			t.Fatalf("redacted log still contains %q: %s", secret, redacted)
		}
	}
}

func TestSafeManagedFailureCauseOmitsPathAndSecret(t *testing.T) {
	t.Parallel()
	cause := fmt.Errorf("open /Users/private/token-secret: %w", os.ErrNotExist)
	got := safeManagedFailureCause(cause)
	if got != "managed file not found" || strings.Contains(got, "/Users/") || strings.Contains(got, "token-secret") {
		t.Fatalf("safe failure cause = %q", got)
	}
}

type blockingStopDriver struct {
	once    sync.Once
	started chan struct{}
}

type recoveryDriver struct {
	cleanupCalls int
	startCalls   int
	stopCalls    int
}

func (d *recoveryDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (d *recoveryDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	d.startCalls++
	return "", errors.New("unexpected start")
}
func (d *recoveryDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	d.stopCalls++
	return nil
}
func (d *recoveryDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error {
	return errors.New("unexpected uninstall")
}
func (d *recoveryDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	d.cleanupCalls++
	return nil
}
func (d *recoveryDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func (d *blockingStopDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (d *blockingStopDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}
func (d *blockingStopDriver) Stop(ctx context.Context, _ *pfregistry.ManagedService) error {
	d.once.Do(func() { close(d.started) })
	<-ctx.Done()
	return ctx.Err()
}
func (d *blockingStopDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error {
	return errors.New("unexpected uninstall")
}
func (d *blockingStopDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return nil
}
func (d *blockingStopDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func managedErrorCode(err error) string {
	code, _, _, _ := ErrorDetails(err)
	return code
}

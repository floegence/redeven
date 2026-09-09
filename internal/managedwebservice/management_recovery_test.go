package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagementStopRemainsAvailableWithoutTemplate(t *testing.T) {
	service := *uninstallContainerService()
	service.ObservedState = "running"
	actions := serviceActionCapabilities(service, nil, nil, nil)
	if !actions.Stop.Available {
		t.Fatal("a missing template must not block stopping an owned instance")
	}
}

func TestManagementStoppedServiceIgnoresHistoricalFailure(t *testing.T) {
	service := *uninstallContainerService()
	service.ObservedState, service.LastErrorCode = "stopped", "OLD_FAILURE"
	actions := serviceActionCapabilities(service, &resolvedRuntime{Template: Template{Deployment: DeploymentContainer}}, nil, &pfregistry.ManagedOperation{Action: "stop", State: "failed"})
	if !actions.Start.Available {
		t.Fatal("historical failure must not disable a valid start")
	}
}

func TestManagementHostDataIsInstanceScoped(t *testing.T) {
	a, b := &pfregistry.ManagedService{ServiceID: "mws_first"}, &pfregistry.ManagedService{ServiceID: "mws_second"}
	setTestRuntimeBinding(t, a, "same-template", DeploymentHost)
	setTestRuntimeBinding(t, b, "same-template", DeploymentHost)
	ab, _ := decodeRuntimeBinding(a)
	bb, _ := decodeRuntimeBinding(b)
	if ab.Host.DataRoot == bb.Host.DataRoot {
		t.Fatal("different instances must not share their default data directory")
	}
}

func TestManagementImageDriftDoesNotChangeContainerOwnership(t *testing.T) {
	service := uninstallContainerService()
	container := uninstallEngineContainer(service)
	container.Image.Reference = "example.invalid/changed:latest"
	client := &uninstallContainerEngineClient{container: container}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver := &containerTemplateDriver{adapter: adapter}
	if err := driver.Stop(context.Background(), service); err != nil {
		t.Fatalf("verified identity must remain stoppable despite image drift: %v", err)
	}
}

// The fake engine records real mutation boundaries, including resources that
// survive a failed request. It never treats an inspection error as absence.
type managementEngine struct {
	uninstallContainerEngineClient
	containerengine.ExtendedEngineClient
	volumes      []containerengine.VolumeRecord
	other        []containerengine.EngineContainer
	offline      bool
	failRemove   string
	ignoreRemove bool
}

func (e *managementEngine) Inspect(ctx context.Context, engine containerengine.Engine, id string) (containerengine.EngineContainer, error) {
	if e.offline {
		return containerengine.EngineContainer{}, errors.New("engine unavailable")
	}
	for _, item := range e.other {
		if item.ContainerID == id {
			return item, nil
		}
	}
	return e.uninstallContainerEngineClient.Inspect(ctx, engine, id)
}
func (e *managementEngine) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	if e.offline {
		return nil, errors.New("engine unavailable")
	}
	out := append([]containerengine.EngineContainer(nil), e.other...)
	if e.container.ContainerID != "" {
		out = append(out, e.container)
	}
	return out, nil
}
func (e *managementEngine) ListVolumes(context.Context, containerengine.Engine) ([]containerengine.VolumeRecord, error) {
	if e.offline {
		return nil, errors.New("engine unavailable")
	}
	return append([]containerengine.VolumeRecord(nil), e.volumes...), nil
}
func (e *managementEngine) InspectVolume(_ context.Context, _ containerengine.Engine, name string) (containerengine.VolumeRecord, error) {
	for _, item := range e.volumes {
		if item.Name == name {
			return item, nil
		}
	}
	return containerengine.VolumeRecord{}, errors.New("volume missing")
}
func (e *managementEngine) RemoveVolume(_ context.Context, request containerengine.VolumeRemoveRequest) error {
	if e.failRemove == request.Name {
		return errors.New("injected deletion failure")
	}
	for i, item := range e.volumes {
		if item.Name == request.Name {
			e.volumes = append(e.volumes[:i], e.volumes[i+1:]...)
			return nil
		}
	}
	return errors.New("volume missing")
}
func (e *managementEngine) Action(ctx context.Context, req containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	result, err := e.uninstallContainerEngineClient.Action(ctx, req)
	if err != nil {
		return result, err
	}
	if req.Method == containerengine.MethodStop {
		e.container.State = containerengine.ContainerStateExited
	}
	if req.Method == containerengine.MethodRemove && !e.ignoreRemove {
		e.container = containerengine.EngineContainer{}
	}
	return result, nil
}

func TestManagementLostContainerCreateResponseRecoversOnlyAllocationProof(t *testing.T) {
	for _, matches := range []bool{true, false} {
		t.Run(fmt.Sprint(matches), func(t *testing.T) {
			m, service, engine := managementFixture(t)
			oldID := service.RuntimeIdentity
			engine.container.ContainerID = "container_new_allocation"
			engine.container.State = containerengine.ContainerStateRunning
			token := "allocation-proof"
			engine.container.Runtime.Labels[managedServiceLabel+".generation"] = token
			if !matches {
				engine.container.Runtime.Labels[managedServiceLabel+".generation"] = "other-generation"
			}
			if err := m.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: containerAllocationResource, Kind: "runtime", EngineIdentity: "pending:" + customContainerName(service.ServiceID), StableIdentity: token, Ownership: "owned", CreatedAtUnixMs: 1}); err != nil {
				t.Fatal(err)
			}
			facts, err := m.inspectService(context.Background(), service, false)
			stored, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
			if matches {
				if err != nil || facts.Runtime != "running" || stored.RuntimeIdentity != engine.container.ContainerID {
					t.Fatalf("lost response was not recovered: %+v %v %+v", facts, err, stored)
				}
			} else if err == nil || stored.RuntimeIdentity != oldID {
				t.Fatalf("unproved allocation was claimed: %+v %v", stored, err)
			}
			if len(engine.actions) > 0 {
				t.Fatal("observing a lost response changed the business process")
			}
		})
	}
}

func TestManagementUninstallChecksRemovalPostcondition(t *testing.T) {
	m, service, engine := managementFixture(t)
	engine.ignoreRemove = true
	op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionUninstall, DeleteWorkspace: true})
	if op.State != "failed" || op.ErrorCode != "RUNTIME_REMOVAL_UNCONFIRMED" {
		t.Fatalf("unchecked removal: %+v", op)
	}
	if _, err := os.Stat(service.WorkspacePath); err != nil {
		t.Fatal("workspace was deleted before confirming runtime removal")
	}
	stored, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
	journal, err := readUninstallJournal(stored)
	if err != nil || journal.RuntimeState == "completed" {
		t.Fatalf("false completion: %+v %v", journal, err)
	}
}

func TestManagementVolumeRecreationInSameTimestampIsRejected(t *testing.T) {
	m, service, engine := managementFixture(t)
	engine.volumes = []containerengine.VolumeRecord{{Name: "instance-data", CreatedAtUnixMs: 123, Labels: map[string]string{managedServiceLabel: service.ServiceID, managedServiceLabel + ".generation": "new-token"}}}
	if err := m.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: "data", Kind: "volume", EngineIdentity: "instance-data", StableIdentity: "old-token", Ownership: "owned", CreatedAtUnixMs: 123}); err != nil {
		t.Fatal(err)
	}
	plan, err := m.PreflightManagement(context.Background(), service.ServiceID, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true})
	if err != nil || !slices.Contains(plan.Blockers, "DATA_IDENTITY_MISMATCH") {
		t.Fatalf("recreated volume accepted: %+v %v", plan, err)
	}
	if len(engine.actions) > 0 {
		t.Fatal("preflight changed runtime")
	}
}

func managementFixture(t *testing.T) (*Manager, *pfregistry.ManagedService, *managementEngine) {
	t.Helper()
	manager, registry, home := newWorkspaceTestManager(t)
	workspace := filepath.Join(home, "workspace")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	service := persistWorkspaceTestService(t, registry, "mws-management", workspace, workspaceOwnershipRedevenCreated)
	service.RuntimeIdentity = "container_management"
	setTestRuntimeBinding(t, &service, "family-management", DeploymentContainer)
	if err := registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &service.RuntimeIdentity, RuntimeBindingJSON: &service.RuntimeBindingJSON, RuntimeBindingSHA256: &service.RuntimeBindingSHA256}); err != nil {
		t.Fatal(err)
	}
	engine := &managementEngine{uninstallContainerEngineClient: uninstallContainerEngineClient{container: uninstallEngineContainer(&service)}}
	adapter, err := containerengine.NewAdapter(engine)
	if err != nil {
		t.Fatal(err)
	}
	manager.containers = adapter
	manager.container = &containerTemplateDriver{manager: manager, adapter: adapter}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	return manager, stored, engine
}
func managementRun(t *testing.T, m *Manager, service *pfregistry.ManagedService, req ManagementPlanRequest) *pfregistry.ManagedOperation {
	t.Helper()
	plan, err := m.PreflightManagement(context.Background(), service.ServiceID, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Blockers) > 0 {
		t.Fatalf("unexpected blockers: %v", plan.Blockers)
	}
	id := fmt.Sprintf("reviewed-%s-%d", req.Action, time.Now().UnixNano())
	op, err := m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: id, Action: req.Action, PlanDigest: plan.PlanDigest, DeleteData: req.DeleteData, DeleteWorkspace: req.DeleteWorkspace, SkipHooks: req.SkipHooks, Administrator: true})
	if err != nil {
		t.Fatal(err)
	}
	m.workers.Wait()
	stored, err := m.Operation(context.Background(), op.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	return stored
}
func TestManagementUninstallPreflightFindsRunningAndStoppedReferences(t *testing.T) {
	m, service, engine := managementFixture(t)
	engine.container.State = containerengine.ContainerStateRunning
	engine.volumes = []containerengine.VolumeRecord{{Name: "shared-data", CreatedAtUnixMs: 1, UsedBy: []containerengine.ResourceReference{{ContainerID: "other-running", State: containerengine.ContainerStateRunning}, {ContainerID: "other-stopped", State: containerengine.ContainerStateExited}}, ReferencedContainers: 2}}
	if err := m.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: "config", Kind: "volume", EngineIdentity: "shared-data", CreatedAtUnixMs: 1}); err != nil {
		t.Fatal(err)
	}
	plan, err := m.PreflightManagement(context.Background(), service.ServiceID, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(plan.Blockers, "RESOURCE_IN_USE") || len(plan.Facts.Resources[0].References) != 2 {
		t.Fatalf("shared resource review = %+v", plan)
	}
	if len(engine.actions) != 0 {
		t.Fatal("preflight stopped or deleted a container")
	}
	_, err = m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "blocked-uninstall", Action: ActionUninstall, DeleteData: true, PlanDigest: plan.PlanDigest, Administrator: true})
	if managedErrorCode(err) != "RESOURCE_IN_USE" || len(engine.actions) != 0 {
		t.Fatalf("blocked preflight mutated resource: %v", err)
	}
	engine.container = containerengine.EngineContainer{}
	op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionUninstall})
	if op.State != "succeeded" || len(engine.actions) != 0 {
		t.Fatalf("retained uninstall = %+v; mutations=%v", op, engine.actions)
	}
	archived, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
	if archived == nil || archived.ManagementState != "uninstalled" || archived.ForwardID != "" || len(engine.volumes) != 1 {
		t.Fatalf("archive=%+v", archived)
	}
	if _, err := os.Stat(service.WorkspacePath); err != nil {
		t.Fatal("retained workspace changed")
	}
}
func TestManagementStopMissingConvergesAndRestartRequiresRecovery(t *testing.T) {
	m, service, engine := managementFixture(t)
	engine.container = containerengine.EngineContainer{}
	_, err := m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "missing-restart", Action: ActionRestart})
	if managedErrorCode(err) != "RECOVERY_REQUIRED" {
		t.Fatalf("restart=%v", err)
	}
	op, err := m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "missing-stop", Action: ActionStop})
	if err != nil {
		t.Fatal(err)
	}
	m.workers.Wait()
	op, _ = m.Operation(context.Background(), op.OperationID)
	stored, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
	if op.State != "succeeded" || stored.DesiredState != "stopped" || len(engine.actions) != 0 {
		t.Fatalf("stop=%+v service=%+v", op, stored)
	}
}
func TestManagementDetachWorksOfflineAndPreservesSecrets(t *testing.T) {
	m, service, engine := managementFixture(t)
	engine.offline = true
	if err := m.writeServiceSecrets(service.ServiceID, map[string]string{"TOKEN": "private-value"}); err != nil {
		t.Fatal(err)
	}
	op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionDetach})
	if op.State != "succeeded" {
		t.Fatalf("detach=%+v", op)
	}
	stored, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
	forward, _ := m.registry.GetForward(context.Background(), service.ForwardID)
	if stored.ManagementState != "detached" || forward != nil || stored.RuntimeIdentity != service.RuntimeIdentity || len(engine.actions) != 0 {
		t.Fatalf("detached=%+v", stored)
	}
	if _, err := os.Stat(m.serviceSecretPath(service.ServiceID)); err != nil {
		t.Fatal("detach removed secrets")
	}
	views, err := m.List(context.Background())
	if err != nil || len(views) != 1 || views[0].Status != "detached" {
		t.Fatalf("archived list=%+v, %v", views, err)
	}
	engine.offline = false
	restored := managementRun(t, m, stored, ManagementPlanRequest{Action: ActionRestore})
	if restored.State != "succeeded" {
		t.Fatalf("restore=%+v", restored)
	}
	stored, _ = m.registry.GetManagedService(context.Background(), service.ServiceID)
	if stored.ManagementState != "active" || stored.ForwardID == service.ForwardID || len(engine.actions) != 0 {
		t.Fatal("restore must rebind without starting another instance")
	}
}
func TestManagementUninstallContinuesRemainingVolumes(t *testing.T) {
	m, service, engine := managementFixture(t)
	for _, name := range []string{"first", "second"} {
		engine.volumes = append(engine.volumes, containerengine.VolumeRecord{Name: name, CreatedAtUnixMs: 1})
		if err := m.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: name, Kind: "volume", EngineIdentity: name, CreatedAtUnixMs: 1, Ownership: "owned"}); err != nil {
			t.Fatal(err)
		}
	}
	engine.failRemove = "second"
	op := managementRun(t, m, service, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true})
	if op.State != "failed" || len(engine.volumes) != 1 || engine.volumes[0].Name != "second" {
		t.Fatalf("partial result=%+v volumes=%v", op, engine.volumes)
	}
	stored, _ := m.registry.GetManagedService(context.Background(), service.ServiceID)
	if !pendingUninstall(stored) {
		t.Fatal("partial uninstall lost its transaction")
	}
	actions := len(engine.actions)
	engine.failRemove = ""
	op = managementRun(t, m, stored, ManagementPlanRequest{Action: ActionUninstall, DeleteData: true})
	if op.State != "succeeded" || len(engine.volumes) != 0 || len(engine.actions) != actions {
		t.Fatalf("resume=%+v", op)
	}
}
func TestManagementRejectsStaleConfirmationBeforeMutation(t *testing.T) {
	m, service, engine := managementFixture(t)
	plan, err := m.PreflightManagement(context.Background(), service.ServiceID, ManagementPlanRequest{Action: ActionUninstall})
	if err != nil {
		t.Fatal(err)
	}
	engine.container = containerengine.EngineContainer{}
	_, err = m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "stale-uninstall", Action: ActionUninstall, PlanDigest: plan.PlanDigest})
	if managedErrorCode(err) != "RESOURCE_PLAN_STALE" || len(engine.actions) != 0 {
		t.Fatalf("stale review=%v", err)
	}
}

func TestHistoricalUninstallFailureDoesNotOverrideCurrentInstance(t *testing.T) {
	failure := &pfregistry.ManagedOperation{Action: "uninstall", State: "failed", ErrorCode: "DATA_REMOVE_FAILED"}
	service := pfregistry.ManagedService{ManagementState: "active", ObservedState: "running"}
	facts := ServiceFacts{Presence: "present", Ownership: "verified", Runtime: "running"}
	status, primary, _ := servicePresentation(service, facts, nil, failure)
	if status != "running" || primary != "stop" {
		t.Fatalf("history replaced observed facts: status=%s action=%s", status, primary)
	}
	service.ObservedState = "stopped"
	actions := serviceActionCapabilities(service, &resolvedRuntime{}, nil, failure)
	if !actions.Start.Available {
		t.Fatalf("historical failure disabled an existing stopped instance: %+v", actions)
	}
}

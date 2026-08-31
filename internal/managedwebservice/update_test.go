package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestContainerUpdatePullsBeforeStopAndCommitsReviewedRevision(t *testing.T) {
	for _, desired := range []string{"running", "stopped"} {
		desired := desired
		t.Run(desired, func(t *testing.T) {
			manager, registry, service, driver := newContainerUpdateTestManager(t, desired)
			op := pfregistry.ManagedOperation{OperationID: "mop_update_" + desired, ServiceID: service.ServiceID, ProgressTotal: operationProgressTotal}
			if err := manager.runUpdate(context.Background(), service, &op, map[string]int64{webtopRootNoticeID: 1}, driver); err != nil {
				t.Fatal(err)
			}
			pull, stop := indexOf(driver.events, "pull:target"), indexOf(driver.events, "stop:old")
			if pull < 0 || stop < 0 || pull >= stop {
				t.Fatalf("update event order = %v", driver.events)
			}
			got, err := registry.GetManagedService(context.Background(), service.ServiceID)
			if err != nil {
				t.Fatal(err)
			}
			if got.TemplateRevision != 1 || got.Version != webtopUbuntuKDEVersion || got.RuntimeIdentity != "target-container" || got.RuntimeManifestJSON != "{}" || got.DesiredState != desired || got.ObservedState != desired {
				t.Fatalf("updated service = %+v", got)
			}
			if desired == "stopped" && indexOf(driver.events, "stop:target") < 0 {
				t.Fatalf("stopped update did not restore stopped state: %v", driver.events)
			}
		})
	}
}

func TestServiceListDerivesUpdateAvailabilityFromBuiltInRevision(t *testing.T) {
	t.Parallel()
	manager, _, service, _ := newContainerUpdateTestManager(t, "running")
	views, err := manager.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].ServiceID != service.ServiceID || !views[0].UpdateAvailable || views[0].TargetRevision != 1 || views[0].TargetVersion != webtopUbuntuKDEVersion {
		t.Fatalf("service update projection = %+v", views)
	}
	if len(views[0].UpdateNotices) != 1 || views[0].UpdateNotices[0].ID != webtopRootNoticeID {
		t.Fatalf("service update notices = %+v", views[0].UpdateNotices)
	}
}

func TestContainerUpdateHealthFailureRestoresPreviousRelease(t *testing.T) {
	manager, registry, service, driver := newContainerUpdateTestManager(t, "running")
	manager.healthCheck = func(_ context.Context, current *pfregistry.ManagedService) error {
		if current.Version == webtopUbuntuKDEVersion {
			return errors.New("target health failed")
		}
		return nil
	}
	op := pfregistry.ManagedOperation{OperationID: "mop_update_rollback", ServiceID: service.ServiceID, ProgressTotal: operationProgressTotal}
	err := manager.runUpdate(context.Background(), service, &op, map[string]int64{webtopRootNoticeID: 1}, driver)
	var updateErr *updateExecutionError
	if !errors.As(err, &updateErr) || updateErr.RollbackErr != nil {
		t.Fatalf("update error = %#v", err)
	}
	got, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TemplateRevision != 0 || got.Version != "previous" || got.RuntimeIdentity != "old-restored-container" || got.ArtifactReference != "lscr.io/linuxserver/webtop@sha256:"+strings.Repeat("a", 64) || got.ObservedState != "running" || got.RuntimeManifestJSON != "{}" {
		t.Fatalf("rolled back service = %+v", got)
	}
	if indexOf(driver.events, "remove:target") < 0 || indexOf(driver.events, "create:old") < 0 || indexOf(driver.events, "start:old") < 0 {
		t.Fatalf("rollback events = %v", driver.events)
	}
}

func TestContainerUpdateCancellationRestoresPreviousRelease(t *testing.T) {
	manager, registry, service, driver := newContainerUpdateTestManager(t, "running")
	driver.startErr = context.Canceled
	op := pfregistry.ManagedOperation{OperationID: "mop_update_cancel", ServiceID: service.ServiceID, ProgressTotal: operationProgressTotal}
	err := manager.runUpdate(context.Background(), service, &op, map[string]int64{webtopRootNoticeID: 1}, driver)
	var updateErr *updateExecutionError
	if !errors.As(err, &updateErr) || !errors.Is(updateErr.Cause, context.Canceled) || updateErr.RollbackErr != nil {
		t.Fatalf("cancel error = %#v", err)
	}
	got, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TemplateRevision != 0 || got.RuntimeIdentity != "old-restored-container" || got.ObservedState != "running" {
		t.Fatalf("service after cancelled update = %+v", got)
	}
}

func TestInterruptedContainerUpdateRecoversFromJournal(t *testing.T) {
	rollbackCases := []struct {
		name          string
		phase         string
		targetPresent bool
	}{
		{name: updatePhasePreparing, phase: updatePhasePreparing},
		{name: updatePhaseArtifactReady, phase: updatePhaseArtifactReady},
		{name: updatePhaseOldStopped, phase: updatePhaseOldStopped},
		{name: updatePhaseOldRemoved, phase: updatePhaseOldRemoved},
		{name: updatePhaseTargetCreating + " before create", phase: updatePhaseTargetCreating},
		{name: updatePhaseTargetCreating + " after create", phase: updatePhaseTargetCreating, targetPresent: true},
		{name: updatePhaseTargetCreated, phase: updatePhaseTargetCreated, targetPresent: true},
	}
	for _, testCase := range rollbackCases {
		testCase := testCase
		t.Run("rollback "+testCase.name, func(t *testing.T) {
			manager, registry, service, driver := newContainerUpdateTestManager(t, "running")
			old, target := updateTestReleases(t, manager, *service)
			switch testCase.phase {
			case updatePhasePreparing, updatePhaseArtifactReady, updatePhaseOldStopped:
				driver.runtimes = map[string]bool{"old-container": true}
				driver.current = "old-container"
			case updatePhaseTargetCreating, updatePhaseTargetCreated:
				if testCase.phase == updatePhaseTargetCreated {
					target.RuntimeIdentity = "target-container"
				}
				if !testCase.targetPresent {
					driver.runtimes = map[string]bool{}
					driver.current = ""
					break
				}
				driver.runtimes = map[string]bool{"target-container": true}
				driver.current = "target-container"
			default:
				driver.runtimes = map[string]bool{}
				driver.current = ""
			}
			journal := containerUpdateJournal{Kind: containerUpdateJournalKind, Phase: testCase.phase, Old: old, Target: target}
			if err := manager.writeContainerUpdateJournal(context.Background(), service.ServiceID, journal); err != nil {
				t.Fatal(err)
			}
			encoded, _ := jsonMarshal(journal)
			service.RuntimeManifestJSON = encoded
			op := pfregistry.ManagedOperation{OperationID: "mop_recover_rollback_" + strings.ReplaceAll(testCase.name, " ", "_"), ServiceID: service.ServiceID, State: "interrupted", ProgressTotal: operationProgressTotal}
			if err := manager.recoverInterruptedContainerUpdate(service, &op, driver); err != nil {
				t.Fatal(err)
			}
			got, _ := registry.GetManagedService(context.Background(), service.ServiceID)
			if got.TemplateRevision != 0 || got.RuntimeManifestJSON != "{}" || got.ObservedState != "running" {
				t.Fatalf("recovered old release at %s = %+v", testCase.name, got)
			}
			if testCase.targetPresent && indexOf(driver.events, "remove:target") < 0 {
				t.Fatalf("verified target was not removed at %s: %v", testCase.name, driver.events)
			}
		})
	}

	t.Run("finalize verified target", func(t *testing.T) {
		manager, registry, service, driver := newContainerUpdateTestManager(t, "running")
		old, target := updateTestReleases(t, manager, *service)
		target.RuntimeIdentity = "target-container"
		driver.runtimes = map[string]bool{"target-container": true}
		driver.current = "target-container"
		journal := containerUpdateJournal{Kind: containerUpdateJournalKind, Phase: updatePhaseTargetVerified, Old: old, Target: target}
		encoded, _ := jsonMarshal(journal)
		service.RuntimeManifestJSON = encoded
		if err := manager.writeContainerUpdateJournal(context.Background(), service.ServiceID, journal); err != nil {
			t.Fatal(err)
		}
		op := pfregistry.ManagedOperation{OperationID: "mop_recover_finalize", ServiceID: service.ServiceID, State: "interrupted", ProgressTotal: operationProgressTotal}
		if err := registry.CreateManagedOperation(context.Background(), op); err != nil {
			t.Fatal(err)
		}
		if err := manager.recoverInterruptedContainerUpdate(service, &op, driver); err != nil {
			t.Fatal(err)
		}
		got, _ := registry.GetManagedService(context.Background(), service.ServiceID)
		if got.TemplateRevision != 1 || got.RuntimeIdentity != "target-container" || got.RuntimeManifestJSON != "{}" {
			t.Fatalf("finalized target release = %+v", got)
		}
	})
}

func newContainerUpdateTestManager(t *testing.T, state string) (*Manager, *pfregistry.Registry, *pfregistry.ManagedService, *fakeContainerUpdateDriver) {
	t.Helper()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	scope, stateDir := newManagedServiceTestScope(t)
	adapter, err := containerengine.NewAdapter(catalogDockerEngineClient{})
	if err != nil {
		t.Fatal(err)
	}
	oldSpec := webtopTemplateSpec(WebtopUbuntuKDETemplateID, dockerArtifact{Image: webtopImage, Digest: "sha256:" + strings.Repeat("a", 64)})
	oldSnapshot, oldHash, err := canonicalTemplateSpec(oldSpec)
	if err != nil {
		t.Fatal(err)
	}
	configuration, configurationHash, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_webtop_update", TemplateID: WebtopUbuntuKDETemplateID, TemplateSource: "builtin", TemplateRevision: 0,
		TemplateSnapshotJSON: oldSnapshot, TemplateSnapshotSHA256: oldHash, ServiceFamilyID: WebtopUbuntuKDETemplateID,
		Deployment: string(DeploymentContainer), WorkspacePath: t.TempDir(), ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationHash, Version: "previous",
		DesiredState: state, ObservedState: state, ForwardID: "pf_webtop_update", RuntimeIdentity: "old-container",
		RuntimeManifestJSON: `{}`, RuntimePort: 43123, ArtifactReference: oldSpec.Container.Image,
	}
	if err := registry.CreateManagedService(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:43123"}); err != nil {
		t.Fatal(err)
	}
	driver := &fakeContainerUpdateDriver{runtimes: map[string]bool{"old-container": true}, current: "old-container"}
	manager := &Manager{
		log: slog.Default(), registry: registry, scope: scope, stateDir: stateDir, containers: adapter, downloads: defaultPackageDownloadClient(),
		container: driver, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}, healthCheck: func(context.Context, *pfregistry.ManagedService) error { return nil },
	}
	driver.manager = manager
	return manager, registry, service, driver
}

func updateTestReleases(t *testing.T, manager *Manager, service pfregistry.ManagedService) (containerUpdateRelease, containerUpdateRelease) {
	t.Helper()
	target, err := manager.serviceUpdateTarget(context.Background(), service)
	if err != nil || target == nil || target.Spec == nil {
		t.Fatalf("update target = %+v, err=%v", target, err)
	}
	snapshot, hash, err := canonicalTemplateSpec(*target.Spec)
	if err != nil {
		t.Fatal(err)
	}
	old := containerUpdateRelease{
		TemplateRevision: service.TemplateRevision, TemplateSnapshotJSON: service.TemplateSnapshotJSON, TemplateSnapshotSHA256: service.TemplateSnapshotSHA256,
		ConfigurationJSON: service.ConfigurationJSON, ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
		Version: service.Version, DesiredState: service.DesiredState, ObservedState: service.ObservedState,
		RuntimeIdentity: service.RuntimeIdentity, ArtifactReference: service.ArtifactReference,
	}
	targetConfiguration, targetHash, err := configurationWithAcceptedNotices(service.ConfigurationJSON, map[string]int64{"interactive-desktop-root-and-network": 1})
	if err != nil {
		t.Fatal(err)
	}
	targetRelease := containerUpdateRelease{
		TemplateRevision: target.Revision, TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: hash, ConfigurationJSON: targetConfiguration, ConfigurationRevision: service.ConfigurationRevision + 1, ConfigurationSHA256: targetHash,
		Version: target.Version, DesiredState: service.DesiredState, ObservedState: service.ObservedState, ArtifactReference: target.Spec.Container.Image,
	}
	return old, targetRelease
}

func jsonMarshal(value any) (string, error) {
	raw, err := json.Marshal(value)
	return string(raw), err
}

type fakeContainerUpdateDriver struct {
	manager  *Manager
	events   []string
	runtimes map[string]bool
	current  string
	startErr error
}

func (d *fakeContainerUpdateDriver) Install(context.Context, *pfregistry.ManagedService, catalogPayload, func(string, int64)) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (d *fakeContainerUpdateDriver) PrepareUpdateArtifact(_ context.Context, spec TemplateSpec) (string, error) {
	d.events = append(d.events, "pull:target")
	return spec.Container.Image, nil
}
func (d *fakeContainerUpdateDriver) CreateRuntime(_ context.Context, service *pfregistry.ManagedService, _ TemplateSpec, artifact string) (string, error) {
	isTarget := service.Version == webtopUbuntuKDEVersion
	identity, label := "old-restored-container", "old"
	if isTarget {
		identity, label = "target-container", "target"
	}
	d.events = append(d.events, "create:"+label)
	d.runtimes[identity] = true
	d.current = identity
	service.RuntimeIdentity, service.ArtifactReference = identity, artifact
	return identity, nil
}
func (d *fakeContainerUpdateDriver) Start(_ context.Context, service *pfregistry.ManagedService) (string, error) {
	label := updateTestReleaseLabel(service)
	d.events = append(d.events, "start:"+label)
	if label == "target" && d.startErr != nil {
		err := d.startErr
		d.startErr = nil
		return "", err
	}
	d.runtimes[service.RuntimeIdentity] = true
	d.current = service.RuntimeIdentity
	return service.RuntimeIdentity, nil
}
func (d *fakeContainerUpdateDriver) Stop(_ context.Context, service *pfregistry.ManagedService) error {
	d.events = append(d.events, "stop:"+updateTestReleaseLabel(service))
	return nil
}
func (d *fakeContainerUpdateDriver) RemoveRuntime(_ context.Context, service *pfregistry.ManagedService) error {
	d.events = append(d.events, "remove:"+updateTestReleaseLabel(service))
	delete(d.runtimes, service.RuntimeIdentity)
	if d.current == service.RuntimeIdentity {
		d.current = ""
	}
	return nil
}
func (d *fakeContainerUpdateDriver) VerifyRuntime(_ context.Context, service *pfregistry.ManagedService, _ TemplateSpec) error {
	if !d.runtimes[service.RuntimeIdentity] {
		return serviceError("CONTAINER_IDENTITY_MISSING", "missing", 409, false, nil)
	}
	return nil
}
func (d *fakeContainerUpdateDriver) FindRuntime(context.Context, string) (string, error) {
	return d.current, nil
}
func (d *fakeContainerUpdateDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, func(string, int64)) error {
	return errors.New("unexpected uninstall")
}
func (d *fakeContainerUpdateDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}
func (d *fakeContainerUpdateDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

func updateTestReleaseLabel(service *pfregistry.ManagedService) string {
	if service != nil && service.Version == webtopUbuntuKDEVersion {
		return "target"
	}
	return "old"
}

func indexOf(values []string, target string) int {
	for index, value := range values {
		if value == target {
			return index
		}
	}
	return -1
}

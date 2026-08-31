package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestReconfigureCommitsOneVerifiedStoppedRuntime(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, service, "target")
	driver := &recordingReconfigureDriver{}

	if err := manager.runReconfigure(context.Background(), service, operation, driver, candidate); err != nil {
		t.Fatal(err)
	}
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ConfigurationRevision != 2 || stored.ConfigurationJSON != candidate.JSON || stored.ConfigurationSHA256 != candidate.SHA256 || stored.RuntimeIdentity != "runtime-target" || stored.RuntimeManifestJSON != "{}" {
		t.Fatalf("committed service = %+v", stored)
	}
	if driver.removed != 1 || driver.rebuilt != 1 || driver.verified != 2 {
		t.Fatalf("driver calls: remove=%d rebuild=%d verify=%d", driver.removed, driver.rebuilt, driver.verified)
	}
}

func TestReconfigureFailureRebuildsOldRuntimeAndKeepsOldRevision(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, service, "target")
	driver := &recordingReconfigureDriver{failFirstRebuild: errors.New("target create failed")}

	err := manager.runReconfigure(context.Background(), service, operation, driver, candidate)
	var executionError *reconfigureExecutionError
	if !errors.As(err, &executionError) || executionError.RollbackErr != nil || !strings.Contains(err.Error(), "target create failed") {
		t.Fatalf("reconfigure error = %#v", err)
	}
	stored, getErr := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if stored.ConfigurationRevision != 1 || stored.ConfigurationJSON != service.ConfigurationJSON || stored.RuntimeIdentity != "runtime-rollback" || stored.RuntimeManifestJSON != "{}" {
		t.Fatalf("rolled back service = %+v", stored)
	}
	if driver.removed != 1 || driver.rebuilt != 2 || driver.verified != 2 {
		t.Fatalf("driver calls: remove=%d rebuild=%d verify=%d", driver.removed, driver.rebuilt, driver.verified)
	}
}

func TestRecoverInterruptedReconfigureBeforeJournalHasNoRuntimeSideEffects(t *testing.T) {
	t.Parallel()
	manager, service, _ := reconfigureManagerForTest(t)
	operation := &pfregistry.ManagedOperation{OperationID: "mop_pending", ServiceID: service.ServiceID, Action: string(ActionReconfigure), State: "interrupted"}
	driver := &recordingReconfigureDriver{}

	if err := manager.recoverInterruptedReconfigure(service, operation, driver); err != nil {
		t.Fatal(err)
	}
	if driver.removed != 0 || driver.rebuilt != 0 || driver.verified != 0 {
		t.Fatalf("recovery before journal changed Runtime: %+v", driver)
	}
}

func TestRecoverInterruptedReconfigureRejectsAnotherOperationsJournal(t *testing.T) {
	t.Parallel()
	manager, service, _ := reconfigureManagerForTest(t)
	journal := reconfigureJournal{
		Kind: reconfigureJournalKind, OperationID: "mop_other", Phase: reconfigurePhasePrepared,
		Old:    reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision, RuntimeIdentity: service.RuntimeIdentity},
		Target: reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision + 1},
	}
	raw, err := json.Marshal(journal)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeManifestJSON = string(raw)
	operation := &pfregistry.ManagedOperation{OperationID: "mop_current", ServiceID: service.ServiceID, Action: string(ActionReconfigure), State: "interrupted"}

	if err := manager.recoverInterruptedReconfigure(service, operation, &recordingReconfigureDriver{}); err == nil {
		t.Fatal("journal from another operation was accepted")
	}
}

func reconfigureManagerForTest(t *testing.T) (*Manager, *pfregistry.ManagedService, *pfregistry.ManagedOperation) {
	t.Helper()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	spec := TemplateSpec{
		SchemaVersion: templateSpecSchemaVersion,
		Kind:          DeploymentContainer,
		Endpoint:      WebEndpointSpec{Scheme: "http", ContainerPort: 3000},
		Container: &ContainerTemplateSpec{
			Image:        "example.invalid/app@sha256:" + strings.Repeat("a", 64),
			Mounts:       []ContainerMountSpec{{ResourceID: "data", Type: "volume", Source: "data", Target: "/data"}},
			ReadOnlyRoot: true,
		},
	}
	service := configuredServiceForTest(t, spec, newServiceConfiguration(nil, nil), "custom")
	service.WorkspacePath = t.TempDir()
	service.DesiredState = "stopped"
	service.ObservedState = "stopped"
	service.ForwardID = "pf_reconfigure"
	service.RuntimeIdentity = "runtime-old"
	service.ArtifactReference = spec.Container.Image
	service.RuntimeManifestJSON = "{}"
	operation := &pfregistry.ManagedOperation{
		OperationID: "mop_reconfigure", ServiceID: service.ServiceID, RequestID: "request-reconfigure",
		RequestFingerprint: "fingerprint", Action: string(ActionReconfigure), State: "running", Stage: "reconfigure_preflight",
	}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3000"}, *operation); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(t.TempDir(), "managed-services")
	manager := &Manager{stateDir: stateDir, registry: registry, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	return manager, service, operation
}

func reconfigureCandidateForTest(t *testing.T, service *pfregistry.ManagedService, command string) reconfigureCandidate {
	t.Helper()
	configuration, err := decodeServiceConfiguration(service.ConfigurationJSON)
	if err != nil {
		t.Fatal(err)
	}
	commands := []string{command}
	configuration.Container = &containerSettingsOverride{Command: &commands}
	encoded, digest, err := canonicalServiceConfiguration(configuration)
	if err != nil {
		t.Fatal(err)
	}
	target := *service
	target.ConfigurationJSON, target.ConfigurationSHA256 = encoded, digest
	spec, _, err := effectiveSpecFromService(&target)
	if err != nil {
		t.Fatal(err)
	}
	return reconfigureCandidate{
		Configuration: configuration,
		JSON:          encoded,
		SHA256:        digest,
		Secrets:       serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion},
		Spec:          spec,
		Plan:          ReconfigurePlan{ConfigurationRevision: service.ConfigurationRevision, PlanDigest: "plan", RequiresRebuild: true},
	}
}

type recordingReconfigureDriver struct {
	removed          int
	rebuilt          int
	verified         int
	failFirstRebuild error
}

func (d *recordingReconfigureDriver) RebuildStoppedRuntime(_ context.Context, _ *pfregistry.ManagedService, _ TemplateSpec, _ string) (string, string, error) {
	d.rebuilt++
	if d.rebuilt == 1 && d.failFirstRebuild != nil {
		return "", "", d.failFirstRebuild
	}
	if d.rebuilt == 1 {
		return "runtime-target", "artifact-target", nil
	}
	return "runtime-rollback", "artifact-old", nil
}

func (d *recordingReconfigureDriver) RemoveRuntime(context.Context, *pfregistry.ManagedService) error {
	d.removed++
	return nil
}

func (d *recordingReconfigureDriver) VerifyRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec) error {
	d.verified++
	return nil
}

func (*recordingReconfigureDriver) FindReconfiguredRuntime(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", nil
}

func (*recordingReconfigureDriver) Install(context.Context, *pfregistry.ManagedService, catalogPayload, func(string, int64)) (string, string, error) {
	return "", "", errors.New("unexpected install")
}
func (*recordingReconfigureDriver) Start(context.Context, *pfregistry.ManagedService) (string, error) {
	return "", errors.New("unexpected start")
}
func (*recordingReconfigureDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected stop")
}
func (*recordingReconfigureDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, func(string, int64)) error {
	return errors.New("unexpected uninstall")
}
func (*recordingReconfigureDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}
func (*recordingReconfigureDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

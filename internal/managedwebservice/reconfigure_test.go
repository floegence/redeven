package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestReconfigureCommitsOneVerifiedStoppedRuntime(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, manager, service, "target")
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
	resolved, err := manager.resolveCurrentRuntime(context.Background(), stored)
	if err != nil {
		t.Fatal(err)
	}
	if stored.RuntimeSpecSHA256 == "" || stored.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 {
		t.Fatalf("committed runtime digest = %q, want %q", stored.RuntimeSpecSHA256, resolved.RuntimeSpecSHA256)
	}
	if driver.removed != 1 || driver.rebuilt != 1 || driver.verified != 2 {
		t.Fatalf("driver calls: remove=%d rebuild=%d verify=%d", driver.removed, driver.rebuilt, driver.verified)
	}

	manager.healthCheck = func(context.Context, *pfregistry.ManagedService) error { return nil }
	if err := manager.runStart(context.Background(), stored, operation, driver, resolved); err != nil {
		t.Fatalf("start after verified reconfigure: %v", err)
	}
	if driver.installed != 0 || driver.started != 1 {
		t.Fatalf("start rebuilt the current runtime: install=%d start=%d", driver.installed, driver.started)
	}
}

func TestReconfigureFailureRebuildsOldRuntimeAndKeepsOldRevision(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, manager, service, "target")
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
	resolved, resolveErr := manager.resolveCurrentRuntime(context.Background(), stored)
	if resolveErr != nil {
		t.Fatal(resolveErr)
	}
	if stored.RuntimeSpecSHA256 == "" || stored.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 {
		t.Fatalf("rolled back runtime digest = %q, want %q", stored.RuntimeSpecSHA256, resolved.RuntimeSpecSHA256)
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

func TestRecoverInterruptedVerifiedReconfigureCommitsCurrentRuntimeDigest(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, manager, service, "target")
	target := *service
	target.ConfigurationJSON, target.ConfigurationSHA256 = candidate.JSON, candidate.SHA256
	target.ConfigurationRevision++
	target.RuntimeIdentity, target.ArtifactReference = "runtime-target", "artifact-target"
	resolved, err := manager.resolveCurrentRuntime(context.Background(), &target)
	if err != nil {
		t.Fatal(err)
	}
	journal := reconfigureJournal{
		Kind: reconfigureJournalKind, OperationID: operation.OperationID, Phase: reconfigurePhaseTargetVerified,
		Old: reconfigureRelease{
			ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision,
			RuntimeIdentity: service.RuntimeIdentity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, ArtifactReference: service.ArtifactReference,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
		Target: reconfigureRelease{
			ConfigurationJSON: candidate.JSON, ConfigurationSHA256: candidate.SHA256, Revision: target.ConfigurationRevision,
			RuntimeIdentity: target.RuntimeIdentity, RuntimeSpecSHA256: resolved.RuntimeSpecSHA256, ArtifactReference: target.ArtifactReference,
			RuntimeBindingJSON: target.RuntimeBindingJSON, RuntimeBindingSHA256: target.RuntimeBindingSHA256,
		},
	}
	if err := manager.stageReconfigureSecrets(service.ServiceID, operation.OperationID, serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion}, candidate.Secrets); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(journal)
	if err != nil {
		t.Fatal(err)
	}
	manifest := string(raw)
	service.RuntimeManifestJSON = manifest
	if err := manager.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &manifest}); err != nil {
		t.Fatal(err)
	}
	operation.State = "interrupted"
	driver := &recordingReconfigureDriver{}
	if err := manager.recoverInterruptedReconfigure(service, operation, driver); err != nil {
		t.Fatal(err)
	}
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ConfigurationRevision != target.ConfigurationRevision || stored.RuntimeIdentity != target.RuntimeIdentity || stored.RuntimeManifestJSON != "{}" {
		t.Fatalf("recovered service = %+v", stored)
	}
	if stored.RuntimeSpecSHA256 != resolved.RuntimeSpecSHA256 {
		t.Fatalf("recovered runtime digest = %q, want %q", stored.RuntimeSpecSHA256, resolved.RuntimeSpecSHA256)
	}
	if driver.verified != 1 || driver.rebuilt != 0 || driver.removed != 0 {
		t.Fatalf("recovery driver calls = %+v", driver)
	}
}

func TestRecoverInterruptedVerifiedReconfigureKeepsBuiltDigestAfterIncompatibleTemplateEdit(t *testing.T) {
	t.Parallel()
	manager, service, operation := reconfigureManagerForTest(t)
	candidate := reconfigureCandidateForTest(t, manager, service, "target")
	target := *service
	target.ConfigurationJSON, target.ConfigurationSHA256 = candidate.JSON, candidate.SHA256
	target.ConfigurationRevision++
	target.RuntimeIdentity, target.ArtifactReference = "runtime-target", "artifact-target"
	built, err := manager.resolveCurrentRuntime(context.Background(), &target)
	if err != nil {
		t.Fatal(err)
	}
	journal := reconfigureJournal{
		Kind: reconfigureJournalKind, OperationID: operation.OperationID, Phase: reconfigurePhaseTargetVerified,
		Old: reconfigureRelease{
			ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision,
			RuntimeIdentity: service.RuntimeIdentity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, ArtifactReference: service.ArtifactReference,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
		Target: reconfigureRelease{
			ConfigurationJSON: candidate.JSON, ConfigurationSHA256: candidate.SHA256, Revision: target.ConfigurationRevision,
			RuntimeIdentity: target.RuntimeIdentity, RuntimeSpecSHA256: built.RuntimeSpecSHA256, ArtifactReference: target.ArtifactReference,
			RuntimeBindingJSON: target.RuntimeBindingJSON, RuntimeBindingSHA256: target.RuntimeBindingSHA256,
		},
	}
	if err := manager.stageReconfigureSecrets(service.ServiceID, operation.OperationID, serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion}, candidate.Secrets); err != nil {
		t.Fatal(err)
	}

	record, err := manager.registry.GetManagedTemplate(context.Background(), service.TemplateID)
	if err != nil || record == nil {
		t.Fatalf("template = %+v, err=%v", record, err)
	}
	spec, err := verifiedTemplateSpec(record.SpecJSON, record.SpecSHA256)
	if err != nil {
		t.Fatal(err)
	}
	spec.Parameters = append(spec.Parameters, TemplateParameter{Name: "NEW_REQUIRED", Label: "New required value", Type: "text", Required: true})
	record.SpecJSON, record.SpecSHA256, err = canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	record.Revision++
	if err := manager.registry.UpdateManagedTemplate(context.Background(), *record); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(journal)
	if err != nil {
		t.Fatal(err)
	}
	manifest := string(raw)
	service.RuntimeManifestJSON = manifest
	if err := manager.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &manifest}); err != nil {
		t.Fatal(err)
	}
	operation.State = "interrupted"
	driver := &recordingReconfigureDriver{foundRuntime: target.RuntimeIdentity}
	manager.container = driver
	manager.reconcileInterruptedService(service, *operation)
	stored, err := manager.registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.resolveCurrentRuntime(context.Background(), stored); managedErrorCode(err) != "CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE" {
		t.Fatalf("current template resolution error = %v", err)
	}
	if stored.RuntimeSpecSHA256 != built.RuntimeSpecSHA256 {
		t.Fatalf("recovered digest=%q built=%q", stored.RuntimeSpecSHA256, built.RuntimeSpecSHA256)
	}
	if driver.verified != 0 || driver.found != 1 {
		t.Fatalf("template-drift recovery calls = %+v", driver)
	}
	storedOperation, err := manager.registry.GetManagedOperation(context.Background(), operation.OperationID)
	if err != nil || storedOperation == nil || storedOperation.State != "succeeded" {
		t.Fatalf("recovered operation = %+v, err=%v", storedOperation, err)
	}
}

func TestRecoverInterruptedReconfigureRejectsAnotherOperationsJournal(t *testing.T) {
	t.Parallel()
	manager, service, _ := reconfigureManagerForTest(t)
	journal := reconfigureJournal{
		Kind: reconfigureJournalKind, OperationID: "mop_other", Phase: reconfigurePhasePrepared,
		Old:    reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision, RuntimeIdentity: service.RuntimeIdentity, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256},
		Target: reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision + 1, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256},
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
	specJSON, specDigest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	const templateID = "template-reconfigure"
	const familyID = "family-reconfigure"
	if err := registry.CreateManagedTemplate(context.Background(), pfregistry.ManagedTemplate{
		TemplateID: templateID, Name: "Reconfigure test", Source: "custom", Deployment: string(DeploymentContainer), Revision: 1,
		SpecJSON: specJSON, SpecSHA256: specDigest, ServiceFamilyID: familyID,
	}); err != nil {
		t.Fatal(err)
	}
	configurationJSON, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	releaseJSON, releaseDigest, err := canonicalReleaseIdentity(ReleaseIdentity{
		Kind: "oci", Source: "example.invalid/app", Tag: "1.0.0", Digest: "sha256:" + strings.Repeat("a", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_reconfigure", TemplateID: templateID, ConfigurationJSON: configurationJSON,
		ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
		ReleaseIdentityJSON: releaseJSON, ReleaseIdentitySHA256: releaseDigest,
	}
	service.WorkspacePath, err = filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service.DesiredState = "stopped"
	service.ObservedState = "stopped"
	service.ForwardID = "pf-reconfigure"
	service.RuntimeIdentity = "runtime-old"
	service.ArtifactReference = spec.Container.Image
	service.RuntimeManifestJSON = "{}"
	setTestRuntimeBinding(t, service, familyID, DeploymentContainer)
	operation := &pfregistry.ManagedOperation{
		OperationID: "mop_reconfigure", ServiceID: service.ServiceID, RequestID: "request-reconfigure",
		RequestFingerprint: "fingerprint", Action: string(ActionReconfigure), State: "running", Stage: "reconfigure_preflight",
	}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:3000"}, *operation); err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Join(t.TempDir(), "managed-services")
	catalog, err := LoadBuiltinCatalog()
	if err != nil {
		t.Fatal(err)
	}
	scope, err := filesystemscope.NewDefaultRegistry(service.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{stateDir: stateDir, registry: registry, catalog: catalog, scope: scope, listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	resolved, err := manager.resolveCurrentRuntime(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	service.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	if err := registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeSpecSHA256: &service.RuntimeSpecSHA256}); err != nil {
		t.Fatal(err)
	}
	return manager, service, operation
}

func reconfigureCandidateForTest(t *testing.T, manager *Manager, service *pfregistry.ManagedService, command string) reconfigureCandidate {
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
	resolved, err := manager.resolveCurrentRuntime(context.Background(), &target)
	if err != nil {
		t.Fatal(err)
	}
	return reconfigureCandidate{
		Configuration: configuration,
		JSON:          encoded,
		SHA256:        digest,
		Secrets:       serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion},
		Spec:          resolved.Spec,
		Plan:          ReconfigurePlan{ConfigurationRevision: service.ConfigurationRevision, PlanDigest: "plan", RequiresRebuild: true},
	}
}

type recordingReconfigureDriver struct {
	removed          int
	rebuilt          int
	verified         int
	installed        int
	started          int
	found            int
	foundRuntime     string
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

func (d *recordingReconfigureDriver) FindReconfiguredRuntime(context.Context, *pfregistry.ManagedService) (string, error) {
	d.found++
	return d.foundRuntime, nil
}

func (d *recordingReconfigureDriver) Install(context.Context, *pfregistry.ManagedService, operationProgress) (string, string, error) {
	d.installed++
	return "", "", errors.New("unexpected install")
}
func (d *recordingReconfigureDriver) Start(_ context.Context, service *pfregistry.ManagedService) (string, error) {
	d.started++
	return service.RuntimeIdentity, nil
}
func (*recordingReconfigureDriver) Stop(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected stop")
}
func (*recordingReconfigureDriver) Uninstall(context.Context, *pfregistry.ManagedService, bool, operationProgress) error {
	return errors.New("unexpected uninstall")
}
func (*recordingReconfigureDriver) CleanupPartial(context.Context, *pfregistry.ManagedService) error {
	return errors.New("unexpected cleanup")
}
func (*recordingReconfigureDriver) Logs(context.Context, *pfregistry.ManagedService, int) (*LogResult, error) {
	return nil, errors.New("unexpected logs")
}

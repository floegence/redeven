package managedwebservice

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestManagementSettingsRepairMissingInputsWithoutStartingArchivedService(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}
	m, registry, service, template := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	spec.Parameters = []TemplateParameter{{Name: "MODE", Label: "Mode", Type: "text", Required: true}, {Name: "TOKEN", Label: "Token", Type: "secret", Required: true}}
	updateRuntimeResolutionTestTemplate(t, registry, template, spec)
	if _, err := m.resolveCurrentRuntime(context.Background(), service); managedErrorCode(err) != "CURRENT_TEMPLATE_PARAMETERS_INCOMPATIBLE" {
		t.Fatalf("execution accepted missing inputs: %v", err)
	}
	service, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.ArchiveManagedService(context.Background(), *service, "detached"); err != nil {
		t.Fatal(err)
	}
	settings, err := m.Settings(context.Background(), service.ServiceID)
	if err != nil || len(settings.ParameterDefinitions) != 2 {
		t.Fatalf("repair form unavailable: %+v %v", settings, err)
	}
	draft := ReconfigureDraft{ConfigurationRevision: settings.ConfigurationRevision, Parameters: map[string]string{"MODE": "production"}, SecretParameters: map[string]string{"TOKEN": "private-repair-token"}, Runtime: settings.Runtime}
	plan, err := m.PreflightReconfigure(context.Background(), service.ServiceID, draft)
	if err != nil || plan.RequiresRebuild {
		t.Fatalf("archive repair would mutate the business runtime: %+v %v", plan, err)
	}
	operation, err := m.Operate(context.Background(), service.ServiceID, OperationRequest{RequestID: "repair-config", Action: ActionReconfigure, Reconfigure: &ReconfigureRequest{Draft: draft, PlanDigest: plan.PlanDigest}})
	if err != nil {
		t.Fatal(err)
	}
	m.workers.Wait()
	operation, err = m.Operation(context.Background(), operation.OperationID)
	if err != nil || operation.State != "succeeded" {
		t.Fatalf("repair did not finish: %+v %v", operation, err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored.ManagementState != "detached" || stored.RuntimeIdentity != "" || stored.ForwardID != "" {
		t.Fatalf("repair changed lifecycle: %+v %v", stored, err)
	}
	if _, err = m.resolveCurrentRuntime(context.Background(), stored); err != nil {
		t.Fatalf("repaired inputs still unusable: %v", err)
	}
	settings, err = m.Settings(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(settings)
	if strings.Contains(string(raw), "private-repair-token") || strings.Contains(stored.ConfigurationJSON, "private-repair-token") {
		t.Fatal("repair exposed private parameters")
	}
	if len(settings.ConfiguredSecretParameters) != 1 {
		t.Fatal("repair did not record the configured secret")
	}
}

func TestManagementRecoveryCannotOverwriteAnotherLifecycleTransaction(t *testing.T) {
	m, service, _ := managementFixture(t)
	manifest := `{"kind":"redeven.managed_service_reconfigure.v1"}`
	if err := m.registry.UpdateManagedService(context.Background(), service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &manifest}); err != nil {
		t.Fatal(err)
	}
	plan, err := m.PreflightManagement(context.Background(), service.ServiceID, ManagementPlanRequest{Action: ActionRecover})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(plan.Blockers, ","), "LIFECYCLE_TRANSACTION_PENDING") {
		t.Fatalf("existing transaction could be overwritten: %+v", plan)
	}
}

func TestManagementArchivedConfigurationInterruptionRestoresPrivateState(t *testing.T) {
	spec := TemplateSpec{SchemaVersion: templateSpecSchemaVersion, Kind: DeploymentHost, Endpoint: WebEndpointSpec{Scheme: "http"}, Host: &HostTemplateSpec{StartScript: "exec sleep 60"}}
	m, registry, service, _ := newRuntimeResolutionTestService(t, spec, ReleaseIdentity{Kind: "none"}, "stopped")
	service, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if err = registry.ArchiveManagedService(context.Background(), *service, "detached"); err != nil {
		t.Fatal(err)
	}
	old := serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion, Parameters: map[string]string{"TOKEN": "old-private-value"}}
	target := serviceSecrets{SchemaVersion: serviceConfigurationSchemaVersion, Parameters: map[string]string{"TOKEN": "target-private-value"}}
	op := pfregistry.ManagedOperation{OperationID: "mop-archived-config", ServiceID: service.ServiceID, RequestID: "archive-config-interruption", Action: string(ActionReconfigure), State: "interrupted", Stage: "interrupted", ProgressTotal: operationProgressTotal}
	if err = registry.CreateManagedOperation(context.Background(), op); err != nil {
		t.Fatal(err)
	}
	release := reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256}
	next := release
	next.Revision++
	journal := reconfigureJournal{Kind: reconfigureJournalKind, OperationID: op.OperationID, Phase: reconfigurePhasePrepared, ConfigurationOnly: true, Old: release, Target: next}
	if err = m.stageReconfigureSecrets(service.ServiceID, op.OperationID, old, target); err != nil {
		t.Fatal(err)
	}
	if err = m.writeReconfigureJournal(context.Background(), service.ServiceID, journal); err != nil {
		t.Fatal(err)
	}
	if err = m.writeServiceSecretDocument(service.ServiceID, target); err != nil {
		t.Fatal(err)
	}
	m.Start(context.Background())
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ManagementState != "detached" || stored.RuntimeManifestJSON != "{}" || stored.RuntimeIdentity != "" {
		t.Fatalf("archive recovery changed the runtime: %+v", stored)
	}
	secrets, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil || secrets.Parameters["TOKEN"] != "old-private-value" {
		t.Fatalf("interrupted private state was not restored: %v", err)
	}
}

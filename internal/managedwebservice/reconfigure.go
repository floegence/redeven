package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const reconfigureJournalKind = "redeven.managed_service_reconfigure.v1"

const (
	reconfigurePhasePrepared       = "prepared"
	reconfigurePhaseOldRemoved     = "old_removed"
	reconfigurePhaseTargetCreating = "target_creating"
	reconfigurePhaseTargetCreated  = "target_created"
	reconfigurePhaseTargetVerified = "target_verified"
)

type reconfigureRelease struct {
	ConfigurationJSON    string `json:"configuration_json"`
	ConfigurationSHA256  string `json:"configuration_sha256"`
	Revision             int64  `json:"revision"`
	RuntimeIdentity      string `json:"runtime_identity,omitempty"`
	RuntimeSpecSHA256    string `json:"runtime_spec_sha256,omitempty"`
	ArtifactReference    string `json:"artifact_reference,omitempty"`
	RuntimeBindingJSON   string `json:"runtime_binding_json"`
	RuntimeBindingSHA256 string `json:"runtime_binding_sha256"`
}

type reconfigureJournal struct {
	Kind        string             `json:"kind"`
	OperationID string             `json:"operation_id"`
	Phase       string             `json:"phase"`
	Old         reconfigureRelease `json:"old"`
	Target      reconfigureRelease `json:"target"`
}

type reconfigureRuntimeDriver interface {
	deploymentDriver
	RebuildStoppedRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec, string) (string, string, error)
	RemoveRuntime(context.Context, *pfregistry.ManagedService) error
	VerifyRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec) error
	FindReconfiguredRuntime(context.Context, *pfregistry.ManagedService) (string, error)
}

type reconfigureExecutionError struct {
	Cause       error
	RollbackErr error
}

func (e *reconfigureExecutionError) Error() string {
	if e == nil || e.Cause == nil {
		return "managed Web Service reconfiguration failed"
	}
	return e.Cause.Error()
}

func (e *reconfigureExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (m *Manager) runReconfigure(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver, candidate reconfigureCandidate) (runErr error) {
	if service.DesiredState != "stopped" || service.ObservedState != "stopped" {
		return serviceError("RECONFIGURE_REQUIRES_STOPPED", "Stop the service before applying runtime settings.", 409, false, nil)
	}
	if candidate.Plan.ConfigurationRevision != service.ConfigurationRevision {
		return serviceError("CONFIGURATION_REVISION_CONFLICT", "Service settings changed after preflight. Run preflight again.", 409, true, nil)
	}
	oldSecrets, err := m.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return err
	}
	binding, bindingErr := decodeRuntimeBinding(service)
	if bindingErr != nil {
		return bindingErr
	}
	journal := reconfigureJournal{
		Kind: reconfigureJournalKind, OperationID: op.OperationID, Phase: reconfigurePhasePrepared,
		Old:    reconfigureRelease{ConfigurationJSON: service.ConfigurationJSON, ConfigurationSHA256: service.ConfigurationSHA256, Revision: service.ConfigurationRevision, RuntimeIdentity: service.RuntimeIdentity, RuntimeSpecSHA256: service.RuntimeSpecSHA256, ArtifactReference: service.ArtifactReference, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256},
		Target: reconfigureRelease{ConfigurationJSON: candidate.JSON, ConfigurationSHA256: candidate.SHA256, Revision: service.ConfigurationRevision + 1, ArtifactReference: service.ArtifactReference, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256},
	}
	var oldResolved *resolvedRuntime
	if binding.Deployment != DeploymentHost {
		oldResolved, err = m.resolveCurrentRuntime(ctx, service)
		if err != nil {
			return err
		}
		target := *service
		target.ConfigurationJSON, target.ConfigurationSHA256 = candidate.JSON, candidate.SHA256
		target.ConfigurationRevision = service.ConfigurationRevision + 1
		journal.Target.RuntimeSpecSHA256, err = currentRuntimeSpecDigest(candidate.Spec, candidate.Configuration, oldResolved.Release, oldResolved.Binding, candidate.Secrets, &target)
		if err != nil {
			return err
		}
	}
	if err := m.stageReconfigureSecrets(service.ServiceID, op.OperationID, oldSecrets, candidate.Secrets); err != nil {
		return err
	}
	journalPersisted, committed := false, false
	defer func() {
		if m.isClosing() {
			return
		}
		if !journalPersisted {
			m.removeReconfigureStage(service.ServiceID, op.OperationID)
			return
		}
		if runErr == nil || committed {
			return
		}
		rollbackErr := m.rollbackReconfigure(context.Background(), service, journal, driver)
		runErr = &reconfigureExecutionError{Cause: runErr, RollbackErr: rollbackErr}
	}()

	m.progress(op, "reconfigure_preflight", 1)
	if err := m.writeReconfigureJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	journalPersisted = true

	// Host services have no persistent Runtime resource to rebuild. Their
	// scripts become authoritative only for the next matching lifecycle action.
	if binding.Deployment == DeploymentHost {
		m.progress(op, "applying_configuration", 5)
		if err := m.writeServiceSecretDocument(service.ServiceID, candidate.Secrets); err != nil {
			return err
		}
		if _, err := m.registry.CommitManagedServiceReconfiguration(ctx, service.ServiceID, service.ConfigurationRevision, candidate.JSON, candidate.SHA256, service.RuntimeIdentity, service.RuntimeSpecSHA256, service.ArtifactReference, "{}"); err != nil {
			return err
		}
		committed = true
		m.removeReconfigureStage(service.ServiceID, op.OperationID)
		return nil
	}

	runtimeDriver, ok := driver.(reconfigureRuntimeDriver)
	if !ok {
		return serviceError("RECONFIGURE_UNSUPPORTED", "This managed Web Service deployment cannot be rebuilt from instance settings.", 409, false, nil)
	}
	oldSpec := oldResolved.Spec
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		m.progress(op, "verifying_runtime", 2)
		if err := runtimeDriver.VerifyRuntime(ctx, service, oldSpec); err != nil {
			return err
		}
		m.progress(op, "removing_runtime", 3)
		if err := runtimeDriver.RemoveRuntime(ctx, service); err != nil {
			return err
		}
	}
	journal.Phase = reconfigurePhaseOldRemoved
	if err := m.writeReconfigureJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := m.writeServiceSecretDocument(service.ServiceID, candidate.Secrets); err != nil {
		return err
	}
	target := *service
	target.ConfigurationJSON, target.ConfigurationSHA256 = candidate.JSON, candidate.SHA256
	target.ConfigurationRevision = service.ConfigurationRevision + 1
	target.RuntimeIdentity, target.RuntimeSpecSHA256 = "", journal.Target.RuntimeSpecSHA256
	journal.Phase = reconfigurePhaseTargetCreating
	if err := m.writeReconfigureJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "rebuilding_runtime", 5)
	runtimeID, artifact, err := runtimeDriver.RebuildStoppedRuntime(ctx, &target, candidate.Spec, service.ArtifactReference)
	if err != nil {
		return err
	}
	target.RuntimeIdentity, target.ArtifactReference = runtimeID, artifact
	journal.Target.RuntimeIdentity, journal.Target.ArtifactReference = runtimeID, artifact
	journal.Phase = reconfigurePhaseTargetCreated
	if err := m.writeReconfigureJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "verifying_runtime", 6)
	if err := runtimeDriver.VerifyRuntime(ctx, &target, candidate.Spec); err != nil {
		return err
	}
	journal.Phase = reconfigurePhaseTargetVerified
	if err := m.writeReconfigureJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if _, err := m.registry.CommitManagedServiceReconfiguration(ctx, service.ServiceID, service.ConfigurationRevision, candidate.JSON, candidate.SHA256, runtimeID, journal.Target.RuntimeSpecSHA256, artifact, "{}"); err != nil {
		return err
	}
	service.ConfigurationJSON, service.ConfigurationSHA256 = candidate.JSON, candidate.SHA256
	service.ConfigurationRevision++
	service.RuntimeIdentity, service.RuntimeSpecSHA256, service.ArtifactReference, service.RuntimeManifestJSON = runtimeID, journal.Target.RuntimeSpecSHA256, artifact, "{}"
	committed = true
	m.removeReconfigureStage(service.ServiceID, op.OperationID)
	return nil
}

func (m *Manager) writeReconfigureJournal(ctx context.Context, serviceID string, journal reconfigureJournal) error {
	raw, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	value := string(raw)
	return m.registry.UpdateManagedService(ctx, serviceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &value})
}

func decodeReconfigureJournal(raw string) (reconfigureJournal, error) {
	journal := reconfigureJournal{}
	if err := decodeStrictJSON([]byte(raw), &journal); err != nil {
		return journal, err
	}
	if journal.Kind != reconfigureJournalKind || journal.OperationID == "" || journal.Phase == "" || journal.Old.Revision <= 0 || journal.Target.Revision != journal.Old.Revision+1 ||
		journal.Old.RuntimeBindingJSON == "" || journal.Old.RuntimeBindingSHA256 == "" || journal.Target.RuntimeBindingJSON == "" || journal.Target.RuntimeBindingSHA256 == "" ||
		(journal.Old.RuntimeSpecSHA256 != "" && !validRuntimeSpecSHA256(journal.Old.RuntimeSpecSHA256)) ||
		(journal.Target.RuntimeSpecSHA256 != "" && !validRuntimeSpecSHA256(journal.Target.RuntimeSpecSHA256)) {
		return journal, errors.New("invalid managed service reconfigure journal")
	}
	return journal, nil
}

func (m *Manager) reconfigureStagePath(serviceID, operationID, name string) string {
	return filepath.Join(m.stateDir, "reconfigure", serviceID, operationID, name+".json")
}

func (m *Manager) stageReconfigureSecrets(serviceID, operationID string, old, target serviceSecrets) error {
	for name, value := range map[string]serviceSecrets{"old": old, "target": target} {
		value.SchemaVersion = serviceConfigurationSchemaVersion
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if err := writePrivateFile(m.reconfigureStagePath(serviceID, operationID, name), raw); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) stagedReconfigureSecrets(serviceID, operationID, name string) (serviceSecrets, error) {
	raw, err := os.ReadFile(m.reconfigureStagePath(serviceID, operationID, name))
	if err != nil {
		return serviceSecrets{}, err
	}
	value := serviceSecrets{}
	if err := decodeStrictJSON(raw, &value); err != nil || value.SchemaVersion != serviceConfigurationSchemaVersion {
		return serviceSecrets{}, errors.New("invalid staged managed service secrets")
	}
	return value, nil
}

func (m *Manager) removeReconfigureStage(serviceID, operationID string) {
	_ = os.RemoveAll(filepath.Dir(m.reconfigureStagePath(serviceID, operationID, "old")))
}

func (m *Manager) rollbackReconfigure(ctx context.Context, service *pfregistry.ManagedService, journal reconfigureJournal, driver deploymentDriver) error {
	oldSecrets, err := m.stagedReconfigureSecrets(service.ServiceID, journal.OperationID, "old")
	if err != nil {
		return err
	}
	if err := m.writeServiceSecretDocument(service.ServiceID, oldSecrets); err != nil {
		return err
	}
	binding, bindingErr := decodeRuntimeBinding(service)
	if bindingErr != nil {
		return bindingErr
	}
	if binding.Deployment == DeploymentHost {
		empty := "{}"
		if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &empty}); err != nil {
			return err
		}
		m.removeReconfigureStage(service.ServiceID, journal.OperationID)
		return nil
	}
	runtimeDriver, ok := driver.(reconfigureRuntimeDriver)
	if !ok {
		return errors.New("reconfigure runtime recovery is unsupported")
	}
	target := serviceFromReconfigureRelease(*service, journal.Target)
	if target.RuntimeIdentity == "" && (journal.Phase == reconfigurePhaseTargetCreating || journal.Phase == reconfigurePhaseTargetCreated || journal.Phase == reconfigurePhaseTargetVerified) {
		target.RuntimeIdentity, err = runtimeDriver.FindReconfiguredRuntime(ctx, &target)
		if err != nil {
			return err
		}
	}
	if target.RuntimeIdentity != "" {
		if err := runtimeDriver.RemoveRuntime(ctx, &target); err != nil {
			return err
		}
	}
	old := serviceFromReconfigureRelease(*service, journal.Old)
	resolved, err := m.resolveCurrentRuntime(ctx, &old)
	if err != nil {
		return err
	}
	oldSpec := resolved.Spec
	if journal.Phase == reconfigurePhasePrepared {
		if err := runtimeDriver.VerifyRuntime(ctx, &old, oldSpec); err == nil {
			empty := "{}"
			_ = m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeSpecSHA256: &journal.Old.RuntimeSpecSHA256, RuntimeManifestJSON: &empty})
			m.removeReconfigureStage(service.ServiceID, journal.OperationID)
			return nil
		}
	}
	old.RuntimeIdentity = ""
	runtimeID, artifact, err := runtimeDriver.RebuildStoppedRuntime(ctx, &old, oldSpec, journal.Old.ArtifactReference)
	if err != nil {
		return err
	}
	if err := runtimeDriver.VerifyRuntime(ctx, &old, oldSpec); err != nil {
		return err
	}
	empty := "{}"
	journal.Old.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeIdentity: &runtimeID, RuntimeSpecSHA256: &journal.Old.RuntimeSpecSHA256, ArtifactReference: &artifact, RuntimeManifestJSON: &empty}); err != nil {
		return err
	}
	service.RuntimeIdentity, service.RuntimeSpecSHA256, service.ArtifactReference, service.RuntimeManifestJSON = runtimeID, journal.Old.RuntimeSpecSHA256, artifact, empty
	m.removeReconfigureStage(service.ServiceID, journal.OperationID)
	return nil
}

func serviceFromReconfigureRelease(base pfregistry.ManagedService, release reconfigureRelease) pfregistry.ManagedService {
	base.ConfigurationJSON = release.ConfigurationJSON
	base.ConfigurationSHA256 = release.ConfigurationSHA256
	base.ConfigurationRevision = release.Revision
	base.RuntimeIdentity = release.RuntimeIdentity
	base.RuntimeSpecSHA256 = release.RuntimeSpecSHA256
	base.ArtifactReference = release.ArtifactReference
	base.RuntimeBindingJSON = release.RuntimeBindingJSON
	base.RuntimeBindingSHA256 = release.RuntimeBindingSHA256
	return base
}

func (m *Manager) recoverInterruptedReconfigure(service *pfregistry.ManagedService, operation *pfregistry.ManagedOperation, driver deploymentDriver) error {
	// The operation row is committed before its worker writes the journal. No
	// Runtime or secret mutation is allowed before that journal, so an empty
	// manifest means there is nothing to recover.
	if strings.TrimSpace(service.RuntimeManifestJSON) == "" || strings.TrimSpace(service.RuntimeManifestJSON) == "{}" {
		m.removeReconfigureStage(service.ServiceID, operation.OperationID)
		return nil
	}
	journal, err := decodeReconfigureJournal(service.RuntimeManifestJSON)
	if err != nil {
		return err
	}
	if journal.OperationID != operation.OperationID {
		return errors.New("managed service reconfigure journal belongs to another operation")
	}
	if journal.Phase == reconfigurePhaseTargetVerified {
		if !validRuntimeSpecSHA256(journal.Target.RuntimeSpecSHA256) {
			return errors.New("verified managed service reconfigure journal has no valid runtime digest")
		}
		targetSecrets, err := m.stagedReconfigureSecrets(service.ServiceID, journal.OperationID, "target")
		if err != nil {
			return err
		}
		if err := m.writeServiceSecretDocument(service.ServiceID, targetSecrets); err != nil {
			return err
		}
		target := serviceFromReconfigureRelease(*service, journal.Target)
		runtimeDriver, ok := driver.(reconfigureRuntimeDriver)
		if !ok {
			return errors.New("reconfigure runtime recovery is unsupported")
		}
		resolved, err := m.resolveCurrentRuntime(context.Background(), &target)
		if err == nil && resolved.RuntimeSpecSHA256 == journal.Target.RuntimeSpecSHA256 {
			if err := runtimeDriver.VerifyRuntime(context.Background(), &target, resolved.Spec); err != nil {
				return err
			}
		} else {
			found, findErr := runtimeDriver.FindReconfiguredRuntime(context.Background(), &target)
			if findErr != nil {
				return findErr
			}
			if found == "" || found != target.RuntimeIdentity {
				return errors.New("the verified reconfigured runtime identity is unavailable")
			}
		}
		if _, err := m.registry.CommitManagedServiceReconfiguration(context.Background(), service.ServiceID, journal.Old.Revision, journal.Target.ConfigurationJSON, journal.Target.ConfigurationSHA256, journal.Target.RuntimeIdentity, journal.Target.RuntimeSpecSHA256, journal.Target.ArtifactReference, "{}"); err != nil {
			return err
		}
		m.removeReconfigureStage(service.ServiceID, journal.OperationID)
		operation.State, operation.Stage = "succeeded", "completed"
		operation.ProgressCurrent = operationProgressTotal
		operation.FinishedAtUnixMs = time.Now().UnixMilli()
		blank := ""
		return m.registry.FinalizeManagedOperation(context.Background(), *operation, pfregistry.ManagedServicePatch{LastErrorCode: &blank, LastErrorMessage: &blank})
	}
	return m.rollbackReconfigure(context.Background(), service, journal, driver)
}

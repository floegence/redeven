package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const managedServiceUpdateJournalKind = "redeven.managed_service_update.v2"

const (
	updatePhasePreparing      = "preparing"
	updatePhaseArtifactReady  = "artifact_ready"
	updatePhaseOldStopped     = "old_stopped"
	updatePhaseOldRemoved     = "old_removed"
	updatePhaseTargetCreating = "target_creating"
	updatePhaseTargetCreated  = "target_created"
	updatePhaseTargetVerified = "target_verified"
)

type containerUpdateRelease struct {
	ConfigurationJSON     string `json:"configuration_json"`
	ConfigurationRevision int64  `json:"configuration_revision"`
	ConfigurationSHA256   string `json:"configuration_sha256"`
	DesiredState          string `json:"desired_state"`
	ObservedState         string `json:"observed_state"`
	RuntimeIdentity       string `json:"runtime_identity,omitempty"`
	RuntimeSpecSHA256     string `json:"runtime_spec_sha256,omitempty"`
	ArtifactReference     string `json:"artifact_reference,omitempty"`
	ReleaseIdentityJSON   string `json:"release_identity_json"`
	ReleaseIdentitySHA256 string `json:"release_identity_sha256"`
	RuntimeBindingJSON    string `json:"runtime_binding_json"`
	RuntimeBindingSHA256  string `json:"runtime_binding_sha256"`
}

type containerUpdateJournal struct {
	Kind   string                 `json:"kind"`
	Phase  string                 `json:"phase"`
	Old    containerUpdateRelease `json:"old"`
	Target containerUpdateRelease `json:"target"`
}

type containerUpdateDriver interface {
	deploymentDriver
	PrepareUpdateArtifact(context.Context, TemplateSpec, operationProgress) (string, error)
	CreateRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec, string) (string, error)
	RemoveRuntime(context.Context, *pfregistry.ManagedService) error
	VerifyRuntime(context.Context, *pfregistry.ManagedService, TemplateSpec) error
	FindRuntime(context.Context, string) (string, error)
}

type updateExecutionError struct {
	Cause       error
	RollbackErr error
}

func updateReleaseFromService(service pfregistry.ManagedService) containerUpdateRelease {
	return containerUpdateRelease{
		ConfigurationJSON: service.ConfigurationJSON, ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
		DesiredState: service.DesiredState, ObservedState: service.ObservedState, RuntimeIdentity: service.RuntimeIdentity,
		RuntimeSpecSHA256: service.RuntimeSpecSHA256, ArtifactReference: service.ArtifactReference,
		ReleaseIdentityJSON: service.ReleaseIdentityJSON, ReleaseIdentitySHA256: service.ReleaseIdentitySHA256,
		RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
	}
}

func (m *Manager) releaseUpdateTarget(ctx context.Context, service *pfregistry.ManagedService, identity ReleaseIdentity, accepted map[string]int64) (pfregistry.ManagedService, *resolvedRuntime, error) {
	target := *service
	configurationJSON, configurationSHA256, err := configurationWithAcceptedNotices(service.ConfigurationJSON, accepted)
	if err != nil {
		return pfregistry.ManagedService{}, nil, err
	}
	if configurationJSON != service.ConfigurationJSON {
		target.ConfigurationRevision++
	}
	target.ConfigurationJSON, target.ConfigurationSHA256 = configurationJSON, configurationSHA256
	target.ReleaseIdentityJSON, target.ReleaseIdentitySHA256, err = canonicalReleaseIdentity(identity)
	if err != nil {
		return pfregistry.ManagedService{}, nil, err
	}
	target.RuntimeIdentity, target.ArtifactReference = "", ""
	resolved, err := m.resolveCurrentRuntime(ctx, &target)
	if err != nil {
		return pfregistry.ManagedService{}, nil, err
	}
	resolved.applyTo(&target)
	target.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
	return target, resolved, nil
}

func (m *Manager) runHostReleaseUpdate(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, accepted map[string]int64, candidate cachedReleaseCandidate, driver deploymentDriver) (runErr error) {
	if (service.DesiredState != "running" || service.ObservedState != "running") && (service.DesiredState != "stopped" || service.ObservedState != "stopped") {
		return serviceError("UPDATE_STATE_INVALID", "Stop or fully start the service before updating it.", 409, false, nil)
	}
	targetService, targetRuntime, err := m.releaseUpdateTarget(ctx, service, candidate.Identity, accepted)
	if err != nil {
		return err
	}
	if targetRuntime.Spec.Kind != DeploymentHost || targetRuntime.Spec.Host == nil || targetRuntime.Spec.Host.NPM == nil {
		return serviceError("UPDATE_UNSUPPORTED", "The selected release is not a compatible npm Host release.", 409, false, nil)
	}
	journal := containerUpdateJournal{
		Kind: managedServiceUpdateJournalKind, Phase: updatePhasePreparing,
		Old: updateReleaseFromService(*service), Target: updateReleaseFromService(targetService),
	}
	journalPersisted, committed := false, false
	defer func() {
		if runErr == nil || committed || !journalPersisted {
			return
		}
		rollbackErr := m.rollbackHostReleaseUpdate(context.Background(), service, journal, driver)
		runErr = &updateExecutionError{Cause: runErr, RollbackErr: rollbackErr}
	}()
	m.progress(op, "update_preparing", 1)
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	journalPersisted = true
	targetService.ArtifactReference = ""
	m.progress(op, "downloading", 2)
	_, artifact, err := driver.Install(ctx, &targetService, m.operationProgress(op))
	if err != nil {
		return err
	}
	if identity, identityErr := decodeReleaseIdentity(targetService.ReleaseIdentityJSON, targetService.ReleaseIdentitySHA256); identityErr != nil || !sameReleaseIdentity(*identity, candidate.Identity) {
		return serviceError("RELEASE_IDENTITY_MISMATCH", "The installed npm release no longer matches the selected candidate.", 409, true, identityErr)
	}
	targetService.ArtifactReference = artifact
	journal.Target.ArtifactReference = artifact
	journal.Target.ReleaseIdentityJSON, journal.Target.ReleaseIdentitySHA256 = targetService.ReleaseIdentityJSON, targetService.ReleaseIdentitySHA256
	journal.Phase = updatePhaseArtifactReady
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.progress(op, "stopping", 3)
	if journal.Old.DesiredState == "running" {
		if err := driver.Stop(ctx, service); err != nil {
			return err
		}
	}
	journal.Phase = updatePhaseOldStopped
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "installing", 4)
	journal.Phase = updatePhaseTargetCreating
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "starting", 5)
	runtimeID, err := m.startRuntime(ctx, &targetService, driver)
	if err != nil {
		return err
	}
	targetService.RuntimeIdentity, journal.Target.RuntimeIdentity = runtimeID, runtimeID
	journal.Phase = updatePhaseTargetCreated
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, &targetService); err != nil {
		return serviceError("HEALTH_CHECK_FAILED", "The updated managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	if journal.Old.DesiredState == "stopped" {
		if err := driver.Stop(ctx, &targetService); err != nil {
			return err
		}
	}
	journal.Phase = updatePhaseTargetVerified
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := m.commitContainerUpdate(ctx, service, journal.Target); err != nil {
		return err
	}
	committed = true
	_ = m.removeManagedHostRelease(*service, journal.Old.ArtifactReference, journal.Target.ArtifactReference)
	return nil
}

func (m *Manager) rollbackHostReleaseUpdate(ctx context.Context, service *pfregistry.ManagedService, journal containerUpdateJournal, driver deploymentDriver) error {
	target := serviceFromUpdateRelease(*service, journal.Target)
	if target.RuntimeIdentity != "" {
		_ = driver.Stop(ctx, &target)
	}
	old := serviceFromUpdateRelease(*service, journal.Old)
	if journal.Old.DesiredState == "running" && phaseAtLeast(journal.Phase, updatePhaseOldStopped) {
		resolved, err := m.resolveCurrentRuntime(ctx, &old)
		if err != nil {
			return err
		}
		resolved.applyTo(&old)
		old.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
		runtimeID, err := m.startRuntime(ctx, &old, driver)
		if err != nil {
			return err
		}
		old.RuntimeIdentity, journal.Old.RuntimeIdentity = runtimeID, runtimeID
		journal.Old.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
		if err := m.waitHealthy(ctx, &old); err != nil {
			return err
		}
	}
	if err := m.commitContainerUpdate(ctx, service, journal.Old); err != nil {
		return err
	}
	return m.removeManagedHostRelease(*service, journal.Target.ArtifactReference, journal.Old.ArtifactReference)
}

func (m *Manager) removeManagedHostRelease(service pfregistry.ManagedService, artifact, keepArtifact string) error {
	artifact = filepath.Clean(strings.TrimSpace(artifact))
	keepArtifact = filepath.Clean(strings.TrimSpace(keepArtifact))
	if artifact == "." || artifact == keepArtifact {
		return nil
	}
	releasesRoot := filepath.Join(m.stateDir, "instances", service.ServiceID, "releases")
	rel, err := filepath.Rel(releasesRoot, artifact)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil
	}
	parts := strings.Split(rel, string(filepath.Separator))
	if len(parts) < 2 || parts[0] == "" {
		return nil
	}
	return os.RemoveAll(filepath.Join(releasesRoot, parts[0]))
}

func (e *updateExecutionError) Error() string {
	if e == nil || e.Cause == nil {
		return "managed Web Service update failed"
	}
	return e.Cause.Error()
}

func (e *updateExecutionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func (m *Manager) runContainerReleaseUpdate(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, accepted map[string]int64, candidate cachedReleaseCandidate, driver containerUpdateDriver) error {
	target, resolved, err := m.releaseUpdateTarget(ctx, service, candidate.Identity, accepted)
	if err != nil {
		return err
	}
	if resolved.Spec.Kind != DeploymentContainer || resolved.Spec.Container == nil {
		return serviceError("UPDATE_NOT_AVAILABLE", "The selected release has no single-container Runtime definition.", 409, false, nil)
	}
	return m.runContainerUpdateTarget(ctx, service, op, target, resolved, driver)
}

func (m *Manager) runContainerUpdateTarget(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, targetService pfregistry.ManagedService, targetRuntime *resolvedRuntime, driver containerUpdateDriver) (runErr error) {
	if targetRuntime == nil || targetRuntime.Spec.Container == nil {
		return serviceError("UPDATE_NOT_AVAILABLE", "The selected release has no single-container Runtime definition.", 409, false, nil)
	}
	journal := containerUpdateJournal{
		Kind:   managedServiceUpdateJournalKind,
		Phase:  updatePhasePreparing,
		Old:    updateReleaseFromService(*service),
		Target: updateReleaseFromService(targetService),
	}
	if (journal.Old.DesiredState != "running" || journal.Old.ObservedState != "running") && (journal.Old.DesiredState != "stopped" || journal.Old.ObservedState != "stopped") {
		return serviceError("UPDATE_STATE_INVALID", "Stop or fully start the service before updating it.", 409, false, nil)
	}
	journalPersisted := false
	committed := false
	defer func() {
		if runErr == nil || committed || !journalPersisted {
			return
		}
		rollbackErr := m.rollbackContainerUpdate(context.Background(), service, journal, driver)
		runErr = &updateExecutionError{Cause: runErr, RollbackErr: rollbackErr}
	}()

	m.progress(op, "update_preparing", 1)
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	journalPersisted = true

	m.progress(op, "pulling", 2)
	artifact, err := driver.PrepareUpdateArtifact(ctx, targetRuntime.Spec, m.operationProgress(op))
	if err != nil {
		return err
	}
	journal.Target.ArtifactReference = artifact
	journal.Phase = updatePhaseArtifactReady
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	m.progress(op, "stopping", 3)
	if err := driver.Stop(ctx, service); err != nil {
		return err
	}
	journal.Phase = updatePhaseOldStopped
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := driver.RemoveRuntime(ctx, service); err != nil {
		return err
	}
	journal.Phase = updatePhaseOldRemoved
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}

	journal.Phase = updatePhaseTargetCreating
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "installing", 4)
	runtimeID, err := driver.CreateRuntime(ctx, &targetService, targetRuntime.Spec, artifact)
	if err != nil {
		return err
	}
	targetService.RuntimeIdentity = runtimeID
	journal.Target.RuntimeIdentity = runtimeID
	journal.Phase = updatePhaseTargetCreated
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}

	m.progress(op, "starting", 5)
	if _, err := m.startRuntime(ctx, &targetService, driver); err != nil {
		return err
	}
	m.progress(op, "health_check", 6)
	if err := m.waitHealthy(ctx, &targetService); err != nil {
		return serviceError("HEALTH_CHECK_FAILED", "The updated managed Web Service did not become healthy on its loopback port.", 502, true, err)
	}
	if journal.Old.DesiredState == "stopped" {
		if err := driver.Stop(ctx, &targetService); err != nil {
			return err
		}
	}
	journal.Phase = updatePhaseTargetVerified
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if err := m.commitContainerUpdate(ctx, service, journal.Target); err != nil {
		return err
	}
	committed = true
	return nil
}

func configurationWithAcceptedNotices(raw string, accepted map[string]int64) (string, string, error) {
	configuration, err := decodeServiceConfiguration(raw)
	if err != nil {
		return "", "", err
	}
	configuration.AcceptedNoticeRevisions = cloneNoticeRevisions(accepted)
	return canonicalServiceConfiguration(configuration)
}

func (m *Manager) writeContainerUpdateJournal(ctx context.Context, serviceID string, journal containerUpdateJournal) error {
	encoded, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	value := string(encoded)
	return m.registry.UpdateManagedService(ctx, serviceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &value})
}

func decodeContainerUpdateJournal(raw string) (containerUpdateJournal, error) {
	journal := containerUpdateJournal{}
	if err := decodeStrictJSON([]byte(raw), &journal); err != nil {
		return journal, err
	}
	if journal.Kind != managedServiceUpdateJournalKind || journal.Phase == "" || journal.Old.ConfigurationJSON == "" || journal.Target.ConfigurationJSON == "" ||
		journal.Old.ReleaseIdentityJSON == "" || journal.Old.ReleaseIdentitySHA256 == "" || journal.Target.ReleaseIdentityJSON == "" || journal.Target.ReleaseIdentitySHA256 == "" ||
		journal.Old.RuntimeBindingJSON == "" || journal.Old.RuntimeBindingSHA256 == "" || journal.Target.RuntimeBindingJSON == "" || journal.Target.RuntimeBindingSHA256 == "" ||
		(journal.Old.RuntimeSpecSHA256 != "" && !validRuntimeSpecSHA256(journal.Old.RuntimeSpecSHA256)) ||
		(journal.Target.RuntimeSpecSHA256 != "" && !validRuntimeSpecSHA256(journal.Target.RuntimeSpecSHA256)) {
		return journal, errors.New("invalid managed container update journal")
	}
	return journal, nil
}

func serviceFromUpdateRelease(base pfregistry.ManagedService, release containerUpdateRelease) pfregistry.ManagedService {
	base.ConfigurationJSON = release.ConfigurationJSON
	base.ConfigurationRevision = release.ConfigurationRevision
	base.ConfigurationSHA256 = release.ConfigurationSHA256
	base.DesiredState = release.DesiredState
	base.ObservedState = release.ObservedState
	base.RuntimeIdentity = release.RuntimeIdentity
	base.RuntimeSpecSHA256 = release.RuntimeSpecSHA256
	base.ArtifactReference = release.ArtifactReference
	base.RuntimeBindingJSON = release.RuntimeBindingJSON
	base.RuntimeBindingSHA256 = release.RuntimeBindingSHA256
	base.ReleaseIdentityJSON = release.ReleaseIdentityJSON
	base.ReleaseIdentitySHA256 = release.ReleaseIdentitySHA256
	return base
}

func (m *Manager) commitContainerUpdate(ctx context.Context, service *pfregistry.ManagedService, release containerUpdateRelease) error {
	emptyManifest, blank := "{}", ""
	patch := pfregistry.ManagedServicePatch{
		ConfigurationJSON:     &release.ConfigurationJSON,
		ConfigurationRevision: &release.ConfigurationRevision, ConfigurationSHA256: &release.ConfigurationSHA256,
		DesiredState: &release.DesiredState, ObservedState: &release.ObservedState,
		RuntimeIdentity: &release.RuntimeIdentity, RuntimeSpecSHA256: &release.RuntimeSpecSHA256, ArtifactReference: &release.ArtifactReference,
		RuntimeBindingJSON: &release.RuntimeBindingJSON, RuntimeBindingSHA256: &release.RuntimeBindingSHA256,
		ReleaseIdentityJSON: &release.ReleaseIdentityJSON, ReleaseIdentitySHA256: &release.ReleaseIdentitySHA256,
		RuntimeManifestJSON: &emptyManifest, LastErrorCode: &blank, LastErrorMessage: &blank,
	}
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, patch); err != nil {
		return err
	}
	*service = serviceFromUpdateRelease(*service, release)
	service.RuntimeManifestJSON = emptyManifest
	service.LastErrorCode, service.LastErrorMessage = "", ""
	return nil
}

func (m *Manager) rollbackContainerUpdate(ctx context.Context, service *pfregistry.ManagedService, journal containerUpdateJournal, driver containerUpdateDriver) error {
	target := serviceFromUpdateRelease(*service, journal.Target)
	if target.RuntimeIdentity == "" && phaseAtLeast(journal.Phase, updatePhaseTargetCreating) {
		identity, err := driver.FindRuntime(ctx, service.ServiceID)
		if err != nil {
			return err
		}
		target.RuntimeIdentity = identity
	}
	if target.RuntimeIdentity != "" {
		exists, _, err := m.journaledContainerRuntimeExists(ctx, &target, journal.Target.RuntimeSpecSHA256, driver)
		if err != nil {
			return err
		}
		if exists {
			if err := driver.RemoveRuntime(ctx, &target); err != nil {
				return err
			}
		}
	}

	old := serviceFromUpdateRelease(*service, journal.Old)
	oldExists, oldMatchesCurrent, err := m.journaledContainerRuntimeExists(ctx, &old, journal.Old.RuntimeSpecSHA256, driver)
	if err != nil {
		return err
	}
	needsRebuild := !oldExists || (!oldMatchesCurrent && journal.Old.DesiredState == "running" && phaseAtLeast(journal.Phase, updatePhaseOldStopped))
	if needsRebuild {
		if old.ArtifactReference == "" {
			return errors.New("the previous container artifact is unavailable")
		}
		if oldExists {
			if err := driver.RemoveRuntime(ctx, &old); err != nil {
				return err
			}
		}
		resolvedOld, err := m.resolveCurrentRuntime(ctx, &old)
		if err != nil {
			return err
		}
		resolvedOld.applyTo(&old)
		old.RuntimeIdentity = ""
		runtimeID, err := driver.CreateRuntime(ctx, &old, resolvedOld.Spec, old.ArtifactReference)
		if err != nil {
			return err
		}
		old.RuntimeIdentity = runtimeID
		old.RuntimeSpecSHA256 = resolvedOld.RuntimeSpecSHA256
		journal.Old.RuntimeIdentity = runtimeID
		journal.Old.RuntimeSpecSHA256 = resolvedOld.RuntimeSpecSHA256
	}
	if journal.Old.DesiredState == "running" {
		if oldMatchesCurrent || needsRebuild {
			if _, err := m.startRuntime(ctx, &old, driver); err != nil {
				return err
			}
			if err := m.waitHealthy(ctx, &old); err != nil {
				return err
			}
		}
	} else if err := driver.Stop(ctx, &old); err != nil {
		return err
	}
	journal.Old.RuntimeIdentity = old.RuntimeIdentity
	return m.commitContainerUpdate(ctx, service, journal.Old)
}

func (m *Manager) journaledContainerRuntimeExists(ctx context.Context, service *pfregistry.ManagedService, runtimeSpecSHA256 string, driver containerUpdateDriver) (bool, bool, error) {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return false, false, nil
	}
	resolved, resolveErr := m.resolveCurrentRuntime(ctx, service)
	if resolveErr == nil && resolved.RuntimeSpecSHA256 == runtimeSpecSHA256 {
		resolved.applyTo(service)
		if err := driver.VerifyRuntime(ctx, service, resolved.Spec); err != nil {
			if code, _, _, _ := ErrorDetails(err); code == "CONTAINER_IDENTITY_MISSING" {
				return false, true, nil
			}
			return false, true, err
		}
		return true, true, nil
	}
	found, err := driver.FindRuntime(ctx, service.ServiceID)
	if err != nil {
		return false, false, err
	}
	if found == "" {
		return false, false, nil
	}
	if found != service.RuntimeIdentity {
		return false, false, errors.New("the journaled managed container identity is unavailable")
	}
	return true, false, nil
}

func phaseAtLeast(actual, expected string) bool {
	order := map[string]int{
		updatePhasePreparing: 1, updatePhaseArtifactReady: 2, updatePhaseOldStopped: 3, updatePhaseOldRemoved: 4,
		updatePhaseTargetCreating: 5, updatePhaseTargetCreated: 6, updatePhaseTargetVerified: 7,
	}
	return order[actual] >= order[expected]
}

func (m *Manager) recoverInterruptedContainerUpdate(service *pfregistry.ManagedService, operation *pfregistry.ManagedOperation, driver containerUpdateDriver) error {
	journal, err := decodeContainerUpdateJournal(service.RuntimeManifestJSON)
	if err != nil {
		return serviceError("UPDATE_JOURNAL_INVALID", "The interrupted update journal is invalid; Redeven will not guess which runtime is authoritative.", 409, false, err)
	}
	if journal.Phase == updatePhaseTargetVerified {
		if !validRuntimeSpecSHA256(journal.Target.RuntimeSpecSHA256) {
			return serviceError("UPDATE_JOURNAL_INVALID", "The verified update journal has no valid runtime digest.", 409, false, nil)
		}
		target := serviceFromUpdateRelease(*service, journal.Target)
		if target.RuntimeIdentity == "" {
			target.RuntimeIdentity, err = driver.FindRuntime(context.Background(), service.ServiceID)
			if err != nil {
				return err
			}
		}
		exists, matchesCurrent, specErr := m.journaledContainerRuntimeExists(context.Background(), &target, journal.Target.RuntimeSpecSHA256, driver)
		if specErr == nil && !exists {
			specErr = errors.New("the verified updated runtime identity is unavailable")
		}
		if specErr == nil {
			if journal.Old.DesiredState == "running" && matchesCurrent {
				_, specErr = m.startRuntime(context.Background(), &target, driver)
			} else {
				if journal.Old.DesiredState == "stopped" {
					specErr = driver.Stop(context.Background(), &target)
				}
			}
		}
		if specErr == nil {
			journal.Target.RuntimeIdentity = target.RuntimeIdentity
			if err := m.commitContainerUpdate(context.Background(), service, journal.Target); err != nil {
				return err
			}
			operation.State, operation.Stage = "succeeded", "completed"
			operation.ProgressCurrent = operation.ProgressTotal
			operation.FinishedAtUnixMs = time.Now().UnixMilli()
			blank := ""
			return m.registry.FinalizeManagedOperation(context.Background(), *operation, pfregistry.ManagedServicePatch{LastErrorCode: &blank, LastErrorMessage: &blank})
		}
		m.log.Warn("finalize verified interrupted managed Web Service update", "service_id", service.ServiceID, "operation_id", operation.OperationID, "cause", safeManagedFailureCause(specErr))
	}
	if err := m.rollbackContainerUpdate(context.Background(), service, journal, driver); err != nil {
		return fmt.Errorf("rollback interrupted update: %w", err)
	}
	return nil
}

func (m *Manager) recoverInterruptedHostUpdate(service *pfregistry.ManagedService, operation *pfregistry.ManagedOperation, driver deploymentDriver) error {
	journal, err := decodeContainerUpdateJournal(service.RuntimeManifestJSON)
	if err != nil {
		return serviceError("UPDATE_JOURNAL_INVALID", "The interrupted update journal is invalid; Redeven will not guess which runtime is authoritative.", 409, false, err)
	}
	if journal.Kind != managedServiceUpdateJournalKind {
		return serviceError("UPDATE_JOURNAL_INVALID", "The interrupted Host update does not use the supported update journal.", 409, false, nil)
	}
	if journal.Phase == updatePhaseTargetVerified {
		target := serviceFromUpdateRelease(*service, journal.Target)
		resolved, resolveErr := m.resolveCurrentRuntime(context.Background(), &target)
		if resolveErr != nil {
			return resolveErr
		}
		resolved.applyTo(&target)
		target.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
		journal.Target.RuntimeSpecSHA256 = resolved.RuntimeSpecSHA256
		// The staged target identity was never committed, so it cannot authorize
		// restart adoption. Start that exact release afresh and verify it before
		// making the journal target authoritative.
		target.RuntimeIdentity = ""
		runtimeID, startErr := m.startRuntime(context.Background(), &target, driver)
		if startErr == nil {
			target.RuntimeIdentity = runtimeID
			startErr = m.waitHealthy(context.Background(), &target)
		}
		if startErr == nil && journal.Old.DesiredState == "stopped" {
			startErr = driver.Stop(context.Background(), &target)
		}
		if startErr == nil {
			journal.Target.RuntimeIdentity = runtimeID
			if journal.Old.DesiredState == "stopped" {
				journal.Target.RuntimeIdentity = ""
			}
			if err := m.commitContainerUpdate(context.Background(), service, journal.Target); err != nil {
				return err
			}
			operation.State, operation.Stage = "succeeded", "completed"
			operation.ProgressCurrent = operation.ProgressTotal
			operation.FinishedAtUnixMs = time.Now().UnixMilli()
			blank := ""
			if err := m.registry.FinalizeManagedOperation(context.Background(), *operation, pfregistry.ManagedServicePatch{LastErrorCode: &blank, LastErrorMessage: &blank}); err != nil {
				return err
			}
			return m.removeManagedHostRelease(*service, journal.Old.ArtifactReference, journal.Target.ArtifactReference)
		}
		m.log.Warn("finalize verified interrupted managed Web Service Host update", "service_id", service.ServiceID, "operation_id", operation.OperationID, "cause", safeManagedFailureCause(startErr))
	}
	if err := m.rollbackHostReleaseUpdate(context.Background(), service, journal, driver); err != nil {
		return fmt.Errorf("rollback interrupted Host update: %w", err)
	}
	return nil
}

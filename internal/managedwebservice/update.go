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
	TemplateRevision       int64  `json:"template_revision"`
	TemplateSnapshotJSON   string `json:"template_snapshot_json"`
	TemplateSnapshotSHA256 string `json:"template_snapshot_sha256"`
	ConfigurationJSON      string `json:"configuration_json"`
	ConfigurationRevision  int64  `json:"configuration_revision"`
	ConfigurationSHA256    string `json:"configuration_sha256"`
	DesiredState           string `json:"desired_state"`
	ObservedState          string `json:"observed_state"`
	RuntimeIdentity        string `json:"runtime_identity,omitempty"`
	ArtifactReference      string `json:"artifact_reference,omitempty"`
	ReleaseIdentityJSON    string `json:"release_identity_json,omitempty"`
	ReleaseIdentitySHA256  string `json:"release_identity_sha256,omitempty"`
	RuntimeBindingJSON     string `json:"runtime_binding_json"`
	RuntimeBindingSHA256   string `json:"runtime_binding_sha256"`
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

func (m *Manager) runHostReleaseUpdate(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, accepted map[string]int64, candidate cachedReleaseCandidate, driver deploymentDriver) (runErr error) {
	if candidate.Spec.Kind != DeploymentHost || candidate.Spec.Host == nil || candidate.Spec.Host.NPM == nil {
		return serviceError("UPDATE_UNSUPPORTED", "The selected release is not a compatible npm Host release.", 409, false, nil)
	}
	if (service.DesiredState != "running" || service.ObservedState != "running") && (service.DesiredState != "stopped" || service.ObservedState != "stopped") {
		return serviceError("UPDATE_STATE_INVALID", "Stop or fully start the service before updating it.", 409, false, nil)
	}
	targetSnapshotJSON, targetSnapshotHash, err := canonicalTemplateSpec(candidate.Spec)
	if err != nil {
		return err
	}
	targetReleaseJSON, targetReleaseHash, err := canonicalReleaseIdentity(candidate.Identity)
	if err != nil {
		return err
	}
	targetConfiguration, targetConfigurationHash, err := configurationWithAcceptedNotices(service.ConfigurationJSON, accepted)
	if err != nil {
		return err
	}
	targetConfigurationRevision := service.ConfigurationRevision
	if targetConfiguration != service.ConfigurationJSON {
		targetConfigurationRevision++
	}
	journal := containerUpdateJournal{
		Kind: managedServiceUpdateJournalKind, Phase: updatePhasePreparing,
		Old: containerUpdateRelease{
			TemplateRevision: service.TemplateRevision, TemplateSnapshotJSON: service.TemplateSnapshotJSON, TemplateSnapshotSHA256: service.TemplateSnapshotSHA256,
			ConfigurationJSON: service.ConfigurationJSON, ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState, RuntimeIdentity: service.RuntimeIdentity,
			ArtifactReference: service.ArtifactReference, ReleaseIdentityJSON: service.ReleaseIdentityJSON, ReleaseIdentitySHA256: service.ReleaseIdentitySHA256,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
		Target: containerUpdateRelease{
			TemplateRevision: candidate.TemplateRevision, TemplateSnapshotJSON: targetSnapshotJSON, TemplateSnapshotSHA256: targetSnapshotHash,
			ConfigurationJSON: targetConfiguration, ConfigurationRevision: targetConfigurationRevision, ConfigurationSHA256: targetConfigurationHash,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState,
			ReleaseIdentityJSON: targetReleaseJSON, ReleaseIdentitySHA256: targetReleaseHash,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
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
	targetService := serviceFromUpdateRelease(*service, journal.Target)
	targetService.RuntimeIdentity, targetService.ArtifactReference = "", ""
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
		runtimeID, err := m.startRuntime(ctx, &old, driver)
		if err != nil {
			return err
		}
		old.RuntimeIdentity, journal.Old.RuntimeIdentity = runtimeID, runtimeID
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
	target := Template{TemplateID: service.TemplateID, Source: service.TemplateSource, Deployment: DeploymentContainer, Revision: candidate.TemplateRevision, ServiceFamilyID: service.ServiceFamilyID, Spec: &candidate.Spec}
	return m.runContainerUpdateTarget(ctx, service, op, target, candidate.Identity, accepted, true, driver)
}

func (m *Manager) runContainerUpdateTarget(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, target Template, identity ReleaseIdentity, accepted map[string]int64, updateNotices bool, driver containerUpdateDriver) (runErr error) {
	if target.Spec == nil || target.Spec.Container == nil {
		return serviceError("UPDATE_NOT_AVAILABLE", "The selected release has no single-container Runtime definition.", 409, false, nil)
	}
	targetConfiguration, targetConfigurationHash := service.ConfigurationJSON, service.ConfigurationSHA256
	targetConfigurationRevision := service.ConfigurationRevision
	var err error
	if updateNotices {
		targetConfiguration, targetConfigurationHash, err = configurationWithAcceptedNotices(service.ConfigurationJSON, accepted)
		targetConfigurationRevision++
	}
	if err != nil {
		return err
	}
	targetReleaseJSON, targetReleaseHash, err := canonicalReleaseIdentity(identity)
	if err != nil {
		return err
	}
	targetSnapshotJSON, targetSnapshotHash, err := canonicalTemplateSpec(*target.Spec)
	if err != nil {
		return err
	}
	journal := containerUpdateJournal{
		Kind:  managedServiceUpdateJournalKind,
		Phase: updatePhasePreparing,
		Old: containerUpdateRelease{
			TemplateRevision: service.TemplateRevision, TemplateSnapshotJSON: service.TemplateSnapshotJSON,
			TemplateSnapshotSHA256: service.TemplateSnapshotSHA256, ConfigurationJSON: service.ConfigurationJSON,
			ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState,
			RuntimeIdentity: service.RuntimeIdentity, ArtifactReference: service.ArtifactReference,
			ReleaseIdentityJSON: service.ReleaseIdentityJSON, ReleaseIdentitySHA256: service.ReleaseIdentitySHA256,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
		Target: containerUpdateRelease{
			TemplateRevision: target.Revision, TemplateSnapshotJSON: targetSnapshotJSON, TemplateSnapshotSHA256: targetSnapshotHash,
			ConfigurationJSON: targetConfiguration, ConfigurationRevision: targetConfigurationRevision, ConfigurationSHA256: targetConfigurationHash,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
			ReleaseIdentityJSON: targetReleaseJSON, ReleaseIdentitySHA256: targetReleaseHash,
		},
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
	artifact, err := driver.PrepareUpdateArtifact(ctx, *target.Spec, m.operationProgress(op))
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

	targetService := serviceFromUpdateRelease(*service, journal.Target)
	targetEffectiveSpec, _, err := effectiveSpecFromService(&targetService)
	if err != nil {
		return serviceError("TEMPLATE_UPDATE_CONFIGURATION_CONFLICT", "The saved service overrides conflict with the updated template. Review service settings before updating.", 409, false, err)
	}
	journal.Phase = updatePhaseTargetCreating
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	m.progress(op, "installing", 4)
	runtimeID, err := driver.CreateRuntime(ctx, &targetService, targetEffectiveSpec, artifact)
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

func (m *Manager) runComposeTemplateUpdate(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, candidate cachedReleaseCandidate, driver deploymentDriver) (runErr error) {
	runtimeDriver, ok := driver.(reconfigureRuntimeDriver)
	if !ok || candidate.Spec.Kind != DeploymentCompose || candidate.Spec.Compose == nil || candidate.Identity.Kind != "none" {
		return serviceError("UPDATE_UNSUPPORTED", "This Compose template update cannot be applied by the current Runtime.", 409, false, nil)
	}
	if (service.DesiredState != "running" || service.ObservedState != "running") && (service.DesiredState != "stopped" || service.ObservedState != "stopped") {
		return serviceError("UPDATE_STATE_INVALID", "Stop or fully start the service before updating it.", 409, false, nil)
	}
	targetSnapshotJSON, targetSnapshotHash, err := canonicalTemplateSpec(candidate.Spec)
	if err != nil {
		return err
	}
	targetReleaseJSON, targetReleaseHash, err := canonicalReleaseIdentity(candidate.Identity)
	if err != nil {
		return err
	}
	journal := containerUpdateJournal{
		Kind: managedServiceUpdateJournalKind, Phase: updatePhasePreparing,
		Old: containerUpdateRelease{
			TemplateRevision: service.TemplateRevision, TemplateSnapshotJSON: service.TemplateSnapshotJSON, TemplateSnapshotSHA256: service.TemplateSnapshotSHA256,
			ConfigurationJSON: service.ConfigurationJSON, ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState, RuntimeIdentity: service.RuntimeIdentity, ArtifactReference: service.ArtifactReference,
			ReleaseIdentityJSON: service.ReleaseIdentityJSON, ReleaseIdentitySHA256: service.ReleaseIdentitySHA256, RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
		Target: containerUpdateRelease{
			TemplateRevision: candidate.TemplateRevision, TemplateSnapshotJSON: targetSnapshotJSON, TemplateSnapshotSHA256: targetSnapshotHash,
			ConfigurationJSON: service.ConfigurationJSON, ConfigurationRevision: service.ConfigurationRevision, ConfigurationSHA256: service.ConfigurationSHA256,
			DesiredState: service.DesiredState, ObservedState: service.ObservedState, ReleaseIdentityJSON: targetReleaseJSON, ReleaseIdentitySHA256: targetReleaseHash,
			RuntimeBindingJSON: service.RuntimeBindingJSON, RuntimeBindingSHA256: service.RuntimeBindingSHA256,
		},
	}
	journalPersisted, committed := false, false
	defer func() {
		if runErr == nil || committed || !journalPersisted {
			return
		}
		rollbackErr := m.rollbackComposeTemplateUpdate(context.Background(), service, journal, runtimeDriver)
		runErr = &updateExecutionError{Cause: runErr, RollbackErr: rollbackErr}
	}()
	m.progress(op, "update_preparing", 1)
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	journalPersisted = true
	oldSpec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return err
	}
	if service.RuntimeIdentity != "" {
		if err := runtimeDriver.VerifyRuntime(ctx, service, oldSpec); err != nil {
			return err
		}
		if service.DesiredState == "running" {
			m.progress(op, "stopping", 2)
			if err := driver.Stop(ctx, service); err != nil {
				return err
			}
		}
		if err := runtimeDriver.RemoveRuntime(ctx, service); err != nil {
			return err
		}
	}
	journal.Phase = updatePhaseOldRemoved
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	target := serviceFromUpdateRelease(*service, journal.Target)
	target.RuntimeIdentity = ""
	m.progress(op, "installing", 4)
	runtimeID, artifact, err := runtimeDriver.RebuildStoppedRuntime(ctx, &target, candidate.Spec, service.ArtifactReference)
	if err != nil {
		return err
	}
	target.RuntimeIdentity, target.ArtifactReference = runtimeID, artifact
	journal.Target.RuntimeIdentity, journal.Target.ArtifactReference = runtimeID, artifact
	journal.Phase = updatePhaseTargetCreated
	if err := m.writeContainerUpdateJournal(ctx, service.ServiceID, journal); err != nil {
		return err
	}
	if journal.Old.DesiredState == "running" {
		m.progress(op, "starting", 5)
		if runtimeID, err = m.startRuntime(ctx, &target, driver); err != nil {
			return err
		}
		target.RuntimeIdentity, journal.Target.RuntimeIdentity = runtimeID, runtimeID
		if err := m.waitHealthy(ctx, &target); err != nil {
			return err
		}
	}
	m.progress(op, "verifying", 6)
	if err := runtimeDriver.VerifyRuntime(ctx, &target, candidate.Spec); err != nil {
		return err
	}
	if err := m.commitContainerUpdate(ctx, service, journal.Target); err != nil {
		return err
	}
	committed = true
	return nil
}

func (m *Manager) rollbackComposeTemplateUpdate(ctx context.Context, service *pfregistry.ManagedService, journal containerUpdateJournal, driver reconfigureRuntimeDriver) error {
	target := serviceFromUpdateRelease(*service, journal.Target)
	if target.RuntimeIdentity != "" {
		_ = driver.RemoveRuntime(ctx, &target)
	}
	old := serviceFromUpdateRelease(*service, journal.Old)
	old.RuntimeIdentity = ""
	oldSpec, _, err := effectiveSpecFromService(&old)
	if err != nil {
		return err
	}
	runtimeID, artifact, err := driver.RebuildStoppedRuntime(ctx, &old, oldSpec, journal.Old.ArtifactReference)
	if err != nil {
		return err
	}
	journal.Old.RuntimeIdentity, journal.Old.ArtifactReference = runtimeID, artifact
	old.RuntimeIdentity, old.ArtifactReference = runtimeID, artifact
	if journal.Old.DesiredState == "running" {
		runtimeID, err = m.startRuntime(ctx, &old, driver)
		if err != nil {
			return err
		}
		journal.Old.RuntimeIdentity = runtimeID
	}
	return m.commitContainerUpdate(ctx, service, journal.Old)
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
	if journal.Kind != managedServiceUpdateJournalKind || journal.Phase == "" || journal.Old.TemplateSnapshotJSON == "" || journal.Target.TemplateSnapshotJSON == "" ||
		journal.Old.RuntimeBindingJSON == "" || journal.Old.RuntimeBindingSHA256 == "" || journal.Target.RuntimeBindingJSON == "" || journal.Target.RuntimeBindingSHA256 == "" {
		return journal, errors.New("invalid managed container update journal")
	}
	return journal, nil
}

func serviceFromUpdateRelease(base pfregistry.ManagedService, release containerUpdateRelease) pfregistry.ManagedService {
	base.TemplateRevision = release.TemplateRevision
	base.TemplateSnapshotJSON = release.TemplateSnapshotJSON
	base.TemplateSnapshotSHA256 = release.TemplateSnapshotSHA256
	base.ConfigurationJSON = release.ConfigurationJSON
	base.ConfigurationRevision = release.ConfigurationRevision
	base.ConfigurationSHA256 = release.ConfigurationSHA256
	base.DesiredState = release.DesiredState
	base.ObservedState = release.ObservedState
	base.RuntimeIdentity = release.RuntimeIdentity
	base.ArtifactReference = release.ArtifactReference
	base.RuntimeBindingJSON = release.RuntimeBindingJSON
	base.RuntimeBindingSHA256 = release.RuntimeBindingSHA256
	if release.ReleaseIdentityJSON != "" {
		base.ReleaseIdentityJSON = release.ReleaseIdentityJSON
		base.ReleaseIdentitySHA256 = release.ReleaseIdentitySHA256
	}
	return base
}

func (m *Manager) commitContainerUpdate(ctx context.Context, service *pfregistry.ManagedService, release containerUpdateRelease) error {
	emptyManifest, blank := "{}", ""
	patch := pfregistry.ManagedServicePatch{
		TemplateRevision: &release.TemplateRevision, TemplateSnapshotJSON: &release.TemplateSnapshotJSON,
		TemplateSnapshotSHA256: &release.TemplateSnapshotSHA256, ConfigurationJSON: &release.ConfigurationJSON,
		ConfigurationRevision: &release.ConfigurationRevision, ConfigurationSHA256: &release.ConfigurationSHA256,
		DesiredState: &release.DesiredState, ObservedState: &release.ObservedState,
		RuntimeIdentity: &release.RuntimeIdentity, ArtifactReference: &release.ArtifactReference,
		RuntimeBindingJSON: &release.RuntimeBindingJSON, RuntimeBindingSHA256: &release.RuntimeBindingSHA256,
		RuntimeManifestJSON: &emptyManifest, LastErrorCode: &blank, LastErrorMessage: &blank,
	}
	if release.ReleaseIdentityJSON != "" {
		patch.ReleaseIdentityJSON, patch.ReleaseIdentitySHA256 = &release.ReleaseIdentityJSON, &release.ReleaseIdentitySHA256
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
		targetSpec, _, err := effectiveSpecFromService(&target)
		if err != nil {
			return err
		}
		if err := driver.VerifyRuntime(ctx, &target, targetSpec); err != nil {
			return err
		}
		if err := driver.RemoveRuntime(ctx, &target); err != nil {
			return err
		}
	}

	old := serviceFromUpdateRelease(*service, journal.Old)
	oldSpec, _, err := effectiveSpecFromService(&old)
	if err != nil {
		return err
	}
	oldExists := false
	if old.RuntimeIdentity != "" {
		if err := driver.VerifyRuntime(ctx, &old, oldSpec); err == nil {
			oldExists = true
		} else if code, _, _, _ := ErrorDetails(err); code != "CONTAINER_IDENTITY_MISSING" {
			return err
		}
	}
	if !oldExists {
		if old.ArtifactReference == "" {
			return errors.New("the previous container artifact is unavailable")
		}
		old.RuntimeIdentity = ""
		runtimeID, err := driver.CreateRuntime(ctx, &old, oldSpec, old.ArtifactReference)
		if err != nil {
			return err
		}
		old.RuntimeIdentity = runtimeID
		journal.Old.RuntimeIdentity = runtimeID
	}
	if journal.Old.DesiredState == "running" {
		if _, err := m.startRuntime(ctx, &old, driver); err != nil {
			return err
		}
		if err := m.waitHealthy(ctx, &old); err != nil {
			return err
		}
	} else if err := driver.Stop(ctx, &old); err != nil {
		return err
	}
	journal.Old.RuntimeIdentity = old.RuntimeIdentity
	return m.commitContainerUpdate(ctx, service, journal.Old)
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
		target := serviceFromUpdateRelease(*service, journal.Target)
		if target.RuntimeIdentity == "" {
			target.RuntimeIdentity, err = driver.FindRuntime(context.Background(), service.ServiceID)
			if err != nil {
				return err
			}
		}
		spec, _, specErr := effectiveSpecFromService(&target)
		if specErr == nil {
			specErr = driver.VerifyRuntime(context.Background(), &target, spec)
		}
		if specErr == nil {
			if journal.Old.DesiredState == "running" {
				_, specErr = m.startRuntime(context.Background(), &target, driver)
			} else {
				specErr = driver.Stop(context.Background(), &target)
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

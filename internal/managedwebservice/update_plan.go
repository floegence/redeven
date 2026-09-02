package managedwebservice

import (
	"context"
	"errors"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	updatePlanSchemaVersion = 1
	updatePlanTTL           = 15 * time.Minute

	releaseRiskNonRecommended = "non_recommended_release"
	releaseRiskNonDefault     = "non_default_release"
	releaseRiskDeprecated     = "deprecated_release"
	releaseRiskUnknownOrder   = "version_order_unknown"
	releaseRiskTagMoved       = "tag_digest_moved"
)

type cachedUpdatePlan struct {
	Plan                UpdatePlan
	ServiceID           string
	TemplateID          string
	TemplateSource      string
	SelectedCandidateID string
	Release             cachedReleaseCandidate
	ExpiresAt           time.Time
}

func (m *Manager) CreateUpdatePlan(ctx context.Context, serviceID string, request UpdatePlanRequest) (*UpdatePlan, error) {
	service, err := m.registry.GetManagedService(ctx, strings.TrimSpace(serviceID))
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The managed Web Service was not found.", 404, false, nil)
	}
	current, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil {
		return nil, serviceError("RELEASE_IDENTITY_INVALID", "The managed Web Service release identity is invalid.", 409, false, err)
	}
	targetTemplate, err := m.Template(ctx, service.TemplateID)
	if err != nil {
		return nil, err
	}
	if targetTemplate.Source != service.TemplateSource || targetTemplate.Deployment != Deployment(service.Deployment) || targetTemplate.ServiceFamilyID != service.ServiceFamilyID || targetTemplate.Spec == nil {
		return nil, serviceError("UPDATE_TEMPLATE_INCOMPATIBLE", "The current template no longer matches this managed Web Service.", 409, false, nil)
	}
	if !targetTemplate.Available {
		return nil, serviceError(targetTemplate.ReasonCode, targetTemplate.Reason, 409, true, nil)
	}

	selectedCandidateID := strings.TrimSpace(request.TargetCandidateID)
	targetIdentity := *current
	var selected *cachedReleaseCandidate
	if selectedCandidateID != "" {
		parameters, parameterErr := m.serviceParameters(service)
		if parameterErr != nil {
			return nil, parameterErr
		}
		selected, err = m.resolveReleaseCandidate(ctx, "service:"+service.ServiceID, selectedCandidateID, parameters, current, service.TemplateSource)
		if err != nil {
			return nil, err
		}
		targetIdentity = selected.Identity
	}
	targetSpec, err := materializeReleaseSpec(*targetTemplate.Spec, targetIdentity)
	if err != nil {
		return nil, err
	}
	releaseChanged := !sameReleaseIdentity(*current, targetIdentity)
	if !releaseChanged && targetTemplate.Revision == service.TemplateRevision {
		return nil, serviceError("UPDATE_NOT_REQUIRED", "The selected release and template revision are already installed.", 409, false, nil)
	}

	relation := releaseRelation(current, targetIdentity)
	requiredRisks := updatePlanRisks(*targetTemplate, selected, current, targetIdentity, releaseChanged, relation)
	requiresStopped := releaseChanged && (relation == "older" || relation == "unknown")
	id, err := randomID("upl")
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(updatePlanTTL)
	plan := UpdatePlan{
		SchemaVersion: updatePlanSchemaVersion, UpdatePlanID: id, CurrentRelease: *current, TargetRelease: targetIdentity,
		CurrentTemplateRevision: service.TemplateRevision, TargetTemplateRevision: targetTemplate.Revision,
		Notices: append([]TemplateNotice(nil), targetTemplate.Notices...), RequiredRiskIDs: requiredRisks,
		RequiresStopped: requiresStopped, ExpiresAtUnixMs: expiresAt.UnixMilli(),
	}
	release := cachedReleaseCandidate{
		Scope: "service:" + service.ServiceID, TemplateID: service.TemplateID, TemplateRevision: targetTemplate.Revision,
		Notices: append([]TemplateNotice(nil), targetTemplate.Notices...), Identity: targetIdentity, Spec: targetSpec, ExpiresAt: expiresAt,
	}
	if selected != nil {
		release.Candidate = selected.Candidate
	}
	cached := cachedUpdatePlan{Plan: plan, ServiceID: service.ServiceID, TemplateID: service.TemplateID, TemplateSource: service.TemplateSource, SelectedCandidateID: selectedCandidateID, Release: release, ExpiresAt: expiresAt}
	m.releaseMu.Lock()
	for key, existing := range m.updatePlans {
		if existing.ServiceID == service.ServiceID || time.Now().After(existing.ExpiresAt) {
			delete(m.updatePlans, key)
		}
	}
	m.updatePlans[id] = cached
	m.releaseMu.Unlock()
	return &plan, nil
}

func materializeReleaseSpec(base TemplateSpec, identity ReleaseIdentity) (TemplateSpec, error) {
	target := cloneTemplateSpec(base)
	switch target.Kind {
	case DeploymentHost:
		if target.Host == nil || target.Host.NPM == nil || identity.Kind != "npm" || identity.Source != target.Host.NPM.PackageName || identity.Registry != normalizedRegistryURL(target.Host.NPM.RegistryURL) || strings.TrimSpace(identity.Version) == "" {
			return TemplateSpec{}, serviceError("RELEASE_TEMPLATE_INCOMPATIBLE", "The selected npm release does not belong to this template source.", 409, false, nil)
		}
		target.Host.NPM.Version = identity.Version
	case DeploymentContainer:
		if target.Container == nil || identity.Kind != "oci" || identity.Source != releaseImageRepository(target.Container.Image) || strings.TrimSpace(identity.Tag) == "" || !strings.HasPrefix(identity.Digest, "sha256:") {
			return TemplateSpec{}, serviceError("RELEASE_TEMPLATE_INCOMPATIBLE", "The selected container release does not belong to this template source.", 409, false, nil)
		}
		target.Container.Image = identity.Source + ":" + identity.Tag + "@" + identity.Digest
	case DeploymentCompose:
		if identity.Kind != "none" {
			return TemplateSpec{}, serviceError("RELEASE_DISCOVERY_UNSUPPORTED", "Compose templates do not support single-release selection.", 409, false, nil)
		}
	default:
		return TemplateSpec{}, serviceError("DEPLOYMENT_INVALID", "The managed Web Service deployment is invalid.", 409, false, nil)
	}
	if err := validateTemplateSpec(target); err != nil {
		return TemplateSpec{}, err
	}
	return target, nil
}

func updatePlanRisks(template Template, selected *cachedReleaseCandidate, current *ReleaseIdentity, target ReleaseIdentity, releaseChanged bool, relation string) []string {
	required := []string{}
	if releaseChanged {
		if template.RecommendedRelease == nil || !sameReleaseSelection(*template.RecommendedRelease, target) {
			if template.Source == "builtin" {
				required = append(required, releaseRiskNonRecommended)
			} else {
				required = append(required, releaseRiskNonDefault)
			}
		}
		if selected != nil {
			if selected.Candidate.Channel == "preview" {
				required = append(required, releaseRiskPreview)
			}
			if selected.Candidate.Channel == "special" {
				required = append(required, releaseRiskUnknownOrder)
			}
			if selected.Candidate.Deprecated {
				required = append(required, releaseRiskDeprecated)
			}
			if selected.Candidate.TagMoved {
				required = append(required, releaseRiskTagMoved)
			}
		}
		if relation == "older" {
			required = append(required, releaseRiskDowngrade)
		} else if relation == "unknown" && current != nil {
			required = append(required, releaseRiskUnknownOrder)
		}
	}
	if target.Kind == "npm" {
		required = append(required, releaseRiskNPMScripts)
	}
	return uniqueStrings(required)
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (m *Manager) resolveUpdatePlan(ctx context.Context, service *pfregistry.ManagedService, planID string, acceptedRisks []string) (*cachedUpdatePlan, error) {
	planID = strings.TrimSpace(planID)
	if planID == "" {
		return nil, serviceError("UPDATE_PLAN_REQUIRED", "Create and review an update plan before updating this managed Web Service.", 409, false, nil)
	}
	m.releaseMu.Lock()
	cached, ok := m.updatePlans[planID]
	m.releaseMu.Unlock()
	if !ok || cached.ServiceID != service.ServiceID || time.Now().After(cached.ExpiresAt) {
		return nil, serviceError("UPDATE_PLAN_EXPIRED", "The update plan expired. Review the current versions again.", 409, true, nil)
	}
	current, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil || !sameReleaseIdentity(*current, cached.Plan.CurrentRelease) || service.TemplateRevision != cached.Plan.CurrentTemplateRevision {
		return nil, serviceError("UPDATE_PLAN_STALE", "The managed Web Service changed after this update plan was created.", 409, true, err)
	}
	template, err := m.Template(ctx, service.TemplateID)
	if err != nil {
		return nil, err
	}
	if template.Revision != cached.Plan.TargetTemplateRevision || template.Spec == nil {
		return nil, serviceError("UPDATE_PLAN_STALE", "The service template changed after this update plan was created.", 409, true, nil)
	}
	targetIdentity := cached.Plan.TargetRelease
	if cached.SelectedCandidateID != "" {
		parameters, parameterErr := m.serviceParameters(service)
		if parameterErr != nil {
			return nil, parameterErr
		}
		fresh, freshErr := m.resolveReleaseCandidate(ctx, "service:"+service.ServiceID, cached.SelectedCandidateID, parameters, current, service.TemplateSource)
		if freshErr != nil {
			return nil, freshErr
		}
		if !sameReleaseIdentity(fresh.Identity, targetIdentity) {
			return nil, serviceError("UPDATE_PLAN_STALE", "The selected release changed after this update plan was created.", 409, true, nil)
		}
	}
	targetSpec, err := materializeReleaseSpec(*template.Spec, targetIdentity)
	if err != nil {
		return nil, err
	}
	accepted := map[string]struct{}{}
	for _, risk := range acceptedRisks {
		accepted[strings.TrimSpace(risk)] = struct{}{}
	}
	for _, risk := range cached.Plan.RequiredRiskIDs {
		if _, ok := accepted[risk]; !ok {
			return nil, serviceError("RELEASE_RISK_ACKNOWLEDGEMENT_REQUIRED", "Accept every release safety warning before continuing.", 409, false, nil)
		}
	}
	if cached.Plan.RequiresStopped && (service.DesiredState != "stopped" || service.ObservedState != "stopped") {
		return nil, serviceError("UPDATE_REQUIRES_STOPPED", "Stop the service before applying a downgrade or a release with unknown version order.", 409, false, nil)
	}
	cached.Release.Spec = targetSpec
	cached.Release.Identity = targetIdentity
	cached.Release.TemplateRevision = template.Revision
	cached.Release.Notices = append([]TemplateNotice(nil), template.Notices...)
	return &cached, nil
}

func (m *Manager) consumeUpdatePlan(planID string) {
	m.releaseMu.Lock()
	delete(m.updatePlans, strings.TrimSpace(planID))
	m.releaseMu.Unlock()
}

func updatePlanErrorCode(err error) string {
	var managed *Error
	if errors.As(err, &managed) {
		return managed.Code
	}
	return ""
}

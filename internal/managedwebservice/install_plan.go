package managedwebservice

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"time"
)

type InstallPlan struct {
	PlanDigest         string `json:"plan_digest"`
	ServiceID          string `json:"service_id"`
	WorkspacePath      string `json:"workspace_path"`
	WorkspaceOwnership string `json:"workspace_ownership"`
	ExpiresAtUnixMs    int64  `json:"expires_at_unix_ms"`
}
type cachedInstallPlan struct {
	Plan                        InstallPlan
	Fingerprint, TemplateDigest string
	Workspace                   ServiceResourceFact
}
type InstallPlanningBackend interface {
	PreflightInstall(context.Context, CreateRequest) (*InstallPlan, error)
}

func installRequestFingerprint(req CreateRequest) string {
	req.RequestID = ""
	req.PlanDigest = ""
	raw, _ := json.Marshal(req)
	return requestFingerprint(string(raw))
}

func (m *Manager) PreflightInstall(ctx context.Context, req CreateRequest) (*InstallPlan, error) {
	template, err := m.Template(ctx, req.TemplateID)
	if err != nil {
		return nil, err
	}
	if !template.Available || template.Spec == nil {
		return nil, serviceError("TEMPLATE_UNAVAILABLE", "The template needs to be corrected before installation.", 409, true, nil)
	}
	if _, _, err := resolveTemplateInputs(*template.Spec, req.Parameters, req.AcceptedNoticeRevisions); err != nil {
		return nil, err
	}
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	if err := validateServiceFamilyAvailability(services, *template); err != nil {
		return nil, err
	}
	id, err := randomID("mws")
	if err != nil {
		return nil, err
	}
	base, err := m.defaultWorkspacePath(template.TemplateID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.WorkspacePath) == "" || filepath.Clean(req.WorkspacePath) == filepath.Clean(base) {
		req.WorkspacePath = filepath.Join(base, strings.TrimPrefix(id, "mws_"))
	}
	path, ownership, err := m.resolveInstallWorkspace(req.WorkspacePath)
	if err != nil {
		return nil, err
	}
	req.WorkspacePath = path.RealAbs
	workspace := ServiceResourceFact{ResourceID: "workspace", Kind: "directory", Identity: req.WorkspacePath, Ownership: ownership}
	inspectDirectory(&workspace)
	for _, other := range services {
		if pathsOverlap(other.WorkspacePath, req.WorkspacePath) {
			return nil, serviceError("RESOURCE_IN_USE", "The workspace is already associated with another service. Choose an independent directory.", 409, true, nil)
		}
	}
	_, digest, err := canonicalTemplateSpec(*template.Spec)
	if err != nil {
		return nil, err
	}
	fingerprint := installRequestFingerprint(req)
	plan := InstallPlan{ServiceID: id, WorkspacePath: req.WorkspacePath, WorkspaceOwnership: ownership, ExpiresAtUnixMs: time.Now().Add(updatePlanTTL).UnixMilli()}
	plan.PlanDigest = requestFingerprint(id, fingerprint, digest)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.installPlans == nil {
		m.installPlans = map[string]cachedInstallPlan{}
	}
	for key, value := range m.installPlans {
		if value.Plan.ExpiresAtUnixMs < time.Now().UnixMilli() {
			delete(m.installPlans, key)
		}
	}
	if len(m.installPlans) >= 64 {
		oldest := ""
		for key, value := range m.installPlans {
			if oldest == "" || value.Plan.ExpiresAtUnixMs < m.installPlans[oldest].Plan.ExpiresAtUnixMs {
				oldest = key
			}
		}
		delete(m.installPlans, oldest)
	}
	m.installPlans[plan.PlanDigest] = cachedInstallPlan{Plan: plan, Fingerprint: fingerprint, TemplateDigest: digest, Workspace: workspace}
	return &plan, nil
}

func (m *Manager) reviewedInstall(req CreateRequest, template Template) (*InstallPlan, error) {
	m.mu.Lock()
	cached, ok := m.installPlans[req.PlanDigest]
	m.mu.Unlock()
	_, digest, err := canonicalTemplateSpec(*template.Spec)
	workspace := cached.Workspace
	inspectDirectory(&workspace)
	if err != nil || !ok || cached.Plan.ExpiresAtUnixMs < time.Now().UnixMilli() || cached.Fingerprint != installRequestFingerprint(req) || cached.TemplateDigest != digest || workspace.Presence != cached.Workspace.Presence || workspace.Generation != cached.Workspace.Generation || workspace.StableIdentity != cached.Workspace.StableIdentity {
		return nil, serviceError("RESOURCE_PLAN_STALE", "The installation review expired or its template or directory changed. Review the installation again.", 409, true, err)
	}
	return &cached.Plan, nil
}

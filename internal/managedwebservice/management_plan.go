package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"sort"
	"strings"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type ManagementPlanRequest struct {
	RetainResourceIDs []string        `json:"retain_resource_ids,omitempty"`
	Action            OperationAction `json:"action"`
	DeleteData        bool            `json:"delete_data,omitempty"`
	DeleteWorkspace   bool            `json:"delete_workspace,omitempty"`
	SkipHooks         bool            `json:"skip_hooks,omitempty"`
}

type ManagementPlan struct {
	ServiceID             string                `json:"service_id"`
	Request               ManagementPlanRequest `json:"request"`
	PlanDigest            string                `json:"plan_digest"`
	Facts                 ServiceFacts          `json:"facts"`
	Blockers              []string              `json:"blockers"`
	Path                  string                `json:"path"`
	ConflictServiceID     string                `json:"conflict_service_id,omitempty"`
	ConfigurationRevision int64                 `json:"configuration_revision"`
	RuntimeIdentity       string                `json:"-"`
	Manifest              string                `json:"-"`
	ManagementState       string                `json:"management_state"`
}

// ManagementBackend extends the lifecycle boundary without granting scripts any
// additional permissions. Authorization still belongs to the product adapter.
type ManagementBackend interface {
	PreflightManagement(context.Context, string, ManagementPlanRequest) (*ManagementPlan, error)
}

func (m *Manager) PreflightManagement(ctx context.Context, serviceID string, req ManagementPlanRequest) (*ManagementPlan, error) {
	service, err := m.registry.GetManagedService(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	if service == nil {
		return nil, serviceError("SERVICE_NOT_FOUND", "The service record was not found.", 404, false, nil)
	}
	return m.managementPlan(ctx, service, req)
}

func (m *Manager) managementPlan(ctx context.Context, service *pfregistry.ManagedService, req ManagementPlanRequest) (*ManagementPlan, error) {
	switch req.Action {
	case ActionUninstall, ActionDetach, ActionRestore, ActionRecover, ActionStop:
	default:
		return nil, serviceError("ACTION_INVALID", "This action does not use a management plan.", 400, false, nil)
	}
	plan := &ManagementPlan{ServiceID: service.ServiceID, Request: req, ConfigurationRevision: service.ConfigurationRevision, RuntimeIdentity: service.RuntimeIdentity, Manifest: service.RuntimeManifestJSON, ManagementState: service.ManagementState, Blockers: []string{}}
	if req.Action == ActionDetach {
		if !activeManagement(*service) {
			plan.Blockers = append(plan.Blockers, "SERVICE_NOT_ACTIVE")
		}
		plan.Path = "detach"
		plan.Facts = ServiceFacts{Presence: "unknown", Ownership: "unverified", Runtime: "unknown"}
	} else {
		facts, _ := m.inspectService(ctx, service, true)
		plan.Facts = facts
		if facts.Presence == "unknown" || facts.Ownership != "verified" {
			code := facts.ProblemCode
			if code == "" {
				code = "RESOURCE_OWNERSHIP_UNVERIFIED"
			}
			plan.Blockers = append(plan.Blockers, code)
		}
		switch req.Action {
		case ActionUninstall:
			plan.Path = "uninstall"
			if raw := strings.TrimSpace(service.RuntimeManifestJSON); raw != "" && raw != "{}" && !pendingUninstall(service) {
				plan.Blockers = append(plan.Blockers, "LIFECYCLE_TRANSACTION_PENDING")
			}
			for _, item := range facts.Resources {
				selected := managementResourceSelected(req, item)
				if !selected || item.Presence == "absent" {
					continue
				}
				code := item.ProblemCode
				if code == "" && (item.Ownership == "unverified" || item.Ownership == "external" || item.Ownership == "conflict") {
					code = "RESOURCE_OWNERSHIP_UNVERIFIED"
				}
				if code == "" && item.Presence == "unknown" {
					code = "RESOURCE_INSPECTION_UNAVAILABLE"
				}
				if code != "" {
					plan.Blockers = append(plan.Blockers, code)
				}
			}
		case ActionRecover, ActionRestore:
			if raw := strings.TrimSpace(service.RuntimeManifestJSON); raw != "" && raw != "{}" && !pendingUninstall(service) {
				plan.Blockers = append(plan.Blockers, "LIFECYCLE_TRANSACTION_PENDING")
			}
			if pendingUninstall(service) {
				journal, err := readUninstallJournal(service)
				if err != nil {
					return nil, err
				}
				if journal.Irreversible {
					plan.Blockers = append(plan.Blockers, "REINSTALL_REQUIRED")
				}
			}
			if facts.Presence == "present" {
				plan.Path = "restore_management"
			} else {
				plan.Path = "recreate"
			}
			if req.Action == ActionRestore && facts.Presence == "absent" {
				plan.Blockers = append(plan.Blockers, "RECOVERY_REQUIRED")
			}
			if facts.Presence == "absent" {
				for _, item := range facts.Resources {
					if item.Kind == "network" {
						continue
					}
					if item.Presence == "absent" {
						plan.Path = "reinstall"
						plan.Blockers = append(plan.Blockers, "REINSTALL_REQUIRED")
					} else if item.Presence == "unknown" || item.ProblemCode != "" {
						code := item.ProblemCode
						if code == "" {
							code = "RESOURCE_INSPECTION_UNAVAILABLE"
						}
						plan.Blockers = append(plan.Blockers, code)
					}
				}
				if _, err := m.resolveCurrentRuntime(ctx, service); err != nil {
					code, _, _, _ := ErrorDetails(err)
					plan.Blockers = append(plan.Blockers, code)
				}
			}
			services, err := m.registry.ListManagedServices(ctx)
			if err != nil {
				return nil, err
			}
			for _, other := range services {
				if other.ServiceID != service.ServiceID && activeManagement(other) && other.TemplateID == service.TemplateID {
					plan.ConflictServiceID = other.ServiceID
					plan.Blockers = append(plan.Blockers, "INSTANCE_ALREADY_EXISTS")
				}
			}
		case ActionStop:
			plan.Path = "stop"
			if !activeManagement(*service) {
				plan.Blockers = append(plan.Blockers, "SERVICE_NOT_ACTIVE")
			}
		}
	}
	// Exclude observation time; every material resource fact, choice, configuration
	// revision and transaction generation is covered by the reviewed digest.
	sort.Strings(plan.Blockers)
	plan.Blockers = slices.Compact(plan.Blockers)
	sort.Strings(plan.Facts.InstanceIDs)
	sort.Slice(plan.Facts.Resources, func(i, j int) bool { return plan.Facts.Resources[i].ResourceID < plan.Facts.Resources[j].ResourceID })
	for i := range plan.Facts.Resources {
		sort.Slice(plan.Facts.Resources[i].References, func(a, b int) bool {
			return plan.Facts.Resources[i].References[a].ContainerID < plan.Facts.Resources[i].References[b].ContainerID
		})
	}
	stable := *plan
	stable.Facts.CheckedAtUnixMs = 0
	raw, _ := json.Marshal(struct {
		Plan                             ManagementPlan
		Identity, Manifest, DesiredState string
	}{stable, service.RuntimeIdentity, service.RuntimeManifestJSON, service.DesiredState})
	digest := sha256.Sum256(raw)
	plan.PlanDigest = hex.EncodeToString(digest[:])
	return plan, nil
}

func requiresManagementPlan(req OperationRequest) bool {
	return req.Action == ActionUninstall || req.Action == ActionDetach || req.Action == ActionRestore || req.Action == ActionRecover || req.SkipHooks
}

func validateManagementPlan(plan *ManagementPlan, req OperationRequest) error {
	if strings.TrimSpace(req.PlanDigest) == "" {
		return serviceError("MANAGEMENT_PREFLIGHT_REQUIRED", "Review the resource impact before confirming this operation.", 409, true, nil)
	}
	if req.PlanDigest != plan.PlanDigest {
		return serviceError("RESOURCE_PLAN_STALE", "The service or its resources changed. Refresh the review before continuing.", 409, true, nil)
	}
	if len(plan.Blockers) > 0 {
		return serviceError(plan.Blockers[0], "The reviewed operation is blocked. Preserve the affected resources or resolve the reported issue.", 409, true, nil)
	}
	return nil
}

func (m *Manager) restoreArchivedManagement(ctx context.Context, service *pfregistry.ManagedService) error {
	if activeManagement(*service) {
		if pendingUninstall(service) {
			empty := "{}"
			return m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &empty})
		}
		return nil
	}
	var forward pfregistry.Forward
	if err := json.Unmarshal([]byte(service.ArchivedForwardJSON), &forward); err != nil {
		return err
	}
	id, err := randomManagedForwardID()
	if err != nil {
		return err
	}
	forward.ForwardID = id
	if forward.DefaultAppPath == "" {
		forward.DefaultAppPath = "/"
	}
	if err := m.registry.ActivateManagedService(ctx, *service, forward); err != nil {
		return err
	}
	service.ManagementState, service.ForwardID = "active", id
	return nil
}

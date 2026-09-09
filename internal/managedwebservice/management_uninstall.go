package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const uninstallJournalKind = "redeven.managed_service_uninstall.v1"

type skipManagementHooksKey struct{}

func managementResourceSelected(req ManagementPlanRequest, item ServiceResourceFact) bool {
	if slices.Contains(req.RetainResourceIDs, item.ResourceID) {
		return false
	}
	if item.Kind == "network" {
		return item.Ownership != "external"
	}
	if item.ResourceID == "workspace" {
		return req.DeleteWorkspace
	}
	return req.DeleteData
}

func skipManagementHooks(ctx context.Context) bool {
	value, _ := ctx.Value(skipManagementHooksKey{}).(bool)
	return value
}

type uninstallResourceResult struct {
	Resource ServiceResourceFact `json:"resource"`
	State    string              `json:"state"`
}
type uninstallJournal struct {
	Kind            string                    `json:"kind"`
	OperationID     string                    `json:"operation_id"`
	PlanDigest      string                    `json:"plan_digest"`
	RuntimeIdentity string                    `json:"runtime_identity"`
	RuntimeState    string                    `json:"runtime_state"`
	Resources       []uninstallResourceResult `json:"resources"`
	Irreversible    bool                      `json:"irreversible"`
}

func pendingUninstall(service *pfregistry.ManagedService) bool {
	if service == nil {
		return false
	}
	var header struct {
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal([]byte(service.RuntimeManifestJSON), &header)
	return header.Kind == uninstallJournalKind
}
func readUninstallJournal(service *pfregistry.ManagedService) (uninstallJournal, error) {
	journal := uninstallJournal{}
	err := decodeStrictJSON([]byte(service.RuntimeManifestJSON), &journal)
	if err == nil && (journal.Kind != uninstallJournalKind || journal.OperationID == "" || journal.RuntimeIdentity != service.RuntimeIdentity) {
		err = serviceError("UNINSTALL_JOURNAL_INVALID", "The saved uninstall transaction cannot be verified.", 409, false, nil)
	}
	return journal, err
}
func (m *Manager) saveUninstallJournal(ctx context.Context, service *pfregistry.ManagedService, journal uninstallJournal) error {
	raw, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	text := string(raw)
	if err := m.registry.UpdateManagedServiceIfRuntimeMatches(ctx, service.ServiceID, service.RuntimeIdentity, service.RuntimeSpecSHA256, pfregistry.ManagedServicePatch{RuntimeManifestJSON: &text}); err != nil {
		return err
	}
	service.RuntimeManifestJSON = text
	return nil
}

func (m *Manager) runManagementUninstall(ctx context.Context, service *pfregistry.ManagedService, op *pfregistry.ManagedOperation, driver deploymentDriver, plan *ManagementPlan) error {
	if plan == nil {
		return serviceError("MANAGEMENT_PREFLIGHT_REQUIRED", "Review the uninstall impact before continuing.", 409, true, nil)
	}
	fresh, err := m.managementPlan(ctx, service, plan.Request)
	if err != nil {
		return err
	}
	if err := validateManagementPlan(fresh, OperationRequest{PlanDigest: plan.PlanDigest}); err != nil {
		return err
	}
	journal := uninstallJournal{Kind: uninstallJournalKind, OperationID: op.OperationID, PlanDigest: plan.PlanDigest, RuntimeIdentity: service.RuntimeIdentity, RuntimeState: "pending"}
	if pendingUninstall(service) {
		journal, err = readUninstallJournal(service)
		if err != nil {
			return err
		}
		journal.OperationID, journal.PlanDigest = op.OperationID, plan.PlanDigest
	} else if raw := strings.TrimSpace(service.RuntimeManifestJSON); raw != "" && raw != "{}" {
		return serviceError("LIFECYCLE_TRANSACTION_PENDING", "Resolve the existing lifecycle transaction before uninstalling.", 409, true, nil)
	}
	previous := map[string]uninstallResourceResult{}
	for _, item := range journal.Resources {
		previous[item.Resource.ResourceID] = item
	}
	journal.Resources = nil
	for _, item := range plan.Facts.Resources {
		state := "retained"
		if managementResourceSelected(plan.Request, item) {
			state = "pending"
		}
		if old, ok := previous[item.ResourceID]; ok && old.State == "completed" {
			state = "completed"
			item = old.Resource
		}
		journal.Resources = append(journal.Resources, uninstallResourceResult{Resource: item, State: state})
	}
	stopped := "stopped"
	if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{DesiredState: &stopped}); err != nil {
		return err
	}
	service.DesiredState = stopped
	if err := m.saveUninstallJournal(ctx, service, journal); err != nil {
		return err
	}
	if journal.RuntimeState != "completed" {
		journal.RuntimeState = "executing"
		if err := m.saveUninstallJournal(ctx, service, journal); err != nil {
			return err
		}
		actionCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		err = driver.Uninstall(actionCtx, service, false, m.operationProgress(op))
		cancel()
		if err != nil {
			return err
		}
		facts, inspectionErr := m.inspectService(ctx, service, false)
		if inspectionErr != nil {
			return inspectionErr
		}
		binding, bindingErr := decodeRuntimeBinding(service)
		if bindingErr != nil {
			return bindingErr
		}
		if facts.Runtime == "running" || (binding.Deployment != DeploymentHost && facts.Presence != "absent") {
			return serviceError("RUNTIME_REMOVAL_UNCONFIRMED", "The runtime removal has not been confirmed. Recheck the instance before continuing cleanup.", 409, true, nil)
		}
		journal.RuntimeState = "completed"
		if err := m.saveUninstallJournal(ctx, service, journal); err != nil {
			return err
		}
	}
	for index := range journal.Resources {
		item := &journal.Resources[index]
		if item.State == "completed" || item.State == "retained" {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		item.State = "executing"
		if err := m.saveUninstallJournal(ctx, service, journal); err != nil {
			return err
		}
		m.progress(op, "workspace_cleanup", 6)
		if err := m.removeManagementResource(ctx, service, item.Resource); err != nil {
			item.State = "blocked"
			_ = m.saveUninstallJournal(context.WithoutCancel(ctx), service, journal)
			return err
		}
		item.State = "completed"
		journal.Irreversible = true
		if err := m.saveUninstallJournal(context.WithoutCancel(ctx), service, journal); err != nil {
			return err
		}
	}
	if err := os.Remove(m.serviceSecretPath(service.ServiceID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.RemoveAll(m.staticOpeningDirectory(service)); err != nil {
		return err
	}
	retain := false
	for _, item := range journal.Resources {
		if item.State == "retained" && item.Resource.Presence != "absent" {
			retain = true
		}
	}
	if binding, err := decodeRuntimeBinding(service); err == nil && binding.Compose != nil {
		root := m.resolveBindingPath(binding.Compose.ConfigRoot)
		if retain {
			// Keep the generated resource inventory, but erase injected application secrets.
			if err := writePrivateFile(filepath.Join(root, "template.env"), nil); err != nil {
				return err
			}
		} else if err := os.RemoveAll(root); err != nil {
			return err
		}
	}
	// Stop progress persistence before the transaction clears retained output.
	if reporter := reporterFromContext(ctx); reporter != nil {
		reporter.Close()
	}
	op.State, op.Stage, op.ProgressCurrent, op.FinishedAtUnixMs = "succeeded", "completed", operationProgressTotal, time.Now().UnixMilli()
	return m.registry.CompleteManagedServiceUninstall(context.WithoutCancel(ctx), service.ServiceID, *op, retain)
}

func (m *Manager) removeManagementResource(ctx context.Context, service *pfregistry.ManagedService, target ServiceResourceFact) error {
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	facts, _ := m.inspectService(checkCtx, service, true)
	var current *ServiceResourceFact
	for index := range facts.Resources {
		if facts.Resources[index].ResourceID == target.ResourceID {
			current = &facts.Resources[index]
			break
		}
	}
	if current == nil {
		return serviceError("RESOURCE_INSPECTION_INCOMPLETE", "The selected resource could not be inspected.", 409, true, nil)
	}
	if current.Presence == "absent" {
		if target.Kind == "volume" {
			return m.registry.DeleteManagedServiceResource(ctx, service.ServiceID, target.ResourceID)
		}
		return nil
	}
	if current.Presence != "present" || current.Identity != target.Identity || current.Generation != target.Generation || current.StableIdentity != target.StableIdentity || current.ProblemCode != "" || current.Ownership == "conflict" {
		return serviceError("RESOURCE_PLAN_STALE", "The selected resource identity or references changed. Review the remaining cleanup.", 409, true, nil)
	}
	switch target.Kind {
	case "network":
		if err := m.containers.RemoveNetwork(checkCtx, containerengine.EngineDocker, target.StableIdentity); err != nil {
			return serviceError("DATA_REMOVE_FAILED", "The instance network could not be removed. Review the remaining references.", 502, true, err)
		}
		networks, err := m.containers.ListNetworks(checkCtx, containerengine.EngineDocker)
		if err != nil {
			return err
		}
		for _, network := range networks {
			if network.NetworkID == target.StableIdentity {
				return serviceError("RESOURCE_PLAN_STALE", "The network removal is not yet confirmed.", 409, true, nil)
			}
		}
		// Retain the exact network identity until finalization so an interrupted
		// transaction can distinguish absence from a replacement with the same name.
		return nil
	case "volume":
		if err := m.containers.RemoveVolume(checkCtx, containerengine.VolumeRemoveRequest{Engine: containerengine.EngineDocker, Name: target.Identity}); err != nil {
			return serviceError("DATA_REMOVE_FAILED", "The selected volume could not be deleted. Review its current references.", 502, true, err)
		}
		remaining, err := m.containers.ListVolumes(checkCtx, containerengine.EngineDocker)
		if err != nil {
			return serviceError("RESOURCE_INSPECTION_UNAVAILABLE", "The volume deletion result could not be checked.", 502, true, err)
		}
		for _, item := range remaining {
			if item.Name == target.Identity {
				return serviceError("RESOURCE_PLAN_STALE", "A volume still occupies the reviewed name. Inspect its identity before continuing.", 409, true, nil)
			}
		}
		return m.registry.DeleteManagedServiceResource(ctx, service.ServiceID, target.ResourceID)
	case "directory":
		if target.ResourceID == "workspace" {
			return m.deleteServiceWorkspace(ctx, *service)
		}
		binding, err := decodeRuntimeBinding(service)
		if err != nil {
			return err
		}
		if binding.Host == nil || !strings.HasPrefix(binding.Host.DataRoot, "instances/") || m.resolveBindingPath(binding.Host.DataRoot) != target.Identity {
			return serviceError("RESOURCE_OWNERSHIP_UNVERIFIED", "The data directory is not an owned instance directory.", 409, false, nil)
		}
		return os.RemoveAll(target.Identity)
	}
	return serviceError("RESOURCE_CLEANUP_UNSUPPORTED", "This resource needs manual review before cleanup.", 409, false, nil)
}

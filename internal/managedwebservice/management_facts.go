package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

// ServiceFacts is the authoritative observation used by management and opening.
// Unknown existence never authorizes creation, stopping, or deletion.
type ServiceFacts struct {
	InstanceIDs       []string              `json:"instance_ids,omitempty"`
	Presence          string                `json:"presence"`
	Ownership         string                `json:"ownership"`
	Runtime           string                `json:"runtime"`
	CheckedAtUnixMs   int64                 `json:"checked_at_unix_ms"`
	ProblemCode       string                `json:"problem_code,omitempty"`
	Resources         []ServiceResourceFact `json:"resources,omitempty"`
	ResourcesComplete bool                  `json:"resources_complete"`
}

type ServiceResourceFact struct {
	StableIdentity string                              `json:"stable_identity,omitempty"`
	ResourceID     string                              `json:"resource_id"`
	Kind           string                              `json:"kind"`
	Identity       string                              `json:"identity"`
	Generation     int64                               `json:"generation,omitempty"`
	Presence       string                              `json:"presence"`
	Ownership      string                              `json:"ownership"`
	ProblemCode    string                              `json:"problem_code,omitempty"`
	References     []containerengine.ResourceReference `json:"references,omitempty"`
}

func activeManagement(service pfregistry.ManagedService) bool {
	return service.ManagementState == "" || service.ManagementState == "active"
}

func (m *Manager) inspectService(ctx context.Context, service *pfregistry.ManagedService, resources bool) (ServiceFacts, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	facts := ServiceFacts{Presence: "unknown", Ownership: "unknown", Runtime: "unknown", CheckedAtUnixMs: time.Now().UnixMilli()}
	binding, err := decodeRuntimeBinding(service)
	if err == nil {
		switch driver := m.driver(binding.Deployment).(type) {
		case *containerTemplateDriver:
			if driver.adapter == nil {
				err = serviceError("DOCKER_UNAVAILABLE", "The container engine is unavailable.", 503, true, nil)
				break
			}
			var item containerengine.ContainerInspect
			var exists bool
			item, exists, err = driver.ownedContainer(ctx, service)
			if err == nil {
				facts.Presence, facts.Ownership, facts.Runtime = "absent", "verified", "stopped"
				if exists {
					facts.Presence = "present"
					facts.InstanceIDs = []string{item.ContainerID}
					facts.Runtime = string(item.State)
					if item.State != containerengine.ContainerStateRunning && item.State != containerengine.ContainerStateRestarting && item.State != containerengine.ContainerStatePaused {
						facts.Runtime = "stopped"
					}
				}
			}
		case *composeTemplateDriver:
			if driver.adapter == nil {
				err = serviceError("DOCKER_UNAVAILABLE", "The container engine is unavailable.", 503, true, nil)
				break
			}
			if service.RuntimeIdentity == "" {
				facts.Presence, facts.Ownership, facts.Runtime = "absent", "verified", "stopped"
				break
			}
			var images map[string]string
			images, err = driver.expectedImages(service)
			if err != nil {
				break
			}
			var details containerengine.ComposeProjectDetails
			details, err = driver.verifyOwnedProject(ctx, service, images)
			if err == nil {
				facts.Presence, facts.Ownership, facts.Runtime = "absent", "verified", "stopped"
				if len(details.Containers) > 0 {
					facts.Presence = "present"
					running := 0
					for _, c := range details.Containers {
						facts.InstanceIDs = append(facts.InstanceIDs, c.ContainerID)
						if c.State == containerengine.ContainerStateRunning {
							running++
						}
					}
					if running == len(images) {
						facts.Runtime = "running"
					} else if running > 0 || len(details.Containers) != len(images) {
						facts.Runtime = "transition"
					}
				}
			}
		default:
			observer, ok := m.driver(binding.Deployment).(runtimeObserver)
			if !ok {
				err = serviceError("RUNTIME_INSPECTION_UNAVAILABLE", "The service runtime cannot be inspected.", 503, true, nil)
				break
			}
			var running bool
			running, err = observer.Observe(ctx, service)
			if err == nil {
				facts.Presence, facts.Ownership, facts.Runtime = "present", "verified", "stopped"
				if running {
					facts.Runtime = "running"
				} else if service.ManagementState == "uninstalled" {
					facts.Presence = "absent"
				}
			}
		}
	}
	if err != nil {
		facts.ProblemCode, _, _, _ = ErrorDetails(err)
		if errors.Is(err, containerengine.ErrPermissionDenied) || errors.Is(err, os.ErrPermission) {
			facts.ProblemCode = "RESOURCE_PERMISSION_DENIED"
		}
		if errors.Is(err, containerengine.ErrEngineTimeout) || errors.Is(err, context.DeadlineExceeded) {
			facts.ProblemCode = "RESOURCE_INSPECTION_TIMEOUT"
		}
		if errors.Is(err, containerengine.ErrDaemonStopped) {
			facts.ProblemCode = "ENGINE_NOT_RUNNING"
		}
		if strings.Contains(facts.ProblemCode, "MISMATCH") {
			facts.Ownership = "conflict"
		}
	}
	if resources {
		m.inspectServiceResources(ctx, service, binding, &facts)
	}
	return facts, err
}

func (m *Manager) inspectServiceResources(ctx context.Context, service *pfregistry.ManagedService, binding *runtimeBinding, facts *ServiceFacts) {
	facts.ResourcesComplete = true
	owned := map[string]bool{}
	for _, id := range facts.InstanceIDs {
		owned[id] = true
	}
	records, err := m.registry.ListManagedServiceResources(ctx, service.ServiceID)
	if err != nil {
		facts.ResourcesComplete = false
		return
	}
	var volumes []containerengine.VolumeRecord
	var volumeErr error
	if m.containers != nil && (len(records) > 0 || (binding != nil && binding.Compose != nil)) {
		volumes, volumeErr = m.containers.ListVolumes(ctx, containerengine.EngineDocker)
	}
	if volumeErr == nil && m.containers != nil {
		var allocationErr error
		records, allocationErr = m.recoverVolumeAllocations(ctx, service, records, volumes)
		if allocationErr != nil {
			facts.ResourcesComplete = false
			facts.Resources = append(facts.Resources, ServiceResourceFact{ResourceID: "pending-data", Kind: "volume", Identity: "unknown", Presence: "unknown", Ownership: "unverified", ProblemCode: "DATA_IDENTITY_MISMATCH"})
		}
	}
	if binding != nil && binding.Compose != nil {
		var inventoryErr error
		records, inventoryErr = m.composeVolumeInventory(ctx, service, records, volumes)
		if inventoryErr != nil {
			facts.ResourcesComplete = false
			facts.Resources = append(facts.Resources, ServiceResourceFact{ResourceID: "compose-data", Kind: "volume", Identity: "unknown", Presence: "unknown", Ownership: "unverified", ProblemCode: "RESOURCE_INSPECTION_INCOMPLETE"})
		}
	}
	for _, record := range records {
		if record.Kind == "runtime" || record.Kind == "network" {
			continue
		}
		item := ServiceResourceFact{StableIdentity: record.StableIdentity, ResourceID: record.ResourceID, Kind: record.Kind, Identity: record.EngineIdentity, Generation: record.CreatedAtUnixMs, Presence: "unknown", Ownership: record.Ownership}
		if record.Kind == "volume" && m.containers != nil {
			if volumeErr == nil {
				item.Presence = "absent"
				for _, volume := range volumes {
					if volume.Name != record.EngineIdentity {
						continue
					}
					item.Presence = "present"
					item.References = volume.UsedBy
					if volume.CreatedAtUnixMs != record.CreatedAtUnixMs || (record.StableIdentity != "" && (volume.Labels[managedServiceLabel+".generation"] != record.StableIdentity || volume.Labels[managedServiceLabel] != service.ServiceID)) {
						item.Ownership = "conflict"
						item.ProblemCode = "DATA_IDENTITY_MISMATCH"
					}
					if volume.ReferenceInspectionFailures > 0 {
						item.ProblemCode = "RESOURCE_INSPECTION_INCOMPLETE"
						facts.ResourcesComplete = false
					}
					for _, ref := range volume.UsedBy {
						if !owned[ref.ContainerID] {
							item.ProblemCode = "RESOURCE_IN_USE"
						}
					}
				}
			} else {
				item.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
				facts.ResourcesComplete = false
			}
		} else {
			item.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
			facts.ResourcesComplete = false
		}
		facts.Resources = append(facts.Resources, item)
	}
	if pendingUninstall(service) {
		if journal, err := readUninstallJournal(service); err == nil {
			for _, old := range journal.Resources {
				found := false
				for _, current := range facts.Resources {
					if current.ResourceID == old.Resource.ResourceID {
						found = true
						break
					}
				}
				if !found && old.Resource.Kind == "volume" {
					item := old.Resource
					item.Presence = "unknown"
					if volumeErr == nil && m.containers != nil {
						item.Presence = "absent"
						for _, volume := range volumes {
							if volume.Name == item.Identity {
								item.Presence = "present"
								item.ProblemCode = "DATA_IDENTITY_MISMATCH"
							}
						}
					}
					facts.Resources = append(facts.Resources, item)
				}

			}
		}
	}
	workspace := ServiceResourceFact{ResourceID: "workspace", Kind: "directory", Identity: service.WorkspacePath, Ownership: service.WorkspaceOwnership}
	inspectDirectory(&workspace)
	if workspace.Presence == "present" {
		services, listErr := m.registry.ListManagedServices(ctx)
		if listErr != nil {
			workspace.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
			facts.ResourcesComplete = false
		}
		for _, other := range services {
			if other.ServiceID != service.ServiceID && pathsOverlap(service.WorkspacePath, other.WorkspacePath) {
				workspace.ProblemCode = "RESOURCE_IN_USE"
			}
		}
		if binding != nil && (binding.Deployment != DeploymentHost || m.containers != nil) {
			if m.containers == nil {
				workspace.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
				facts.ResourcesComplete = false
			} else {
				containers, listErr := m.containers.List(ctx, containerengine.ContainerListRequest{Engine: containerengine.EngineDocker, All: true})
				if listErr != nil {
					workspace.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
					facts.ResourcesComplete = false
				} else {
					for _, c := range containers.Containers {
						if owned[c.ContainerID] {
							continue
						}
						detail, inspectErr := m.containers.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: c.ContainerID})
						if errors.Is(inspectErr, containerengine.ErrContainerNotFound) {
							continue
						}
						if inspectErr != nil {
							workspace.ProblemCode = "RESOURCE_INSPECTION_INCOMPLETE"
							facts.ResourcesComplete = false
							continue
						}
						for _, mount := range detail.Container.Mounts {
							if mount.Type == containerengine.MountTypeBind && pathsOverlap(strings.TrimPrefix(mount.Source, "/host_mnt"), service.WorkspacePath) {
								workspace.ProblemCode = "RESOURCE_IN_USE"
								workspace.References = append(workspace.References, containerengine.ResourceReference{ContainerID: c.ContainerID, Name: c.Name, State: c.State})
								break
							}
						}
					}
				}
			}
		}
	}
	facts.Resources = append(facts.Resources, workspace)
	if binding != nil && binding.Compose != nil && m.containers != nil {
		m.inspectComposeNetworks(ctx, service, facts, owned)
	}
	if binding != nil && binding.Host != nil {
		item := ServiceResourceFact{ResourceID: "host-data", Kind: "directory", Identity: m.resolveBindingPath(binding.Host.DataRoot), Ownership: "owned"}
		if !strings.HasPrefix(binding.Host.DataRoot, "instances/") {
			item.Ownership = "unverified"
		}
		inspectDirectory(&item)
		facts.Resources = append(facts.Resources, item)
	}
	for _, item := range facts.Resources {
		if item.Presence == "unknown" || strings.HasPrefix(item.ProblemCode, "RESOURCE_INSPECTION_") {
			facts.ResourcesComplete = false
		}
	}
}

func inspectDirectory(item *ServiceResourceFact) {
	info, err := os.Lstat(item.Identity)
	if errors.Is(err, os.ErrNotExist) {
		item.Presence = "absent"
		return
	}
	if err != nil {
		item.Presence = "unknown"
		item.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
		return
	}
	item.Presence = "present"
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || !filepath.IsAbs(item.Identity) {
		item.Ownership = "conflict"
		item.ProblemCode = "WORKSPACE_DELETE_UNSAFE"
	}
	item.Generation = directoryGeneration(info)
	item.StableIdentity, err = directoryStableIdentity(item.Identity, info)
	if err != nil {
		item.ProblemCode = "RESOURCE_INSPECTION_UNAVAILABLE"
	}
}

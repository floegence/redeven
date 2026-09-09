package managedwebservice

import (
	"context"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const containerAllocationResource = "@runtime/container"

// Persist a random allocation identity before asking the engine to create an
// instance. A lost create response can then be observed without claiming a
// container merely because its name or service label matches.
func (d *containerTemplateDriver) prepareAllocation(ctx context.Context, service *pfregistry.ManagedService, request *containerengine.ContainerCreateRequest) (pfregistry.ManagedServiceResource, error) {
	listed, err := d.adapter.List(ctx, containerengine.ContainerListRequest{Engine: containerengine.EngineDocker, All: true})
	if err != nil {
		return pfregistry.ManagedServiceResource{}, err
	}
	for _, item := range listed.Containers {
		if item.Name == customContainerName(service.ServiceID) {
			return pfregistry.ManagedServiceResource{}, serviceError("CONTAINER_IDENTITY_MISMATCH", "A container already occupies the instance name. Review its ownership before creating another instance.", 409, false, nil)
		}
	}
	token, err := randomID("mra")
	if err != nil {
		return pfregistry.ManagedServiceResource{}, err
	}
	record := pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: containerAllocationResource, Kind: "runtime", EngineIdentity: "pending:" + customContainerName(service.ServiceID), CreatedAtUnixMs: time.Now().UnixMilli(), Ownership: "owned", StableIdentity: token}
	if err := d.manager.registry.PutManagedServiceResource(ctx, record); err != nil {
		return record, err
	}
	if request.Labels == nil {
		request.Labels = map[string]string{}
	}
	request.Labels[managedServiceLabel+".generation"] = token
	return record, nil
}

func (d *containerTemplateDriver) recoverAllocation(ctx context.Context, service *pfregistry.ManagedService) error {
	if d.manager == nil || d.manager.registry == nil {
		return nil
	}
	records, err := d.manager.registry.ListManagedServiceResources(ctx, service.ServiceID)
	if err != nil {
		return err
	}
	for _, record := range records {
		if record.ResourceID != containerAllocationResource || record.Kind != "runtime" {
			continue
		}
		if record.StableIdentity == "" || record.Ownership != "owned" {
			return serviceError("CONTAINER_IDENTITY_MISMATCH", "The saved runtime allocation cannot be verified.", 409, false, nil)
		}
		if record.EngineIdentity == service.RuntimeIdentity {
			return nil
		}
		id := record.EngineIdentity
		if strings.HasPrefix(id, "pending:") {
			listed, err := d.adapter.List(ctx, containerengine.ContainerListRequest{Engine: containerengine.EngineDocker, All: true})
			if err != nil {
				return err
			}
			id = ""
			for _, item := range listed.Containers {
				if item.Name != customContainerName(service.ServiceID) {
					continue
				}
				matched, err := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: item.ContainerID, Key: managedServiceLabel + ".generation", Value: record.StableIdentity})
				if err != nil {
					return err
				}
				if !matched {
					return serviceError("CONTAINER_IDENTITY_MISMATCH", "The instance name is occupied by another runtime allocation.", 409, false, nil)
				}
				id = item.ContainerID
			}
			if id == "" {
				return nil
			}
		}
		candidate := *service
		candidate.RuntimeIdentity = id
		container, exists, err := d.ownedContainerIdentity(ctx, &candidate)
		if err != nil {
			return err
		} else if !exists {
			return nil
		}
		matched, err := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: id, Key: managedServiceLabel + ".generation", Value: record.StableIdentity})
		if err != nil {
			return err
		}
		if !matched {
			return serviceError("CONTAINER_IDENTITY_MISMATCH", "The runtime allocation identity changed.", 409, false, nil)
		}
		artifact := container.Image.Reference
		if err := d.manager.registry.UpdateManagedServiceIfRuntimeMatches(ctx, service.ServiceID, service.RuntimeIdentity, service.RuntimeSpecSHA256, pfregistry.ManagedServicePatch{RuntimeIdentity: &id, ArtifactReference: &artifact}); err != nil {
			return err
		}
		service.RuntimeIdentity = id
		service.ArtifactReference = artifact
		record.EngineIdentity = id
		return d.manager.registry.PutManagedServiceResource(ctx, record)
	}
	return nil
}

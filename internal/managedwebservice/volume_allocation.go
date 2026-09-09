package managedwebservice

import (
	"context"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const volumeAllocationPrefix = "@allocation/volume/"

func (m *Manager) recoverVolumeAllocations(ctx context.Context, service *pfregistry.ManagedService, records []pfregistry.ManagedServiceResource, volumes []containerengine.VolumeRecord) ([]pfregistry.ManagedServiceResource, error) {
	for _, allocation := range records {
		resourceID, ok := strings.CutPrefix(allocation.ResourceID, volumeAllocationPrefix)
		if !ok || allocation.Kind != "runtime" {
			continue
		}
		for _, volume := range volumes {
			if volume.Name != allocation.EngineIdentity {
				continue
			}
			if allocation.StableIdentity == "" || volume.CreatedAtUnixMs <= 0 || volume.Labels[managedServiceLabel] != service.ServiceID || volume.Labels[managedServiceLabel+".resource"] != resourceID || volume.Labels[managedServiceLabel+".generation"] != allocation.StableIdentity {
				return records, serviceError("DATA_IDENTITY_MISMATCH", "A pending volume allocation no longer matches its saved ownership proof.", 409, false, nil)
			}
			record := allocation
			record.ResourceID = resourceID
			record.Kind = "volume"
			record.CreatedAtUnixMs = volume.CreatedAtUnixMs
			found := false
			for _, existing := range records {
				if existing.ResourceID == resourceID {
					found = true
					break
				}
			}
			if !found {
				if err := m.registry.PutManagedServiceResource(ctx, record); err != nil {
					return records, err
				}
				records = append(records, record)
			}
			if err := m.registry.DeleteManagedServiceResource(ctx, service.ServiceID, allocation.ResourceID); err != nil {
				return records, err
			}
		}
	}
	return records, nil
}

func (d *containerTemplateDriver) persistVolumeAllocation(ctx context.Context, service *pfregistry.ManagedService, resourceID, name, token string) error {
	return d.manager.registry.PutManagedServiceResource(ctx, pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: volumeAllocationPrefix + resourceID, Kind: "runtime", EngineIdentity: name, StableIdentity: token, Ownership: "owned", CreatedAtUnixMs: time.Now().UnixMilli()})
}

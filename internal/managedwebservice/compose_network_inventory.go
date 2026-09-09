package managedwebservice

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

func (m *Manager) inspectComposeNetworks(ctx context.Context, service *pfregistry.ManagedService, facts *ServiceFacts, owned map[string]bool) {
	driver, ok := m.compose.(*composeTemplateDriver)
	if !ok {
		return
	}
	networks, err := m.containers.ListNetworks(ctx, containerengine.EngineDocker)
	if err != nil {
		facts.ResourcesComplete = false
		facts.Resources = append(facts.Resources, ServiceResourceFact{ResourceID: "@network/unknown", Kind: "network", Identity: driver.projectName(service), Presence: "unknown", Ownership: "unverified", ProblemCode: "RESOURCE_INSPECTION_UNAVAILABLE"})
		return
	}
	raw, readErr := os.ReadFile(driver.request(service).ConfigPath)
	var doc struct {
		Networks map[string]struct {
			Name     string            `yaml:"name"`
			External bool              `yaml:"external"`
			Labels   map[string]string `yaml:"labels"`
		} `yaml:"networks"`
	}
	if readErr == nil {
		readErr = yaml.Unmarshal(raw, &doc)
	}
	records, err := m.registry.ListManagedServiceResources(ctx, service.ServiceID)
	if err != nil {
		facts.ResourcesComplete = false
		return
	}
	byName := map[string]pfregistry.ManagedServiceResource{}
	allocations := map[string]pfregistry.ManagedServiceResource{}
	for _, record := range records {
		if record.Kind == "runtime" && strings.HasPrefix(record.ResourceID, "@allocation/network/") {
			allocations[record.EngineIdentity] = record
		}
		if record.Kind == "network" {
			byName[record.EngineIdentity] = record
		}
	}
	for _, network := range networks {
		if network.Labels["com.docker.compose.project"] != driver.projectName(service) {
			continue
		}
		allocation, allocated := allocations[network.Name]
		if _, ok := byName[network.Name]; ok && !allocated {
			continue
		}
		record := pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: "@network/" + network.Name, Kind: "network", EngineIdentity: network.Name, StableIdentity: network.NetworkID, CreatedAtUnixMs: time.Now().UnixMilli(), Ownership: "unverified"}
		for _, declaration := range doc.Networks {
			if allocated && allocation.StableIdentity != "" && allocation.StableIdentity == network.Labels[managedServiceLabel+".generation"] && declaration.Name == network.Name && declaration.Labels[managedServiceLabel+".generation"] == allocation.StableIdentity && network.Labels[managedServiceLabel] == service.ServiceID {
				record.Ownership = "owned"
			}
		}
		if _, exists := byName[network.Name]; exists && record.Ownership != "owned" {
			continue
		}
		if err := m.registry.PutManagedServiceResource(ctx, record); err != nil {
			facts.ResourcesComplete = false
			return
		}
		if allocated && record.Ownership == "owned" {
			if err := m.registry.DeleteManagedServiceResource(ctx, service.ServiceID, allocation.ResourceID); err != nil {
				facts.ResourcesComplete = false
				return
			}
		}
		byName[network.Name] = record
	}
	for _, record := range byName {
		item := ServiceResourceFact{ResourceID: record.ResourceID, Kind: "network", Identity: record.EngineIdentity, StableIdentity: record.StableIdentity, Generation: record.CreatedAtUnixMs, Ownership: record.Ownership, Presence: "absent"}
		for _, network := range networks {
			if network.Name != record.EngineIdentity {
				continue
			}
			item.Presence = "present"
			item.References = network.UsedBy
			if network.NetworkID != record.StableIdentity {
				item.Ownership = "conflict"
				item.ProblemCode = "DATA_IDENTITY_MISMATCH"
			}
			for _, ref := range item.References {
				if !owned[ref.ContainerID] {
					item.ProblemCode = "RESOURCE_IN_USE"
				}
			}
		}
		facts.Resources = append(facts.Resources, item)
	}
	if readErr != nil && len(byName) == 0 && strings.TrimSpace(service.RuntimeIdentity) != "" {
		facts.ResourcesComplete = false
	}
}

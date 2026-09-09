package managedwebservice

import (
	"context"
	"os"
	"sort"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
	"gopkg.in/yaml.v3"
)

// Legacy volumes stay where they are. Discovering a binding records inventory,
// never exclusive ownership or permission to delete it.
func (m *Manager) composeVolumeInventory(ctx context.Context, service *pfregistry.ManagedService, records []pfregistry.ManagedServiceResource, volumes []containerengine.VolumeRecord) ([]pfregistry.ManagedServiceResource, error) {
	driver, ok := m.compose.(*composeTemplateDriver)
	if !ok {
		return records, nil
	}
	raw, err := os.ReadFile(driver.request(service).ConfigPath)
	if err != nil {
		return records, err
	}
	var doc struct {
		Volumes map[string]struct {
			Name     string `yaml:"name"`
			External bool   `yaml:"external"`
		} `yaml:"volumes"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return records, err
	}
	names := make([]string, 0, len(doc.Volumes))
	for name := range doc.Volumes {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		found := false
		for _, record := range records {
			if record.ResourceID == name {
				found = true
				break
			}
		}
		if found {
			continue
		}
		declaration := doc.Volumes[name]
		identity := declaration.Name
		if identity == "" {
			identity = driver.projectName(service) + "_" + name
			if declaration.External {
				identity = name
			}
		}
		record := pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: name, Kind: "volume", EngineIdentity: identity, Ownership: "unverified"}
		if declaration.External {
			record.Ownership = "external"
		}
		for _, volume := range volumes {
			if volume.Name == identity {
				record.CreatedAtUnixMs = volume.CreatedAtUnixMs
				break
			}
		}
		if record.CreatedAtUnixMs > 0 {
			if err := m.registry.PutManagedServiceResource(ctx, record); err != nil {
				return records, err
			}
		}
		records = append(records, record)
	}
	return records, nil
}

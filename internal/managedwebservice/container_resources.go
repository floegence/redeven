package managedwebservice

import (
	"context"
	"errors"
	"os"
	"strings"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type ContainerResourceKind string

const (
	ContainerResourceContainer      ContainerResourceKind = "container"
	ContainerResourceVolume         ContainerResourceKind = "volume"
	ContainerResourceComposeProject ContainerResourceKind = "compose_project"
)

type ContainerResourceOwner struct {
	Kind      string `json:"kind"`
	ServiceID string `json:"service_id"`
	Name      string `json:"name"`
}

func containerResourceLink(service pfregistry.ManagedService) *ContainerResourceLink {
	identity := strings.TrimSpace(service.RuntimeIdentity)
	if identity == "" {
		return nil
	}
	switch Deployment(service.Deployment) {
	case DeploymentDocker, DeploymentContainer:
		return &ContainerResourceLink{Engine: string(containerengine.EngineDocker), View: "containers", Identity: identity}
	case DeploymentCompose:
		parts := strings.Split(identity, ":")
		if len(parts) != 4 || parts[0] != "compose" || strings.TrimSpace(parts[2]) == "" {
			return nil
		}
		return &ContainerResourceLink{Engine: string(containerengine.EngineDocker), View: "compose-projects", Identity: containerengine.ComposeProjectID(parts[2])}
	default:
		return nil
	}
}

// ContainerResourceOwner resolves the single Redeven product owner of a
// Docker resource. Native Containers uses this on both read and write paths so
// a caller cannot bypass the managed Web Service lifecycle through another UI.
func (m *Manager) ContainerResourceOwner(ctx context.Context, engine containerengine.Engine, endpointID containerengine.EndpointID, kind ContainerResourceKind, identity string) (*ContainerResourceOwner, error) {
	if m == nil || m.registry == nil || m.containers == nil {
		return nil, nil
	}
	identity = strings.TrimSpace(identity)
	if engine != containerengine.EngineDocker || identity == "" {
		return nil, nil
	}
	if endpointID != "" {
		endpoint, err := m.containers.EndpointStatus(ctx, containerengine.EndpointStatusRequest{Engine: engine, EndpointID: endpointID})
		if err != nil {
			return nil, err
		}
		if !endpoint.Default {
			return nil, nil
		}
	}
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return nil, err
	}
	for index := range services {
		service := &services[index]
		owned, err := m.serviceOwnsContainerResource(ctx, service, kind, identity)
		if err != nil {
			return nil, err
		}
		if !owned {
			continue
		}
		name, _ := m.serviceDisplayMetadata(ctx, *service)
		return &ContainerResourceOwner{Kind: "web_service", ServiceID: service.ServiceID, Name: name}, nil
	}
	return nil, nil
}

func (m *Manager) serviceOwnsContainerResource(ctx context.Context, service *pfregistry.ManagedService, kind ContainerResourceKind, identity string) (bool, error) {
	if service == nil {
		return false, nil
	}
	deployment := Deployment(service.Deployment)
	switch kind {
	case ContainerResourceContainer:
		if (deployment == DeploymentDocker || deployment == DeploymentContainer) && strings.TrimSpace(service.RuntimeIdentity) == identity {
			return true, nil
		}
		if deployment != DeploymentCompose || strings.TrimSpace(service.RuntimeIdentity) == "" {
			return false, nil
		}
		driver := &composeTemplateDriver{manager: m, adapter: m.containers}
		project, err := driver.verifyProject(ctx, service)
		if err != nil {
			return false, err
		}
		for _, child := range project.Containers {
			if child.ContainerID == identity {
				return true, nil
			}
		}
		return false, nil
	case ContainerResourceComposeProject:
		if deployment != DeploymentCompose || strings.TrimSpace(service.RuntimeIdentity) == "" {
			return false, nil
		}
		driver := &composeTemplateDriver{manager: m, adapter: m.containers}
		if err := driver.verifyIdentity(service); err != nil {
			return false, err
		}
		return identity == containerengine.ComposeProjectID(driver.projectName(service)), nil
	case ContainerResourceVolume:
		return m.serviceOwnsVolume(ctx, service, identity)
	default:
		return false, nil
	}
}

func (m *Manager) serviceOwnsVolume(ctx context.Context, service *pfregistry.ManagedService, identity string) (bool, error) {
	if service == nil || strings.TrimSpace(identity) == "" {
		return false, nil
	}
	switch Deployment(service.Deployment) {
	case DeploymentDocker:
		driver := &dockerDriver{stateDir: m.stateDir}
		raw, err := os.ReadFile(driver.markerPath())
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		var marker retainedDockerVolume
		if err := decodeStrictJSON(raw, &marker); err != nil {
			return false, err
		}
		return marker.Name == identity, nil
	case DeploymentContainer:
		driver := &containerTemplateDriver{manager: m}
		marker, err := driver.loadVolumeSet(service)
		if err != nil {
			return false, err
		}
		for _, volume := range marker.Volumes {
			if volume.Name == identity {
				return true, nil
			}
		}
	case DeploymentCompose:
		driver := &composeTemplateDriver{manager: m, adapter: m.containers}
		project, err := driver.verifyProject(ctx, service)
		if err != nil {
			return false, err
		}
		for _, child := range project.Containers {
			inspected, err := m.containers.Inspect(ctx, containerengine.ContainerInspectRequest{
				Engine: containerengine.EngineDocker, ContainerID: child.ContainerID,
			})
			if err != nil {
				return false, err
			}
			for _, mount := range inspected.Container.Runtime.Mounts {
				if mount.Type == containerengine.MountTypeVolume && mount.Source == identity {
					return true, nil
				}
			}
		}
	}
	return false, nil
}

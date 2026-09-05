package containerresource

import (
	"context"
	"encoding/json"
	"path/filepath"
	"sort"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

func (s *Service) Runtimes(ctx context.Context) (containerengine.ActiveRuntimeResponse, error) {
	return s.engine.ActiveRuntimes(ctx)
}

func (s *Service) ContainerServices(ctx context.Context) (containerengine.ContainerServicesResponse, error) {
	response, err := s.engine.ContainerServices(ctx)
	if err != nil {
		return containerengine.ContainerServicesResponse{}, err
	}
	for index := range response.Services {
		for _, sourceID := range response.Services[index].ConfigurationAccess.Sources {
			state, stateErr := s.store.containerServiceConfigurationState(ctx, response.Services[index].ServiceID, sourceID)
			if stateErr != nil {
				return containerengine.ContainerServicesResponse{}, stateErr
			}
			response.Services[index].RestartRequired = response.Services[index].RestartRequired || state.RestartRequired
		}
	}
	return response, nil
}

func (s *Service) ContainerServiceConfiguration(ctx context.Context, serviceID string) (containerengine.ContainerServiceConfiguration, error) {
	configuration, err := s.engine.ContainerServiceConfiguration(ctx, serviceID)
	if err != nil {
		return containerengine.ContainerServiceConfiguration{}, err
	}
	for index := range configuration.Sources {
		state, stateErr := s.store.containerServiceConfigurationState(ctx, serviceID, configuration.Sources[index].SourceID)
		if stateErr != nil {
			return containerengine.ContainerServiceConfiguration{}, stateErr
		}
		configuration.Sources[index].RestartRequired = state.RestartRequired
	}
	return configuration, nil
}

func (s *Service) Containers(ctx context.Context, req containerengine.ContainerListRequest) ([]ContainerItem, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	response, err := s.engine.List(bound, req)
	if err != nil {
		return nil, err
	}
	result := make([]ContainerItem, 0, len(response.Containers))
	for _, item := range response.Containers {
		management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceContainer, item.ContainerID, nil)
		if err != nil {
			return nil, err
		}
		result = append(result, ContainerItem{ContainerSummary: item, Management: management})
	}
	return result, nil
}

func (s *Service) Container(ctx context.Context, req containerengine.ContainerInspectRequest) (ContainerDetails, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return ContainerDetails{}, err
	}
	response, err := s.engine.Inspect(bound, req)
	if err != nil {
		return ContainerDetails{}, err
	}
	management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceContainer, response.Container.ContainerID, nil)
	if err != nil {
		return ContainerDetails{}, err
	}
	return ContainerDetails{ContainerInspect: response.Container, Management: management}, nil
}

func (s *Service) PrepareContainerExec(ctx context.Context, req containerengine.ContainerExecRequest) (containerengine.ProgramSpec, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ProgramSpec{}, err
	}
	management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceContainer, req.ContainerID, nil)
	if err != nil {
		return containerengine.ProgramSpec{}, err
	}
	if management.Managed {
		return containerengine.ProgramSpec{}, &ManagedResourceError{Owner: *management.Owner}
	}
	return s.engine.ContainerExecProgram(bound, req)
}

func (s *Service) Images(ctx context.Context, req containerengine.ImageListRequest) ([]containerengine.ImageRecord, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	return s.engine.ListImages(bound, req.Engine)
}

func (s *Service) Image(ctx context.Context, req containerengine.ImageInspectRequest) (containerengine.ImageRecord, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ImageRecord{}, err
	}
	return s.engine.InspectImage(bound, req)
}

func (s *Service) ImageBuildHistory(ctx context.Context, req containerengine.ImageBuildHistoryRequest) ([]containerengine.ImageBuildHistoryEntry, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	return s.engine.BuildHistoryImage(bound, req)
}

func (s *Service) Volumes(ctx context.Context, req containerengine.VolumeListRequest) ([]VolumeItem, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	items, err := s.engine.ListVolumes(bound, req.Engine)
	if err != nil {
		return nil, err
	}
	result := make([]VolumeItem, 0, len(items))
	for _, item := range items {
		management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceVolume, item.Name, nil)
		if err != nil {
			return nil, err
		}
		result = append(result, VolumeItem{VolumeRecord: item, Management: management})
	}
	return result, nil
}

func (s *Service) Volume(ctx context.Context, req containerengine.VolumeInspectRequest) (VolumeItem, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return VolumeItem{}, err
	}
	item, err := s.engine.InspectVolume(bound, req)
	if err != nil {
		return VolumeItem{}, err
	}
	management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceVolume, item.Name, nil)
	if err != nil {
		return VolumeItem{}, err
	}
	return VolumeItem{VolumeRecord: item, Management: management}, nil
}

func (s *Service) ComposeProjects(ctx context.Context, req containerengine.ComposeProjectListRequest) ([]ComposeProjectItem, error) {
	items, err := s.engine.ListComposeProjects(ctx, req)
	if err != nil {
		return nil, err
	}
	definitions, err := s.store.composeProjectDefinitions(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	savedNames := make(map[string]struct{}, len(definitions))
	observed := make(map[string]containerengine.ComposeProject, len(items))
	for _, item := range items {
		observed[item.Name] = item
	}
	result := make([]ComposeProjectItem, 0, len(items)+len(definitions))
	for _, definition := range definitions {
		savedNames[definition.Name] = struct{}{}
		project, present := observed[definition.Name]
		if !present {
			project = containerengine.ComposeProject{Name: definition.Name, Status: "stopped"}
		}
		project.ProjectID = definition.ProjectID
		management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceComposeProject, containerengine.ComposeProjectID(definition.Name), nil)
		if err != nil {
			return nil, err
		}
		source := ""
		if len(definition.ConfigPaths) > 0 {
			source = filepath.Base(definition.ConfigPaths[0])
		}
		result = append(result, ComposeProjectItem{ComposeProject: project, Management: management, Saved: true, Source: source})
	}
	for _, item := range items {
		if _, saved := savedNames[item.Name]; saved {
			continue
		}
		management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceComposeProject, item.ProjectID, nil)
		if err != nil {
			return nil, err
		}
		result = append(result, ComposeProjectItem{ComposeProject: item, Management: management})
	}
	sort.Slice(result, func(left, right int) bool { return result[left].Name < result[right].Name })
	return result, nil
}

func (s *Service) ComposeProject(ctx context.Context, req containerengine.ComposeProjectRequest) (containerengine.ComposeProjectDetails, Management, error) {
	if err := s.hydrateSavedComposeRequest(ctx, &req); err != nil {
		return containerengine.ComposeProjectDetails{}, Management{}, err
	}
	item, err := s.engine.InspectComposeProject(ctx, req)
	if err != nil {
		return containerengine.ComposeProjectDetails{}, Management{}, err
	}
	managementIdentity := item.ProjectID
	if req.Deployment != nil {
		managementIdentity = containerengine.ComposeProjectID(item.Name)
	}
	management, err := s.management(ctx, req.Engine, req.EndpointID, ResourceComposeProject, managementIdentity, nil)
	return item, management, err
}

func (s *Service) Pods(ctx context.Context, req containerengine.PodListRequest) ([]containerengine.PodRecord, error) {
	return s.engine.ListPods(ctx, req)
}

func (s *Service) Pod(ctx context.Context, req containerengine.PodRequest) (containerengine.PodRecord, error) {
	return s.engine.InspectPod(ctx, req)
}

func (s *Service) TailLogs(ctx context.Context, req containerengine.LogsTailRequest) (containerengine.LogsTailResponse, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.LogsTailResponse{}, err
	}
	return s.engine.TailLogs(bound, req)
}

func (s *Service) FollowLogs(ctx context.Context, req containerengine.LogsTailRequest, sink containerengine.LogLineSink) error {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return err
	}
	return s.engine.FollowLogs(bound, req, sink)
}

func (s *Service) Stats(ctx context.Context, req containerengine.ContainerStatsWatchRequest) (containerengine.ContainerStats, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ContainerStats{}, err
	}
	stats, err := s.engine.Stats(bound, req.Engine, req.ContainerID)
	if err != nil {
		return containerengine.ContainerStats{}, err
	}
	stats.SampledAtUnixMs = time.Now().UnixMilli()
	return stats, nil
}

func (s *Service) StatsCollection(ctx context.Context, req containerengine.ContainerStatsCollectionRequest) (containerengine.ContainerStatsCollection, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ContainerStatsCollection{}, err
	}
	return s.engine.StatsCollection(bound, req)
}

func (s *Service) RawContainerInspect(ctx context.Context, req containerengine.ContainerInspectRequest) (json.RawMessage, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return nil, err
	}
	return s.engine.RawContainerInspect(bound, req)
}

func (s *Service) ListVolumeFiles(ctx context.Context, req containerengine.VolumeFileRequest) (containerengine.ResourceFileListing, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ResourceFileListing{}, err
	}
	return s.engine.ListVolumeFiles(bound, req)
}

func (s *Service) ReadVolumeFile(ctx context.Context, req containerengine.VolumeFileRequest) (containerengine.ResourceFileContent, error) {
	bound, _, err := s.engine.BindEndpoint(ctx, req.Engine, req.EndpointID)
	if err != nil {
		return containerengine.ResourceFileContent{}, err
	}
	return s.engine.ReadVolumeFile(bound, req)
}

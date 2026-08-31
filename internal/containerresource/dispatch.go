package containerresource

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/floegence/redeven/internal/containerengine"
)

type executionResult struct {
	Identity        string
	State           string
	Revision        string
	RestartRequired bool
}

func (s *Service) execute(ctx context.Context, operationID string, decoded decodedMutation) (executionResult, error) {
	bound := ctx
	var err error
	if decoded.preflight.ResourceKind != ResourceContainerService {
		bound, _, err = s.engine.BindEndpoint(ctx, decoded.preflight.Engine, decoded.preflight.EndpointID)
		if err != nil {
			return executionResult{}, err
		}
	}
	switch req := decoded.request.(type) {
	case *containerengine.ContainerCreateRequest:
		result, err := s.engine.Create(bound, *req)
		return executionResult{Identity: result.ContainerID}, err
	case *containerengine.ContainerActionRequest:
		var result containerengine.ContainerActionResponse
		switch decoded.preflight.Method {
		case containerengine.MethodStart:
			result, err = s.engine.Start(bound, containerengine.ContainerStartRequest{Engine: req.Engine, EndpointID: req.EndpointID, ContainerID: req.ContainerID})
		case containerengine.MethodStop:
			result, err = s.engine.Stop(bound, *req)
		case containerengine.MethodRestart:
			result, err = s.engine.Restart(bound, *req)
		case containerengine.MethodRemove:
			result, err = s.engine.Remove(bound, *req)
		case containerengine.MethodPause:
			result, err = s.engine.Pause(bound, *req)
		case containerengine.MethodUnpause:
			result, err = s.engine.Unpause(bound, *req)
		case containerengine.MethodKill:
			result, err = s.engine.Kill(bound, *req)
		default:
			err = containerengine.ErrInvalidMethod
		}
		return executionResult{Identity: result.ContainerID}, err
	case *containerengine.ImagePullRequest:
		_, err := s.engine.PullImageWithProgress(bound, *req, func(_ context.Context, progress containerengine.ImagePullProgress) error {
			s.reportProgress(operationID, OperationProgress{
				Phase: progress.Phase, Completed: progress.Completed, Total: progress.Total, Unit: progress.Unit,
			})
			return nil
		})
		return executionResult{Identity: req.ImageRef}, err
	case *containerengine.ImageTagRequest:
		err := s.engine.TagImage(bound, *req)
		return executionResult{Identity: req.Tag}, err
	case *containerengine.ImageRemovePreflightRequest:
		err := s.engine.RemoveImage(bound, containerengine.ImageRemoveRequest{
			Engine: req.Engine, EndpointID: req.EndpointID, Image: req.Image, Force: req.Force,
		})
		return executionResult{Identity: req.Image}, err
	case *containerengine.ResourcePruneRequest:
		if decoded.preflight.Method == containerengine.MethodImagesPrune {
			err := s.engine.PruneImages(bound, *req)
			return executionResult{Identity: "prune"}, err
		}
		err := s.engine.PruneVolumes(bound, *req)
		return executionResult{Identity: "prune"}, err
	case *containerengine.VolumeCreateRequest:
		result, err := s.engine.CreateVolume(bound, *req)
		return executionResult{Identity: result.Name}, err
	case *containerengine.VolumeRemovePreflightRequest:
		err := s.engine.RemoveVolume(bound, containerengine.VolumeRemoveRequest{Engine: req.Engine, EndpointID: req.EndpointID, Name: req.Name})
		return executionResult{Identity: req.Name}, err
	case *containerengine.ComposeProjectRequest:
		result, err := s.engine.ComposeProjectAction(bound, decoded.preflight.Method, *req)
		return executionResult{Identity: result.Identity}, err
	case *containerengine.PodCreateRequest:
		result, err := s.engine.CreatePod(bound, *req)
		return executionResult{Identity: result.PodID}, err
	case *containerengine.PodRequest:
		result, err := s.engine.PodAction(bound, decoded.preflight.Method, *req)
		return executionResult{Identity: result.Identity}, err
	case *containerengine.ContainerServiceActionRequest:
		result, err := s.engine.ContainerServiceAction(ctx, decoded.preflight.Method, *req)
		if err == nil && (decoded.preflight.Method == containerengine.MethodContainerServicesStart || decoded.preflight.Method == containerengine.MethodContainerServicesRestart) {
			state, stateErr := s.store.containerServiceConfigurationState(ctx, req.ServiceID)
			if stateErr != nil {
				return executionResult{}, stateErr
			}
			state.RestartRequired = false
			state.UpdatedAtUnixMs = 0
			if storeErr := s.store.upsertContainerServiceConfigurationState(ctx, state); storeErr != nil {
				return executionResult{}, storeErr
			}
		}
		return executionResult{Identity: result.ServiceID, State: string(result.State)}, err
	case *containerengine.ContainerServiceConfigurationUpdateRequest:
		result, err := s.engine.UpdateContainerServiceConfiguration(ctx, *req)
		if err != nil {
			return executionResult{}, err
		}
		service, serviceErr := s.engine.ContainerService(ctx, req.ServiceID)
		if serviceErr != nil {
			return executionResult{}, serviceErr
		}
		if storeErr := s.store.upsertContainerServiceConfigurationState(ctx, ContainerServiceConfigurationState{
			ServiceID: req.ServiceID, ConfigurationRevision: result.Revision, RestartRequired: result.RestartRequired,
			ServiceGeneration: service.Generation,
		}); storeErr != nil {
			return executionResult{}, storeErr
		}
		return executionResult{Identity: result.ServiceID, State: string(result.State), Revision: result.Revision, RestartRequired: result.RestartRequired}, nil
	default:
		return executionResult{}, ErrInvalidRequest
	}
}

func (s *Service) reconcile(ctx context.Context, decoded decodedMutation, result executionResult) (json.RawMessage, error) {
	bound := ctx
	var err error
	if decoded.preflight.ResourceKind != ResourceContainerService {
		bound, _, err = s.engine.BindEndpoint(ctx, decoded.preflight.Engine, decoded.preflight.EndpointID)
		if err != nil {
			return nil, err
		}
	}
	status := struct {
		Status   string `json:"status"`
		Outcome  string `json:"outcome"`
		Identity string `json:"identity,omitempty"`
		State    string `json:"state,omitempty"`
	}{Status: "verified", Outcome: "present", Identity: result.Identity}

	switch req := decoded.request.(type) {
	case *containerengine.ContainerCreateRequest:
		if result.Identity == "" {
			return nil, errors.New("container creation returned no identity")
		}
		var inspected containerengine.ContainerInspectResponse
		inspected, err = s.engine.Inspect(bound, containerengine.ContainerInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, ContainerID: result.Identity})
		if err == nil {
			status.State = string(inspected.Container.State)
		}
	case *containerengine.ContainerActionRequest:
		var inspected containerengine.ContainerInspectResponse
		inspected, err = s.engine.Inspect(bound, containerengine.ContainerInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, ContainerID: req.ContainerID})
		if decoded.preflight.Method == containerengine.MethodRemove && errors.Is(err, containerengine.ErrContainerNotFound) {
			err = nil
			status.Outcome = "absent"
		} else if err == nil {
			status.State = string(inspected.Container.State)
			err = requireContainerState(decoded.preflight.Method, inspected.Container.State)
		}
	case *containerengine.ImagePullRequest:
		_, err = s.engine.InspectImage(bound, containerengine.ImageInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, Image: req.ImageRef})
	case *containerengine.ImageTagRequest:
		_, err = s.engine.InspectImage(bound, containerengine.ImageInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, Image: req.Tag})
	case *containerengine.ImageRemovePreflightRequest:
		_, err = s.engine.InspectImage(bound, containerengine.ImageInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, Image: req.Image})
		if errors.Is(err, containerengine.ErrImageNotFound) {
			err = nil
			status.Outcome = "absent"
		}
	case *containerengine.ResourcePruneRequest:
		// The engine adapter reconciles exact prune sets before returning.
		status.Outcome = "exact_set_absent"
	case *containerengine.VolumeCreateRequest:
		_, err = s.engine.InspectVolume(bound, containerengine.VolumeInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, Name: result.Identity})
	case *containerengine.VolumeRemovePreflightRequest:
		_, err = s.engine.InspectVolume(bound, containerengine.VolumeInspectRequest{Engine: req.Engine, EndpointID: req.EndpointID, Name: req.Name})
		if err != nil {
			// Container CLIs do not expose a shared typed volume-not-found error.
			items, listErr := s.engine.ListVolumes(bound, req.Engine)
			if listErr != nil {
				return nil, listErr
			}
			present := false
			for _, item := range items {
				present = present || item.Name == req.Name
			}
			if !present {
				err = nil
				status.Outcome = "absent"
			}
		}
	case *containerengine.ComposeProjectRequest:
		var inspected containerengine.ComposeProjectDetails
		inspected, err = s.engine.InspectComposeProject(bound, *req)
		if decoded.preflight.Method == containerengine.MethodComposeProjectsDown && req.Deployment != nil && err == nil && inspected.ContainerCount == 0 {
			status.Outcome = "absent"
			break
		}
		if decoded.preflight.Method == containerengine.MethodComposeProjectsDown && err != nil {
			items, listErr := s.engine.ListComposeProjects(bound, containerengine.ComposeProjectListRequest{Engine: req.Engine, EndpointID: req.EndpointID})
			if listErr != nil {
				return nil, listErr
			}
			present := false
			for _, item := range items {
				present = present || item.ProjectID == req.ProjectID
			}
			if !present {
				err = nil
				status.Outcome = "absent"
			}
		} else if err == nil {
			status.State = inspected.Status
			err = requireWorkspaceState(decoded.preflight.Method, inspected.Status)
		}
	case *containerengine.PodCreateRequest:
		var inspected containerengine.PodRecord
		inspected, err = s.engine.InspectPod(bound, containerengine.PodRequest{Engine: req.Engine, EndpointID: req.EndpointID, PodID: result.Identity})
		if err == nil {
			status.State = inspected.Status
		}
	case *containerengine.PodRequest:
		var inspected containerengine.PodRecord
		inspected, err = s.engine.InspectPod(bound, *req)
		if decoded.preflight.Method == containerengine.MethodPodsRemove && err != nil {
			items, listErr := s.engine.ListPods(bound, containerengine.PodListRequest{Engine: req.Engine, EndpointID: req.EndpointID})
			if listErr != nil {
				return nil, listErr
			}
			present := false
			for _, item := range items {
				present = present || item.PodID == req.PodID
			}
			if !present {
				err = nil
				status.Outcome = "absent"
			}
		} else if err == nil {
			status.State = inspected.Status
			err = requireWorkspaceState(decoded.preflight.Method, inspected.Status)
		}
	case *containerengine.ContainerServiceActionRequest:
		var service containerengine.ContainerService
		service, err = s.engine.ContainerService(ctx, req.ServiceID)
		if err == nil {
			status.State = string(service.State)
			err = requireContainerServiceState(decoded.preflight.Method, service.State)
		}
	case *containerengine.ContainerServiceConfigurationUpdateRequest:
		var configuration containerengine.ContainerServiceConfiguration
		configuration, err = s.engine.ContainerServiceConfiguration(ctx, req.ServiceID)
		if err == nil && result.Revision != "" && configuration.BaseRevision != result.Revision {
			err = errors.New("container service configuration revision was not reconciled")
		}
		status.State = result.State
	}
	if err != nil {
		return nil, err
	}
	return json.Marshal(status)
}

func requireContainerServiceState(method containerengine.Method, state containerengine.ContainerServiceState) error {
	matched := false
	switch method {
	case containerengine.MethodContainerServicesStart, containerengine.MethodContainerServicesRestart:
		matched = state == containerengine.ContainerServiceStateRunning
	case containerengine.MethodContainerServicesStop:
		matched = state == containerengine.ContainerServiceStateStopped
	default:
		return nil
	}
	if !matched {
		return errors.New("container service lifecycle state was not reconciled")
	}
	return nil
}

func requireContainerState(method containerengine.Method, state containerengine.ContainerState) error {
	matched := false
	switch method {
	case containerengine.MethodStart, containerengine.MethodRestart, containerengine.MethodUnpause:
		matched = state == containerengine.ContainerStateRunning
	case containerengine.MethodStop, containerengine.MethodKill:
		matched = state == containerengine.ContainerStateStopped || state == containerengine.ContainerStateExited
	case containerengine.MethodPause:
		matched = state == containerengine.ContainerStatePaused
	case containerengine.MethodRemove:
		matched = false
	default:
		return nil
	}
	if !matched {
		return errors.New("container lifecycle state was not reconciled")
	}
	return nil
}

func requireWorkspaceState(method containerengine.Method, state string) error {
	matched := false
	switch method {
	case containerengine.MethodComposeProjectsStart, containerengine.MethodComposeProjectsRestart,
		containerengine.MethodPodsStart, containerengine.MethodPodsRestart:
		matched = state == "running"
	case containerengine.MethodComposeProjectsStop, containerengine.MethodPodsStop:
		matched = state == "stopped" || state == "exited"
	case containerengine.MethodComposeProjectsDown, containerengine.MethodPodsRemove:
		matched = false
	default:
		return nil
	}
	if !matched {
		return errors.New("container workspace lifecycle state was not reconciled")
	}
	return nil
}

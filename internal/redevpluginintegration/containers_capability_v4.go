package redevpluginintegration

import (
	"context"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redevplugin/v3/pkg/capability"
)

type endpointStatusArguments struct {
	Engine     containers.Engine     `json:"engine"`
	EndpointID containers.EndpointID `json:"endpoint_id"`
}

type composeProjectArguments struct {
	Engine           containers.Engine     `json:"engine"`
	EndpointID       containers.EndpointID `json:"endpoint_id"`
	ProjectID        string                `json:"project_id"`
	Action           containers.Method     `json:"action,omitempty"`
	ConfirmationName string                `json:"confirmation_name,omitempty"`
}

type podArguments struct {
	Engine           containers.Engine     `json:"engine"`
	EndpointID       containers.EndpointID `json:"endpoint_id"`
	PodID            string                `json:"pod_id"`
	Action           containers.Method     `json:"action,omitempty"`
	ConfirmationName string                `json:"confirmation_name,omitempty"`
}

func (a *containersCapabilityAdapter) invokeWorkspaceSync(ctx context.Context, method containers.Method, arguments map[string]any) (capability.Result, error) {
	switch method {
	case containers.MethodEndpointsList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		result, err := a.containers.ListEndpoints(ctx, containers.EndpointListRequest{Engine: input.Engine})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "endpoints": result.Endpoints})
	case containers.MethodEndpointsStatus:
		var input endpointStatusArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		result, err := a.containers.EndpointStatus(ctx, containers.EndpointStatusRequest{Engine: input.Engine, EndpointID: input.EndpointID})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"endpoint": result})
	case containers.MethodComposeProjectsList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		items, err := a.containers.ListComposeProjects(ctx, containers.ComposeProjectListRequest{Engine: input.Engine, EndpointID: input.EndpointID})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "endpoint_id": input.EndpointID, "projects": items})
	case containers.MethodComposeProjectsInspect:
		var input composeProjectArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		item, err := a.containers.InspectComposeProject(ctx, composeRequest(input))
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "endpoint_id": input.EndpointID, "project": item})
	case containers.MethodComposeProjectsPreflight:
		var input composeProjectArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.ComposeProjectPreflight(ctx, input.Action, composeRequest(input))
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodPodsList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		items, err := a.containers.ListPods(ctx, containers.PodListRequest{Engine: input.Engine, EndpointID: input.EndpointID})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "endpoint_id": input.EndpointID, "pods": items})
	case containers.MethodPodsInspect:
		var input podArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		item, err := a.containers.InspectPod(ctx, podRequest(input))
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "endpoint_id": input.EndpointID, "pod": item})
	case containers.MethodPodsCreatePreflight:
		var input containers.PodCreateRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.CreatePodPreflight(ctx, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodPodsActionPreflight:
		var input podArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.PodActionPreflight(ctx, input.Action, podRequest(input))
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	default:
		return capability.Result{}, fmt.Errorf("%w: %q is not an engine workspace read method", containers.ErrInvalidMethod, method)
	}
}

func (a *containersCapabilityAdapter) workspaceOperation(method containers.Method, arguments map[string]any) (map[string]any, func(context.Context) error, error) {
	switch method {
	case containers.MethodComposeProjectsStart, containers.MethodComposeProjectsStop,
		containers.MethodComposeProjectsRestart, containers.MethodComposeProjectsDown:
		var input composeProjectArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		request := composeRequest(input)
		accepted := map[string]any{"accepted": true, "engine": string(input.Engine), "endpoint_id": input.EndpointID, "method": string(method), "project_id": input.ProjectID}
		return accepted, func(ctx context.Context) error {
			_, err := a.containers.ComposeProjectAction(ctx, method, request)
			return err
		}, nil
	case containers.MethodPodsCreate:
		var input containers.PodCreateRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		accepted := map[string]any{"accepted": true, "engine": string(input.Engine), "endpoint_id": input.EndpointID, "method": string(method), "name": strings.TrimSpace(input.Name)}
		return accepted, func(ctx context.Context) error {
			_, err := a.containers.CreatePod(ctx, input)
			return err
		}, nil
	case containers.MethodPodsStart, containers.MethodPodsStop, containers.MethodPodsRestart, containers.MethodPodsRemove:
		var input podArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		request := podRequest(input)
		accepted := map[string]any{"accepted": true, "engine": string(input.Engine), "endpoint_id": input.EndpointID, "method": string(method), "pod_id": input.PodID}
		return accepted, func(ctx context.Context) error {
			_, err := a.containers.PodAction(ctx, method, request)
			return err
		}, nil
	default:
		return nil, nil, fmt.Errorf("%w: %q is not an engine workspace operation", containers.ErrInvalidMethod, method)
	}
}

func composeRequest(input composeProjectArguments) containers.ComposeProjectRequest {
	return containers.ComposeProjectRequest{Engine: input.Engine, EndpointID: input.EndpointID, ProjectID: input.ProjectID, ConfirmationName: input.ConfirmationName}
}

func podRequest(input podArguments) containers.PodRequest {
	return containers.PodRequest{Engine: input.Engine, EndpointID: input.EndpointID, PodID: input.PodID, ConfirmationName: input.ConfirmationName}
}

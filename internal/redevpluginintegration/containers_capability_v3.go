package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redevplugin/v3/pkg/capability"
	"github.com/floegence/redevplugin/v3/pkg/mutation"
)

type imageArguments struct {
	Engine     containers.Engine     `json:"engine"`
	EndpointID containers.EndpointID `json:"endpoint_id,omitempty"`
	Image      string                `json:"image"`
}

type imageTagArguments struct {
	Engine     containers.Engine     `json:"engine"`
	EndpointID containers.EndpointID `json:"endpoint_id,omitempty"`
	Image      string                `json:"image"`
	Tag        string                `json:"tag"`
}

type imageRemoveArguments struct {
	Engine           containers.Engine     `json:"engine"`
	EndpointID       containers.EndpointID `json:"endpoint_id,omitempty"`
	Image            string                `json:"image"`
	Force            bool                  `json:"force,omitempty"`
	ConfirmationName string                `json:"confirmation_name,omitempty"`
}

type volumeArguments struct {
	Engine           containers.Engine     `json:"engine"`
	EndpointID       containers.EndpointID `json:"endpoint_id,omitempty"`
	Name             string                `json:"name"`
	ConfirmationName string                `json:"confirmation_name,omitempty"`
}

type volumeCreateArguments struct {
	Engine     containers.Engine         `json:"engine"`
	EndpointID containers.EndpointID     `json:"endpoint_id,omitempty"`
	Name       string                    `json:"name,omitempty"`
	Driver     string                    `json:"driver,omitempty"`
	Options    []containers.VolumeOption `json:"options,omitempty"`
}

type resourcePruneArguments struct {
	Engine             containers.Engine     `json:"engine"`
	EndpointID         containers.EndpointID `json:"endpoint_id,omitempty"`
	ResourceIdentities []string              `json:"resource_identities,omitempty"`
}

func (a *containersCapabilityAdapter) invokeResourceSync(ctx context.Context, method containers.Method, arguments map[string]any) (capability.Result, error) {
	switch method {
	case containers.MethodContainersStatsSnapshot:
		var input containerArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		stats, err := a.containers.Stats(bound, input.Engine, input.ContainerID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "stats": stats}, input.EndpointID))
	case containers.MethodContainersCreatePreflight:
		var input containers.ContainerCreateRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.CreatePreflight(input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodContainersRemovePreflight:
		var input containers.ContainerRemovePreflightRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		plan, err := a.containers.RemovePreflight(bound, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodImagesList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		items, err := a.containers.ListImages(bound, input.Engine)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "images": items, "partial_failure_count": imageReferenceFailureCount(items)}, input.EndpointID))
	case containers.MethodImagesInspect:
		var input imageArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		item, err := a.containers.InspectImage(bound, containers.ImageInspectRequest{Engine: input.Engine, EndpointID: input.EndpointID, Image: input.Image})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "image": item}, input.EndpointID))
	case containers.MethodImagesHistory:
		var input imageArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		items, err := a.containers.HistoryImage(bound, containers.ImageHistoryRequest{Engine: input.Engine, EndpointID: input.EndpointID, Image: input.Image})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "image": input.Image, "history": items}, input.EndpointID))
	case containers.MethodImagesRemovePreflight:
		var input containers.ImageRemovePreflightRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		plan, err := a.containers.RemoveImagePreflight(bound, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodVolumesList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		items, err := a.containers.ListVolumes(bound, input.Engine)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "volumes": items, "partial_failure_count": volumeReferenceFailureCount(items)}, input.EndpointID))
	case containers.MethodVolumesInspect:
		var input volumeArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		item, err := a.containers.InspectVolume(bound, containers.VolumeInspectRequest{Engine: input.Engine, EndpointID: input.EndpointID, Name: input.Name})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(acceptedWithEndpoint(map[string]any{"engine": string(input.Engine), "volume": item}, input.EndpointID))
	case containers.MethodVolumesCreatePreflight:
		var input containers.VolumeCreateRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.CreateVolumePreflight(input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodVolumesRemovePreflight:
		var input containers.VolumeRemovePreflightRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		plan, err := a.containers.RemoveVolumePreflight(bound, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodImagesPrunePreflight, containers.MethodVolumesPrunePreflight:
		var input resourcePruneArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		var plan containers.ResourcePlan
		var err error
		bound, bindErr := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
		if bindErr != nil {
			return capability.Result{}, containerResourceBusinessError(bindErr)
		}
		if method == containers.MethodImagesPrunePreflight {
			plan, err = a.containers.PruneImagesPreflight(bound, containers.ResourcePruneRequest{Engine: input.Engine, EndpointID: input.EndpointID, ResourceIdentities: input.ResourceIdentities})
		} else {
			plan, err = a.containers.PruneVolumesPreflight(bound, containers.ResourcePruneRequest{Engine: input.Engine, EndpointID: input.EndpointID, ResourceIdentities: input.ResourceIdentities})
		}
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	default:
		return capability.Result{}, fmt.Errorf("%w: %q is not a resource read method", containers.ErrInvalidMethod, method)
	}
}

func (a *containersCapabilityAdapter) resourceOperation(method containers.Method, arguments map[string]any) (map[string]any, func(context.Context) error, error) {
	switch method {
	case containers.MethodContainersCreate:
		var input containers.ContainerCreateRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			_, err = a.containers.Create(bound, input)
			return err
		}, nil
	case containers.MethodPause, containers.MethodUnpause, containers.MethodKill:
		var input containerActionArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		accepted := acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, input.ContainerID), input.EndpointID)
		return accepted, func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			req := containers.ContainerActionRequest{Engine: input.Engine, EndpointID: input.EndpointID, ContainerID: input.ContainerID, TimeoutSec: input.TimeoutSec}
			switch method {
			case containers.MethodPause:
				_, err = a.containers.Pause(bound, req)
			case containers.MethodUnpause:
				_, err = a.containers.Unpause(bound, req)
			case containers.MethodKill:
				_, err = a.containers.Kill(bound, req)
			}
			return err
		}, nil
	case containers.MethodImagesTag:
		var input imageTagArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			return a.containers.TagImage(bound, containers.ImageTagRequest{Engine: input.Engine, EndpointID: input.EndpointID, Image: input.Image, Tag: input.Tag})
		}, nil
	case containers.MethodImagesRemove:
		var input imageRemoveArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			return a.containers.RemoveImage(bound, containers.ImageRemoveRequest{Engine: input.Engine, EndpointID: input.EndpointID, Image: input.Image, Force: input.Force})
		}, nil
	case containers.MethodImagesPrune:
		var input resourcePruneArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			return a.containers.PruneImages(bound, containers.ResourcePruneRequest{Engine: input.Engine, EndpointID: input.EndpointID, ResourceIdentities: input.ResourceIdentities})
		}, nil
	case containers.MethodVolumesCreate:
		var input volumeCreateArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			_, err = a.containers.CreateVolume(bound, containers.VolumeCreateRequest{Engine: input.Engine, EndpointID: input.EndpointID, Name: input.Name, Driver: input.Driver, Options: input.Options})
			return err
		}, nil
	case containers.MethodVolumesRemove:
		var input volumeArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			return a.containers.RemoveVolume(bound, containers.VolumeRemoveRequest{Engine: input.Engine, EndpointID: input.EndpointID, Name: input.Name})
		}, nil
	case containers.MethodVolumesPrune:
		var input resourcePruneArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedWithEndpoint(acceptedResourceOperation(method, input.Engine, ""), input.EndpointID), func(ctx context.Context) error {
			bound, err := a.bindEndpoint(ctx, input.Engine, input.EndpointID)
			if err != nil {
				return err
			}
			return a.containers.PruneVolumes(bound, containers.ResourcePruneRequest{Engine: input.Engine, EndpointID: input.EndpointID, ResourceIdentities: input.ResourceIdentities})
		}, nil
	default:
		return nil, nil, fmt.Errorf("%w: %q is not a resource operation method", containers.ErrInvalidMethod, method)
	}
}

func resourceResult(value map[string]any) (capability.Result, error) {
	prepared, err := projectResourceValue(value)
	if err != nil {
		return capability.Result{}, err
	}
	return capability.Result{Data: prepared}, nil
}

func containerResourceBusinessError(cause error) error {
	code := ""
	message := ""
	switch {
	case errors.Is(cause, containers.ErrResourcePrunePartial):
		code = "CONTAINER_OPERATION_FAILED"
		message = "The container operation failed"
	case errors.Is(cause, containers.ErrResourcePruneReconcile):
		code = "CONTAINER_OPERATION_FAILED"
		message = "The container operation failed"
	case errors.Is(cause, containers.ErrCLIUnavailable):
		code = "CONTAINER_CLI_UNAVAILABLE"
		message = "The selected container engine CLI is not installed"
	case errors.Is(cause, containers.ErrBackendUnreachable):
		code = "CONTAINER_ENGINE_UNREACHABLE"
		message = "The selected container engine service is unreachable"
	case errors.Is(cause, containers.ErrDaemonStopped):
		code = "CONTAINER_DAEMON_STOPPED"
		message = "The selected container engine service is not running"
	case errors.Is(cause, containers.ErrPermissionDenied):
		code = "CONTAINER_PERMISSION_DENIED"
		message = "Permission to access the container engine was denied"
	case errors.Is(cause, containers.ErrEngineTimeout), errors.Is(cause, context.DeadlineExceeded):
		code = "CONTAINER_OPERATION_TIMEOUT"
		message = "The container engine operation timed out"
	case errors.Is(cause, containers.ErrReferenceStateIncomplete):
		code = "CONTAINER_REFERENCE_STATE_INCOMPLETE"
		message = "Container reference state is incomplete"
	case errors.Is(cause, containers.ErrEndpointNotFound):
		code = "CONTAINER_ENDPOINT_NOT_FOUND"
		message = "The selected container engine endpoint is unavailable"
	default:
		return containerBusinessError(cause)
	}
	businessError, err := capability.NewBusinessError(code, message, nil)
	if err != nil {
		return errors.New("container resource capability business error is invalid")
	}
	return businessError
}

func containerBusinessErrorForBinding(binding capability.ExecutionBinding, cause error) error {
	var mapped error
	if binding.CapabilityVersion == containersCapabilityV3Version || binding.CapabilityVersion == containersCapabilityV4Version {
		mapped = containerResourceBusinessError(cause)
	} else {
		mapped = containerBusinessError(cause)
	}
	if errors.Is(cause, containers.ErrResourcePrunePartial) || errors.Is(cause, containers.ErrResourcePruneReconcile) {
		return mutation.Unknown(mapped)
	}
	return mapped
}

func imageReferenceFailureCount(items []containers.ImageRecord) int {
	count := 0
	for _, item := range items {
		if item.ReferenceInspectionFailures > count {
			count = item.ReferenceInspectionFailures
		}
	}
	return count
}

func volumeReferenceFailureCount(items []containers.VolumeRecord) int {
	count := 0
	for _, item := range items {
		if item.ReferenceInspectionFailures > count {
			count = item.ReferenceInspectionFailures
		}
	}
	return count
}

func resourcePlanResult(plan containers.ResourcePlan) (capability.Result, error) {
	riskFlags := plan.RiskFlags
	if riskFlags == nil {
		riskFlags = []containers.RiskFlag{}
	}
	projectedRequest, err := projectResourcePlanRequest(plan)
	if err != nil {
		return capability.Result{}, err
	}
	return resourceResult(map[string]any{
		"method":         string(plan.Method),
		"target":         projectResourcePlanTarget(plan.Target),
		"request":        projectedRequest,
		"risk_level":     string(plan.RiskLevel),
		"risk_flags":     riskFlags,
		"requires_admin": plan.RequiresAdmin,
		"summary":        plan.Summary,
		"plan_digest":    plan.PlanDigest,
	})
}

func projectResourcePlanRequest(plan containers.ResourcePlan) (map[string]any, error) {
	prepared, err := projectResourceValue(plan.Request)
	if err != nil {
		return nil, err
	}
	source, ok := prepared.(map[string]any)
	if !ok {
		return nil, errors.New("container resource plan request is not an object")
	}
	out := make(map[string]any)
	for _, key := range []string{"engine", "endpoint_id", "container_id", "name", "force", "confirmation_name", "resource_identities", "project_id", "pod_id"} {
		if value, exists := source[key]; exists {
			out[key] = value
		}
	}
	if value, exists := plan.Target["driver"]; exists {
		out["driver"] = value
	}
	if value, exists := plan.Target["option_keys"]; exists {
		out["option_keys"] = value
	}
	return out, nil
}

func projectResourcePlanTarget(target map[string]any) map[string]any {
	out := make(map[string]any)
	for _, key := range []string{
		"engine", "endpoint_id", "resource_kind", "identity", "image", "container_id", "container_name", "state", "name", "driver", "project_id", "pod_id", "container_count",
		"option_keys", "referenced_containers", "reclaimable_bytes", "resource_count", "resource_identities",
	} {
		if value, exists := target[key]; exists {
			out[key] = value
		}
	}
	return out
}

func acceptedResourceOperation(method containers.Method, engine containers.Engine, containerID string) map[string]any {
	accepted := map[string]any{"accepted": true, "engine": string(engine), "method": string(method)}
	if strings.TrimSpace(containerID) != "" {
		accepted["container_id"] = strings.TrimSpace(containerID)
	}
	return accepted
}

func projectResourceValue(value any) (any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("project container resource response: %w", err)
	}
	var prepared any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&prepared); err != nil {
		return nil, fmt.Errorf("project container resource response: %w", err)
	}
	return prepared, nil
}

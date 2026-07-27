package redevpluginintegration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/capabilities/containers"
	"github.com/floegence/redevplugin/pkg/capability"
	"github.com/floegence/redevplugin/pkg/mutation"
)

type imageArguments struct {
	Engine containers.Engine `json:"engine"`
	Image  string            `json:"image"`
}

type imageTagArguments struct {
	Engine containers.Engine `json:"engine"`
	Image  string            `json:"image"`
	Tag    string            `json:"tag"`
}

type imageRemoveArguments struct {
	Engine           containers.Engine `json:"engine"`
	Image            string            `json:"image"`
	Force            bool              `json:"force,omitempty"`
	ConfirmationName string            `json:"confirmation_name,omitempty"`
}

type volumeArguments struct {
	Engine           containers.Engine `json:"engine"`
	Name             string            `json:"name"`
	ConfirmationName string            `json:"confirmation_name,omitempty"`
}

type volumeCreateArguments struct {
	Engine  containers.Engine         `json:"engine"`
	Name    string                    `json:"name,omitempty"`
	Driver  string                    `json:"driver,omitempty"`
	Options []containers.VolumeOption `json:"options,omitempty"`
}

type resourcePruneArguments struct {
	Engine             containers.Engine `json:"engine"`
	ResourceIdentities []string          `json:"resource_identities,omitempty"`
}

func (a *containersCapabilityAdapter) invokeResourceSync(ctx context.Context, method containers.Method, arguments map[string]any) (capability.Result, error) {
	switch method {
	case containers.MethodContainersStatsSnapshot:
		var input containerArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		stats, err := a.containers.Stats(ctx, input.Engine, input.ContainerID)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "stats": stats})
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
		plan, err := a.containers.RemovePreflight(ctx, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodImagesList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		items, err := a.containers.ListImages(ctx, input.Engine)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "images": items, "partial_failure_count": imageReferenceFailureCount(items)})
	case containers.MethodImagesInspect:
		var input imageArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		item, err := a.containers.InspectImage(ctx, containers.ImageInspectRequest{Engine: input.Engine, Image: input.Image})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "image": item})
	case containers.MethodImagesHistory:
		var input imageArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		items, err := a.containers.HistoryImage(ctx, containers.ImageHistoryRequest{Engine: input.Engine, Image: input.Image})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "image": input.Image, "history": items})
	case containers.MethodImagesRemovePreflight:
		var input containers.ImageRemovePreflightRequest
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		plan, err := a.containers.RemoveImagePreflight(ctx, input)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourcePlanResult(plan)
	case containers.MethodVolumesList:
		var input engineArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		items, err := a.containers.ListVolumes(ctx, input.Engine)
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "volumes": items, "partial_failure_count": volumeReferenceFailureCount(items)})
	case containers.MethodVolumesInspect:
		var input volumeArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return capability.Result{}, err
		}
		item, err := a.containers.InspectVolume(ctx, containers.VolumeInspectRequest{Engine: input.Engine, Name: input.Name})
		if err != nil {
			return capability.Result{}, containerResourceBusinessError(err)
		}
		return resourceResult(map[string]any{"engine": string(input.Engine), "volume": item})
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
		plan, err := a.containers.RemoveVolumePreflight(ctx, input)
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
		if method == containers.MethodImagesPrunePreflight {
			plan, err = a.containers.PruneImagesPreflight(ctx, containers.ResourcePruneRequest{Engine: input.Engine, ResourceIdentities: input.ResourceIdentities})
		} else {
			plan, err = a.containers.PruneVolumesPreflight(ctx, containers.ResourcePruneRequest{Engine: input.Engine, ResourceIdentities: input.ResourceIdentities})
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
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			_, err := a.containers.Create(ctx, input)
			return err
		}, nil
	case containers.MethodPause, containers.MethodUnpause, containers.MethodKill:
		var input containerActionArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		accepted := acceptedResourceOperation(method, input.Engine, input.ContainerID)
		return accepted, func(ctx context.Context) error {
			req := containers.ContainerActionRequest{Engine: input.Engine, ContainerID: input.ContainerID, TimeoutSec: input.TimeoutSec}
			var err error
			switch method {
			case containers.MethodPause:
				_, err = a.containers.Pause(ctx, req)
			case containers.MethodUnpause:
				_, err = a.containers.Unpause(ctx, req)
			case containers.MethodKill:
				_, err = a.containers.Kill(ctx, req)
			}
			return err
		}, nil
	case containers.MethodImagesTag:
		var input imageTagArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			return a.containers.TagImage(ctx, containers.ImageTagRequest{Engine: input.Engine, Image: input.Image, Tag: input.Tag})
		}, nil
	case containers.MethodImagesRemove:
		var input imageRemoveArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			return a.containers.RemoveImage(ctx, containers.ImageRemoveRequest{Engine: input.Engine, Image: input.Image, Force: input.Force})
		}, nil
	case containers.MethodImagesPrune:
		var input resourcePruneArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			return a.containers.PruneImages(ctx, containers.ResourcePruneRequest{Engine: input.Engine, ResourceIdentities: input.ResourceIdentities})
		}, nil
	case containers.MethodVolumesCreate:
		var input volumeCreateArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			_, err := a.containers.CreateVolume(ctx, containers.VolumeCreateRequest{Engine: input.Engine, Name: input.Name, Driver: input.Driver, Options: input.Options})
			return err
		}, nil
	case containers.MethodVolumesRemove:
		var input volumeArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			return a.containers.RemoveVolume(ctx, containers.VolumeRemoveRequest{Engine: input.Engine, Name: input.Name})
		}, nil
	case containers.MethodVolumesPrune:
		var input resourcePruneArguments
		if err := decodeCapabilityArguments(arguments, &input); err != nil {
			return nil, nil, err
		}
		return acceptedResourceOperation(method, input.Engine, ""), func(ctx context.Context) error {
			return a.containers.PruneVolumes(ctx, containers.ResourcePruneRequest{Engine: input.Engine, ResourceIdentities: input.ResourceIdentities})
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
	if binding.CapabilityVersion == containersCapabilityV3Version {
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
	for _, key := range []string{"engine", "container_id", "name", "force", "confirmation_name", "resource_identities"} {
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
		"engine", "resource_kind", "identity", "image", "container_id", "container_name", "state", "name", "driver",
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

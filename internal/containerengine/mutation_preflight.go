package containerengine

import (
	"context"
	"errors"
	"strings"
)

func (a *Adapter) ContainerActionPreflight(ctx context.Context, method Method, req ContainerActionRequest) (ResourcePlan, error) {
	if method == MethodRemove {
		return a.RemovePreflight(ctx, ContainerRemovePreflightRequest{
			Engine: req.Engine, EndpointID: req.EndpointID, ContainerID: req.ContainerID,
			Force: req.Force, ConfirmationName: req.ConfirmationName,
		})
	}
	if method != MethodStart && method != MethodStop && method != MethodRestart && method != MethodPause && method != MethodUnpause && method != MethodKill {
		return ResourcePlan{}, ErrInvalidMethod
	}
	if err := validateEngine(req.Engine); err != nil {
		return ResourcePlan{}, err
	}
	containerID := strings.TrimSpace(req.ContainerID)
	if err := validateContainerIdentifier(containerID); err != nil {
		return ResourcePlan{}, err
	}
	item, err := a.client.Inspect(ctx, req.Engine, containerID)
	if err != nil {
		return ResourcePlan{}, normalizeContainerResourceError(containerID, err)
	}
	if req.TimeoutSec < 0 || req.TimeoutSec > 3600 {
		return ResourcePlan{}, errors.New("timeout_sec is invalid")
	}
	risk := RiskLevelMedium
	requiresAdmin := false
	flags := []RiskFlag(nil)
	if method == MethodStart {
		start, err := BuildStartPreflightPlan(StartPreflightInput{
			Engine: req.Engine, EndpointID: req.EndpointID, ContainerID: item.ContainerID,
			ContainerName: item.Name, Image: item.Image, Runtime: item.Runtime,
		})
		if err != nil {
			return ResourcePlan{}, err
		}
		target := map[string]any{
			"engine": string(req.Engine), "resource_kind": "container", "container_id": item.ContainerID,
			"container_name": item.Name, "target_hash": start.Target.TargetHash, "image": start.Image, "runtime": start.Runtime,
		}
		addEndpointTarget(target, req.EndpointID)
		return BuildResourcePlan(method, target, req, start.RiskLevel, start.RiskFlags, start.RequiresAdmin, start.Summary...)
	}
	if method == MethodKill {
		if strings.TrimSpace(req.ConfirmationName) != strings.TrimSpace(item.Name) || strings.TrimSpace(item.Name) == "" {
			return ResourcePlan{}, errors.New("confirmation_name must match the container name")
		}
		risk = RiskLevelHigh
		requiresAdmin = true
		flags = []RiskFlag{{ID: "container_kill", Severity: RiskSeverityHigh, Title: "Immediate container termination", Detail: "The container process will be terminated without a graceful shutdown.", AdminRequired: true}}
	}
	target := map[string]any{
		"engine": string(req.Engine), "resource_kind": "container", "container_id": item.ContainerID,
		"container_name": strings.TrimSpace(item.Name), "state": string(item.State),
	}
	addEndpointTarget(target, req.EndpointID)
	return BuildResourcePlan(method, target, req, risk, flags, requiresAdmin, "Apply the reviewed lifecycle action to this container")
}

func (a *Adapter) PullImagePreflight(req ImagePullRequest) (ResourcePlan, error) {
	if err := validateEngine(req.Engine); err != nil {
		return ResourcePlan{}, err
	}
	if err := validateImageReference(req.ImageRef); err != nil {
		return ResourcePlan{}, err
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "image", "image": strings.TrimSpace(req.ImageRef)}
	addEndpointTarget(target, req.EndpointID)
	return BuildResourcePlan(MethodImagesPull, target, req, RiskLevelLow, nil, false, "Pull the reviewed image reference")
}

func (a *Adapter) TagImagePreflight(req ImageTagRequest) (ResourcePlan, error) {
	if err := validateEngine(req.Engine); err != nil {
		return ResourcePlan{}, err
	}
	if err := validateImageReference(req.Image); err != nil {
		return ResourcePlan{}, err
	}
	if err := validateImageReference(req.Tag); err != nil {
		return ResourcePlan{}, errors.New("image tag is invalid")
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "image", "image": strings.TrimSpace(req.Image), "tag": strings.TrimSpace(req.Tag)}
	addEndpointTarget(target, req.EndpointID)
	return BuildResourcePlan(MethodImagesTag, target, req, RiskLevelLow, nil, false, "Apply the reviewed image tag")
}

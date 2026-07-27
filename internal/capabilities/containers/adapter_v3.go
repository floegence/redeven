package containers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

func (a *Adapter) Create(ctx context.Context, req ContainerCreateRequest) (ContainerActionResponse, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ContainerActionResponse{}, err
	}
	if err := validateContainerCreateRequest(req); err != nil {
		return ContainerActionResponse{}, err
	}
	return ext.CreateContainer(ctx, req)
}

func (a *Adapter) CreatePreflight(req ContainerCreateRequest) (ResourcePlan, error) {
	if err := validateContainerCreateRequest(req); err != nil {
		return ResourcePlan{}, err
	}
	mounts := make([]MountInput, 0, len(req.Mounts))
	for _, mount := range req.Mounts {
		mounts = append(mounts, MountInput(mount))
	}
	devices := make([]DeviceInput, 0, len(req.Devices))
	for _, device := range req.Devices {
		devices = append(devices, DeviceInput(device))
	}
	runtime := RuntimeSummary{
		Privileged: req.Privileged, NetworkMode: req.NetworkMode, PIDMode: req.PIDMode, IPCMode: req.IPCMode,
		RestartPolicy: req.RestartPolicy, Env: summarizeEnv(req.Env), Mounts: summarizeMounts(mounts),
		Devices: summarizeDevices(devices), CapAdd: normalizeCaps(req.CapAdd), CapDrop: normalizeCaps(req.CapDrop),
	}
	digest, digestPinned := canonicalImageReferenceDigest(req.Image)
	image := ImageSummary{Reference: strings.TrimSpace(req.Image), Digest: digest, DigestPinned: digestPinned}
	flags := startRiskFlags(image, runtime)
	identity := strings.TrimSpace(req.Name)
	if identity == "" {
		identity = strings.TrimSpace(req.Image)
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "container", "identity": identity}
	return BuildResourcePlan(MethodContainersCreate, target, req, maxRiskLevel(flags), flags, requiresAdmin(flags), "Create the container with the reviewed configuration")
}

func (a *Adapter) RemovePreflight(ctx context.Context, req ContainerRemovePreflightRequest) (ResourcePlan, error) {
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
	name := strings.TrimSpace(item.Name)
	if removalBlockingState(item.State) && !req.Force {
		return ResourcePlan{}, &ContainerRunningError{ContainerID: item.ContainerID, ContainerName: name}
	}
	if req.Force && (name == "" || strings.TrimSpace(req.ConfirmationName) != name) {
		return ResourcePlan{}, errors.New("confirmation_name must match the running container name")
	}
	risk := RiskLevelHigh
	flags := []RiskFlag{{ID: "container_remove", Severity: RiskSeverityHigh, Title: "Container removal", Detail: "The selected container will be permanently removed."}}
	if req.Force {
		risk = RiskLevelCritical
		flags = append(flags, RiskFlag{ID: "force_running_container", Severity: RiskSeverityCritical, Title: "Force running container removal", Detail: "The running container will be terminated and removed.", AdminRequired: true})
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "container", "container_id": item.ContainerID, "state": string(item.State)}
	if name != "" {
		target["container_name"] = name
	}
	return BuildResourcePlan(MethodRemove, target, req, risk, flags, req.Force, "Remove the selected container using the reviewed plan")
}

func removalBlockingState(state ContainerState) bool {
	return state == ContainerStateRunning || state == ContainerStatePaused || state == ContainerStateRestarting
}

func (a *Adapter) Stats(ctx context.Context, engine Engine, containerID string) (ContainerStats, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ContainerStats{}, err
	}
	if err := validateEngine(engine); err != nil {
		return ContainerStats{}, err
	}
	if err := validateContainerIdentifier(containerID); err != nil {
		return ContainerStats{}, err
	}
	return ext.Stats(ctx, engine, strings.TrimSpace(containerID))
}

func (a *Adapter) Pause(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{Engine: req.Engine, Method: MethodPause, ContainerID: req.ContainerID})
}

func (a *Adapter) Unpause(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{Engine: req.Engine, Method: MethodUnpause, ContainerID: req.ContainerID})
}

func (a *Adapter) Kill(ctx context.Context, req ContainerActionRequest) (ContainerActionResponse, error) {
	return a.runAction(ctx, EngineActionRequest{Engine: req.Engine, Method: MethodKill, ContainerID: req.ContainerID})
}

func (a *Adapter) ListImages(ctx context.Context, engine Engine) ([]ImageRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return nil, err
	}
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	return ext.ListImages(ctx, engine)
}

func (a *Adapter) InspectImage(ctx context.Context, req ImageInspectRequest) (ImageRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ImageRecord{}, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return ImageRecord{}, err
	}
	if err := validateImageReference(req.Image); err != nil {
		return ImageRecord{}, err
	}
	return ext.InspectImage(ctx, req.Engine, strings.TrimSpace(req.Image))
}

func (a *Adapter) HistoryImage(ctx context.Context, req ImageHistoryRequest) ([]ImageHistoryEntry, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return nil, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return nil, err
	}
	if err := validateImageReference(req.Image); err != nil {
		return nil, err
	}
	return ext.HistoryImage(ctx, req.Engine, strings.TrimSpace(req.Image))
}

func (a *Adapter) TagImage(ctx context.Context, req ImageTagRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if err := validateImageReference(req.Image); err != nil {
		return err
	}
	if err := validateImageReference(req.Tag); err != nil {
		return errors.New("image and tag are required")
	}
	return ext.TagImage(ctx, req)
}

func (a *Adapter) RemoveImage(ctx context.Context, req ImageRemoveRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if err := validateImageReference(req.Image); err != nil {
		return err
	}
	item, err := ext.InspectImage(ctx, req.Engine, strings.TrimSpace(req.Image))
	if err != nil {
		return err
	}
	if item.ReferenceInspectionFailures > 0 {
		return ErrReferenceStateIncomplete
	}
	if item.ReferencedContainers > 0 && !req.Force {
		return &ImageReferencedError{Image: strings.TrimSpace(req.Image), References: item.ReferencedContainers}
	}
	return ext.RemoveImage(ctx, req)
}

func (a *Adapter) RemoveImagePreflight(ctx context.Context, req ImageRemovePreflightRequest) (ResourcePlan, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ResourcePlan{}, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return ResourcePlan{}, err
	}
	image := strings.TrimSpace(req.Image)
	if err := validateImageReference(image); err != nil {
		return ResourcePlan{}, err
	}
	item, err := ext.InspectImage(ctx, req.Engine, image)
	if err != nil {
		return ResourcePlan{}, err
	}
	if item.ReferenceInspectionFailures > 0 {
		return ResourcePlan{}, ErrReferenceStateIncomplete
	}
	if item.ReferencedContainers > 0 && !req.Force {
		return ResourcePlan{}, &ImageReferencedError{Image: image, References: item.ReferencedContainers}
	}
	if req.Force && strings.TrimSpace(req.ConfirmationName) != image {
		return ResourcePlan{}, errors.New("confirmation_name must match the image reference")
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "image", "image": image, "referenced_containers": item.ReferencedContainers, "reclaimable_bytes": item.SizeBytes}
	risk := RiskLevelHigh
	if req.Force {
		risk = RiskLevelCritical
	}
	return BuildResourcePlan(MethodImagesRemove, target, req, risk, nil, req.Force, "Remove the selected image using the reviewed reference plan")
}

func (a *Adapter) PruneImagesPreflight(ctx context.Context, req ResourcePruneRequest) (ResourcePlan, error) {
	items, err := a.ListImages(ctx, req.Engine)
	if err != nil {
		return ResourcePlan{}, err
	}
	available := make(map[string]ImageRecord, len(items))
	var bytes int64
	for _, item := range items {
		if item.ReferenceInspectionFailures > 0 {
			return ResourcePlan{}, ErrReferenceStateIncomplete
		}
		if item.ReferencedContainers != 0 {
			continue
		}
		identity := firstNonEmpty(item.Digest, item.ID, item.Reference)
		if identity != "" {
			available[identity] = item
		}
	}
	identities, err := selectPruneIdentities(req.ResourceIdentities, available)
	if err != nil {
		return ResourcePlan{}, err
	}
	for _, identity := range identities {
		bytes += available[identity].SizeBytes
	}
	request := ResourcePruneRequest{Engine: req.Engine, ResourceIdentities: identities}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "images", "resource_count": len(identities), "reclaimable_bytes": bytes, "resource_identities": identities}
	return BuildResourcePlan(MethodImagesPrune, target, request, RiskLevelHigh, nil, false, "Remove the exact unused image set in this plan")
}

func (a *Adapter) PruneImages(ctx context.Context, req ResourcePruneRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if len(req.ResourceIdentities) == 0 {
		return errors.New("resource_identities is required")
	}
	if _, err := a.PruneImagesPreflight(ctx, req); err != nil {
		return err
	}
	mutationErr := ext.PruneImages(ctx, req)
	items, reconciliationErr := ext.ListImages(ctx, req.Engine)
	present := make(map[string]struct{}, len(items))
	for _, item := range items {
		for _, identity := range append([]string{item.Digest, item.ID, item.Reference}, item.Tags...) {
			if identity = strings.TrimSpace(identity); identity != "" {
				present[identity] = struct{}{}
			}
		}
	}
	return reconcileExactPrune("image", req.ResourceIdentities, present, mutationErr, reconciliationErr)
}

func (a *Adapter) ListVolumes(ctx context.Context, engine Engine) ([]VolumeRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return nil, err
	}
	if err := validateEngine(engine); err != nil {
		return nil, err
	}
	return ext.ListVolumes(ctx, engine)
}

func (a *Adapter) InspectVolume(ctx context.Context, req VolumeInspectRequest) (VolumeRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return VolumeRecord{}, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return VolumeRecord{}, err
	}
	if err := validateVolumeName(req.Name); err != nil {
		return VolumeRecord{}, err
	}
	return ext.InspectVolume(ctx, req.Engine, strings.TrimSpace(req.Name))
}

func (a *Adapter) CreateVolume(ctx context.Context, req VolumeCreateRequest) (VolumeRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return VolumeRecord{}, err
	}
	if err := validateVolumeCreateRequest(req); err != nil {
		return VolumeRecord{}, err
	}
	return ext.CreateVolume(ctx, req)
}

func (a *Adapter) CreateVolumePreflight(req VolumeCreateRequest) (ResourcePlan, error) {
	if err := validateVolumeCreateRequest(req); err != nil {
		return ResourcePlan{}, err
	}
	identity := strings.TrimSpace(req.Name)
	if identity == "" {
		identity = "runtime-generated-volume"
	}
	optionKeys := make([]string, 0, len(req.Options))
	for _, option := range req.Options {
		optionKeys = append(optionKeys, strings.TrimSpace(option.Key))
	}
	sort.Strings(optionKeys)
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "volume", "name": identity, "driver": strings.TrimSpace(req.Driver), "option_keys": optionKeys}
	return BuildResourcePlan(MethodVolumesCreate, target, req, RiskLevelLow, nil, false, "Create the volume with the reviewed driver configuration")
}

func (a *Adapter) RemoveVolume(ctx context.Context, req VolumeRemoveRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if err := validateVolumeName(req.Name); err != nil {
		return err
	}
	item, err := ext.InspectVolume(ctx, req.Engine, strings.TrimSpace(req.Name))
	if err != nil {
		return err
	}
	if item.ReferenceInspectionFailures > 0 {
		return ErrReferenceStateIncomplete
	}
	if item.ReferencedContainers > 0 {
		return &VolumeInUseError{Name: item.Name, References: item.ReferencedContainers}
	}
	return ext.RemoveVolume(ctx, req)
}

func (a *Adapter) RemoveVolumePreflight(ctx context.Context, req VolumeRemovePreflightRequest) (ResourcePlan, error) {
	item, err := a.InspectVolume(ctx, VolumeInspectRequest{Engine: req.Engine, Name: req.Name})
	if err != nil {
		return ResourcePlan{}, err
	}
	if item.ReferenceInspectionFailures > 0 {
		return ResourcePlan{}, ErrReferenceStateIncomplete
	}
	if item.ReferencedContainers > 0 {
		return ResourcePlan{}, &VolumeInUseError{Name: item.Name, References: item.ReferencedContainers}
	}
	if strings.TrimSpace(req.ConfirmationName) != item.Name {
		return ResourcePlan{}, errors.New("confirmation_name must match the volume name")
	}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "volume", "name": item.Name, "referenced_containers": 0}
	return BuildResourcePlan(MethodVolumesRemove, target, req, RiskLevelHigh, nil, false, "Remove the selected volume using the reviewed reference plan")
}

func (a *Adapter) PruneVolumesPreflight(ctx context.Context, req ResourcePruneRequest) (ResourcePlan, error) {
	items, err := a.ListVolumes(ctx, req.Engine)
	if err != nil {
		return ResourcePlan{}, err
	}
	available := make(map[string]VolumeRecord, len(items))
	for _, item := range items {
		if item.ReferenceInspectionFailures > 0 {
			return ResourcePlan{}, ErrReferenceStateIncomplete
		}
		if item.ReferencedContainers == 0 {
			available[item.Name] = item
		}
	}
	identities, err := selectPruneIdentities(req.ResourceIdentities, available)
	if err != nil {
		return ResourcePlan{}, err
	}
	request := ResourcePruneRequest{Engine: req.Engine, ResourceIdentities: identities}
	target := map[string]any{"engine": string(req.Engine), "resource_kind": "volumes", "resource_count": len(identities), "resource_identities": identities}
	return BuildResourcePlan(MethodVolumesPrune, target, request, RiskLevelHigh, nil, false, "Remove the exact unused volume set in this plan")
}

func (a *Adapter) PruneVolumes(ctx context.Context, req ResourcePruneRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if len(req.ResourceIdentities) == 0 {
		return errors.New("resource_identities is required")
	}
	if _, err := a.PruneVolumesPreflight(ctx, req); err != nil {
		return err
	}
	mutationErr := ext.PruneVolumes(ctx, req)
	items, reconciliationErr := ext.ListVolumes(ctx, req.Engine)
	present := make(map[string]struct{}, len(items))
	for _, item := range items {
		if identity := strings.TrimSpace(item.Name); identity != "" {
			present[identity] = struct{}{}
		}
	}
	return reconcileExactPrune("volume", req.ResourceIdentities, present, mutationErr, reconciliationErr)
}

func reconcileExactPrune(kind string, requested []string, present map[string]struct{}, mutationErr, reconciliationErr error) error {
	identities := make([]string, len(requested))
	for index, identity := range requested {
		identities[index] = strings.TrimSpace(identity)
	}
	if reconciliationErr != nil {
		return &ResourcePruneReconciliationError{
			ResourceKind: kind,
			Identities:   identities,
			Cause:        errors.Join(mutationErr, reconciliationErr),
		}
	}
	completed := make([]string, 0, len(identities))
	pending := make([]string, 0, len(identities))
	for _, identity := range identities {
		if _, exists := present[identity]; exists {
			pending = append(pending, identity)
		} else {
			completed = append(completed, identity)
		}
	}
	if len(pending) == 0 {
		return nil
	}
	if len(completed) == 0 && mutationErr != nil && !errors.Is(mutationErr, ErrResourcePrunePartial) {
		return mutationErr
	}
	if len(completed) > 0 {
		return &ResourcePrunePartialError{
			ResourceKind:        kind,
			CompletedIdentities: completed,
			PendingIdentities:   pending,
			Cause:               firstError(mutationErr, ErrResourcePlanStale),
		}
	}
	return &ResourcePruneReconciliationError{
		ResourceKind: kind,
		Identities:   identities,
		Cause:        firstError(mutationErr, ErrResourcePlanStale),
	}
}

func firstError(value, fallback error) error {
	if value != nil {
		return value
	}
	return fallback
}

func selectPruneIdentities[T any](requested []string, available map[string]T) ([]string, error) {
	if len(requested) == 0 {
		identities := make([]string, 0, len(available))
		for identity := range available {
			identities = append(identities, identity)
		}
		sort.Strings(identities)
		return identities, nil
	}
	if len(requested) > 4096 {
		return nil, errors.New("resource_identities exceeds resource limits")
	}
	seen := make(map[string]struct{}, len(requested))
	identities := make([]string, 0, len(requested))
	for _, value := range requested {
		identity := strings.TrimSpace(value)
		if identity == "" || strings.HasPrefix(identity, "-") || hasControl(identity) {
			return nil, errors.New("resource identity is invalid")
		}
		if _, exists := seen[identity]; exists {
			return nil, errors.New("resource identity is duplicated")
		}
		if _, exists := available[identity]; !exists {
			return nil, ErrResourcePlanStale
		}
		seen[identity] = struct{}{}
		identities = append(identities, identity)
	}
	sort.Strings(identities)
	return identities, nil
}

func BuildResourcePlan(method Method, target map[string]any, request any, risk RiskLevel, flags []RiskFlag, requiresAdmin bool, summary ...string) (ResourcePlan, error) {
	payload, err := json.Marshal(struct {
		Method  Method         `json:"method"`
		Target  map[string]any `json:"target"`
		Request any            `json:"request"`
	}{Method: method, Target: target, Request: request})
	if err != nil {
		return ResourcePlan{}, fmt.Errorf("marshal resource plan: %w", err)
	}
	digest := sha256.Sum256(payload)
	return ResourcePlan{
		Method:        method,
		Target:        target,
		Request:       request,
		PlanDigest:    "sha256:" + hex.EncodeToString(digest[:]),
		RiskLevel:     risk,
		RiskFlags:     flags,
		RequiresAdmin: requiresAdmin,
		Summary:       summary,
	}, nil
}

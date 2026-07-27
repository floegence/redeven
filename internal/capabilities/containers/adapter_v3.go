package containers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func (a *Adapter) Create(ctx context.Context, req ContainerCreateRequest) (ContainerActionResponse, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ContainerActionResponse{}, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return ContainerActionResponse{}, err
	}
	if strings.TrimSpace(req.Image) == "" {
		return ContainerActionResponse{}, errors.New("image is required")
	}
	return ext.CreateContainer(ctx, req)
}

func (a *Adapter) Stats(ctx context.Context, engine Engine, containerID string) (ContainerStats, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return ContainerStats{}, err
	}
	if err := validateEngine(engine); err != nil {
		return ContainerStats{}, err
	}
	if strings.TrimSpace(containerID) == "" {
		return ContainerStats{}, errors.New("container_id is required")
	}
	return ext.Stats(ctx, engine, strings.TrimSpace(containerID))
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
	if strings.TrimSpace(req.Image) == "" {
		return ImageRecord{}, errors.New("image is required")
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
	if strings.TrimSpace(req.Image) == "" {
		return nil, errors.New("image is required")
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
	if strings.TrimSpace(req.Image) == "" || strings.TrimSpace(req.Tag) == "" {
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
	if strings.TrimSpace(req.Image) == "" {
		return errors.New("image is required")
	}
	return ext.RemoveImage(ctx, req)
}

func (a *Adapter) PruneImages(ctx context.Context, engine Engine, planDigest string) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(engine); err != nil {
		return err
	}
	if strings.TrimSpace(planDigest) == "" {
		return errors.New("plan_digest is required")
	}
	return ext.PruneImages(ctx, engine, strings.TrimSpace(planDigest))
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
	if strings.TrimSpace(req.Name) == "" {
		return VolumeRecord{}, errors.New("volume name is required")
	}
	return ext.InspectVolume(ctx, req.Engine, strings.TrimSpace(req.Name))
}

func (a *Adapter) CreateVolume(ctx context.Context, req VolumeCreateRequest) (VolumeRecord, error) {
	ext, err := requireExtended(a.client)
	if err != nil {
		return VolumeRecord{}, err
	}
	if err := validateEngine(req.Engine); err != nil {
		return VolumeRecord{}, err
	}
	return ext.CreateVolume(ctx, req)
}

func (a *Adapter) RemoveVolume(ctx context.Context, req VolumeRemoveRequest) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if strings.TrimSpace(req.Name) == "" {
		return errors.New("volume name is required")
	}
	return ext.RemoveVolume(ctx, req)
}

func (a *Adapter) PruneVolumes(ctx context.Context, engine Engine, planDigest string) error {
	ext, err := requireExtended(a.client)
	if err != nil {
		return err
	}
	if err := validateEngine(engine); err != nil {
		return err
	}
	if strings.TrimSpace(planDigest) == "" {
		return errors.New("plan_digest is required")
	}
	return ext.PruneVolumes(ctx, engine, strings.TrimSpace(planDigest))
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
		PlanDigest:    "sha256:" + hex.EncodeToString(digest[:]),
		RiskLevel:     risk,
		RiskFlags:     flags,
		RequiresAdmin: requiresAdmin,
		Summary:       summary,
	}, nil
}

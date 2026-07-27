package containers

import (
	"context"
	"errors"
	"strings"
)

var ErrResourceCapabilityUnsupported = errors.New("container resource capability is unsupported by this engine adapter")

type ContainerCreateRequest struct {
	Engine        Engine   `json:"engine"`
	Name          string   `json:"name,omitempty"`
	Image         string   `json:"image"`
	Command       []string `json:"command,omitempty"`
	Env           []string `json:"env,omitempty"`
	RestartPolicy string   `json:"restart_policy,omitempty"`
	NetworkMode   string   `json:"network_mode,omitempty"`
	Privileged    bool     `json:"privileged,omitempty"`
}

type ImageListRequest struct {
	Engine Engine `json:"engine"`
}
type ImageInspectRequest struct {
	Engine Engine `json:"engine"`
	Image  string `json:"image"`
}
type ImageHistoryRequest struct {
	Engine Engine `json:"engine"`
	Image  string `json:"image"`
}
type ImageTagRequest struct {
	Engine Engine `json:"engine"`
	Image  string `json:"image"`
	Tag    string `json:"tag"`
}
type ImageRemoveRequest struct {
	Engine Engine `json:"engine"`
	Image  string `json:"image"`
	Force  bool   `json:"force,omitempty"`
}
type VolumeListRequest struct {
	Engine Engine `json:"engine"`
}
type VolumeInspectRequest struct {
	Engine Engine `json:"engine"`
	Name   string `json:"name"`
}
type VolumeCreateRequest struct {
	Engine Engine `json:"engine"`
	Name   string `json:"name"`
	Driver string `json:"driver,omitempty"`
}
type VolumeRemoveRequest struct {
	Engine Engine `json:"engine"`
	Name   string `json:"name"`
}

type ExtendedEngineClient interface {
	CreateContainer(context.Context, ContainerCreateRequest) (ContainerActionResponse, error)
	Stats(context.Context, Engine, string) (ContainerStats, error)
	ListImages(context.Context, Engine) ([]ImageRecord, error)
	InspectImage(context.Context, Engine, string) (ImageRecord, error)
	HistoryImage(context.Context, Engine, string) ([]ImageHistoryEntry, error)
	TagImage(context.Context, ImageTagRequest) error
	RemoveImage(context.Context, ImageRemoveRequest) error
	PruneImages(context.Context, Engine, string) error
	ListVolumes(context.Context, Engine) ([]VolumeRecord, error)
	InspectVolume(context.Context, Engine, string) (VolumeRecord, error)
	CreateVolume(context.Context, VolumeCreateRequest) (VolumeRecord, error)
	RemoveVolume(context.Context, VolumeRemoveRequest) error
	PruneVolumes(context.Context, Engine, string) error
}

func requireExtended(client EngineClient) (ExtendedEngineClient, error) {
	extended, ok := client.(ExtendedEngineClient)
	if !ok || extended == nil {
		return nil, ErrResourceCapabilityUnsupported
	}
	return extended, nil
}

func normalizeResourceName(value string) string { return strings.TrimSpace(value) }

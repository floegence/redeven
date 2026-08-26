package containers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"regexp"
	"strings"
)

var ErrResourceCapabilityUnsupported = errors.New("container resource capability is unsupported by this engine adapter")

var (
	containerModePattern   = regexp.MustCompile(`^[A-Za-z0-9_.:/-]+$`)
	containerNamePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	containerCapPattern    = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)
	imageDigestPattern     = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	volumeOptionKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	tmpfsSizeOptionPattern = regexp.MustCompile(`^size=[1-9][0-9]{0,15}$`)
)

type ContainerCreateRequest struct {
	Engine        Engine                 `json:"engine"`
	EndpointID    EndpointID             `json:"endpoint_id,omitempty"`
	Name          string                 `json:"name,omitempty"`
	Image         string                 `json:"image"`
	Entrypoint    string                 `json:"entrypoint,omitempty"`
	Command       []string               `json:"command,omitempty"`
	Env           []string               `json:"env,omitempty"`
	Labels        map[string]string      `json:"labels,omitempty"`
	RestartPolicy string                 `json:"restart_policy,omitempty"`
	NetworkMode   string                 `json:"network_mode,omitempty"`
	Ports         []ContainerPortPublish `json:"ports,omitempty"`
	Mounts        []ContainerMount       `json:"mounts,omitempty"`
	CPUCount      float64                `json:"cpu_count,omitempty"`
	MemoryBytes   int64                  `json:"memory_bytes,omitempty"`
	PIDMode       string                 `json:"pid_mode,omitempty"`
	IPCMode       string                 `json:"ipc_mode,omitempty"`
	CapAdd        []string               `json:"cap_add,omitempty"`
	CapDrop       []string               `json:"cap_drop,omitempty"`
	Devices       []ContainerDevice      `json:"devices,omitempty"`
	Privileged    bool                   `json:"privileged,omitempty"`
	ReadOnlyRoot  bool                   `json:"read_only_root,omitempty"`
	SecurityOpts  []string               `json:"security_opts,omitempty"`
	PIDsLimit     int                    `json:"pids_limit,omitempty"`
	ShmSizeBytes  int64                  `json:"shm_size_bytes,omitempty"`
	User          string                 `json:"user,omitempty"`
}

type ContainerLabelMatchRequest struct {
	Engine      Engine     `json:"engine"`
	EndpointID  EndpointID `json:"endpoint_id,omitempty"`
	ContainerID string     `json:"container_id"`
	Key         string     `json:"key"`
	Value       string     `json:"value"`
}

type ContainerPortPublish struct {
	ContainerPort int    `json:"container_port"`
	HostPort      int    `json:"host_port,omitempty"`
	HostIP        string `json:"host_ip,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
}

type ContainerMount struct {
	Type         MountType `json:"type"`
	Source       string    `json:"source,omitempty"`
	Target       string    `json:"target"`
	ReadOnly     bool      `json:"read_only,omitempty"`
	TmpfsOptions []string  `json:"tmpfs_options,omitempty"`
}

type ContainerDevice struct {
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path,omitempty"`
	Permissions   string `json:"permissions,omitempty"`
}

type ImageListRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
}
type ImageInspectRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Image      string     `json:"image"`
}
type ImageHistoryRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Image      string     `json:"image"`
}
type ImageTagRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Image      string     `json:"image"`
	Tag        string     `json:"tag"`
}
type ImageRemoveRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Image      string     `json:"image"`
	Force      bool       `json:"force,omitempty"`
}
type ImageRemovePreflightRequest struct {
	Engine           Engine     `json:"engine"`
	EndpointID       EndpointID `json:"endpoint_id,omitempty"`
	Image            string     `json:"image"`
	Force            bool       `json:"force,omitempty"`
	ConfirmationName string     `json:"confirmation_name,omitempty"`
}
type VolumeListRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
}
type VolumeInspectRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Name       string     `json:"name"`
}
type VolumeCreateRequest struct {
	Engine     Engine         `json:"engine"`
	EndpointID EndpointID     `json:"endpoint_id,omitempty"`
	Name       string         `json:"name"`
	Driver     string         `json:"driver,omitempty"`
	Options    []VolumeOption `json:"options,omitempty"`
}

type VolumeOption struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}
type VolumeRemoveRequest struct {
	Engine     Engine     `json:"engine"`
	EndpointID EndpointID `json:"endpoint_id,omitempty"`
	Name       string     `json:"name"`
}

type VolumeRemovePreflightRequest struct {
	Engine           Engine     `json:"engine"`
	EndpointID       EndpointID `json:"endpoint_id,omitempty"`
	Name             string     `json:"name"`
	ConfirmationName string     `json:"confirmation_name"`
}

type ResourcePruneRequest struct {
	Engine             Engine     `json:"engine"`
	EndpointID         EndpointID `json:"endpoint_id,omitempty"`
	ResourceIdentities []string   `json:"resource_identities,omitempty"`
}

type ContainerRemovePreflightRequest struct {
	Engine           Engine     `json:"engine"`
	EndpointID       EndpointID `json:"endpoint_id,omitempty"`
	ContainerID      string     `json:"container_id"`
	Force            bool       `json:"force,omitempty"`
	ConfirmationName string     `json:"confirmation_name,omitempty"`
}

type ExtendedEngineClient interface {
	CreateContainer(context.Context, ContainerCreateRequest) (ContainerActionResponse, error)
	Stats(context.Context, Engine, string) (ContainerStats, error)
	ListImages(context.Context, Engine) ([]ImageRecord, error)
	InspectImage(context.Context, Engine, string) (ImageRecord, error)
	HistoryImage(context.Context, Engine, string) ([]ImageHistoryEntry, error)
	TagImage(context.Context, ImageTagRequest) error
	RemoveImage(context.Context, ImageRemoveRequest) error
	PruneImages(context.Context, ResourcePruneRequest) error
	ListVolumes(context.Context, Engine) ([]VolumeRecord, error)
	InspectVolume(context.Context, Engine, string) (VolumeRecord, error)
	CreateVolume(context.Context, VolumeCreateRequest) (VolumeRecord, error)
	RemoveVolume(context.Context, VolumeRemoveRequest) error
	PruneVolumes(context.Context, ResourcePruneRequest) error
}

func validateImageReference(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") || hasControl(value) || strings.ContainsAny(value, " \\?#") || strings.Contains(value, "://") {
		return errors.New("image is invalid")
	}
	if _, _, found := strings.Cut(value, "@"); found {
		if _, valid := canonicalImageReferenceDigest(value); !valid {
			return errors.New("image digest is invalid")
		}
	}
	return nil
}

func isCanonicalSHA256Digest(value string) bool {
	return imageDigestPattern.MatchString(strings.TrimSpace(value))
}

func canonicalImageReferenceDigest(value string) (string, bool) {
	reference, digest, found := strings.Cut(strings.TrimSpace(value), "@")
	if !found || strings.TrimSpace(reference) == "" || !isCanonicalSHA256Digest(digest) {
		return "", false
	}
	return strings.TrimSpace(digest), true
}

func isImageDigestPinned(reference, digest string) bool {
	if isCanonicalSHA256Digest(digest) {
		return true
	}
	_, pinned := canonicalImageReferenceDigest(reference)
	return pinned
}

func requireExtended(client EngineClient) (ExtendedEngineClient, error) {
	extended, ok := client.(ExtendedEngineClient)
	if !ok || extended == nil {
		return nil, ErrResourceCapabilityUnsupported
	}
	return extended, nil
}

func validateContainerCreateRequest(req ContainerCreateRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if err := validateImageReference(req.Image); err != nil {
		return err
	}
	if name := strings.TrimSpace(req.Name); name != "" && !containerNamePattern.MatchString(name) {
		return errors.New("container name is invalid")
	}
	if entrypoint := strings.TrimSpace(req.Entrypoint); strings.HasPrefix(entrypoint, "-") || hasControl(entrypoint) {
		return errors.New("container entrypoint is invalid")
	}
	if len(req.Command) > 128 || len(req.Env) > 256 || len(req.Ports) > 128 || len(req.Mounts) > 128 ||
		len(req.CapAdd) > 128 || len(req.CapDrop) > 128 || len(req.Devices) > 128 || len(req.SecurityOpts) > 32 || len(req.Labels) > 64 {
		return errors.New("container create request exceeds resource limits")
	}
	for _, value := range append(append([]string{req.Entrypoint}, req.Command...), req.Env...) {
		if hasControl(value) {
			return errors.New("container command or environment entry is invalid")
		}
	}
	for key, value := range req.Labels {
		if !validContainerLabel(key, value) {
			return errors.New("container label is invalid")
		}
	}
	if req.RestartPolicy != "" && !validRestartPolicy(req.RestartPolicy) {
		return errors.New("restart policy is invalid")
	}
	for _, mode := range []string{req.NetworkMode, req.PIDMode, req.IPCMode} {
		if mode != "" && !containerModePattern.MatchString(strings.TrimSpace(mode)) {
			return errors.New("container namespace mode is invalid")
		}
	}
	if req.CPUCount < 0 || req.CPUCount > 256 {
		return errors.New("cpu_count is invalid")
	}
	if req.MemoryBytes < 0 || (req.MemoryBytes > 0 && req.MemoryBytes < 4*1024*1024) {
		return errors.New("memory_bytes is invalid")
	}
	if req.PIDsLimit < 0 || req.PIDsLimit > 1_000_000 {
		return errors.New("pids_limit is invalid")
	}
	if req.ShmSizeBytes < 0 || (req.ShmSizeBytes > 0 && req.ShmSizeBytes < 1024*1024) {
		return errors.New("shm_size_bytes is invalid")
	}
	if user := strings.TrimSpace(req.User); user != "" && (!containerModePattern.MatchString(user) || strings.HasPrefix(user, "-")) {
		return errors.New("container user is invalid")
	}
	for _, option := range req.SecurityOpts {
		option = strings.TrimSpace(option)
		if option == "" || strings.HasPrefix(option, "-") || hasControl(option) || strings.ContainsAny(option, " ,") {
			return errors.New("container security option is invalid")
		}
	}
	for _, port := range req.Ports {
		protocol := strings.ToLower(strings.TrimSpace(port.Protocol))
		if port.ContainerPort < 1 || port.ContainerPort > 65535 || port.HostPort < 0 || port.HostPort > 65535 ||
			(protocol != "" && protocol != "tcp" && protocol != "udp" && protocol != "sctp") ||
			(strings.TrimSpace(port.HostIP) != "" && net.ParseIP(strings.TrimSpace(port.HostIP)) == nil) {
			return errors.New("published port is invalid")
		}
	}
	for _, mount := range req.Mounts {
		target := strings.TrimSpace(mount.Target)
		source := strings.TrimSpace(mount.Source)
		if target == "" || !filepath.IsAbs(target) || unsafeMountValue(target) {
			return errors.New("mount target is invalid")
		}
		switch mount.Type {
		case MountTypeBind:
			if source == "" || !filepath.IsAbs(source) || unsafeMountValue(source) {
				return errors.New("bind mount source is invalid")
			}
		case MountTypeVolume:
			if !containerNamePattern.MatchString(source) {
				return errors.New("volume mount source is invalid")
			}
		case MountTypeTmpfs:
			if source != "" {
				return errors.New("tmpfs mount must not declare a source")
			}
			for _, option := range mount.TmpfsOptions {
				option = strings.TrimSpace(option)
				if option != "rw" && option != "noexec" && option != "nosuid" && option != "nodev" && !tmpfsSizeOptionPattern.MatchString(option) {
					return errors.New("tmpfs mount option is invalid")
				}
			}
		default:
			return errors.New("mount type is invalid")
		}
		if mount.Type != MountTypeTmpfs && len(mount.TmpfsOptions) != 0 {
			return errors.New("tmpfs options require a tmpfs mount")
		}
	}
	for _, capability := range append(append([]string(nil), req.CapAdd...), req.CapDrop...) {
		if !containerCapPattern.MatchString(strings.TrimSpace(capability)) {
			return errors.New("Linux capability is invalid")
		}
	}
	for _, device := range req.Devices {
		hostPath := strings.TrimSpace(device.HostPath)
		containerPath := strings.TrimSpace(device.ContainerPath)
		permissions := strings.TrimSpace(device.Permissions)
		if hostPath == "" || !filepath.IsAbs(hostPath) || strings.Contains(hostPath, ":") || hasControl(hostPath) ||
			(containerPath != "" && (!filepath.IsAbs(containerPath) || strings.Contains(containerPath, ":") || hasControl(containerPath))) ||
			(permissions != "" && !validDevicePermissions(permissions)) {
			return errors.New("container device is invalid")
		}
	}
	return nil
}

func validContainerLabel(key, value string) bool {
	key = strings.TrimSpace(key)
	return key != "" && len(key) <= 128 && !strings.HasPrefix(key, "-") && containerModePattern.MatchString(key) && len(value) <= 1024 && !hasControl(value)
}

func validateVolumeCreateRequest(req VolumeCreateRequest) error {
	if err := validateEngine(req.Engine); err != nil {
		return err
	}
	if name := strings.TrimSpace(req.Name); name != "" && !containerNamePattern.MatchString(name) {
		return errors.New("volume name is invalid")
	}
	if driver := strings.TrimSpace(req.Driver); driver != "" && !containerModePattern.MatchString(driver) {
		return errors.New("volume driver is invalid")
	}
	if len(req.Options) > 64 {
		return errors.New("too many volume options")
	}
	seen := make(map[string]struct{}, len(req.Options))
	for _, option := range req.Options {
		key := strings.TrimSpace(option.Key)
		if !volumeOptionKeyPattern.MatchString(key) || hasControl(option.Value) {
			return errors.New("volume option is invalid")
		}
		if _, exists := seen[key]; exists {
			return fmt.Errorf("duplicate volume option %q", key)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateVolumeName(value string) error {
	if !containerNamePattern.MatchString(strings.TrimSpace(value)) {
		return errors.New("volume name is invalid")
	}
	return nil
}

func hasControl(value string) bool {
	return strings.ContainsAny(value, "\x00\r\n")
}

func unsafeMountValue(value string) bool {
	return hasControl(value) || strings.ContainsAny(value, ",=")
}

func validRestartPolicy(value string) bool {
	value = strings.TrimSpace(value)
	if value == "no" || value == "always" || value == "unless-stopped" || value == "on-failure" {
		return true
	}
	if !strings.HasPrefix(value, "on-failure:") {
		return false
	}
	count := strings.TrimPrefix(value, "on-failure:")
	return count != "" && regexp.MustCompile(`^[0-9]{1,3}$`).MatchString(count)
}

func validDevicePermissions(value string) bool {
	seen := map[rune]bool{}
	for _, permission := range value {
		if (permission != 'r' && permission != 'w' && permission != 'm') || seen[permission] {
			return false
		}
		seen[permission] = true
	}
	return len(seen) > 0
}

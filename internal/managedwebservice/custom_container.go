package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/containerengine"
	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type customContainerVolume struct {
	Name            string `json:"name"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

type customContainerVolumeSet struct {
	Volumes []customContainerVolume `json:"volumes"`
}

type containerTemplateDriver struct {
	manager *Manager
	adapter *containerengine.Adapter
}

func (d *containerTemplateDriver) Install(ctx context.Context, service *pfregistry.ManagedService, _ catalogPayload, progress func(string, int64)) (string, string, error) {
	if d.adapter == nil {
		return "", "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	spec, err := templateSpecFromService(service)
	if err != nil {
		return "", "", err
	}
	if spec.Kind != DeploymentContainer || spec.Container == nil {
		return "", "", serviceError("TEMPLATE_SNAPSHOT_INVALID", "The service does not contain a single-container template snapshot.", 409, false, nil)
	}
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		if err := d.removeExactContainer(ctx, service); err != nil {
			return "", "", err
		}
		service.RuntimeIdentity = ""
	}

	progress("pulling", 2)
	pinnedImage, err := d.PrepareUpdateArtifact(ctx, spec)
	if err != nil {
		return "", "", err
	}
	progress("verifying", 3)
	progress("installing", 4)
	runtimeID, err := d.CreateRuntime(ctx, service, spec, pinnedImage)
	if err != nil {
		return "", "", err
	}
	return runtimeID, pinnedImage, nil
}

func (d *containerTemplateDriver) PrepareUpdateArtifact(ctx context.Context, spec TemplateSpec) (string, error) {
	if d.adapter == nil || spec.Container == nil {
		return "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	pulled, err := d.adapter.PullImage(ctx, containerengine.ImagePullRequest{Engine: containerengine.EngineDocker, ImageRef: spec.Container.Image})
	if err != nil || !pulled.Completed {
		return "", serviceError("IMAGE_PULL_FAILED", "The template image could not be pulled.", 503, true, err)
	}
	pinnedImage, err := pinnedImageReference(spec.Container.Image, pulled.Image.Digest)
	if err != nil {
		return "", err
	}
	if expected := imageReferenceDigest(spec.Container.Image); expected != "" {
		if !pulled.Image.DigestPinned || expected != pulled.Image.Digest {
			return "", serviceError("IMAGE_DIGEST_MISMATCH", "Docker returned an image digest that does not match the reviewed template.", 502, false, nil)
		}
	}
	return pinnedImage, nil
}

func imageReferenceDigest(reference string) string {
	_, digest, ok := strings.Cut(strings.TrimSpace(reference), "@")
	if ok && dockerDigestPattern.MatchString(digest) {
		return digest
	}
	return ""
}

func (d *containerTemplateDriver) CreateRuntime(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec, pinnedImage string) (string, error) {
	if d.adapter == nil || spec.Container == nil {
		return "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	mounts, err := d.containerMounts(ctx, service, spec.Container.Mounts, true)
	if err != nil {
		return "", err
	}
	parameters, err := d.manager.serviceParameters(service)
	if err != nil {
		return "", err
	}
	environment, err := renderedContainerEnvironment(spec.Container.Environment, parameters, spec.Container.RuntimeProfile)
	if err != nil {
		return "", err
	}
	request := containerCreateRequest(service, spec, pinnedImage, mounts, environment)
	created, err := d.adapter.Create(ctx, request)
	if err != nil || !created.Completed || strings.TrimSpace(created.ContainerID) == "" {
		return "", serviceError("CONTAINER_CREATE_FAILED", "The managed template container could not be created.", 502, true, err)
	}
	service.RuntimeIdentity, service.ArtifactReference = created.ContainerID, pinnedImage
	if err := d.verifyExactContainer(ctx, service, spec); err != nil {
		_ = d.removeExactContainer(context.Background(), service)
		return "", err
	}
	return created.ContainerID, nil
}

func (d *containerTemplateDriver) RemoveRuntime(ctx context.Context, service *pfregistry.ManagedService) error {
	return d.removeExactContainer(ctx, service)
}

func (d *containerTemplateDriver) VerifyRuntime(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec) error {
	return d.verifyExactContainer(ctx, service, spec)
}

func (d *containerTemplateDriver) FindRuntime(ctx context.Context, serviceID string) (string, error) {
	if d.adapter == nil {
		return "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	listed, err := d.adapter.List(ctx, containerengine.ContainerListRequest{Engine: containerengine.EngineDocker, All: true})
	if err != nil {
		return "", err
	}
	name := customContainerName(serviceID)
	identity := ""
	for _, candidate := range listed.Containers {
		if candidate.Name != name {
			continue
		}
		matches, err := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: candidate.ContainerID, Key: managedServiceLabel, Value: serviceID})
		if err != nil {
			return "", err
		}
		if !matches {
			continue
		}
		if identity != "" {
			return "", serviceError("CONTAINER_IDENTITY_AMBIGUOUS", "More than one container claims the managed service identity.", 409, false, nil)
		}
		identity = candidate.ContainerID
	}
	return identity, nil
}

func pinnedImageReference(reference, digest string) (string, error) {
	reference = strings.TrimSpace(reference)
	if before, after, ok := strings.Cut(reference, "@"); ok {
		if !dockerDigestPattern.MatchString(after) {
			return "", serviceError("IMAGE_DIGEST_UNAVAILABLE", "Docker did not return a verifiable image digest.", 502, false, nil)
		}
		return before + "@" + after, nil
	}
	digest = strings.TrimSpace(digest)
	if !dockerDigestPattern.MatchString(digest) {
		return "", serviceError("IMAGE_DIGEST_UNAVAILABLE", "Docker did not return a verifiable image digest for the pulled template image.", 502, false, nil)
	}
	return reference + "@" + digest, nil
}

func renderedContainerEnvironment(values map[string]string, parameters map[string]string, runtimeProfile string) ([]string, error) {
	replacements := make(map[string]string, len(parameters)+3)
	for name, value := range parameters {
		replacements[name] = value
	}
	if runtimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		system, err := runtimeContainerVariables()
		if err != nil {
			return nil, err
		}
		for name, value := range system {
			replacements[name] = value
		}
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		value := values[key]
		for parameter, replacement := range replacements {
			value = strings.ReplaceAll(value, "${"+parameter+"}", replacement)
		}
		if strings.Contains(value, "${") {
			return nil, serviceError("TEMPLATE_PARAMETER_UNRESOLVED", "A container environment value references an undefined template parameter.", 400, false, nil)
		}
		out = append(out, key+"="+value)
	}
	return out, nil
}

func runtimeContainerVariables() (map[string]string, error) {
	current, err := user.Current()
	if err != nil {
		return nil, serviceError("RUNTIME_USER_IDENTITY_UNAVAILABLE", "Redeven could not determine the Runtime user identity for the container.", 409, false, err)
	}
	for _, value := range []string{current.Uid, current.Gid} {
		if _, err := strconv.ParseUint(value, 10, 32); err != nil {
			return nil, serviceError("RUNTIME_USER_IDENTITY_UNAVAILABLE", "Redeven could not determine a numeric Runtime user identity for the container.", 409, false, err)
		}
	}
	timezone := strings.TrimSpace(os.Getenv("TZ"))
	if timezone == "" || strings.ContainsAny(timezone, "\x00\r\n") {
		timezone = "Etc/UTC"
	}
	return map[string]string{"REDEVEN_RUNTIME_UID": current.Uid, "REDEVEN_RUNTIME_GID": current.Gid, "REDEVEN_RUNTIME_TIMEZONE": timezone}, nil
}

func containerCreateRequest(service *pfregistry.ManagedService, spec TemplateSpec, pinnedImage string, mounts []containerengine.ContainerMount, environment []string) containerengine.ContainerCreateRequest {
	request := containerengine.ContainerCreateRequest{
		Engine: containerengine.EngineDocker, Name: customContainerName(service.ServiceID), Image: pinnedImage,
		Command: append([]string(nil), spec.Container.Command...), Env: append([]string(nil), environment...),
		Labels: map[string]string{managedServiceLabel: service.ServiceID}, RestartPolicy: "no", NetworkMode: "bridge",
		Ports:  []containerengine.ContainerPortPublish{{ContainerPort: spec.Endpoint.ContainerPort, HostPort: service.RuntimePort, HostIP: "127.0.0.1", Protocol: "tcp"}},
		Mounts: append([]containerengine.ContainerMount(nil), mounts...), CPUCount: spec.Container.CPUs, MemoryBytes: spec.Container.MemoryBytes,
		PIDsLimit: effectivePIDsLimit(spec.Container.PIDsLimit),
	}
	if len(spec.Container.Entrypoint) == 1 {
		request.Entrypoint = spec.Container.Entrypoint[0]
	}
	if spec.Container.RuntimeProfile == ContainerRuntimeProfileInteractiveDesktop {
		request.ReadOnlyRoot = false
		request.ShmSizeBytes = 1024 * 1024 * 1024
		request.PIDsLimit = 2048
		return request
	}
	request.CapDrop = []string{"ALL"}
	request.ReadOnlyRoot = true
	request.SecurityOpts = []string{"no-new-privileges:true"}
	request.User = strings.TrimSpace(spec.Container.User)
	return request
}

func effectivePIDsLimit(value int64) int {
	if value <= 0 {
		return 512
	}
	return int(value)
}

func customContainerName(serviceID string) string {
	return "redeven-mws-" + strings.TrimPrefix(strings.TrimSpace(serviceID), "mws_")
}

func resourceNameSuffix(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('-')
		}
	}
	result := strings.Trim(builder.String(), "-_")
	if result == "" {
		return "service"
	}
	if len(result) > 48 {
		return result[:48]
	}
	return result
}

func (d *containerTemplateDriver) markerPath(service *pfregistry.ManagedService) string {
	return filepath.Join(d.manager.stateDir, "families", service.ServiceFamilyID, "container-volumes.json")
}

func (d *containerTemplateDriver) containerMounts(ctx context.Context, service *pfregistry.ManagedService, specs []ContainerMountSpec, createVolumes bool) ([]containerengine.ContainerMount, error) {
	marker, err := d.loadVolumeSet(service)
	if err != nil {
		return nil, err
	}
	volumeByName := make(map[string]customContainerVolume, len(marker.Volumes))
	for _, volume := range marker.Volumes {
		volumeByName[volume.Name] = volume
	}
	result := make([]containerengine.ContainerMount, 0, len(specs))
	changed := false
	for index, mount := range specs {
		switch mount.Type {
		case "workspace":
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeBind, Source: service.WorkspacePath, Target: mount.Target, ReadOnly: mount.ReadOnly})
		case "bind":
			resolved, err := d.manager.scope.Resolve(mount.Source, filesystemscope.ResolveOptions{RequireExisting: true, ForWrite: !mount.ReadOnly})
			if err != nil {
				return nil, serviceError("TEMPLATE_MOUNT_UNAVAILABLE", "A custom container bind mount is outside the Environment's allowed paths.", 400, false, err)
			}
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeBind, Source: resolved.RealAbs, Target: mount.Target, ReadOnly: mount.ReadOnly})
		case "tmpfs":
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeTmpfs, Target: mount.Target, TmpfsOptions: []string{"rw", "noexec", "nosuid", "nodev", "size=536870912"}})
		case "volume":
			name := fmt.Sprintf("redeven-mws-data-%s-%d", resourceNameSuffix(service.ServiceFamilyID), index)
			identity, ok := volumeByName[name]
			if ok {
				inspected, err := d.adapter.InspectVolume(ctx, containerengine.VolumeInspectRequest{Engine: containerengine.EngineDocker, Name: name})
				if err != nil || inspected.CreatedAtUnixMs != identity.CreatedAtUnixMs {
					return nil, serviceError("DATA_IDENTITY_MISMATCH", "A retained template data volume is missing or has changed identity.", 409, false, err)
				}
			} else if createVolumes {
				created, err := d.adapter.CreateVolume(ctx, containerengine.VolumeCreateRequest{Engine: containerengine.EngineDocker, Name: name})
				if err != nil {
					return nil, serviceError("DATA_VOLUME_CREATE_FAILED", "A template data volume could not be created.", 502, true, err)
				}
				if created.CreatedAtUnixMs <= 0 {
					created, err = d.adapter.InspectVolume(ctx, containerengine.VolumeInspectRequest{Engine: containerengine.EngineDocker, Name: name})
					if err != nil {
						return nil, err
					}
				}
				if created.CreatedAtUnixMs <= 0 {
					return nil, serviceError("DATA_IDENTITY_UNAVAILABLE", "Docker did not return a stable identity for a template data volume.", 502, false, nil)
				}
				identity = customContainerVolume{Name: name, CreatedAtUnixMs: created.CreatedAtUnixMs}
				marker.Volumes = append(marker.Volumes, identity)
				volumeByName[name] = identity
				changed = true
			} else {
				return nil, serviceError("DATA_IDENTITY_MISSING", "A retained template data volume identity is missing.", 409, false, nil)
			}
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeVolume, Source: name, Target: mount.Target, ReadOnly: mount.ReadOnly})
		default:
			return nil, serviceError("TEMPLATE_MOUNT_REJECTED", "A custom container mount type is invalid.", 400, false, nil)
		}
	}
	if changed {
		if err := d.saveVolumeSet(service, marker); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (d *containerTemplateDriver) loadVolumeSet(service *pfregistry.ManagedService) (customContainerVolumeSet, error) {
	marker := customContainerVolumeSet{Volumes: []customContainerVolume{}}
	raw, err := os.ReadFile(d.markerPath(service))
	if errors.Is(err, os.ErrNotExist) {
		return marker, nil
	}
	if err != nil {
		return marker, err
	}
	if err := decodeStrictJSON(raw, &marker); err != nil {
		return marker, serviceError("DATA_IDENTITY_INVALID", "The retained template data identity is invalid.", 409, false, err)
	}
	return marker, nil
}

func (d *containerTemplateDriver) saveVolumeSet(service *pfregistry.ManagedService, marker customContainerVolumeSet) error {
	raw, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	path := d.markerPath(service)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (d *containerTemplateDriver) verifyExactContainer(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec) error {
	if strings.TrimSpace(service.RuntimeIdentity) == "" {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The managed template container identity is missing.", 409, false, nil)
	}
	response, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The exact managed template container no longer exists.", 409, false, err)
	}
	container := response.Container
	labelMatches, labelErr := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity, Key: managedServiceLabel, Value: service.ServiceID})
	if labelErr != nil || container.ContainerID != service.RuntimeIdentity || container.Name != customContainerName(service.ServiceID) || container.Image.Reference != service.ArtifactReference || !container.Image.DigestPinned || !labelMatches {
		return serviceError("CONTAINER_IDENTITY_MISMATCH", "The exact managed template container identity or image has changed.", 409, false, labelErr)
	}
	runtime := container.Runtime
	if !containerRuntimeMatchesProfile(runtime, spec.Container.RuntimeProfile, effectivePIDsLimit(spec.Container.PIDsLimit)) {
		return serviceError("CONTAINER_HARDENING_MISMATCH", "The managed template container no longer matches Redeven's hardened runtime policy.", 409, false, nil)
	}
	expectedMounts, err := d.containerMounts(ctx, service, spec.Container.Mounts, false)
	if err != nil {
		return err
	}
	if len(container.Devices) != 0 || len(container.Mounts) != len(expectedMounts) {
		return serviceError("CONTAINER_CAPABILITY_MISMATCH", "The managed template container exposes an unreviewed device or mount.", 409, false, nil)
	}
	for _, expected := range expectedMounts {
		found := false
		for _, actual := range container.Mounts {
			if actual.Target == expected.Target && mountSourceMatches(expected, actual) && actual.ReadOnly == expected.ReadOnly && actual.Type == expected.Type && !actual.ContainerSocket {
				found = true
				break
			}
		}
		if !found {
			return serviceError("CONTAINER_MOUNT_MISMATCH", "The managed template container no longer matches its reviewed mount contract.", 409, false, nil)
		}
	}
	if len(container.Ports) != 1 || container.Ports[0].Port != spec.Endpoint.ContainerPort || container.Ports[0].HostPort != service.RuntimePort || container.Ports[0].HostIP != "127.0.0.1" {
		return serviceError("CONTAINER_NETWORK_MISMATCH", "The managed template container must publish exactly one Web port on 127.0.0.1.", 409, false, nil)
	}
	return nil
}

func mountSourceMatches(expected containerengine.ContainerMount, actual containerengine.MountSummary) bool {
	return mountSourceMatchesForHost(expected, actual, runtime.GOOS)
}

func mountSourceMatchesForHost(expected containerengine.ContainerMount, actual containerengine.MountSummary, hostOS string) bool {
	if expected.Type != containerengine.MountTypeBind || hostOS != "darwin" {
		return actual.Source == expected.Source
	}
	expectedSource := filepath.Clean(expected.Source)
	if resolved, err := filepath.EvalSymlinks(expectedSource); err == nil {
		expectedSource = resolved
	}
	actualSource := filepath.Clean(actual.Source)
	return actualSource == expectedSource || actualSource == filepath.Join("/host_mnt", expectedSource)
}

func containerRuntimeMatchesProfile(runtime containerengine.RuntimeSummary, profile string, pidsLimit int) bool {
	if runtime.Privileged || runtime.NetworkMode != "bridge" || !privateNamespaceMode(runtime.PIDMode) || !privateNamespaceMode(runtime.IPCMode) || len(runtime.CapAdd) != 0 || len(runtime.Devices) != 0 {
		return false
	}
	if profile == ContainerRuntimeProfileInteractiveDesktop {
		for _, option := range runtime.SecurityOpts {
			lower := strings.ToLower(strings.TrimSpace(option))
			if strings.Contains(lower, "seccomp=unconfined") || strings.Contains(lower, "apparmor=unconfined") {
				return false
			}
		}
		return !runtime.ReadOnlyRoot && runtime.PIDsLimit == 2048 && runtime.ShmSizeBytes == 1024*1024*1024 && strings.TrimSpace(runtime.User) == "" && len(runtime.CapDrop) == 0
	}
	return runtime.ReadOnlyRoot && runtime.PIDsLimit == pidsLimit && slices.Contains(runtime.CapDrop, "ALL") && slices.Contains(runtime.SecurityOpts, "no-new-privileges:true")
}

func privateNamespaceMode(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "private":
		return true
	default:
		return false
	}
}

func (d *containerTemplateDriver) Start(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	spec, err := templateSpecFromService(service)
	if err != nil {
		return "", err
	}
	if err := d.verifyExactContainer(ctx, service, spec); err != nil {
		return "", err
	}
	response, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return "", err
	}
	if response.Container.State == containerengine.ContainerStateRunning {
		return service.RuntimeIdentity, nil
	}
	started, err := d.adapter.Start(ctx, containerengine.ContainerStartRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil || !started.Completed || started.ContainerID != service.RuntimeIdentity {
		return "", serviceError("START_FAILED", "The exact managed template container could not be started.", 502, true, err)
	}
	return service.RuntimeIdentity, d.verifyExactContainer(ctx, service, spec)
}

func (d *containerTemplateDriver) Stop(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	spec, err := templateSpecFromService(service)
	if err != nil {
		return err
	}
	if err := d.verifyExactContainer(ctx, service, spec); err != nil {
		return err
	}
	response, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return err
	}
	if response.Container.State != containerengine.ContainerStateRunning && response.Container.State != containerengine.ContainerStateRestarting && response.Container.State != containerengine.ContainerStatePaused {
		return nil
	}
	stopped, err := d.adapter.Stop(ctx, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity, TimeoutSec: 10})
	if err != nil || !stopped.Completed || stopped.ContainerID != service.RuntimeIdentity {
		return serviceError("STOP_FAILED", "The exact managed template container could not be stopped.", 502, true, err)
	}
	return nil
}

func (d *containerTemplateDriver) removeExactContainer(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	removed, err := d.adapter.Remove(ctx, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil || !removed.Completed || removed.ContainerID != service.RuntimeIdentity {
		return serviceError("CONTAINER_REMOVE_FAILED", "The exact managed template container could not be removed.", 502, true, err)
	}
	return nil
}

func (d *containerTemplateDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool) error {
	if err := d.removeExactContainer(ctx, service); err != nil {
		return err
	}
	if !deleteData {
		return nil
	}
	marker, err := d.loadVolumeSet(service)
	if err != nil {
		return err
	}
	for _, identity := range marker.Volumes {
		volume, err := d.adapter.InspectVolume(ctx, containerengine.VolumeInspectRequest{Engine: containerengine.EngineDocker, Name: identity.Name})
		if err != nil || volume.CreatedAtUnixMs != identity.CreatedAtUnixMs {
			return serviceError("DATA_IDENTITY_MISMATCH", "Redeven will not delete a template data volume whose identity has changed.", 409, false, err)
		}
		if err := d.adapter.RemoveVolume(ctx, containerengine.VolumeRemoveRequest{Engine: containerengine.EngineDocker, Name: identity.Name}); err != nil {
			return serviceError("DATA_REMOVE_FAILED", "A template data volume could not be deleted.", 502, true, err)
		}
	}
	if err := os.Remove(d.markerPath(service)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (d *containerTemplateDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	return d.removeExactContainer(ctx, service)
}

func (d *containerTemplateDriver) Logs(ctx context.Context, service *pfregistry.ManagedService, tail int) (*LogResult, error) {
	spec, err := templateSpecFromService(service)
	if err != nil {
		return nil, err
	}
	if err := d.verifyExactContainer(ctx, service, spec); err != nil {
		return nil, err
	}
	result, err := d.adapter.TailLogs(ctx, containerengine.LogsTailRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity, TailLines: tail})
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(result.Lines))
	for _, line := range result.Lines {
		lines = append(lines, redactLogLine(line.Message))
	}
	return &LogResult{Lines: lines}, nil
}

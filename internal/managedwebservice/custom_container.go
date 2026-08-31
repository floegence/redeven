package managedwebservice

import (
	"context"
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
	ResourceID      string `json:"resource_id,omitempty"`
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

func (d *containerTemplateDriver) RebuildStoppedRuntime(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec, artifact string) (string, string, error) {
	runtimeID, err := d.CreateRuntime(ctx, service, spec, artifact)
	return runtimeID, artifact, err
}

func (d *containerTemplateDriver) FindReconfiguredRuntime(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	return d.FindRuntime(ctx, service.ServiceID)
}

func (d *containerTemplateDriver) Install(ctx context.Context, service *pfregistry.ManagedService, _ catalogPayload, progress func(string, int64)) (string, string, error) {
	if d.adapter == nil {
		return "", "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	spec, _, err := effectiveSpecFromService(service)
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
	pulled, err := pullManagedImage(ctx, d.adapter, spec.Container.Image)
	if err != nil {
		return "", err
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
	environmentValues := cloneStringMap(spec.Container.Environment)
	secrets, err := d.manager.serviceSecretDocument(service.ServiceID)
	if err != nil {
		return "", err
	}
	for name, value := range secrets.Environment {
		environmentValues[name] = value
	}
	environment, err := renderedContainerEnvironment(environmentValues, parameters, spec.Container.RuntimeProfile)
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
	labels := cloneStringMap(spec.Container.Labels)
	if labels == nil {
		labels = map[string]string{}
	}
	labels[managedServiceLabel] = service.ServiceID
	ports := []containerengine.ContainerPortPublish{{ContainerPort: spec.Endpoint.ContainerPort, HostPort: service.RuntimePort, HostIP: "127.0.0.1", Protocol: "tcp"}}
	for _, port := range spec.Container.Ports {
		ports = append(ports, containerengine.ContainerPortPublish{ContainerPort: port.ContainerPort, HostPort: port.HostPort, HostIP: port.HostIP, Protocol: port.Protocol})
	}
	devices := make([]containerengine.ContainerDevice, 0, len(spec.Container.Devices))
	for _, device := range spec.Container.Devices {
		devices = append(devices, containerengine.ContainerDevice{HostPath: device.HostPath, ContainerPath: device.ContainerPath, Permissions: device.Permissions})
	}
	request := containerengine.ContainerCreateRequest{
		Engine: containerengine.EngineDocker, Name: customContainerName(service.ServiceID), Image: pinnedImage,
		Command: append([]string(nil), spec.Container.Command...), Env: append([]string(nil), environment...),
		Labels: labels, RestartPolicy: defaultString(spec.Container.RestartPolicy, "no"), NetworkMode: defaultString(spec.Container.NetworkMode, "bridge"), PIDMode: spec.Container.PIDMode, IPCMode: spec.Container.IPCMode,
		Ports:  ports,
		Mounts: append([]containerengine.ContainerMount(nil), mounts...), CPUCount: spec.Container.CPUs, MemoryBytes: spec.Container.MemoryBytes,
		PIDsLimit: int(spec.Container.PIDsLimit), ShmSizeBytes: spec.Container.ShmSizeBytes,
		CapAdd: append([]string(nil), spec.Container.CapAdd...), CapDrop: append([]string(nil), spec.Container.CapDrop...), Devices: devices,
		Privileged: spec.Container.Privileged, ReadOnlyRoot: spec.Container.ReadOnlyRoot, SecurityOpts: append([]string(nil), spec.Container.SecurityOpts...), User: strings.TrimSpace(spec.Container.User),
	}
	if len(spec.Container.Entrypoint) == 1 {
		request.Entrypoint = spec.Container.Entrypoint[0]
	}
	return request
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
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
	volumeByResourceID := make(map[string]customContainerVolume, len(marker.Volumes))
	for _, volume := range marker.Volumes {
		volumeByResourceID[volume.ResourceID] = volume
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
			options := append([]string(nil), mount.TmpfsOptions...)
			if len(options) == 0 {
				options = []string{"rw", "noexec", "nosuid", "nodev", "size=536870912"}
			}
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeTmpfs, Target: mount.Target, TmpfsOptions: options})
		case "volume":
			resourceID := strings.TrimSpace(mount.ResourceID)
			if resourceID == "" {
				resourceID = fmt.Sprintf("legacy-volume-%d", index)
			}
			name := fmt.Sprintf("redeven-mws-data-%s-%s", resourceNameSuffix(service.ServiceFamilyID), resourceNameSuffix(resourceID))
			identity, ok := volumeByResourceID[resourceID]
			if ok {
				name = identity.Name
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
				identity = customContainerVolume{ResourceID: resourceID, Name: name, CreatedAtUnixMs: created.CreatedAtUnixMs}
				marker.Volumes = append(marker.Volumes, identity)
				volumeByResourceID[resourceID] = identity
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

func (d *containerTemplateDriver) containerMountsForPreflight(ctx context.Context, service *pfregistry.ManagedService, specs []ContainerMountSpec) ([]containerengine.ContainerMount, error) {
	marker, err := d.loadVolumeSet(service)
	if err != nil {
		return nil, err
	}
	volumeNames := make(map[string]string, len(marker.Volumes))
	for _, volume := range marker.Volumes {
		volumeNames[volume.ResourceID] = volume.Name
	}
	result := make([]containerengine.ContainerMount, 0, len(specs))
	for _, mount := range specs {
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
			options := append([]string(nil), mount.TmpfsOptions...)
			if len(options) == 0 {
				options = []string{"rw", "noexec", "nosuid", "nodev", "size=536870912"}
			}
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeTmpfs, Target: mount.Target, TmpfsOptions: options})
		case "volume":
			name := volumeNames[mount.ResourceID]
			if name == "" {
				name = fmt.Sprintf("redeven-mws-data-%s-%s", resourceNameSuffix(service.ServiceFamilyID), resourceNameSuffix(mount.ResourceID))
			}
			result = append(result, containerengine.ContainerMount{Type: containerengine.MountTypeVolume, Source: name, Target: mount.Target, ReadOnly: mount.ReadOnly})
		default:
			return nil, serviceError("TEMPLATE_MOUNT_REJECTED", "A custom container mount type is invalid.", 400, false, nil)
		}
	}
	return result, nil
}

func (d *containerTemplateDriver) loadVolumeSet(service *pfregistry.ManagedService) (customContainerVolumeSet, error) {
	marker := customContainerVolumeSet{Volumes: []customContainerVolume{}}
	resources, err := d.manager.registry.ListManagedServiceResources(context.Background(), service.ServiceID)
	if err != nil {
		return marker, err
	}
	for _, resource := range resources {
		if resource.Kind == "volume" {
			marker.Volumes = append(marker.Volumes, customContainerVolume{ResourceID: resource.ResourceID, Name: resource.EngineIdentity, CreatedAtUnixMs: resource.CreatedAtUnixMs})
		}
	}
	if len(marker.Volumes) > 0 {
		return marker, nil
	}
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
	for index := range marker.Volumes {
		if marker.Volumes[index].ResourceID == "" {
			marker.Volumes[index].ResourceID = fmt.Sprintf("legacy-volume-%d", index)
		}
		if err := d.manager.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: marker.Volumes[index].ResourceID, Kind: "volume", EngineIdentity: marker.Volumes[index].Name, CreatedAtUnixMs: marker.Volumes[index].CreatedAtUnixMs}); err != nil {
			return customContainerVolumeSet{}, err
		}
	}
	if err := os.Remove(d.markerPath(service)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return customContainerVolumeSet{}, err
	}
	return marker, nil
}

func (d *containerTemplateDriver) saveVolumeSet(service *pfregistry.ManagedService, marker customContainerVolumeSet) error {
	for _, volume := range marker.Volumes {
		if err := d.manager.registry.PutManagedServiceResource(context.Background(), pfregistry.ManagedServiceResource{ServiceID: service.ServiceID, ResourceID: volume.ResourceID, Kind: "volume", EngineIdentity: volume.Name, CreatedAtUnixMs: volume.CreatedAtUnixMs}); err != nil {
			return err
		}
	}
	return nil
}

func (d *containerTemplateDriver) verifyExactContainer(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec) error {
	if strings.TrimSpace(service.RuntimeIdentity) == "" {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The managed template container identity is missing.", 409, false, nil)
	}
	container, exists, err := d.ownedContainer(ctx, service)
	if err != nil {
		return err
	}
	if !exists {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The exact managed template container no longer exists.", 409, false, nil)
	}
	expectedMounts, err := d.containerMounts(ctx, service, spec.Container.Mounts, false)
	if err != nil {
		return err
	}
	expected := containerCreateRequest(service, spec, service.ArtifactReference, expectedMounts, nil)
	runtime := container.Runtime
	if runtime.Privileged != expected.Privileged || runtime.ReadOnlyRoot != expected.ReadOnlyRoot || runtime.PIDsLimit != expected.PIDsLimit ||
		runtime.ShmSizeBytes != expected.ShmSizeBytes || strings.TrimSpace(runtime.NetworkMode) != strings.TrimSpace(expected.NetworkMode) ||
		!namespaceModeMatches(runtime.PIDMode, expected.PIDMode) || !namespaceModeMatches(runtime.IPCMode, expected.IPCMode) ||
		strings.TrimSpace(runtime.RestartPolicy) != normalizedRestartPolicy(expected.RestartPolicy) || strings.TrimSpace(runtime.User) != strings.TrimSpace(expected.User) ||
		!sameStrings(runtime.CapAdd, expected.CapAdd) || !sameStrings(runtime.CapDrop, expected.CapDrop) || !sameStrings(runtime.SecurityOpts, expected.SecurityOpts) {
		return serviceError("CONTAINER_CONFIGURATION_MISMATCH", "The managed template container no longer matches its effective runtime configuration.", 409, false, nil)
	}
	if len(container.Devices) != len(expected.Devices) || len(container.Mounts) != len(expectedMounts) {
		return serviceError("CONTAINER_CAPABILITY_MISMATCH", "The managed template container exposes a device or mount outside its effective configuration.", 409, false, nil)
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
	for _, expectedDevice := range expected.Devices {
		found := false
		for _, actual := range container.Devices {
			if actual.HostPath == expectedDevice.HostPath && actual.ContainerPath == expectedDevice.ContainerPath && actual.Permissions == expectedDevice.Permissions {
				found = true
				break
			}
		}
		if !found {
			return serviceError("CONTAINER_DEVICE_MISMATCH", "The managed template container no longer matches its effective device configuration.", 409, false, nil)
		}
	}
	expectedPorts := make([]ContainerPortSpec, 0, len(expected.Ports))
	for _, port := range expected.Ports {
		expectedPorts = append(expectedPorts, ContainerPortSpec{ContainerPort: port.ContainerPort, HostPort: port.HostPort, HostIP: port.HostIP, Protocol: port.Protocol})
	}
	if !composePortsMatch(container.Ports, expectedPorts, false, 0, 0) {
		return serviceError("CONTAINER_NETWORK_MISMATCH", "The managed template container no longer matches its effective published-port configuration.", 409, false, nil)
	}
	return nil
}

func (d *containerTemplateDriver) ownedContainer(ctx context.Context, service *pfregistry.ManagedService) (containerengine.ContainerInspect, bool, error) {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return containerengine.ContainerInspect{}, false, nil
	}
	response, err := d.adapter.Inspect(ctx, containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
	if errors.Is(err, containerengine.ErrContainerNotFound) {
		return containerengine.ContainerInspect{}, false, nil
	}
	if err != nil {
		return containerengine.ContainerInspect{}, false, serviceError("CONTAINER_INSPECTION_FAILED", "The managed template container could not be inspected before removal.", 502, true, err)
	}
	container := response.Container
	labelMatches, labelErr := d.adapter.ContainerMatchesLabel(ctx, containerengine.ContainerLabelMatchRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity, Key: managedServiceLabel, Value: service.ServiceID})
	if labelErr != nil || container.ContainerID != service.RuntimeIdentity || container.Name != customContainerName(service.ServiceID) || container.Image.Reference != service.ArtifactReference || !container.Image.DigestPinned || !labelMatches {
		return containerengine.ContainerInspect{}, false, serviceError("CONTAINER_IDENTITY_MISMATCH", "The exact managed template container identity or image has changed.", 409, false, labelErr)
	}
	return container, true, nil
}

func (d *containerTemplateDriver) stopOwnedContainer(ctx context.Context, service *pfregistry.ManagedService) (bool, error) {
	container, exists, err := d.ownedContainer(ctx, service)
	if err != nil || !exists {
		return exists, err
	}
	if container.State != containerengine.ContainerStateRunning && container.State != containerengine.ContainerStateRestarting && container.State != containerengine.ContainerStatePaused {
		return true, nil
	}
	stopped, err := d.adapter.Stop(ctx, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity, TimeoutSec: 10})
	if err != nil || !stopped.Completed || stopped.ContainerID != service.RuntimeIdentity {
		return false, serviceError("STOP_FAILED", "The exact managed template container could not be stopped.", 502, true, err)
	}
	return true, nil
}

func namespaceModeMatches(actual, expected string) bool {
	if strings.TrimSpace(expected) == "" || strings.EqualFold(strings.TrimSpace(expected), "private") {
		return privateNamespaceMode(actual)
	}
	return strings.EqualFold(strings.TrimSpace(actual), strings.TrimSpace(expected))
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
	spec, _, err := effectiveSpecFromService(service)
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
	spec, _, err := effectiveSpecFromService(service)
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

func (d *containerTemplateDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool, progress func(string, int64)) error {
	progress("stopping", 2)
	exists, err := d.stopOwnedContainer(ctx, service)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	progress("uninstalling", 5)
	background := context.Background()
	if exists {
		removed, err := d.adapter.Remove(background, containerengine.ContainerActionRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
		if !errors.Is(err, containerengine.ErrContainerNotFound) && (err != nil || !removed.Completed || removed.ContainerID != service.RuntimeIdentity) {
			return serviceError("CONTAINER_REMOVE_FAILED", "The exact managed template container could not be removed.", 502, true, err)
		}
	}
	if !deleteData {
		return nil
	}
	marker, err := d.loadVolumeSet(service)
	if err != nil {
		return err
	}
	for _, identity := range marker.Volumes {
		volume, err := d.adapter.InspectVolume(background, containerengine.VolumeInspectRequest{Engine: containerengine.EngineDocker, Name: identity.Name})
		if err != nil || volume.CreatedAtUnixMs != identity.CreatedAtUnixMs {
			return serviceError("DATA_IDENTITY_MISMATCH", "Redeven will not delete a template data volume whose identity has changed.", 409, false, err)
		}
		if err := d.adapter.RemoveVolume(background, containerengine.VolumeRemoveRequest{Engine: containerengine.EngineDocker, Name: identity.Name}); err != nil {
			return serviceError("DATA_REMOVE_FAILED", "A template data volume could not be deleted.", 502, true, err)
		}
	}
	if err := os.Remove(d.markerPath(service)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, identity := range marker.Volumes {
		_ = d.manager.registry.DeleteManagedServiceResource(context.Background(), service.ServiceID, identity.ResourceID)
	}
	return nil
}

func (d *containerTemplateDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	return d.removeExactContainer(ctx, service)
}

func (d *containerTemplateDriver) Logs(ctx context.Context, service *pfregistry.ManagedService, tail int) (*LogResult, error) {
	spec, _, err := effectiveSpecFromService(service)
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

package managedwebservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/capabilities/containers"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	auditedDockerImage       = "runzhliu/deepseek-harness:0.1.1-rc.2"
	auditedDockerAMD64Digest = "sha256:7ab8875c68f3ecef18b21b8f04f72d914a4b86df9876064bb5af7d45a9224e9c"
	auditedDockerARM64Digest = "sha256:53e8a997f09252b139b8e46c0c13eeb574074e6f17a732a4b57135ac5a6bc58a"
	managedServiceLabel      = "com.floegence.redeven.managed-web-service"
)

var dockerDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func auditedDockerArtifact(platform string) (dockerArtifact, bool) {
	digest := ""
	switch platform {
	case "linux-amd64":
		digest = auditedDockerAMD64Digest
	case "linux-arm64":
		digest = auditedDockerARM64Digest
	default:
		return dockerArtifact{}, false
	}
	return dockerArtifact{Image: auditedDockerImage, Digest: digest}, true
}

func auditedDockerCatalog() catalogPayload {
	docker := make(map[string]dockerArtifact, 2)
	for _, platform := range []string{"linux-amd64", "linux-arm64"} {
		artifact, _ := auditedDockerArtifact(platform)
		docker[platform] = artifact
	}
	return catalogPayload{
		TemplateID: DeepSeekHarnessTemplateID,
		Version:    DeepSeekHarnessVersion,
		Docker:     docker,
	}
}

type retainedDockerVolume struct {
	Name            string `json:"name"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

type dockerDriver struct {
	adapter  *containers.Adapter
	stateDir string
}

func (d *dockerDriver) Install(ctx context.Context, service *pfregistry.ManagedService, catalog catalogPayload, progress func(string, int64)) (string, string, error) {
	if d.adapter == nil {
		return "", "", serviceError("DOCKER_UNAVAILABLE", "Docker is not available in this Environment.", 409, true, nil)
	}
	artifact, ok := catalog.Docker["linux-"+runtime.GOARCH]
	if !ok {
		return "", "", serviceError("DOCKER_PLATFORM_UNSUPPORTED", "The audited Docker catalog does not include this CPU architecture.", 409, false, nil)
	}
	if artifact.Image != auditedDockerImage || !dockerDigestPattern.MatchString(strings.TrimSpace(artifact.Digest)) {
		return "", "", serviceError("CATALOG_INVALID", "The Docker image reference or digest is not the audited DeepSeek Harness release.", 502, false, nil)
	}
	pinnedImage := artifact.Image + "@" + artifact.Digest
	if strings.TrimSpace(service.RuntimeIdentity) != "" {
		if err := d.removeExactContainer(ctx, service); err != nil {
			return "", "", err
		}
		service.RuntimeIdentity = ""
	}
	progress("pulling", 2)
	pulled, err := d.adapter.PullImage(ctx, containers.ImagePullRequest{Engine: containers.EngineDocker, ImageRef: pinnedImage})
	if err != nil || !pulled.Completed || !pulled.Image.DigestPinned {
		return "", "", serviceError("IMAGE_PULL_FAILED", "The audited DeepSeek Harness image could not be pulled by digest.", 503, true, err)
	}
	progress("verifying", 3)
	if pulled.Image.Digest != "" && pulled.Image.Digest != artifact.Digest {
		return "", "", serviceError("IMAGE_DIGEST_MISMATCH", "Docker returned an image digest that does not match the audited catalog.", 502, false, nil)
	}
	volumeName, err := d.ensureDataVolume(ctx, service)
	if err != nil {
		return "", "", err
	}
	progress("installing", 4)
	created, err := d.adapter.Create(ctx, hardenedDockerCreateRequest(service, pinnedImage, volumeName))
	if err != nil {
		return "", "", serviceError("CONTAINER_CREATE_FAILED", "The hardened DeepSeek Harness container could not be created.", 502, true, err)
	}
	service.RuntimeIdentity = created.ContainerID
	service.ArtifactReference = pinnedImage
	if err := d.verifyExactContainer(ctx, service, pinnedImage); err != nil {
		_ = d.removeExactContainer(context.Background(), service)
		return "", "", err
	}
	return created.ContainerID, pinnedImage, nil
}

func hardenedDockerCreateRequest(service *pfregistry.ManagedService, pinnedImage, volumeName string) containers.ContainerCreateRequest {
	return containers.ContainerCreateRequest{
		Engine: containers.EngineDocker, Name: dockerContainerName(service.ServiceID), Image: pinnedImage, RestartPolicy: "no", NetworkMode: "bridge",
		Env:    []string{"DSH_DESKTOP_ENABLED=0", "DSH_HOME=/home/node/.dsh", "HOME=/workspace"},
		Labels: map[string]string{managedServiceLabel: service.ServiceID},
		Ports:  []containers.ContainerPortPublish{{ContainerPort: 3080, HostPort: service.RuntimePort, HostIP: "127.0.0.1", Protocol: "tcp"}},
		Mounts: []containers.ContainerMount{
			{Type: containers.MountTypeVolume, Source: volumeName, Target: "/home/node/.dsh"},
			{Type: containers.MountTypeBind, Source: service.WorkspacePath, Target: "/workspace"},
			{Type: containers.MountTypeTmpfs, Target: "/tmp", TmpfsOptions: []string{"rw", "noexec", "nosuid", "nodev", "size=536870912"}},
		},
		CapDrop: []string{"ALL"}, ReadOnlyRoot: true, SecurityOpts: []string{"no-new-privileges:true"}, PIDsLimit: 512, ShmSizeBytes: 1024 * 1024 * 1024, User: "1000:1000",
	}
}

func dockerContainerName(serviceID string) string {
	return "redeven-dsh-" + strings.TrimPrefix(strings.TrimSpace(serviceID), "mws_")
}
func (d *dockerDriver) markerPath() string {
	return filepath.Join(d.stateDir, DeepSeekHarnessTemplateID, "docker-volume.json")
}

func (d *dockerDriver) ensureDataVolume(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	markerPath := d.markerPath()
	marker := retainedDockerVolume{}
	if raw, err := os.ReadFile(markerPath); err == nil {
		if err := decodeStrictJSON(raw, &marker); err != nil || !strings.HasPrefix(marker.Name, "redeven-dsh-data-") || marker.CreatedAtUnixMs <= 0 {
			return "", serviceError("DATA_IDENTITY_INVALID", "The retained Docker data identity is invalid.", 409, false, err)
		}
		volume, err := d.adapter.InspectVolume(ctx, containers.VolumeInspectRequest{Engine: containers.EngineDocker, Name: marker.Name})
		if err != nil {
			return "", serviceError("DATA_VOLUME_MISSING", "The retained DeepSeek Harness data volume is missing.", 409, false, err)
		}
		if volume.CreatedAtUnixMs != marker.CreatedAtUnixMs {
			return "", serviceError("DATA_IDENTITY_MISMATCH", "The retained Docker data volume identity has changed.", 409, false, nil)
		}
		return marker.Name, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	name := "redeven-dsh-data-" + strings.TrimPrefix(service.ServiceID, "mws_")
	volume, err := d.adapter.CreateVolume(ctx, containers.VolumeCreateRequest{Engine: containers.EngineDocker, Name: name})
	if err != nil {
		return "", serviceError("DATA_VOLUME_CREATE_FAILED", "The DeepSeek Harness data volume could not be created.", 502, true, err)
	}
	if volume.CreatedAtUnixMs <= 0 {
		inspected, inspectErr := d.adapter.InspectVolume(ctx, containers.VolumeInspectRequest{Engine: containers.EngineDocker, Name: name})
		if inspectErr != nil {
			return "", inspectErr
		}
		volume = inspected
	}
	if volume.CreatedAtUnixMs <= 0 {
		return "", serviceError("DATA_IDENTITY_UNAVAILABLE", "Docker did not return a stable identity for the managed data volume.", 502, false, nil)
	}
	marker = retainedDockerVolume{Name: name, CreatedAtUnixMs: volume.CreatedAtUnixMs}
	raw, _ := json.Marshal(marker)
	if err := os.MkdirAll(filepath.Dir(markerPath), 0o700); err != nil {
		return "", err
	}
	temporary := markerPath + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, markerPath); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	return name, nil
}

func (d *dockerDriver) verifyExactContainer(ctx context.Context, service *pfregistry.ManagedService, pinnedImage string) error {
	if strings.TrimSpace(service.RuntimeIdentity) == "" {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The managed container identity is missing.", 409, false, nil)
	}
	response, err := d.adapter.Inspect(ctx, containers.ContainerInspectRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The exact managed container no longer exists.", 409, false, err)
	}
	container := response.Container
	labelMatches, labelErr := d.adapter.ContainerMatchesLabel(ctx, containers.ContainerLabelMatchRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity, Key: managedServiceLabel, Value: service.ServiceID})
	if labelErr != nil {
		return serviceError("CONTAINER_IDENTITY_MISSING", "The exact managed container could not be verified.", 409, false, labelErr)
	}
	if container.ContainerID != service.RuntimeIdentity || container.Name != dockerContainerName(service.ServiceID) || container.Image.Reference != pinnedImage || !container.Image.DigestPinned || !labelMatches {
		return serviceError("CONTAINER_IDENTITY_MISMATCH", "The exact managed container identity or audited image has changed.", 409, false, nil)
	}
	runtime := container.Runtime
	if runtime.Privileged || !runtime.ReadOnlyRoot || runtime.PIDsLimit != 512 || runtime.ShmSizeBytes != 1024*1024*1024 || runtime.User == "" || !slices.Contains(runtime.CapDrop, "ALL") || !slices.Contains(runtime.SecurityOpts, "no-new-privileges:true") {
		return serviceError("CONTAINER_HARDENING_MISMATCH", "The managed container no longer matches Redeven's hardened runtime policy.", 409, false, nil)
	}
	if len(container.Ports) != 1 || container.Ports[0].Port != 3080 || container.Ports[0].HostPort != service.RuntimePort || container.Ports[0].HostIP != "127.0.0.1" {
		return serviceError("CONTAINER_NETWORK_MISMATCH", "The managed container must publish only port 3080 on 127.0.0.1.", 409, false, nil)
	}
	return nil
}

func (d *dockerDriver) Start(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	if err := d.verifyExactContainer(ctx, service, service.ArtifactReference); err != nil {
		return "", err
	}
	response, err := d.adapter.Inspect(ctx, containers.ContainerInspectRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return "", err
	}
	if response.Container.State == containers.ContainerStateRunning {
		return service.RuntimeIdentity, nil
	}
	started, err := d.adapter.Start(ctx, containers.ContainerStartRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil || !started.Completed || started.ContainerID != service.RuntimeIdentity {
		return "", serviceError("START_FAILED", "The exact managed Docker container could not be started.", 502, true, err)
	}
	if err := d.verifyExactContainer(ctx, service, service.ArtifactReference); err != nil {
		_ = d.Stop(context.Background(), service)
		return "", err
	}
	return service.RuntimeIdentity, nil
}

func (d *dockerDriver) Stop(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	if err := d.verifyExactContainer(ctx, service, service.ArtifactReference); err != nil {
		return err
	}
	response, err := d.adapter.Inspect(ctx, containers.ContainerInspectRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil {
		return err
	}
	if response.Container.State != containers.ContainerStateRunning && response.Container.State != containers.ContainerStateRestarting && response.Container.State != containers.ContainerStatePaused {
		return nil
	}
	stopped, err := d.adapter.Stop(ctx, containers.ContainerActionRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity, TimeoutSec: 10})
	if err != nil || !stopped.Completed || stopped.ContainerID != service.RuntimeIdentity {
		return serviceError("STOP_FAILED", "The exact managed Docker container could not be stopped.", 502, true, err)
	}
	return nil
}

func (d *dockerDriver) removeExactContainer(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil || strings.TrimSpace(service.RuntimeIdentity) == "" {
		return nil
	}
	if err := d.verifyExactContainer(ctx, service, service.ArtifactReference); err != nil {
		return err
	}
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	removed, err := d.adapter.Remove(ctx, containers.ContainerActionRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity})
	if err != nil || !removed.Completed || removed.ContainerID != service.RuntimeIdentity {
		return serviceError("CONTAINER_REMOVE_FAILED", "The exact managed Docker container could not be removed.", 502, true, err)
	}
	return nil
}

func (d *dockerDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool) error {
	if err := d.removeExactContainer(ctx, service); err != nil {
		return err
	}
	if !deleteData {
		return nil
	}
	markerPath := d.markerPath()
	raw, err := os.ReadFile(markerPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	marker := retainedDockerVolume{}
	if err := decodeStrictJSON(raw, &marker); err != nil {
		return serviceError("DATA_IDENTITY_INVALID", "The retained Docker data identity is invalid.", 409, false, err)
	}
	volume, err := d.adapter.InspectVolume(ctx, containers.VolumeInspectRequest{Engine: containers.EngineDocker, Name: marker.Name})
	if err != nil || volume.CreatedAtUnixMs != marker.CreatedAtUnixMs {
		return serviceError("DATA_IDENTITY_MISMATCH", "Redeven will not delete a Docker volume whose identity has changed.", 409, false, err)
	}
	if err := d.adapter.RemoveVolume(ctx, containers.VolumeRemoveRequest{Engine: containers.EngineDocker, Name: marker.Name}); err != nil {
		return serviceError("DATA_REMOVE_FAILED", "The DeepSeek Harness data volume could not be deleted.", 502, true, err)
	}
	return os.Remove(markerPath)
}

func (d *dockerDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	return d.removeExactContainer(ctx, service)
}
func (d *dockerDriver) Logs(ctx context.Context, service *pfregistry.ManagedService, tail int) (*LogResult, error) {
	if err := d.verifyExactContainer(ctx, service, service.ArtifactReference); err != nil {
		return nil, err
	}
	result, err := d.adapter.TailLogs(ctx, containers.LogsTailRequest{Engine: containers.EngineDocker, ContainerID: service.RuntimeIdentity, TailLines: tail})
	if err != nil {
		return nil, err
	}
	lines := make([]string, 0, len(result.Lines))
	for _, line := range result.Lines {
		lines = append(lines, redactLogLine(line.Message))
	}
	return &LogResult{Lines: lines}, nil
}

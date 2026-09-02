package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const legacyVolumeCreatedAtUnixMs = int64(1_788_146_334_000)

func TestContainerStartImportsLegacyDeepSeekVolumeIdentity(t *testing.T) {
	t.Parallel()
	driver, registry, service, client, markerPath := legacyDeepSeekVolumeMigrationFixture(t)

	identity, err := driver.Start(context.Background(), service)
	if err != nil {
		spec, _, _ := effectiveSpecFromService(service)
		expected, _ := driver.containerMounts(context.Background(), service, spec.Container.Mounts, false)
		actual, _ := driver.adapter.Inspect(context.Background(), containerengine.ContainerInspectRequest{Engine: containerengine.EngineDocker, ContainerID: service.RuntimeIdentity})
		t.Fatalf("Start() legacy DeepSeek container error = %v; expected mounts=%+v actual mounts=%+v", err, expected, actual.Container.Mounts)
	}
	if identity != service.RuntimeIdentity || len(client.actions) != 1 || client.actions[0].Method != containerengine.MethodStart {
		t.Fatalf("started legacy container identity = %q, actions = %+v", identity, client.actions)
	}
	assertLegacyVolumeResource(t, registry, service.ServiceID)
	if _, err := os.Stat(markerPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy volume marker still exists: %v", err)
	}

	if _, err := driver.Start(context.Background(), service); err != nil {
		t.Fatalf("repeated Start() after volume import error = %v", err)
	}
	assertLegacyVolumeResource(t, registry, service.ServiceID)
}

func TestLegacyDeepSeekVolumeImportRejectsUnverifiedIdentity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		markerName   string
		markerTime   int64
		volumeName   string
		volumeTime   int64
		inspectErr   error
		wantCode     string
		removeMarker bool
	}{
		{name: "marker missing", wantCode: "DATA_IDENTITY_MISSING", removeMarker: true},
		{name: "wrong deterministic name", markerName: "redeven-dsh-data-other", markerTime: legacyVolumeCreatedAtUnixMs, wantCode: "DATA_IDENTITY_INVALID"},
		{name: "missing creation time", markerTime: 0, wantCode: "DATA_IDENTITY_INVALID"},
		{name: "volume unavailable", markerTime: legacyVolumeCreatedAtUnixMs, inspectErr: errors.New("volume unavailable"), wantCode: "DATA_VOLUME_MISSING"},
		{name: "volume name changed", markerTime: legacyVolumeCreatedAtUnixMs, volumeName: "redeven-dsh-data-other", volumeTime: legacyVolumeCreatedAtUnixMs, wantCode: "DATA_IDENTITY_MISMATCH"},
		{name: "volume creation time changed", markerTime: legacyVolumeCreatedAtUnixMs, volumeTime: legacyVolumeCreatedAtUnixMs + 1, wantCode: "DATA_IDENTITY_MISMATCH"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			driver, registry, service, client, markerPath := legacyDeepSeekVolumeMigrationFixture(t)
			wantName := legacyDeepSeekVolumeName(service.ServiceID)
			if test.removeMarker {
				if err := os.Remove(markerPath); err != nil {
					t.Fatal(err)
				}
			} else {
				markerName := test.markerName
				if markerName == "" {
					markerName = wantName
				}
				writeLegacyVolumeMarker(t, markerPath, markerName, test.markerTime)
			}
			client.volume.Name = test.volumeName
			if client.volume.Name == "" {
				client.volume.Name = wantName
			}
			client.volume.CreatedAtUnixMs = test.volumeTime
			if client.volume.CreatedAtUnixMs == 0 {
				client.volume.CreatedAtUnixMs = legacyVolumeCreatedAtUnixMs
			}
			client.volumeErr = test.inspectErr

			_, err := driver.Start(context.Background(), service)
			if managedErrorCode(err) != test.wantCode {
				t.Fatalf("Start() error = %v, want %s", err, test.wantCode)
			}
			resources, listErr := registry.ListManagedServiceResources(context.Background(), service.ServiceID)
			if listErr != nil || len(resources) != 0 {
				t.Fatalf("resources after rejected import = %+v, err=%v", resources, listErr)
			}
			if !test.removeMarker {
				if _, statErr := os.Stat(markerPath); statErr != nil {
					t.Fatalf("rejected import changed legacy marker: %v", statErr)
				}
			}
			if len(client.actions) != 0 {
				t.Fatalf("rejected import performed container actions: %+v", client.actions)
			}
		})
	}
}

func TestLegacyDeepSeekVolumeImportIsBuiltinOnlyAndKeepsMarkerOnRegistryFailure(t *testing.T) {
	t.Parallel()
	t.Run("custom template", func(t *testing.T) {
		driver, registry, service, _, markerPath := legacyDeepSeekVolumeMigrationFixture(t)
		service.TemplateSource = "custom"
		marker, err := driver.loadVolumeSet(context.Background(), service)
		if err != nil || len(marker.Volumes) != 0 {
			t.Fatalf("custom template volume load = %+v, err=%v", marker, err)
		}
		resources, listErr := registry.ListManagedServiceResources(context.Background(), service.ServiceID)
		if listErr != nil || len(resources) != 0 {
			t.Fatalf("custom template resources = %+v, err=%v", resources, listErr)
		}
		if _, statErr := os.Stat(markerPath); statErr != nil {
			t.Fatalf("custom template changed legacy marker: %v", statErr)
		}
	})

	t.Run("registry write", func(t *testing.T) {
		driver, registry, service, client, markerPath := legacyDeepSeekVolumeMigrationFixture(t)
		missing := *service
		missing.ServiceID = "mws_missing_registry_owner"
		writeLegacyVolumeMarker(t, markerPath, legacyDeepSeekVolumeName(missing.ServiceID), legacyVolumeCreatedAtUnixMs)
		client.volume.Name = legacyDeepSeekVolumeName(missing.ServiceID)
		_, err := driver.loadVolumeSet(context.Background(), &missing)
		if err == nil {
			t.Fatal("legacy import without Registry owner succeeded")
		}
		if _, statErr := os.Stat(markerPath); statErr != nil {
			t.Fatalf("failed Registry write changed legacy marker: %v", statErr)
		}
		resources, listErr := registry.ListManagedServiceResources(context.Background(), missing.ServiceID)
		if listErr != nil || len(resources) != 0 {
			t.Fatalf("resources after failed Registry write = %+v, err=%v", resources, listErr)
		}
	})
}

func TestLegacyDeepSeekVolumeMarkerCleanupRetriesAfterCommittedImport(t *testing.T) {
	t.Parallel()
	driver, registry, service, _, markerPath := legacyDeepSeekVolumeMigrationFixture(t)
	driver.removeMarker = func(string) error { return errors.New("read-only marker directory") }

	marker, err := driver.loadVolumeSet(context.Background(), service)
	if err != nil || len(marker.Volumes) != 1 {
		t.Fatalf("loadVolumeSet() with cleanup failure = %+v, err=%v", marker, err)
	}
	assertLegacyVolumeResource(t, registry, service.ServiceID)
	if _, err := os.Stat(markerPath); err != nil {
		t.Fatalf("cleanup failure removed marker: %v", err)
	}

	driver.removeMarker = nil
	if _, err := driver.loadVolumeSet(context.Background(), service); err != nil {
		t.Fatalf("loadVolumeSet() cleanup retry error = %v", err)
	}
	if _, err := os.Stat(markerPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cleanup retry left marker: %v", err)
	}
}

func legacyDeepSeekVolumeMigrationFixture(t *testing.T) (*containerTemplateDriver, *pfregistry.Registry, *pfregistry.ManagedService, *legacyVolumeEngineClient, string) {
	t.Helper()
	stateDir := t.TempDir()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	artifact, ok := auditedDockerArtifact("linux-arm64")
	if !ok {
		t.Fatal("reviewed DeepSeek container artifact is unavailable")
	}
	spec := deepSeekContainerTemplateSpec(artifact, true)
	effectiveSpec, err := effectiveTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, digest, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	configuration, configurationDigest, err := canonicalServiceConfiguration(newServiceConfiguration(nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	service := &pfregistry.ManagedService{
		ServiceID: "mws_legacy_volume", TemplateID: DeepSeekHarnessContainerTemplateID, TemplateSource: "builtin", TemplateRevision: 2,
		TemplateSnapshotJSON: snapshot, TemplateSnapshotSHA256: digest, ServiceFamilyID: DeepSeekHarnessContainerTemplateID,
		Deployment: string(DeploymentContainer), WorkspacePath: "/workspace/project", Version: DeepSeekHarnessVersion,
		ConfigurationJSON: configuration, ConfigurationRevision: 1, ConfigurationSHA256: configurationDigest,
		DesiredState: "stopped", ObservedState: "stopped", ForwardID: "pf_legacy_volume", RuntimeIdentity: "container_legacy_volume",
		RuntimePort: 49152, ArtifactReference: artifact.Image + "@" + artifact.Digest,
	}
	if err := registry.CreateManagedService(context.Background(), *service, pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:49152"}); err != nil {
		t.Fatal(err)
	}
	volumeName := legacyDeepSeekVolumeName(service.ServiceID)
	request := containerCreateRequest(service, effectiveSpec, service.ArtifactReference, []containerengine.ContainerMount{
		{Type: containerengine.MountTypeVolume, Source: volumeName, Target: "/home/node/.dsh"},
		{Type: containerengine.MountTypeBind, Source: service.WorkspacePath, Target: "/workspace"},
		{Type: containerengine.MountTypeTmpfs, Target: "/tmp", TmpfsOptions: []string{"rw", "noexec", "nosuid", "nodev", "size=536870912"}},
	}, nil)
	container := engineContainerFromCreateRequest(service.RuntimeIdentity, legacyDeepSeekContainerName(service.ServiceID), request)
	client := &legacyVolumeEngineClient{
		uninstallContainerEngineClient: uninstallContainerEngineClient{container: container},
		volume:                         containerengine.VolumeRecord{Name: volumeName, CreatedAtUnixMs: legacyVolumeCreatedAtUnixMs},
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, stateDir: stateDir}
	driver := &containerTemplateDriver{manager: manager, adapter: adapter}
	markerPath := driver.legacyDeepSeekVolumeMarkerPath()
	writeLegacyVolumeMarker(t, markerPath, volumeName, legacyVolumeCreatedAtUnixMs)
	return driver, registry, service, client, markerPath
}

func engineContainerFromCreateRequest(containerID, name string, request containerengine.ContainerCreateRequest) containerengine.EngineContainer {
	mounts := make([]containerengine.MountInput, 0, len(request.Mounts))
	for _, mount := range request.Mounts {
		source := mount.Source
		if mount.Type == containerengine.MountTypeBind {
			if resolved, err := filepath.EvalSymlinks(source); err == nil {
				source = resolved
			}
		}
		mounts = append(mounts, containerengine.MountInput{Type: mount.Type, Source: source, Target: mount.Target, ReadOnly: mount.ReadOnly})
	}
	devices := make([]containerengine.DeviceInput, 0, len(request.Devices))
	for _, device := range request.Devices {
		devices = append(devices, containerengine.DeviceInput{HostPath: device.HostPath, ContainerPath: device.ContainerPath, Permissions: device.Permissions})
	}
	ports := make([]containerengine.PortSummary, 0, len(request.Ports))
	for _, port := range request.Ports {
		ports = append(ports, containerengine.PortSummary{Protocol: port.Protocol, HostIP: port.HostIP, HostPort: port.HostPort, Port: port.ContainerPort})
	}
	_, digest, _ := strings.Cut(request.Image, "@")
	return containerengine.EngineContainer{
		Engine: containerengine.EngineDocker, ContainerID: containerID, Name: name,
		Image: containerengine.ImageInput{Reference: request.Image, Digest: digest}, State: containerengine.ContainerStateExited, Ports: ports,
		Runtime: containerengine.RuntimeInput{
			Privileged: request.Privileged, NetworkMode: request.NetworkMode, PIDMode: request.PIDMode, IPCMode: request.IPCMode,
			RestartPolicy: request.RestartPolicy, Env: request.Env, Labels: request.Labels, Mounts: mounts, Devices: devices,
			CapAdd: request.CapAdd, CapDrop: request.CapDrop, ReadOnlyRoot: request.ReadOnlyRoot, SecurityOpts: request.SecurityOpts,
			PIDsLimit: request.PIDsLimit, ShmSizeBytes: request.ShmSizeBytes, User: request.User,
		},
	}
}

func legacyDeepSeekVolumeName(serviceID string) string {
	return "redeven-dsh-data-" + strings.TrimPrefix(serviceID, "mws_")
}

func writeLegacyVolumeMarker(t *testing.T, path, name string, createdAtUnixMs int64) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	raw := []byte("{\"name\":\"" + name + "\",\"created_at_unix_ms\":" + strconv.FormatInt(createdAtUnixMs, 10) + "}")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertLegacyVolumeResource(t *testing.T, registry *pfregistry.Registry, serviceID string) {
	t.Helper()
	resources, err := registry.ListManagedServiceResources(context.Background(), serviceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(resources) != 1 || resources[0].ResourceID != "data" || resources[0].Kind != "volume" || resources[0].EngineIdentity != legacyDeepSeekVolumeName(serviceID) || resources[0].CreatedAtUnixMs != legacyVolumeCreatedAtUnixMs {
		t.Fatalf("migrated legacy volume resources = %+v", resources)
	}
}

type legacyVolumeEngineClient struct {
	uninstallContainerEngineClient
	containerengine.ExtendedEngineClient
	volume    containerengine.VolumeRecord
	volumeErr error
}

func (c *legacyVolumeEngineClient) InspectVolume(context.Context, containerengine.Engine, string) (containerengine.VolumeRecord, error) {
	if c.volumeErr != nil {
		return containerengine.VolumeRecord{}, c.volumeErr
	}
	return c.volume, nil
}

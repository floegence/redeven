package containers

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

const testSHA256Digest = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestImageDigestPinRequiresCanonicalSHA256(t *testing.T) {
	validReference := "ghcr.io/acme/api@" + testSHA256Digest
	if err := validateImageReference(validReference); err != nil {
		t.Fatalf("validateImageReference(valid) error = %v", err)
	}
	for _, invalid := range []string{
		"ghcr.io/acme/api@sha256:feed",
		"ghcr.io/acme/api@sha256:0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF",
		"ghcr.io/acme/api@sha512:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	} {
		if err := validateImageReference(invalid); err == nil {
			t.Fatalf("validateImageReference(%q) unexpectedly succeeded", invalid)
		}
	}
	adapter := mustNewAdapter(t, &resourceAuditEngineClient{fakeEngineClient: &fakeEngineClient{}})
	plan, err := adapter.CreatePreflight(ContainerCreateRequest{Engine: EngineDocker, Name: "api", Image: validReference})
	if err != nil {
		t.Fatal(err)
	}
	for _, flag := range plan.RiskFlags {
		if flag.ID == "image_not_digest_pinned" {
			t.Fatalf("canonical digest reference was not recognized as pinned: %#v", plan.RiskFlags)
		}
	}
	if imageSummary(ImageInput{Digest: "sha256:feed"}).DigestPinned {
		t.Fatal("short digest was projected as pinned")
	}
}

func TestAdapterRemovePreflightProtectsRunningContainerWithExactConfirmation(t *testing.T) {
	client := &resourceAuditEngineClient{
		fakeEngineClient: &fakeEngineClient{inspect: map[string]EngineContainer{
			"docker:container_123": {
				Engine: EngineDocker, ContainerID: "container_123", Name: "api", State: ContainerStateRunning,
			},
		}},
	}
	adapter := mustNewAdapter(t, client)

	_, err := adapter.RemovePreflight(context.Background(), ContainerRemovePreflightRequest{
		Engine: EngineDocker, ContainerID: "container_123",
	})
	var running *ContainerRunningError
	if !errors.As(err, &running) || running.ContainerID != "container_123" || running.ContainerName != "api" {
		t.Fatalf("RemovePreflight() error = %#v, want running container details", err)
	}

	_, err = adapter.RemovePreflight(context.Background(), ContainerRemovePreflightRequest{
		Engine: EngineDocker, ContainerID: "container_123", Force: true, ConfirmationName: "wrong",
	})
	if err == nil || !strings.Contains(err.Error(), "confirmation_name") {
		t.Fatalf("RemovePreflight() mismatched confirmation error = %v", err)
	}

	plan, err := adapter.RemovePreflight(context.Background(), ContainerRemovePreflightRequest{
		Engine: EngineDocker, ContainerID: "container_123", Force: true, ConfirmationName: "api",
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Method != MethodRemove || plan.RiskLevel != RiskLevelCritical || !plan.RequiresAdmin {
		t.Fatalf("RemovePreflight() plan = %#v", plan)
	}
	if plan.Target["container_id"] != "container_123" || plan.Target["container_name"] != "api" || plan.Target["state"] != string(ContainerStateRunning) {
		t.Fatalf("RemovePreflight() target = %#v", plan.Target)
	}
}

func TestAdapterImageRemovePreflightAndMutationProtectReferences(t *testing.T) {
	client := &resourceAuditEngineClient{
		fakeEngineClient: &fakeEngineClient{},
		inspectImage: ImageRecord{
			ID: "sha256:image", Reference: "ghcr.io/acme/api:latest", SizeBytes: 4096, ReferencedContainers: 2,
		},
	}
	adapter := mustNewAdapter(t, client)

	_, err := adapter.RemoveImagePreflight(context.Background(), ImageRemovePreflightRequest{
		Engine: EngineDocker, Image: "ghcr.io/acme/api:latest",
	})
	var referenced *ImageReferencedError
	if !errors.As(err, &referenced) || referenced.Image != "ghcr.io/acme/api:latest" || referenced.References != 2 {
		t.Fatalf("RemoveImagePreflight() error = %#v, want image references", err)
	}

	_, err = adapter.RemoveImagePreflight(context.Background(), ImageRemovePreflightRequest{
		Engine: EngineDocker, Image: "ghcr.io/acme/api:latest", Force: true, ConfirmationName: "api",
	})
	if err == nil || !strings.Contains(err.Error(), "confirmation_name") {
		t.Fatalf("RemoveImagePreflight() mismatched confirmation error = %v", err)
	}

	plan, err := adapter.RemoveImagePreflight(context.Background(), ImageRemovePreflightRequest{
		Engine: EngineDocker, Image: "ghcr.io/acme/api:latest", Force: true, ConfirmationName: "ghcr.io/acme/api:latest",
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Method != MethodImagesRemove || plan.RiskLevel != RiskLevelCritical || !plan.RequiresAdmin ||
		plan.Target["referenced_containers"] != 2 || plan.Target["reclaimable_bytes"] != int64(4096) {
		t.Fatalf("RemoveImagePreflight() plan = %#v", plan)
	}

	if err := adapter.RemoveImage(context.Background(), ImageRemoveRequest{Engine: EngineDocker, Image: "ghcr.io/acme/api:latest"}); !errors.As(err, &referenced) {
		t.Fatalf("RemoveImage() error = %#v, want ImageReferencedError", err)
	}
	if len(client.removedImages) != 0 {
		t.Fatalf("RemoveImage() reached engine despite reference guard: %#v", client.removedImages)
	}
	if err := adapter.RemoveImage(context.Background(), ImageRemoveRequest{Engine: EngineDocker, Image: "ghcr.io/acme/api:latest", Force: true}); err != nil {
		t.Fatal(err)
	}
	if len(client.removedImages) != 1 || !client.removedImages[0].Force {
		t.Fatalf("forced image removal calls = %#v", client.removedImages)
	}
}

func TestAdapterVolumeRemovalProtectsReferencedVolume(t *testing.T) {
	client := &resourceAuditEngineClient{
		fakeEngineClient: &fakeEngineClient{},
		inspectVolume:    VolumeRecord{Name: "data", Driver: "local", ReferencedContainers: 3},
	}
	adapter := mustNewAdapter(t, client)

	err := adapter.RemoveVolume(context.Background(), VolumeRemoveRequest{Engine: EngineDocker, Name: "data"})
	var inUse *VolumeInUseError
	if !errors.As(err, &inUse) || inUse.Name != "data" || inUse.References != 3 {
		t.Fatalf("RemoveVolume() error = %#v, want volume references", err)
	}
	if len(client.removedVolumes) != 0 {
		t.Fatalf("RemoveVolume() reached engine despite reference guard: %#v", client.removedVolumes)
	}
	_, err = adapter.RemoveVolumePreflight(context.Background(), VolumeRemovePreflightRequest{
		Engine: EngineDocker, Name: "data", ConfirmationName: "data",
	})
	if !errors.As(err, &inUse) {
		t.Fatalf("RemoveVolumePreflight() error = %#v, want VolumeInUseError", err)
	}
}

func TestAdapterPrunePreflightsContainExactSortedCandidates(t *testing.T) {
	client := &resourceAuditEngineClient{
		fakeEngineClient: &fakeEngineClient{},
		images: []ImageRecord{
			{ID: "sha256:used", Digest: "sha256:z-used", SizeBytes: 100, ReferencedContainers: 1},
			{ID: "sha256:b", SizeBytes: 200},
			{ID: "sha256:a-id", Digest: "sha256:a", SizeBytes: 300},
			{Reference: "ghcr.io/acme/untagged:latest", SizeBytes: 400},
			{SizeBytes: 500},
		},
		volumes: []VolumeRecord{
			{Name: "used", ReferencedContainers: 1},
			{Name: "z-cache"},
			{Name: "a-data"},
		},
	}
	adapter := mustNewAdapter(t, client)

	images, err := adapter.PruneImagesPreflight(context.Background(), ResourcePruneRequest{Engine: EngineDocker})
	if err != nil {
		t.Fatal(err)
	}
	if images.Target["resource_count"] != 3 || images.Target["reclaimable_bytes"] != int64(900) ||
		!reflect.DeepEqual(images.Target["resource_identities"], []string{"ghcr.io/acme/untagged:latest", "sha256:a", "sha256:b"}) {
		t.Fatalf("PruneImagesPreflight() target = %#v", images.Target)
	}

	volumes, err := adapter.PruneVolumesPreflight(context.Background(), ResourcePruneRequest{Engine: EngineDocker})
	if err != nil {
		t.Fatal(err)
	}
	if volumes.Target["resource_count"] != 2 || !reflect.DeepEqual(volumes.Target["resource_identities"], []string{"a-data", "z-cache"}) {
		t.Fatalf("PruneVolumesPreflight() target = %#v", volumes.Target)
	}
}

func TestAdapterPruneOperationsRevalidateAndForwardExactIdentities(t *testing.T) {
	client := &resourceAuditEngineClient{
		fakeEngineClient: &fakeEngineClient{},
		images: []ImageRecord{
			{ID: "sha256:a", SizeBytes: 100},
			{ID: "sha256:used", ReferencedContainers: 1},
		},
		volumes: []VolumeRecord{{Name: "data"}, {Name: "used", ReferencedContainers: 1}},
	}
	adapter := mustNewAdapter(t, client)

	err := adapter.PruneImages(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"sha256:used"},
	})
	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("PruneImages() stale identity error = %v", err)
	}
	if len(client.prunedImages) != 0 {
		t.Fatalf("stale image plan reached engine: %#v", client.prunedImages)
	}
	err = adapter.PruneImages(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"sha256:a"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(client.prunedImages, []ResourcePruneRequest{{Engine: EngineDocker, ResourceIdentities: []string{"sha256:a"}}}) {
		t.Fatalf("exact image prune calls = %#v", client.prunedImages)
	}

	err = adapter.PruneVolumes(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"used"},
	})
	if err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("PruneVolumes() stale identity error = %v", err)
	}
	if len(client.prunedVolumes) != 0 {
		t.Fatalf("stale volume plan reached engine: %#v", client.prunedVolumes)
	}
	err = adapter.PruneVolumes(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"data"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(client.prunedVolumes, []ResourcePruneRequest{{Engine: EngineDocker, ResourceIdentities: []string{"data"}}}) {
		t.Fatalf("exact volume prune calls = %#v", client.prunedVolumes)
	}
}

func TestCLIClientBuildsAdvancedContainerAndVolumeArgv(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker run -d --name api --restart unless-stopped --network bridge --pid host --ipc private --cpus 1.5 --memory 67108864 --privileged --publish 127.0.0.1:8080:80/tcp --publish 53/udp --mount type=bind,source=/srv/api,target=/workspace,readonly --mount type=volume,source=cache,target=/cache --mount type=tmpfs,target=/tmp --cap-add NET_ADMIN --cap-drop SYS_ADMIN --device /dev/kvm:/dev/kvm:rwm -e MODE=prod ghcr.io/acme/api@" + testSHA256Digest + " server --listen 80": "container_123\n",
		"docker volume create --driver local --opt type=nfs --opt o=addr=10.0.0.1 data": "data\n",
	}}
	client := &CLIClient{Runner: runner}
	created, err := client.CreateContainer(context.Background(), ContainerCreateRequest{
		Engine: EngineDocker, Name: "api", Image: "ghcr.io/acme/api@" + testSHA256Digest,
		Command: []string{"server", "--listen", "80"}, Env: []string{"MODE=prod"},
		RestartPolicy: "unless-stopped", NetworkMode: "bridge", PIDMode: "host", IPCMode: "private",
		CPUCount: 1.5, MemoryBytes: 64 * 1024 * 1024, Privileged: true,
		Ports: []ContainerPortPublish{
			{HostIP: "127.0.0.1", HostPort: 8080, ContainerPort: 80, Protocol: "TCP"},
			{ContainerPort: 53, Protocol: "udp"},
		},
		Mounts: []ContainerMount{
			{Type: MountTypeBind, Source: "/srv/api", Target: "/workspace", ReadOnly: true},
			{Type: MountTypeVolume, Source: "cache", Target: "/cache"},
			{Type: MountTypeTmpfs, Target: "/tmp"},
		},
		CapAdd: []string{"NET_ADMIN"}, CapDrop: []string{"SYS_ADMIN"},
		Devices: []ContainerDevice{{HostPath: "/dev/kvm", ContainerPath: "/dev/kvm", Permissions: "rwm"}},
	})
	if err != nil || created.ContainerID != "container_123" {
		t.Fatalf("CreateContainer() = %#v, err=%v", created, err)
	}
	volume, err := client.CreateVolume(context.Background(), VolumeCreateRequest{
		Engine: EngineDocker, Name: "data", Driver: "local",
		Options: []VolumeOption{{Key: "type", Value: "nfs"}, {Key: "o", Value: "addr=10.0.0.1"}},
	})
	if err != nil || volume.Name != "data" {
		t.Fatalf("CreateVolume() = %#v, err=%v", volume, err)
	}
}

func TestCLIClientBuildsAdvancedPodmanContainerAndVolumeArgv(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"podman run -d --name api --restart unless-stopped --network bridge --pid host --ipc private --cpus 1.5 --memory 67108864 --privileged --publish [::1]:8080:80/tcp --mount type=volume,source=cache,target=/cache --cap-add NET_ADMIN --cap-drop SYS_ADMIN --device /dev/kvm:/dev/kvm:rwm -e MODE=prod quay.io/acme/api@" + testSHA256Digest + " server": "container_123\n",
		"podman volume create --driver local --opt type=nfs --opt o=addr=10.0.0.1 data": "data\n",
	}}
	client := &CLIClient{Runner: runner}
	created, err := client.CreateContainer(context.Background(), ContainerCreateRequest{
		Engine: EnginePodman, Name: "api", Image: "quay.io/acme/api@" + testSHA256Digest,
		Command: []string{"server"}, Env: []string{"MODE=prod"},
		RestartPolicy: "unless-stopped", NetworkMode: "bridge", PIDMode: "host", IPCMode: "private",
		CPUCount: 1.5, MemoryBytes: 64 * 1024 * 1024, Privileged: true,
		Ports:   []ContainerPortPublish{{HostIP: "::1", HostPort: 8080, ContainerPort: 80}},
		Mounts:  []ContainerMount{{Type: MountTypeVolume, Source: "cache", Target: "/cache"}},
		CapAdd:  []string{"NET_ADMIN"},
		CapDrop: []string{"SYS_ADMIN"},
		Devices: []ContainerDevice{{HostPath: "/dev/kvm", ContainerPath: "/dev/kvm", Permissions: "rwm"}},
	})
	if err != nil || created.ContainerID != "container_123" || created.Engine != EnginePodman {
		t.Fatalf("CreateContainer() = %#v, err=%v", created, err)
	}
	volume, err := client.CreateVolume(context.Background(), VolumeCreateRequest{
		Engine: EnginePodman, Name: "data", Driver: "local",
		Options: []VolumeOption{{Key: "type", Value: "nfs"}, {Key: "o", Value: "addr=10.0.0.1"}},
	})
	if err != nil || volume.Name != "data" {
		t.Fatalf("CreateVolume() = %#v, err=%v", volume, err)
	}
}

func TestCLIClientProjectsImageAndVolumeReferencesFromAllContainers(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker images --no-trunc --format json": "{\"ID\":\"sha256:feedface\",\"Repository\":\"ghcr.io/acme/api\",\"Tag\":\"latest\",\"Size\":\"10MB\"}\n{\"ID\":\"sha256:unused\",\"Repository\":\"ghcr.io/acme/unused\",\"Tag\":\"latest\",\"Size\":\"5MB\"}",
		"docker volume ls --format json":         "{\"Name\":\"data\",\"Driver\":\"local\"}\n{\"Name\":\"unused\",\"Driver\":\"local\"}",
		"docker ps -a --no-trunc --format json":  "{\"ID\":\"container_1\"}\n{\"ID\":\"container_2\"}",
		"docker inspect container_1":             `[{"Id":"container_1","Image":"sha256:feedface","Config":{"Image":"ghcr.io/acme/api:deleted-tag"},"State":{"Status":"running"},"Mounts":[{"Type":"volume","Source":"data","Destination":"/data"}]}]`,
		"docker inspect container_2":             `[{"Id":"container_2","Config":{"Image":"ghcr.io/acme/other:latest"},"State":{"Status":"exited"},"Mounts":[]}]`,
	}}
	client := &CLIClient{Runner: runner}

	images, err := client.ListImages(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 2 || images[0].ReferencedContainers != 1 || images[1].ReferencedContainers != 0 {
		t.Fatalf("ListImages() references = %#v", images)
	}
	volumes, err := client.ListVolumes(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	if len(volumes) != 2 || volumes[0].ReferencedContainers != 1 || volumes[1].ReferencedContainers != 0 {
		t.Fatalf("ListVolumes() references = %#v", volumes)
	}
}

func TestCLIClientReportsPartialReferenceInspectionAndDestructivePlansFailClosed(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker images --no-trunc --format json": "{\"ID\":\"sha256:feedface\",\"Repository\":\"ghcr.io/acme/api\",\"Tag\":\"latest\"}",
		"docker volume ls --format json":         "{\"Name\":\"data\",\"Driver\":\"local\"}",
		"docker volume inspect data":             `[{"Name":"data","Driver":"local","Scope":"local","CreatedAt":"2026-07-27T00:00:00Z"}]`,
		"docker ps -a --no-trunc --format json":  "{\"ID\":\"container_1\"}\n{\"ID\":\"container_2\"}",
		"docker inspect container_1":             `[{"Id":"container_1","Image":"sha256:feedface","Config":{"Image":"ghcr.io/acme/api:latest"},"State":{"Status":"running"},"Mounts":[{"Type":"volume","Source":"data","Destination":"/data"}]}]`,
	}}
	client := &CLIClient{Runner: runner}
	images, err := client.ListImages(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].ReferencedContainers != 1 || images[0].ReferenceInspectionFailures != 1 {
		t.Fatalf("ListImages() partial reference state = %#v", images)
	}
	volumes, err := client.ListVolumes(context.Background(), EngineDocker)
	if err != nil {
		t.Fatal(err)
	}
	if len(volumes) != 1 || volumes[0].ReferencedContainers != 1 || volumes[0].ReferenceInspectionFailures != 1 {
		t.Fatalf("ListVolumes() partial reference state = %#v", volumes)
	}

	adapter := mustNewAdapter(t, client)
	if _, err := adapter.PruneImagesPreflight(context.Background(), ResourcePruneRequest{Engine: EngineDocker}); !errors.Is(err, ErrReferenceStateIncomplete) {
		t.Fatalf("PruneImagesPreflight() error = %v, want ErrReferenceStateIncomplete", err)
	}
	if _, err := adapter.PruneVolumesPreflight(context.Background(), ResourcePruneRequest{Engine: EngineDocker}); !errors.Is(err, ErrReferenceStateIncomplete) {
		t.Fatalf("PruneVolumesPreflight() error = %v, want ErrReferenceStateIncomplete", err)
	}
}

func TestCLIClientPrunesOnlyExactReviewedResources(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker image rm sha256:a": "",
		"docker image rm sha256:b": "",
		"docker volume rm cache":   "",
		"docker volume rm data":    "",
	}}
	client := &CLIClient{Runner: runner}
	if err := client.PruneImages(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"sha256:a", "sha256:b"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := client.PruneVolumes(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"cache", "data"},
	}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 4 {
		t.Fatalf("exact prune calls = %#v", runner.calls)
	}
	for _, forbidden := range []string{"image prune", "volume prune", "--force"} {
		if strings.Contains(strings.Join(runner.calls, "\n"), forbidden) {
			t.Fatalf("exact prune fell back to broad command %q: %#v", forbidden, runner.calls)
		}
	}
}

func TestCLIClientPruneValidatesEveryIdentityBeforeMutation(t *testing.T) {
	imageRunner := &fakeCommandRunner{outputs: map[string]string{"docker image rm sha256:a": ""}}
	err := (&CLIClient{Runner: imageRunner}).PruneImages(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"sha256:a", "-invalid"},
	})
	if err == nil {
		t.Fatal("PruneImages() unexpectedly accepted an invalid trailing identity")
	}
	if len(imageRunner.calls) != 0 {
		t.Fatalf("PruneImages() mutated before validating all identities: %#v", imageRunner.calls)
	}

	volumeRunner := &fakeCommandRunner{outputs: map[string]string{"docker volume rm cache": ""}}
	err = (&CLIClient{Runner: volumeRunner}).PruneVolumes(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"cache", "-invalid"},
	})
	if err == nil {
		t.Fatal("PruneVolumes() unexpectedly accepted an invalid trailing identity")
	}
	if len(volumeRunner.calls) != 0 {
		t.Fatalf("PruneVolumes() mutated before validating all identities: %#v", volumeRunner.calls)
	}
}

func TestCLIClientPruneReportsExactPartialOutcome(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{"docker image rm sha256:a": ""}}
	err := (&CLIClient{Runner: runner}).PruneImages(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"sha256:a", "sha256:b", "sha256:c"},
	})
	var partial *ResourcePrunePartialError
	if !errors.As(err, &partial) || !errors.Is(err, ErrResourcePrunePartial) {
		t.Fatalf("PruneImages() error = %#v, want ResourcePrunePartialError", err)
	}
	if !reflect.DeepEqual(partial.CompletedIdentities, []string{"sha256:a"}) ||
		!reflect.DeepEqual(partial.PendingIdentities, []string{"sha256:b", "sha256:c"}) {
		t.Fatalf("partial prune identities = completed %#v, pending %#v", partial.CompletedIdentities, partial.PendingIdentities)
	}
	if !reflect.DeepEqual(runner.calls, []string{"docker image rm sha256:a", "docker image rm sha256:b"}) {
		t.Fatalf("partial prune calls = %#v", runner.calls)
	}

	firstFailure := &fakeCommandRunner{outputs: map[string]string{}}
	err = (&CLIClient{Runner: firstFailure}).PruneVolumes(context.Background(), ResourcePruneRequest{
		Engine: EngineDocker, ResourceIdentities: []string{"cache", "data"},
	})
	if errors.Is(err, ErrResourcePrunePartial) {
		t.Fatalf("first identity failure was incorrectly reported as partial: %v", err)
	}
	if !reflect.DeepEqual(firstFailure.calls, []string{"docker volume rm cache"}) {
		t.Fatalf("first failure calls = %#v", firstFailure.calls)
	}
}

func TestReconcileExactPruneUsesAuthoritativeTerminalInventory(t *testing.T) {
	requested := []string{"sha256:a", "sha256:b"}
	commandFailure := errors.New("second removal failed")

	err := reconcileExactPrune("image", requested, map[string]struct{}{"sha256:b": {}}, commandFailure, nil)
	var partial *ResourcePrunePartialError
	if !errors.As(err, &partial) ||
		!reflect.DeepEqual(partial.CompletedIdentities, []string{"sha256:a"}) ||
		!reflect.DeepEqual(partial.PendingIdentities, []string{"sha256:b"}) {
		t.Fatalf("partial terminal reconciliation = %#v", err)
	}
	if err := reconcileExactPrune("image", requested, map[string]struct{}{}, commandFailure, nil); err != nil {
		t.Fatalf("desired terminal state should override a stale command error: %v", err)
	}
	if err := reconcileExactPrune("image", requested, map[string]struct{}{"sha256:a": {}, "sha256:b": {}}, commandFailure, nil); !errors.Is(err, commandFailure) {
		t.Fatalf("fully unchanged inventory should preserve not-committed error: %v", err)
	}

	inventoryFailure := errors.New("inventory unavailable")
	err = reconcileExactPrune("image", requested, nil, nil, inventoryFailure)
	var reconciliation *ResourcePruneReconciliationError
	if !errors.As(err, &reconciliation) || !errors.Is(err, ErrResourcePruneReconcile) ||
		!reflect.DeepEqual(reconciliation.Identities, requested) {
		t.Fatalf("unavailable terminal inventory = %#v", err)
	}
}

func TestCLIClientUsesCanonicalIDsForMultipleDanglingImages(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker images --no-trunc --format json": "{\"ID\":\"sha256:a\",\"Repository\":\"<none>\",\"Tag\":\"<none>\",\"Digest\":\"<none>\",\"Size\":\"10MB\"}\n{\"ID\":\"sha256:b\",\"Repository\":\"<none>\",\"Tag\":\"<none>\",\"Digest\":\"<none>\",\"Size\":\"20MB\"}",
		"docker ps -a --no-trunc --format json":  "",
	}}
	adapter := mustNewAdapter(t, &CLIClient{Runner: runner})
	plan, err := adapter.PruneImagesPreflight(context.Background(), ResourcePruneRequest{Engine: EngineDocker})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(plan.Target["resource_identities"], []string{"sha256:a", "sha256:b"}) || plan.Target["resource_count"] != 2 {
		t.Fatalf("dangling image plan = %#v", plan.Target)
	}
}

func TestCLIClientImageHistoryNeverProjectsLayerCommands(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker history --no-trunc --format json ghcr.io/acme/api:latest": "{\"ID\":\"sha256:layer\",\"Size\":\"4KB\",\"CreatedBy\":\"ENV API_TOKEN=raw-secret\"}",
	}}
	history, err := (&CLIClient{Runner: runner}).HistoryImage(context.Background(), EngineDocker, "ghcr.io/acme/api:latest")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "raw-secret") || strings.Contains(string(raw), "created_by") {
		t.Fatalf("image history leaked layer command: %s", raw)
	}
}

func TestCLIClientFormatsIPv6PublishedAddressUnambiguously(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{
		"docker run -d --publish [::1]:8080:80/tcp busybox:latest": "container_123\n",
	}}
	_, err := (&CLIClient{Runner: runner}).CreateContainer(context.Background(), ContainerCreateRequest{
		Engine: EngineDocker, Image: "busybox:latest",
		Ports: []ContainerPortPublish{{HostIP: "::1", HostPort: 8080, ContainerPort: 80}},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestCLIClientRejectsOptionLikeImageTargetsBeforeExecution(t *testing.T) {
	runner := &fakeCommandRunner{outputs: map[string]string{}}
	client := &CLIClient{Runner: runner}
	for name, invoke := range map[string]func() error{
		"inspect": func() error {
			_, err := client.InspectImage(context.Background(), EngineDocker, "--help")
			return err
		},
		"history": func() error {
			_, err := client.HistoryImage(context.Background(), EngineDocker, "--help")
			return err
		},
		"tag source": func() error {
			return client.TagImage(context.Background(), ImageTagRequest{Engine: EngineDocker, Image: "--help", Tag: "api:stable"})
		},
		"tag target": func() error {
			return client.TagImage(context.Background(), ImageTagRequest{Engine: EngineDocker, Image: "api:latest", Tag: "--help"})
		},
		"remove": func() error {
			return client.RemoveImage(context.Background(), ImageRemoveRequest{Engine: EngineDocker, Image: "--help"})
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := invoke(); err == nil {
				t.Fatal("image operation accepted option-like target")
			}
		})
	}
	if len(runner.calls) != 0 {
		t.Fatalf("option-like image target reached engine: %#v", runner.calls)
	}
}

func TestCLIClientRejectsInvalidAdvancedContainerInputsBeforeExecution(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*ContainerCreateRequest)
	}{
		{name: "option-like image", mutate: func(req *ContainerCreateRequest) { req.Image = "--privileged" }},
		{name: "control in command", mutate: func(req *ContainerCreateRequest) { req.Command = []string{"echo\nsecret"} }},
		{name: "invalid port", mutate: func(req *ContainerCreateRequest) { req.Ports = []ContainerPortPublish{{ContainerPort: 70000}} }},
		{name: "invalid host IP", mutate: func(req *ContainerCreateRequest) {
			req.Ports = []ContainerPortPublish{{ContainerPort: 80, HostIP: "all"}}
		}},
		{name: "relative mount", mutate: func(req *ContainerCreateRequest) {
			req.Mounts = []ContainerMount{{Type: MountTypeBind, Source: "srv", Target: "/data"}}
		}},
		{name: "ambiguous mount", mutate: func(req *ContainerCreateRequest) {
			req.Mounts = []ContainerMount{{Type: MountTypeBind, Source: "/srv,data", Target: "/data"}}
		}},
		{name: "small memory", mutate: func(req *ContainerCreateRequest) { req.MemoryBytes = 1024 }},
		{name: "invalid namespace", mutate: func(req *ContainerCreateRequest) { req.PIDMode = "container:api other" }},
		{name: "invalid capability", mutate: func(req *ContainerCreateRequest) { req.CapAdd = []string{"NET-ADMIN"} }},
		{name: "invalid device permissions", mutate: func(req *ContainerCreateRequest) {
			req.Devices = []ContainerDevice{{HostPath: "/dev/kvm", Permissions: "rr"}}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runner := &fakeCommandRunner{outputs: map[string]string{}}
			client := &CLIClient{Runner: runner}
			req := ContainerCreateRequest{Engine: EngineDocker, Image: "busybox:latest"}
			test.mutate(&req)
			if _, err := client.CreateContainer(context.Background(), req); err == nil {
				t.Fatal("CreateContainer() accepted invalid input")
			}
			if len(runner.calls) != 0 {
				t.Fatalf("invalid input reached engine: %#v", runner.calls)
			}
		})
	}
}

func TestCLIClientRejectsDuplicateOrControlVolumeOptionsBeforeExecution(t *testing.T) {
	for _, test := range []struct {
		name    string
		options []VolumeOption
	}{
		{name: "duplicate", options: []VolumeOption{{Key: "type", Value: "nfs"}, {Key: "type", Value: "tmpfs"}}},
		{name: "control value", options: []VolumeOption{{Key: "o", Value: "addr=host\nsecret"}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			runner := &fakeCommandRunner{outputs: map[string]string{}}
			_, err := (&CLIClient{Runner: runner}).CreateVolume(context.Background(), VolumeCreateRequest{
				Engine: EngineDocker, Name: "data", Options: test.options,
			})
			if err == nil {
				t.Fatal("CreateVolume() accepted invalid options")
			}
			if len(runner.calls) != 0 {
				t.Fatalf("invalid options reached engine: %#v", runner.calls)
			}
		})
	}
}

type resourceAuditEngineClient struct {
	*fakeEngineClient
	images         []ImageRecord
	inspectImage   ImageRecord
	volumes        []VolumeRecord
	inspectVolume  VolumeRecord
	removedImages  []ImageRemoveRequest
	removedVolumes []VolumeRemoveRequest
	prunedImages   []ResourcePruneRequest
	prunedVolumes  []ResourcePruneRequest
}

func (c *resourceAuditEngineClient) CreateContainer(_ context.Context, req ContainerCreateRequest) (ContainerActionResponse, error) {
	return ContainerActionResponse{Engine: req.Engine, Method: MethodContainersCreate, ContainerID: "created", Completed: true}, nil
}

func (c *resourceAuditEngineClient) Stats(_ context.Context, _ Engine, containerID string) (ContainerStats, error) {
	return ContainerStats{ContainerID: containerID}, nil
}

func (c *resourceAuditEngineClient) ListImages(context.Context, Engine) ([]ImageRecord, error) {
	return append([]ImageRecord(nil), c.images...), nil
}

func (c *resourceAuditEngineClient) InspectImage(context.Context, Engine, string) (ImageRecord, error) {
	return c.inspectImage, nil
}

func (c *resourceAuditEngineClient) HistoryImage(context.Context, Engine, string) ([]ImageHistoryEntry, error) {
	return nil, nil
}

func (c *resourceAuditEngineClient) TagImage(context.Context, ImageTagRequest) error { return nil }

func (c *resourceAuditEngineClient) RemoveImage(_ context.Context, req ImageRemoveRequest) error {
	c.removedImages = append(c.removedImages, req)
	return nil
}

func (c *resourceAuditEngineClient) PruneImages(_ context.Context, req ResourcePruneRequest) error {
	c.prunedImages = append(c.prunedImages, req)
	removed := make(map[string]struct{}, len(req.ResourceIdentities))
	for _, identity := range req.ResourceIdentities {
		removed[identity] = struct{}{}
	}
	kept := c.images[:0]
	for _, item := range c.images {
		identity := firstNonEmpty(item.Digest, item.ID, item.Reference)
		if _, exists := removed[identity]; !exists {
			kept = append(kept, item)
		}
	}
	c.images = kept
	return nil
}

func (c *resourceAuditEngineClient) ListVolumes(context.Context, Engine) ([]VolumeRecord, error) {
	return append([]VolumeRecord(nil), c.volumes...), nil
}

func (c *resourceAuditEngineClient) InspectVolume(context.Context, Engine, string) (VolumeRecord, error) {
	return c.inspectVolume, nil
}

func (c *resourceAuditEngineClient) CreateVolume(_ context.Context, req VolumeCreateRequest) (VolumeRecord, error) {
	return VolumeRecord{Name: req.Name, Driver: req.Driver}, nil
}

func (c *resourceAuditEngineClient) RemoveVolume(_ context.Context, req VolumeRemoveRequest) error {
	c.removedVolumes = append(c.removedVolumes, req)
	return nil
}

func (c *resourceAuditEngineClient) PruneVolumes(_ context.Context, req ResourcePruneRequest) error {
	c.prunedVolumes = append(c.prunedVolumes, req)
	removed := make(map[string]struct{}, len(req.ResourceIdentities))
	for _, identity := range req.ResourceIdentities {
		removed[identity] = struct{}{}
	}
	kept := c.volumes[:0]
	for _, item := range c.volumes {
		if _, exists := removed[item.Name]; !exists {
			kept = append(kept, item)
		}
	}
	c.volumes = kept
	return nil
}

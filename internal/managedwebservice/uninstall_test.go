package managedwebservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/containerengine"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

func TestContainerTemplateUninstallUsesOwnedRuntimeIdentityWithoutTemplateExecution(t *testing.T) {
	t.Parallel()
	service := uninstallContainerService()
	container := uninstallEngineContainer(service)
	container.State = containerengine.ContainerStateRunning
	client := &uninstallContainerEngineClient{container: container}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver := &containerTemplateDriver{adapter: adapter}
	var stages []string
	if err := driver.Uninstall(context.Background(), service, false, func(stage string, _ int64, _ ...pfregistry.ManagedOperationTransferProgress) {
		stages = append(stages, stage)
	}); err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
	if len(client.actions) != 2 || client.actions[0].Method != containerengine.MethodStop || client.actions[1].Method != containerengine.MethodRemove || client.actions[1].ContainerID != service.RuntimeIdentity {
		t.Fatalf("container actions = %+v", client.actions)
	}
	if len(stages) != 2 || stages[0] != "stopping" || stages[1] != "uninstalling" {
		t.Fatalf("uninstall stages = %v", stages)
	}
}

func TestManagerUninstallConvergesMigratedWebtopService(t *testing.T) {
	t.Parallel()
	registry, err := pfregistry.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = registry.Close() })
	artifact, ok := auditedWebtopArtifact(WebtopUbuntuKDETemplateID, "linux-amd64")
	if !ok {
		t.Fatal("reviewed Webtop artifact is unavailable")
	}
	spec := webtopTemplateSpec(WebtopUbuntuKDETemplateID, artifact)
	canonical, _, err := canonicalTemplateSpec(spec)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal([]byte(canonical), &document); err != nil {
		t.Fatal(err)
	}
	persisted, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	snapshotDigest := sha256.Sum256(persisted)
	service := uninstallContainerService()
	service.TemplateID = WebtopUbuntuKDETemplateID
	service.TemplateSource = "builtin"
	service.TemplateRevision = 1
	service.ServiceFamilyID = WebtopUbuntuKDETemplateID
	service.Deployment = string(DeploymentContainer)
	service.WorkspacePath = t.TempDir()
	service.Version = webtopUbuntuKDEVersion
	service.DesiredState = "stopped"
	service.ObservedState = "error"
	service.ForwardID = "pf_uninstall_migrated_webtop"
	service.RuntimePort = 49152
	service.TemplateSnapshotJSON = string(persisted)
	service.TemplateSnapshotSHA256 = hex.EncodeToString(snapshotDigest[:])
	op := pfregistry.ManagedOperation{
		OperationID: "mop_uninstall_migrated_webtop", ServiceID: service.ServiceID,
		RequestID: "request-uninstall-migrated-webtop", RequestFingerprint: "fingerprint-uninstall-migrated-webtop",
		Action: string(ActionUninstall), State: "running", Stage: "queued", ProgressTotal: operationProgressTotal,
	}
	forward := pfregistry.Forward{ForwardID: service.ForwardID, TargetURL: "http://127.0.0.1:49152"}
	if err := registry.CreateManagedServiceWithOperation(context.Background(), *service, forward, op); err != nil {
		t.Fatal(err)
	}
	client := &uninstallContainerEngineClient{container: uninstallEngineContainer(service)}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	manager := &Manager{registry: registry, stateDir: t.TempDir(), listeners: map[string]map[uint64]chan pfregistry.ManagedOperation{}}
	driver := &containerTemplateDriver{manager: manager, adapter: adapter}
	if err := manager.runUninstall(context.Background(), service, &op, driver, false); err != nil {
		t.Fatalf("runUninstall() migrated Webtop error = %v", err)
	}
	stored, err := registry.GetManagedService(context.Background(), service.ServiceID)
	if err != nil || stored != nil {
		t.Fatalf("stored service after uninstall = %+v, err=%v", stored, err)
	}
	storedForward, err := registry.GetForward(context.Background(), service.ForwardID)
	if err != nil || storedForward != nil {
		t.Fatalf("stored forward after uninstall = %+v, err=%v", storedForward, err)
	}
}

func TestContainerTemplateUninstallAcceptsConfirmedMissingRuntime(t *testing.T) {
	t.Parallel()
	service := uninstallContainerService()
	client := &uninstallContainerEngineClient{inspectErr: containerengine.ErrContainerNotFound}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver := &containerTemplateDriver{adapter: adapter}
	if err := driver.Uninstall(context.Background(), service, false, discardOperationProgress); err != nil {
		t.Fatalf("Uninstall() missing runtime error = %v", err)
	}
	if len(client.actions) != 0 {
		t.Fatalf("missing runtime actions = %+v", client.actions)
	}
}

func TestContainerTemplateUninstallRejectsChangedOwnership(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		change func(*containerengine.EngineContainer)
	}{
		{name: "runtime id", change: func(container *containerengine.EngineContainer) { container.ContainerID = "container_other" }},
		{name: "managed name", change: func(container *containerengine.EngineContainer) { container.Name = "redeven-mws-other" }},
		{name: "image", change: func(container *containerengine.EngineContainer) {
			container.Image.Reference = "registry.example/redeven/other@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		}},
		{name: "service label", change: func(container *containerengine.EngineContainer) {
			container.Runtime.Labels[managedServiceLabel] = "mws_other"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := uninstallContainerService()
			container := uninstallEngineContainer(service)
			test.change(&container)
			client := &uninstallContainerEngineClient{container: container}
			adapter, err := containerengine.NewAdapter(client)
			if err != nil {
				t.Fatal(err)
			}
			driver := &containerTemplateDriver{adapter: adapter}
			err = driver.Uninstall(context.Background(), service, false, discardOperationProgress)
			if managedErrorCode(err) != "CONTAINER_IDENTITY_MISMATCH" {
				t.Fatalf("changed ownership error = %v", err)
			}
			if len(client.actions) != 0 {
				t.Fatalf("changed ownership actions = %+v", client.actions)
			}
		})
	}
}

func TestContainerTemplateUninstallRejectsUnavailableEngine(t *testing.T) {
	t.Parallel()
	service := uninstallContainerService()
	client := &uninstallContainerEngineClient{inspectErr: errors.New("docker is unavailable")}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver := &containerTemplateDriver{adapter: adapter}
	err = driver.Uninstall(context.Background(), service, false, discardOperationProgress)
	if managedErrorCode(err) != "CONTAINER_INSPECTION_FAILED" {
		t.Fatalf("unavailable engine error = %v", err)
	}
	if len(client.actions) != 0 {
		t.Fatalf("unavailable engine actions = %+v", client.actions)
	}
}

func TestDockerUninstallUsesOwnedRuntimeIdentityAndAcceptsMissingRuntime(t *testing.T) {
	t.Parallel()
	service := uninstallDockerService()
	container := uninstallDockerEngineContainer(service)
	container.State = containerengine.ContainerStateRunning
	client := &uninstallContainerEngineClient{container: container}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver := &dockerDriver{adapter: adapter}
	if err := driver.Uninstall(context.Background(), service, false, discardOperationProgress); err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
	if len(client.actions) != 2 || client.actions[0].Method != containerengine.MethodStop || client.actions[1].Method != containerengine.MethodRemove {
		t.Fatalf("Docker uninstall actions = %+v", client.actions)
	}

	missingClient := &uninstallContainerEngineClient{inspectErr: containerengine.ErrContainerNotFound}
	missingAdapter, err := containerengine.NewAdapter(missingClient)
	if err != nil {
		t.Fatal(err)
	}
	if err := (&dockerDriver{adapter: missingAdapter}).Uninstall(context.Background(), service, false, discardOperationProgress); err != nil {
		t.Fatalf("Uninstall() missing Docker runtime error = %v", err)
	}
	if len(missingClient.actions) != 0 {
		t.Fatalf("missing Docker runtime actions = %+v", missingClient.actions)
	}
}

func TestDockerUninstallRejectsChangedOwnership(t *testing.T) {
	t.Parallel()
	service := uninstallDockerService()
	container := uninstallDockerEngineContainer(service)
	container.Runtime.Labels[managedServiceLabel] = "mws_other"
	client := &uninstallContainerEngineClient{container: container}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	err = (&dockerDriver{adapter: adapter}).Uninstall(context.Background(), service, false, discardOperationProgress)
	if managedErrorCode(err) != "CONTAINER_IDENTITY_MISMATCH" {
		t.Fatalf("changed Docker ownership error = %v", err)
	}
	if len(client.actions) != 0 {
		t.Fatalf("changed Docker ownership actions = %+v", client.actions)
	}
}

func TestComposeTemplateUninstallUsesOwnedProjectIdentityWithoutTemplateExecution(t *testing.T) {
	t.Parallel()
	stateDir := t.TempDir()
	manager := &Manager{stateDir: stateDir}
	service := &pfregistry.ManagedService{
		ServiceID:              "mws_compose_uninstall",
		ServiceFamilyID:        "compose-uninstall",
		TemplateSnapshotJSON:   `{"schema_version":1,"kind":"compose","endpoint":{}}`,
		TemplateSnapshotSHA256: "intentionally-invalid",
	}
	driver := &composeTemplateDriver{manager: manager}
	const image = "registry.example/redeven/compose@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	config := []byte("services:\n  app:\n    image: " + image + "\n")
	request := driver.request(service)
	if err := os.MkdirAll(filepath.Dir(request.ConfigPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(request.ConfigPath, config, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(config)
	digestHex := hex.EncodeToString(digest[:])
	service.RuntimeIdentity = driver.identity(service, digestHex)
	service.ArtifactReference = "compose-sha256:" + digestHex + ":" + image
	child := containerengine.EngineContainer{
		Engine: containerengine.EngineDocker, ContainerID: "compose_child_app", Name: "compose-app-1",
		Image:   containerengine.ImageInput{Reference: image, Digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
		Runtime: containerengine.RuntimeInput{Labels: map[string]string{managedServiceLabel: service.ServiceID}},
	}
	client := &uninstallComposeEngineClient{
		uninstallContainerEngineClient: uninstallContainerEngineClient{container: child},
		project: containerengine.ComposeProjectDetails{
			ComposeProject: containerengine.ComposeProject{Name: driver.projectName(service)},
			Containers:     []containerengine.ComposeProjectContainer{{ContainerID: child.ContainerID, Service: "app", State: containerengine.ContainerStateRunning}},
		},
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver.adapter = adapter
	var stages []string
	if err := driver.Uninstall(context.Background(), service, false, func(stage string, _ int64, _ ...pfregistry.ManagedOperationTransferProgress) {
		stages = append(stages, stage)
	}); err != nil {
		t.Fatalf("Uninstall() error = %v", err)
	}
	if client.stopCalls != 1 || client.removeCalls != 1 {
		t.Fatalf("compose lifecycle calls: stop=%d remove=%d", client.stopCalls, client.removeCalls)
	}
	if len(stages) != 2 || stages[0] != "stopping" || stages[1] != "uninstalling" {
		t.Fatalf("uninstall stages = %v", stages)
	}
	if _, err := os.Stat(filepath.Dir(request.ConfigPath)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("compose state directory still exists: %v", err)
	}
}

func TestComposeTemplateUninstallRejectsChangedOwnership(t *testing.T) {
	t.Parallel()
	stateDir := t.TempDir()
	manager := &Manager{stateDir: stateDir}
	service := &pfregistry.ManagedService{ServiceID: "mws_compose_mismatch", ServiceFamilyID: "compose-mismatch"}
	driver := &composeTemplateDriver{manager: manager}
	const image = "registry.example/redeven/compose@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	config := []byte("services:\n  app:\n    image: " + image + "\n")
	request := driver.request(service)
	if err := os.MkdirAll(filepath.Dir(request.ConfigPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(request.ConfigPath, config, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(config)
	digestHex := hex.EncodeToString(digest[:])
	service.RuntimeIdentity = driver.identity(service, digestHex)
	service.ArtifactReference = "compose-sha256:" + digestHex + ":" + image
	child := containerengine.EngineContainer{
		Engine: containerengine.EngineDocker, ContainerID: "compose_child_changed", Name: "compose-app-1",
		Image:   containerengine.ImageInput{Reference: image, Digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},
		Runtime: containerengine.RuntimeInput{Labels: map[string]string{managedServiceLabel: "mws_other"}},
	}
	client := &uninstallComposeEngineClient{
		uninstallContainerEngineClient: uninstallContainerEngineClient{container: child},
		project: containerengine.ComposeProjectDetails{
			ComposeProject: containerengine.ComposeProject{Name: driver.projectName(service)},
			Containers:     []containerengine.ComposeProjectContainer{{ContainerID: child.ContainerID, Service: "app"}},
		},
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	driver.adapter = adapter
	err = driver.Uninstall(context.Background(), service, false, discardOperationProgress)
	if managedErrorCode(err) != "COMPOSE_IDENTITY_MISMATCH" {
		t.Fatalf("changed Compose ownership error = %v", err)
	}
	if client.stopCalls != 0 || client.removeCalls != 0 {
		t.Fatalf("changed Compose ownership lifecycle calls: stop=%d remove=%d", client.stopCalls, client.removeCalls)
	}
}

func TestHostUninstallRejectsInvalidExecutableDefinition(t *testing.T) {
	t.Parallel()
	stateDir := t.TempDir()
	manager := &Manager{stateDir: stateDir}
	driver := &hostScriptDriver{manager: manager, processes: map[string]nativeProcess{}}
	service := &pfregistry.ManagedService{
		ServiceID:              "mws_host_invalid_uninstall",
		ServiceFamilyID:        "host-invalid-uninstall",
		TemplateSnapshotJSON:   `{"schema_version":1,"kind":"host","endpoint":{"scheme":"http"},"host":{"uninstall_script":"touch should-not-run"}}`,
		TemplateSnapshotSHA256: "invalid",
	}
	instanceRoot := driver.instanceRoot(service)
	if err := os.MkdirAll(filepath.Join(instanceRoot, "install"), 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(instanceRoot, "install", "preserved")
	if err := os.WriteFile(sentinel, []byte("preserved"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := driver.Uninstall(context.Background(), service, true, discardOperationProgress)
	if managedErrorCode(err) != "TEMPLATE_SNAPSHOT_IDENTITY_MISMATCH" {
		t.Fatalf("invalid host uninstall error = %v", err)
	}
	if _, err := os.Stat(sentinel); err != nil {
		t.Fatalf("invalid host definition changed service files: %v", err)
	}
}

func uninstallContainerService() *pfregistry.ManagedService {
	const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	return &pfregistry.ManagedService{
		ServiceID:              "mws_uninstall_identity",
		RuntimeIdentity:        "container_uninstall_identity",
		ArtifactReference:      "registry.example/redeven/service@" + digest,
		TemplateSnapshotJSON:   `{"schema_version":1,"kind":"container","endpoint":{}}`,
		TemplateSnapshotSHA256: "intentionally-invalid",
	}
}

func uninstallEngineContainer(service *pfregistry.ManagedService) containerengine.EngineContainer {
	return containerengine.EngineContainer{
		Engine:      containerengine.EngineDocker,
		ContainerID: service.RuntimeIdentity,
		Name:        customContainerName(service.ServiceID),
		Image: containerengine.ImageInput{
			Reference: service.ArtifactReference,
			Digest:    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		State: containerengine.ContainerStateExited,
		Runtime: containerengine.RuntimeInput{
			Labels: map[string]string{managedServiceLabel: service.ServiceID},
		},
	}
}

func uninstallDockerService() *pfregistry.ManagedService {
	const digest = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	return &pfregistry.ManagedService{
		ServiceID:         "mws_docker_uninstall",
		RuntimeIdentity:   "container_docker_uninstall",
		ArtifactReference: "registry.example/redeven/docker@" + digest,
	}
}

func uninstallDockerEngineContainer(service *pfregistry.ManagedService) containerengine.EngineContainer {
	return containerengine.EngineContainer{
		Engine:      containerengine.EngineDocker,
		ContainerID: service.RuntimeIdentity,
		Name:        dockerContainerName(service.ServiceID),
		Image: containerengine.ImageInput{
			Reference: service.ArtifactReference,
			Digest:    "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		},
		State:   containerengine.ContainerStateExited,
		Runtime: containerengine.RuntimeInput{Labels: map[string]string{managedServiceLabel: service.ServiceID}},
	}
}

type uninstallContainerEngineClient struct {
	catalogDockerEngineClient
	container  containerengine.EngineContainer
	inspectErr error
	actions    []containerengine.EngineActionRequest
}

type uninstallComposeEngineClient struct {
	uninstallContainerEngineClient
	project     containerengine.ComposeProjectDetails
	inspectErr  error
	stopCalls   int
	removeCalls int
}

func (*uninstallComposeEngineClient) ValidateComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return errors.New("unexpected Compose validation")
}

func (*uninstallComposeEngineClient) ApplyComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return errors.New("unexpected Compose apply")
}

func (c *uninstallComposeEngineClient) InspectComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) (containerengine.ComposeProjectDetails, error) {
	if c.inspectErr != nil {
		return containerengine.ComposeProjectDetails{}, c.inspectErr
	}
	return c.project, nil
}

func (*uninstallComposeEngineClient) StartComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return errors.New("unexpected Compose start")
}

func (c *uninstallComposeEngineClient) StopComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	c.stopCalls++
	return nil
}

func (*uninstallComposeEngineClient) RestartComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return errors.New("unexpected Compose restart")
}

func (c *uninstallComposeEngineClient) RemoveComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest, bool) error {
	c.removeCalls++
	return nil
}

func (*uninstallComposeEngineClient) TailComposeDeploymentLogs(context.Context, containerengine.ComposeDeploymentRequest, int) ([]string, error) {
	return nil, errors.New("unexpected Compose logs")
}

func (c *uninstallContainerEngineClient) Inspect(context.Context, containerengine.Engine, string) (containerengine.EngineContainer, error) {
	if c.inspectErr != nil {
		return containerengine.EngineContainer{}, c.inspectErr
	}
	if c.container.ContainerID == "" {
		return containerengine.EngineContainer{}, containerengine.ErrContainerNotFound
	}
	return c.container, nil
}

func (c *uninstallContainerEngineClient) Action(_ context.Context, req containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	c.actions = append(c.actions, req)
	if req.ContainerID != c.container.ContainerID {
		return containerengine.EngineActionResult{}, errors.New("unexpected container identity")
	}
	return containerengine.EngineActionResult{Engine: req.Engine, Method: req.Method, ContainerID: req.ContainerID, Completed: true}, nil
}

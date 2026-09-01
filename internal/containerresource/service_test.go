package containerresource

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

type fakeEngineClient struct {
	mu              sync.Mutex
	images          []containerengine.ImageRecord
	volumes         map[string]containerengine.VolumeRecord
	createStarted   chan string
	createRelease   <-chan struct{}
	createActive    int
	maxCreateActive int
	composeRunning  map[string]bool
	containers      map[string]containerengine.EngineContainer
	execCalls       int
}

func (f *fakeEngineClient) Status(context.Context, containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: containerengine.EngineDocker, Available: true}, nil
}

func (f *fakeEngineClient) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return nil, nil
}

func (f *fakeEngineClient) Inspect(_ context.Context, engine containerengine.Engine, containerID string) (containerengine.EngineContainer, error) {
	container, ok := f.containers[string(engine)+":"+containerID]
	if !ok {
		return containerengine.EngineContainer{}, containerengine.ErrContainerNotFound
	}
	return container, nil
}

func (f *fakeEngineClient) ContainerExecProgram(_ context.Context, req containerengine.ContainerExecRequest) (containerengine.ProgramSpec, error) {
	f.execCalls++
	return containerengine.ProgramSpec{Executable: string(req.Engine), Args: append([]string{"exec", req.ContainerID}, req.Argv...)}, nil
}

func (f *fakeEngineClient) Action(context.Context, containerengine.EngineActionRequest) (containerengine.EngineActionResult, error) {
	return containerengine.EngineActionResult{}, nil
}

func (f *fakeEngineClient) TailLogs(context.Context, containerengine.EngineLogsRequest) (containerengine.EngineLogsResult, error) {
	return containerengine.EngineLogsResult{}, nil
}

func (f *fakeEngineClient) PullImage(context.Context, containerengine.Engine, string) (containerengine.EngineImageResult, error) {
	return containerengine.EngineImageResult{}, nil
}

func (f *fakeEngineClient) CreateContainer(context.Context, containerengine.ContainerCreateRequest) (containerengine.ContainerActionResponse, error) {
	return containerengine.ContainerActionResponse{ContainerID: "created-container", Completed: true}, nil
}

func (f *fakeEngineClient) Stats(context.Context, containerengine.Engine, string) (containerengine.ContainerStats, error) {
	return containerengine.ContainerStats{}, nil
}

func (f *fakeEngineClient) ListImages(context.Context, containerengine.Engine) ([]containerengine.ImageRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]containerengine.ImageRecord(nil), f.images...), nil
}

func (f *fakeEngineClient) InspectImage(context.Context, containerengine.Engine, string) (containerengine.ImageRecord, error) {
	return containerengine.ImageRecord{}, containerengine.ErrImageNotFound
}

func (f *fakeEngineClient) HistoryImage(context.Context, containerengine.Engine, string) ([]containerengine.ImageHistoryEntry, error) {
	return nil, nil
}

func (f *fakeEngineClient) TagImage(context.Context, containerengine.ImageTagRequest) error {
	return nil
}

func (f *fakeEngineClient) RemoveImage(context.Context, containerengine.ImageRemoveRequest) error {
	return nil
}

func (f *fakeEngineClient) PruneImages(context.Context, containerengine.ResourcePruneRequest) error {
	return nil
}

func (f *fakeEngineClient) ListVolumes(context.Context, containerengine.Engine) ([]containerengine.VolumeRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]containerengine.VolumeRecord, 0, len(f.volumes))
	for _, item := range f.volumes {
		result = append(result, item)
	}
	return result, nil
}

func (f *fakeEngineClient) InspectVolume(_ context.Context, _ containerengine.Engine, name string) (containerengine.VolumeRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	item, ok := f.volumes[name]
	if !ok {
		return containerengine.VolumeRecord{}, errors.New("volume not found")
	}
	return item, nil
}

func (f *fakeEngineClient) CreateVolume(ctx context.Context, req containerengine.VolumeCreateRequest) (containerengine.VolumeRecord, error) {
	item := containerengine.VolumeRecord{Name: req.Name, Driver: req.Driver}
	f.mu.Lock()
	f.createActive++
	if f.createActive > f.maxCreateActive {
		f.maxCreateActive = f.createActive
	}
	started, release := f.createStarted, f.createRelease
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.createActive--
		f.mu.Unlock()
	}()
	if started != nil {
		started <- req.Name
	}
	if release != nil {
		select {
		case <-ctx.Done():
			return containerengine.VolumeRecord{}, ctx.Err()
		case <-release:
		}
	}
	f.mu.Lock()
	f.volumes[req.Name] = item
	f.mu.Unlock()
	return item, nil
}

func (f *fakeEngineClient) RemoveVolume(_ context.Context, req containerengine.VolumeRemoveRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.volumes, req.Name)
	return nil
}

func (f *fakeEngineClient) PruneVolumes(context.Context, containerengine.ResourcePruneRequest) error {
	return nil
}

func (f *fakeEngineClient) ValidateComposeDeployment(context.Context, containerengine.ComposeDeploymentRequest) error {
	return nil
}

func (f *fakeEngineClient) ApplyComposeDeployment(_ context.Context, req containerengine.ComposeDeploymentRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.composeRunning[req.ProjectName] = true
	return nil
}

func (f *fakeEngineClient) InspectComposeDeployment(_ context.Context, req containerengine.ComposeDeploymentRequest) (containerengine.ComposeProjectDetails, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	running := f.composeRunning[req.ProjectName]
	project := containerengine.ComposeProject{ProjectID: containerengine.ComposeProjectID(req.ProjectName), Name: req.ProjectName, Status: "stopped"}
	if running {
		project.Status, project.ContainerCount, project.RunningCount, project.ServiceCount = "running", 1, 1, 1
	}
	return containerengine.ComposeProjectDetails{ComposeProject: project}, nil
}

func (f *fakeEngineClient) StartComposeDeployment(ctx context.Context, req containerengine.ComposeDeploymentRequest) error {
	return f.ApplyComposeDeployment(ctx, req)
}

func (f *fakeEngineClient) StopComposeDeployment(_ context.Context, req containerengine.ComposeDeploymentRequest) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.composeRunning[req.ProjectName] = false
	return nil
}

func (f *fakeEngineClient) RestartComposeDeployment(ctx context.Context, req containerengine.ComposeDeploymentRequest) error {
	return f.ApplyComposeDeployment(ctx, req)
}

func (f *fakeEngineClient) RemoveComposeDeployment(_ context.Context, req containerengine.ComposeDeploymentRequest, _ bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.composeRunning, req.ProjectName)
	return nil
}

func (f *fakeEngineClient) TailComposeDeploymentLogs(context.Context, containerengine.ComposeDeploymentRequest, int) ([]string, error) {
	return nil, nil
}

func newTestService(t *testing.T, resolver ManagedOwnerResolver) *Service {
	t.Helper()
	return newTestServiceWithClient(t, &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), composeRunning: make(map[string]bool)}, resolver)
}

func newTestServiceWithClient(t *testing.T, client *fakeEngineClient, resolver ManagedOwnerResolver) *Service {
	t.Helper()
	if client.composeRunning == nil {
		client.composeRunning = make(map[string]bool)
	}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	service, err := Open(Options{
		DatabasePath: filepath.Join(t.TempDir(), "container-resources.sqlite3"),
		Engine:       adapter, ResolveManagedOwner: resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}

func TestPrunePreflightCanonicalizesRequestHashAndLocks(t *testing.T) {
	client := &fakeEngineClient{
		images: []containerengine.ImageRecord{
			{ID: "sha256:shared", Reference: "example/app:latest", SizeBytes: 4096},
			{ID: "sha256:shared", Reference: "example/app:stable", SizeBytes: 4096},
		},
		volumes:        make(map[string]containerengine.VolumeRecord),
		composeRunning: make(map[string]bool),
	}
	service := newTestServiceWithClient(t, client, nil)

	targetOnly := json.RawMessage(`{"engine":"docker"}`)
	duplicateRows := json.RawMessage(`{"engine":"docker","resource_identities":["sha256:shared","sha256:shared"]}`)
	fromTarget, err := service.decodeAndPreflight(context.Background(), "images.prune", targetOnly)
	if err != nil {
		t.Fatal(err)
	}
	fromRows, err := service.decodeAndPreflight(context.Background(), "images.prune", duplicateRows)
	if err != nil {
		t.Fatal(err)
	}

	if fromTarget.preflight.RequestHash != fromRows.preflight.RequestHash || fromTarget.preflight.PlanHash != fromRows.preflight.PlanHash {
		t.Fatalf("canonical hashes differ: target=%s/%s rows=%s/%s", fromTarget.preflight.RequestHash, fromTarget.preflight.PlanHash, fromRows.preflight.RequestHash, fromRows.preflight.PlanHash)
	}
	lockKeys := fromTarget.lockKeys()
	if len(lockKeys) != 1 || lockKeys[0] != "docker\x00\x00image\x00sha256:shared" {
		t.Fatalf("lock keys = %#v, want one canonical image lock", lockKeys)
	}
	var canonical containerengine.ResourcePruneRequest
	if err := json.Unmarshal(fromTarget.canonical, &canonical); err != nil {
		t.Fatal(err)
	}
	if len(canonical.ResourceIdentities) != 1 || canonical.ResourceIdentities[0] != "sha256:shared" {
		t.Fatalf("canonical request = %#v, want one image identity", canonical)
	}
	if got := fromTarget.preflight.Plan.Target["resource_count"]; got != 1 {
		t.Fatalf("resource_count = %#v, want 1", got)
	}
	if got := fromTarget.preflight.Plan.Target["reclaimable_bytes"]; got != int64(4096) {
		t.Fatalf("reclaimable_bytes = %#v, want 4096", got)
	}
	if got := fromTarget.preflight.Plan.Target["resources"]; !reflect.DeepEqual(got, []containerengine.ResourcePrunePlanItem{{
		Identity: "sha256:shared", Name: "example/app:latest", References: []string{"example/app:latest", "example/app:stable"}, SizeBytes: 4096,
	}}) {
		t.Fatalf("resources = %#v, want one complete reviewed image", got)
	}
}

func TestStatsAddsAuthoritativeSampleTimestamp(t *testing.T) {
	service := newTestService(t, nil)
	before := time.Now().UnixMilli()
	stats, err := service.Stats(context.Background(), containerengine.ContainerStatsWatchRequest{
		Engine:      containerengine.EngineDocker,
		ContainerID: "container-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	after := time.Now().UnixMilli()
	if stats.SampledAtUnixMs < before || stats.SampledAtUnixMs > after {
		t.Fatalf("sample timestamp = %d, want within [%d, %d]", stats.SampledAtUnixMs, before, after)
	}
}

func createVolumeOperation(t *testing.T, service *Service, requestID, name string) Operation {
	t.Helper()
	raw := volumeRequest(t, name)
	preflight, err := service.Preflight(context.Background(), PreflightRequest{Method: containerengine.MethodVolumesCreate, Request: raw})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := service.CreateOperation(context.Background(), CreateOperationRequest{
		RequestID: requestID, Method: containerengine.MethodVolumesCreate, Request: raw,
		RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	return operation
}

func waitOperationTerminal(t *testing.T, service *Service, operation Operation) Operation {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !operation.State.Terminal() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
		var err error
		operation, err = service.Operation(context.Background(), operation.OperationID)
		if err != nil {
			t.Fatal(err)
		}
	}
	if !operation.State.Terminal() {
		t.Fatalf("operation %s did not reach a terminal state", operation.OperationID)
	}
	return operation
}

func volumeRequest(t *testing.T, name string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(containerengine.VolumeCreateRequest{Engine: containerengine.EngineDocker, Name: name, Driver: "local"})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestCreateOperationValidatesPreflightAndIdempotency(t *testing.T) {
	service := newTestService(t, nil)
	ctx := context.Background()
	raw := volumeRequest(t, "cache-data")
	preflight, err := service.Preflight(ctx, PreflightRequest{Method: containerengine.MethodVolumesCreate, Request: raw})
	if err != nil {
		t.Fatal(err)
	}
	request := CreateOperationRequest{
		RequestID: "request-volume-create-1", Method: containerengine.MethodVolumesCreate, Request: raw,
		RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
	}
	first, err := service.CreateOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateOperation(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if second.OperationID != first.OperationID {
		t.Fatalf("idempotent operation id = %q, want %q", second.OperationID, first.OperationID)
	}

	changedRaw := volumeRequest(t, "another-cache")
	changed, err := service.Preflight(ctx, PreflightRequest{Method: containerengine.MethodVolumesCreate, Request: changedRaw})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateOperation(ctx, CreateOperationRequest{
		RequestID: request.RequestID, Method: containerengine.MethodVolumesCreate, Request: changedRaw,
		RequestHash: changed.RequestHash, PlanHash: changed.PlanHash,
	})
	if !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("changed idempotent request error = %v, want conflict", err)
	}

	tampered := request
	tampered.RequestID = "request-volume-create-2"
	tampered.PlanHash = "sha256:tampered"
	if _, err := service.CreateOperation(ctx, tampered); !errors.Is(err, ErrPreflightStale) {
		t.Fatalf("tampered plan error = %v, want stale", err)
	}
}

func TestOperationReconcilesToSucceededWithoutPersistingRequest(t *testing.T) {
	service := newTestService(t, nil)
	ctx := context.Background()
	raw := volumeRequest(t, "state-data")
	preflight, err := service.Preflight(ctx, PreflightRequest{Method: containerengine.MethodVolumesCreate, Request: raw})
	if err != nil {
		t.Fatal(err)
	}
	op, err := service.CreateOperation(ctx, CreateOperationRequest{
		RequestID: "request-volume-state-1", Method: containerengine.MethodVolumesCreate, Request: raw,
		RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !op.State.Terminal() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
		op, err = service.Operation(ctx, op.OperationID)
		if err != nil {
			t.Fatal(err)
		}
	}
	if op.State != OperationSucceeded {
		t.Fatalf("operation state = %q, want succeeded; error=%s", op.State, op.ErrorCode)
	}
	if string(op.Reconciliation) != `{"status":"verified","outcome":"present","identity":"state-data"}` {
		t.Fatalf("reconciliation = %s", op.Reconciliation)
	}
	var rawRequestColumns int
	if err := service.store.db.QueryRow(`
SELECT COUNT(1) FROM pragma_table_info('container_resource_operations')
WHERE name IN ('request_json', 'request_payload', 'raw_request')
`).Scan(&rawRequestColumns); err != nil {
		t.Fatal(err)
	}
	if rawRequestColumns != 0 {
		t.Fatal("operation store must not persist raw requests")
	}
}

func TestManagedWebServiceResourceIsReadOnly(t *testing.T) {
	service := newTestService(t, func(_ context.Context, _ containerengine.Engine, _ containerengine.EndpointID, kind ResourceKind, identity string) (*ManagedOwner, error) {
		if kind == ResourceVolume && identity == "managed-data" {
			return &ManagedOwner{Kind: "web_service", ServiceID: "service-1", Name: "Database"}, nil
		}
		return nil, nil
	})
	_, err := service.Preflight(context.Background(), PreflightRequest{
		Method: containerengine.MethodVolumesCreate, Request: volumeRequest(t, "managed-data"),
	})
	if !errors.Is(err, ErrManagedByWebService) {
		t.Fatalf("managed resource error = %v, want managed protection", err)
	}
}

func TestPrepareContainerExecRejectsManagedContainerBeforeProgramCreation(t *testing.T) {
	client := &fakeEngineClient{
		volumes: make(map[string]containerengine.VolumeRecord), composeRunning: make(map[string]bool),
		containers: map[string]containerengine.EngineContainer{
			"docker:managed-container": {Engine: containerengine.EngineDocker, ContainerID: "managed-container", State: containerengine.ContainerStateRunning},
		},
	}
	service := newTestServiceWithClient(t, client, func(_ context.Context, _ containerengine.Engine, _ containerengine.EndpointID, kind ResourceKind, identity string) (*ManagedOwner, error) {
		if kind == ResourceContainer && identity == "managed-container" {
			return &ManagedOwner{Kind: "web_service", ServiceID: "service-1", Name: "Managed API"}, nil
		}
		return nil, nil
	})
	_, err := service.PrepareContainerExec(context.Background(), containerengine.ContainerExecRequest{
		Engine: containerengine.EngineDocker, ContainerID: "managed-container", Argv: []string{"/bin/sh"},
	})
	if !errors.Is(err, ErrManagedByWebService) {
		t.Fatalf("PrepareContainerExec() error = %v, want managed protection", err)
	}
	if client.execCalls != 0 {
		t.Fatalf("program creation calls = %d, want 0", client.execCalls)
	}
}

func TestOperationsSerializeCanonicalResourceLocks(t *testing.T) {
	t.Run("same resource", func(t *testing.T) {
		release := make(chan struct{})
		client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), createStarted: make(chan string, 2), createRelease: release}
		service := newTestServiceWithClient(t, client, nil)
		first := createVolumeOperation(t, service, "request-lock-same-1", "cache")
		if started := <-client.createStarted; started != "cache" {
			t.Fatalf("first started resource = %q", started)
		}
		second := createVolumeOperation(t, service, "request-lock-same-2", "cache")
		select {
		case started := <-client.createStarted:
			t.Fatalf("same resource started concurrently: %q", started)
		case <-time.After(100 * time.Millisecond):
		}
		close(release)
		if state := waitOperationTerminal(t, service, first).State; state != OperationSucceeded {
			t.Fatalf("first state = %q", state)
		}
		if state := waitOperationTerminal(t, service, second).State; state != OperationSucceeded {
			t.Fatalf("second state = %q", state)
		}
		client.mu.Lock()
		maxActive := client.maxCreateActive
		client.mu.Unlock()
		if maxActive != 1 {
			t.Fatalf("same-resource maximum concurrency = %d, want 1", maxActive)
		}
	})

	t.Run("different resources", func(t *testing.T) {
		release := make(chan struct{})
		client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), createStarted: make(chan string, 2), createRelease: release}
		service := newTestServiceWithClient(t, client, nil)
		first := createVolumeOperation(t, service, "request-lock-different-1", "cache-a")
		second := createVolumeOperation(t, service, "request-lock-different-2", "cache-b")
		seen := map[string]bool{}
		for len(seen) < 2 {
			select {
			case started := <-client.createStarted:
				seen[started] = true
			case <-time.After(time.Second):
				t.Fatalf("different resources did not execute concurrently: %v", seen)
			}
		}
		close(release)
		if waitOperationTerminal(t, service, first).State != OperationSucceeded || waitOperationTerminal(t, service, second).State != OperationSucceeded {
			t.Fatal("different-resource operations did not succeed")
		}
		client.mu.Lock()
		maxActive := client.maxCreateActive
		client.mu.Unlock()
		if maxActive != 2 {
			t.Fatalf("different-resource maximum concurrency = %d, want 2", maxActive)
		}
	})
}

func TestCancelStopsRunningOperationAndReconcilesTerminalState(t *testing.T) {
	release := make(chan struct{})
	client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), createStarted: make(chan string, 1), createRelease: release}
	service := newTestServiceWithClient(t, client, nil)
	operation := createVolumeOperation(t, service, "request-cancel-running", "cancel-me")
	<-client.createStarted
	if _, err := service.CancelOperation(context.Background(), operation.OperationID); err != nil {
		t.Fatal(err)
	}
	operation = waitOperationTerminal(t, service, operation)
	if operation.State != OperationCanceled || operation.ErrorCode != "canceled" || !operation.CancelRequested {
		t.Fatalf("canceled operation = %#v", operation)
	}
	client.mu.Lock()
	_, created := client.volumes["cancel-me"]
	client.mu.Unlock()
	if created {
		t.Fatal("canceled mutation changed engine state")
	}
}

func TestLifecycleReconciliationRequiresDesiredState(t *testing.T) {
	containerTests := []struct {
		method containerengine.Method
		state  containerengine.ContainerState
		valid  bool
	}{
		{method: containerengine.MethodStart, state: containerengine.ContainerStateRunning, valid: true},
		{method: containerengine.MethodRestart, state: containerengine.ContainerStateRestarting, valid: false},
		{method: containerengine.MethodStop, state: containerengine.ContainerStateExited, valid: true},
		{method: containerengine.MethodPause, state: containerengine.ContainerStateRunning, valid: false},
		{method: containerengine.MethodPause, state: containerengine.ContainerStatePaused, valid: true},
		{method: containerengine.MethodUnpause, state: containerengine.ContainerStatePaused, valid: false},
		{method: containerengine.MethodKill, state: containerengine.ContainerStateStopped, valid: true},
	}
	for _, test := range containerTests {
		err := requireContainerState(test.method, test.state)
		if (err == nil) != test.valid {
			t.Fatalf("container method=%s state=%s error=%v, valid=%v", test.method, test.state, err, test.valid)
		}
	}

	workspaceTests := []struct {
		method containerengine.Method
		state  string
		valid  bool
	}{
		{method: containerengine.MethodComposeProjectsStart, state: "running", valid: true},
		{method: containerengine.MethodComposeProjectsRestart, state: "degraded", valid: false},
		{method: containerengine.MethodComposeProjectsStop, state: "stopped", valid: true},
		{method: containerengine.MethodPodsStart, state: "running", valid: true},
		{method: containerengine.MethodPodsRestart, state: "created", valid: false},
		{method: containerengine.MethodPodsStop, state: "exited", valid: true},
	}
	for _, test := range workspaceTests {
		err := requireWorkspaceState(test.method, test.state)
		if (err == nil) != test.valid {
			t.Fatalf("workspace method=%s state=%s error=%v, valid=%v", test.method, test.state, err, test.valid)
		}
	}
}

func TestOpenInterruptsActiveOperationsWithoutReplay(t *testing.T) {
	client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	_, err = service.store.db.Exec(`
INSERT INTO container_resource_operations(
 operation_id, request_id, request_hash, plan_hash, method, engine, endpoint_id, resource_kind,
 resource_identity, state, created_at_unix_ms, updated_at_unix_ms
) VALUES('container_operation_interrupted', 'request-interrupted', 'sha256:req', 'sha256:plan',
 ?, 'docker', '', 'volume', 'never-replay', 'running', ?, ?)
`, containerengine.MethodVolumesCreate, now, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	op, err := reopened.Operation(context.Background(), "container_operation_interrupted")
	if err != nil {
		t.Fatal(err)
	}
	if op.State != OperationInterrupted || op.ErrorCode != "runtime_restarted" {
		t.Fatalf("restarted operation = %#v", op)
	}
	if string(op.Reconciliation) != `{"status":"observed","outcome":"absent"}` {
		t.Fatalf("restart reconciliation = %s, want read-only observed absence", op.Reconciliation)
	}
	if _, exists := client.volumes["never-replay"]; exists {
		t.Fatal("startup must not replay interrupted mutations")
	}
}

func TestSavedComposeProjectSupportsRepeatableLifecycleOperations(t *testing.T) {
	service := newTestService(t, nil)
	configPath := filepath.Join(t.TempDir(), "compose.yaml")
	if err := os.WriteFile(configPath, []byte("services:\n  api:\n    image: example/api:latest\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	definition, err := service.CreateComposeProjectDefinition(context.Background(), ComposeProjectDefinitionInput{
		Engine: containerengine.EngineDocker, Name: "saved-api", ConfigPaths: []string{configPath}, Profiles: []string{"dev"},
	})
	if err != nil {
		t.Fatal(err)
	}
	canonicalPath, err := filepath.EvalSymlinks(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if definition.ProjectID == "" || len(definition.ConfigPaths) != 1 || definition.ConfigPaths[0] != canonicalPath {
		t.Fatalf("definition = %+v", definition)
	}

	raw, err := json.Marshal(containerengine.ComposeProjectRequest{Engine: containerengine.EngineDocker, ProjectID: definition.ProjectID})
	if err != nil {
		t.Fatal(err)
	}
	preflight, err := service.Preflight(context.Background(), PreflightRequest{Method: containerengine.MethodComposeProjectsStart, Request: raw})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := service.CreateOperation(context.Background(), CreateOperationRequest{
		RequestID: "request-compose-start", Method: containerengine.MethodComposeProjectsStart, Request: raw,
		RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	operation = waitOperationTerminal(t, service, operation)
	if operation.State != OperationSucceeded {
		t.Fatalf("operation = %+v", operation)
	}
	events, err := service.Events(context.Background(), operation.OperationID, 0)
	if err != nil {
		t.Fatal(err)
	}
	phases := make([]string, 0, len(events))
	for _, event := range events {
		if event.Type != "progress" {
			continue
		}
		var progress OperationProgress
		if err := json.Unmarshal(event.Payload, &progress); err != nil {
			t.Fatal(err)
		}
		phases = append(phases, progress.Phase)
	}
	if len(phases) != 2 || phases[0] != "executing" || phases[1] != "reconciling" {
		t.Fatalf("progress phases = %v", phases)
	}

	details, _, err := service.ComposeProject(context.Background(), containerengine.ComposeProjectRequest{
		Engine: containerengine.EngineDocker, ProjectID: definition.ProjectID,
	})
	if err != nil || details.Status != "running" {
		t.Fatalf("saved project details = %+v, err=%v", details, err)
	}
	methods := []containerengine.Method{
		containerengine.MethodComposeProjectsRestart,
		containerengine.MethodComposeProjectsStop,
		containerengine.MethodComposeProjectsStart,
		containerengine.MethodComposeProjectsDown,
	}
	requestIDs := []string{"request-compose-restart", "request-compose-stop", "request-compose-start-again", "request-compose-down"}
	for index, method := range methods {
		request := containerengine.ComposeProjectRequest{Engine: containerengine.EngineDocker, ProjectID: definition.ProjectID}
		if method == containerengine.MethodComposeProjectsDown {
			request.ConfirmationName = definition.Name
		}
		raw, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		preflight, err := service.Preflight(context.Background(), PreflightRequest{Method: method, Request: raw})
		if err != nil {
			t.Fatalf("preflight %s: %v", method, err)
		}
		operation, err := service.CreateOperation(context.Background(), CreateOperationRequest{
			RequestID: requestIDs[index], Method: method, Request: raw,
			RequestHash: preflight.RequestHash, PlanHash: preflight.PlanHash,
		})
		if err != nil {
			t.Fatalf("create %s: %v", method, err)
		}
		if operation = waitOperationTerminal(t, service, operation); operation.State != OperationSucceeded {
			t.Fatalf("operation %s = %+v", method, operation)
		}
	}
	if _, err := service.ComposeProjectDefinition(context.Background(), definition.ProjectID); err != nil {
		t.Fatalf("saved definition after down: %v", err)
	}
	if err := service.DeleteComposeProjectDefinition(context.Background(), definition.ProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ComposeProjectDefinition(context.Background(), definition.ProjectID); !errors.Is(err, ErrComposeProjectDefinitionNotFound) {
		t.Fatalf("definition after delete error = %v", err)
	}
}

func TestContainerServiceOperationErrorsStayActionableAndRedacted(t *testing.T) {
	tests := []struct {
		err         error
		wantCode    string
		wantMessage string
	}{
		{err: containerengine.ErrContainerServiceConfigConflict, wantCode: "container_service_configuration_conflict", wantMessage: "The container service configuration changed. Reload it before saving."},
		{err: containerengine.ErrContainerServiceRecoveryRequired, wantCode: "service_recovery_required", wantMessage: "The container service could not be recovered automatically. Review its host configuration before retrying."},
	}
	for _, test := range tests {
		code, message := publicOperationError(test.err)
		if code != test.wantCode || message != test.wantMessage {
			t.Fatalf("publicOperationError(%v) = %q, %q", test.err, code, message)
		}
	}
}

func TestSchemaMigratesV1AndPreservesOperations(t *testing.T) {
	client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), composeRunning: make(map[string]bool)}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	if _, err := service.store.db.Exec(`
INSERT INTO container_resource_operations(
 operation_id, request_id, request_hash, plan_hash, method, engine, endpoint_id, resource_kind,
 resource_identity, state, created_at_unix_ms, updated_at_unix_ms
) VALUES('container_operation_preserved', 'request-preserved', 'sha256:req', 'sha256:plan',
 ?, 'docker', '', 'volume', 'cache', 'succeeded', ?, ?)
`, containerengine.MethodVolumesCreate, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`DROP TABLE container_compose_projects`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`DROP TABLE container_service_configuration_state`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.Operation(context.Background(), "container_operation_preserved"); err != nil {
		t.Fatalf("preserved operation: %v", err)
	}
	var tableName string
	if err := reopened.store.db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'container_compose_projects'`).Scan(&tableName); err != nil || tableName == "" {
		t.Fatalf("Compose project table after migration = %q, err=%v", tableName, err)
	}
}

func TestSchemaMigratesV2AndPreservesComposeProjects(t *testing.T) {
	client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), composeRunning: make(map[string]bool)}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	if _, err := service.store.db.Exec(`
INSERT INTO container_compose_projects(
 project_id, engine, endpoint_id, name, config_paths_json, env_file_path, profiles_json,
 created_at_unix_ms, updated_at_unix_ms
) VALUES('compose-preserved', 'docker', 'endpoint-preserved', 'preserved', '["/workspace/compose.yaml"]', '', '["dev"]', ?, ?)
`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`DROP TABLE container_service_configuration_state`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`PRAGMA user_version = 2`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	definition, err := reopened.ComposeProjectDefinition(context.Background(), "compose-preserved")
	if err != nil || definition.Name != "preserved" || len(definition.Profiles) != 1 || definition.Profiles[0] != "dev" {
		t.Fatalf("preserved Compose definition = %+v, err=%v", definition, err)
	}
	var tableName string
	if err := reopened.store.db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'container_service_configuration_state'`).Scan(&tableName); err != nil || tableName == "" {
		t.Fatalf("container service state table after migration = %q, err=%v", tableName, err)
	}
}

func TestSchemaMigratesV3ConfigurationStateToEngineSource(t *testing.T) {
	client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord), composeRunning: make(map[string]bool)}
	adapter, err := containerengine.NewAdapter(client)
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`
ALTER TABLE container_service_configuration_state RENAME TO container_service_configuration_state_v4;
CREATE TABLE container_service_configuration_state (
  service_id TEXT PRIMARY KEY,
  configuration_revision TEXT NOT NULL DEFAULT '',
  restart_required INTEGER NOT NULL DEFAULT 0 CHECK(restart_required IN (0, 1)),
  service_generation TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL
);
INSERT INTO container_service_configuration_state(
  service_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
) VALUES('container_service_preserved', 'sha256:revision', 1, 'sha256:generation', 1234);
DROP TABLE container_service_configuration_state_v4;
PRAGMA user_version = 3;
`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	engineState, err := reopened.store.containerServiceConfigurationState(context.Background(), "container_service_preserved", containerengine.ContainerServiceConfigurationSourceEngine)
	if err != nil {
		t.Fatal(err)
	}
	if engineState.ConfigurationRevision != "sha256:revision" || !engineState.RestartRequired || engineState.ServiceGeneration != "sha256:generation" {
		t.Fatalf("migrated engine state = %+v", engineState)
	}
	clientState, err := reopened.store.containerServiceConfigurationState(context.Background(), "container_service_preserved", containerengine.ContainerServiceConfigurationSourceDockerCLI)
	if err != nil {
		t.Fatal(err)
	}
	if clientState.ConfigurationRevision != "" || clientState.RestartRequired {
		t.Fatalf("unexpected migrated Docker CLI state = %+v", clientState)
	}
}

func TestSchemaMigratesV4ClientProxyStateToDockerCLI(t *testing.T) {
	adapter, err := containerengine.NewAdapter(&fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)})
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`
INSERT INTO container_service_configuration_state(
  service_id, source_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
) VALUES('container_service_preserved', 'client_proxy', 'sha256:client', 0, 'sha256:generation', 1234);
PRAGMA user_version = 4;
`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	state, err := reopened.store.containerServiceConfigurationState(context.Background(), "container_service_preserved", containerengine.ContainerServiceConfigurationSourceDockerCLI)
	if err != nil {
		t.Fatal(err)
	}
	if state.ConfigurationRevision != "sha256:client" || state.RestartRequired {
		t.Fatalf("migrated Docker CLI state = %+v", state)
	}
}

func TestSchemaRejectsUnknownV4ConfigurationSource(t *testing.T) {
	adapter, err := containerengine.NewAdapter(&fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)})
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
	service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.store.db.Exec(`
INSERT INTO container_service_configuration_state(
  service_id, source_id, configuration_revision, restart_required, service_generation, updated_at_unix_ms
) VALUES('container_service_drift', 'unknown', '', 0, '', 1234);
PRAGMA user_version = 4;
`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := Open(Options{DatabasePath: databasePath, Engine: adapter}); err == nil {
		t.Fatal("Open() accepted an unknown v4 configuration source")
	}
}

func TestSchemaRejectsDrift(t *testing.T) {
	service := newTestService(t, nil)
	path := service.store.db
	if _, err := path.Exec(`ALTER TABLE container_resource_operations ADD COLUMN unexpected TEXT NOT NULL DEFAULT ''`); err != nil {
		t.Fatal(err)
	}
	databasePath := ""
	if err := path.QueryRow(`PRAGMA database_list`).Scan(new(int), new(string), &databasePath); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	adapter, err := containerengine.NewAdapter(&fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = Open(Options{DatabasePath: databasePath, Engine: adapter})
	if err == nil {
		t.Fatal("Open() accepted schema drift")
	}
	var schemaErr interface{ Unwrap() error }
	if !errors.As(err, &schemaErr) {
		t.Fatalf("schema drift error = %T %v", err, err)
	}
}

func TestSchemaRejectsWrongKindAndFutureVersion(t *testing.T) {
	tests := []struct {
		name   string
		mutate string
	}{
		{name: "wrong kind", mutate: `UPDATE __redeven_db_meta SET db_kind = 'another_product' WHERE singleton = 1`},
		{name: "future version", mutate: `PRAGMA user_version = 6`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)}
			adapter, err := containerengine.NewAdapter(client)
			if err != nil {
				t.Fatal(err)
			}
			databasePath := filepath.Join(t.TempDir(), "container-resources.sqlite3")
			service, err := Open(Options{DatabasePath: databasePath, Engine: adapter})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.store.db.Exec(test.mutate); err != nil {
				t.Fatal(err)
			}
			if err := service.Close(); err != nil {
				t.Fatal(err)
			}
			if reopened, err := Open(Options{DatabasePath: databasePath, Engine: adapter}); err == nil {
				_ = reopened.Close()
				t.Fatalf("Open() accepted %s", test.name)
			}
		})
	}
}

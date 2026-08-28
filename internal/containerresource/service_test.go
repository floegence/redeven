package containerresource

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/containerengine"
)

type fakeEngineClient struct {
	mu              sync.Mutex
	volumes         map[string]containerengine.VolumeRecord
	createStarted   chan string
	createRelease   <-chan struct{}
	createActive    int
	maxCreateActive int
}

func (f *fakeEngineClient) Status(context.Context, containerengine.Engine) (containerengine.EngineStatus, error) {
	return containerengine.EngineStatus{Engine: containerengine.EngineDocker, Available: true}, nil
}

func (f *fakeEngineClient) List(context.Context, containerengine.Engine, bool) ([]containerengine.EngineContainer, error) {
	return nil, nil
}

func (f *fakeEngineClient) Inspect(context.Context, containerengine.Engine, string) (containerengine.EngineContainer, error) {
	return containerengine.EngineContainer{}, containerengine.ErrContainerNotFound
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
	return nil, nil
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

func newTestService(t *testing.T, resolver ManagedOwnerResolver) *Service {
	t.Helper()
	return newTestServiceWithClient(t, &fakeEngineClient{volumes: make(map[string]containerengine.VolumeRecord)}, resolver)
}

func newTestServiceWithClient(t *testing.T, client *fakeEngineClient, resolver ManagedOwnerResolver) *Service {
	t.Helper()
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
		{name: "future version", mutate: `PRAGMA user_version = 2`},
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

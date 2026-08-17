package lifecycle

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestRuntimeOperationStoreUsesSchemaV2ForFreshState(t *testing.T) {
	store := newTestStore(t, &fakeController{}, &fakeClock{now: time.Unix(50, 0)})
	if store.state.SchemaVersion != 2 {
		t.Fatalf("schema version = %d, want 2", store.state.SchemaVersion)
	}
}

func TestRuntimeOperationStoreMigratesV1TerminalOperation(t *testing.T) {
	clock := &fakeClock{now: time.Unix(60, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-terminal", "idem-terminal")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-terminal")); err != nil {
		t.Fatal(err)
	}
	persistOperationState(t, store, request.OperationID, gatewayprotocol.RuntimeOperationSucceeded)
	original := writeHistoricalV1State(t, store.stateRoot, store.state, nil)

	reopened, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	operation := reopened.state.Operations[request.OperationID]
	if reopened.state.SchemaVersion != 2 || operation.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("migrated state = version %d operation %#v", reopened.state.SchemaVersion, operation)
	}
	migrated, err := os.ReadFile(reopened.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(migrated, original) || !bytes.Contains(migrated, []byte(`"schema_version": 2`)) {
		t.Fatalf("v1 state was not atomically rewritten as v2: %s", migrated)
	}
}

func TestRuntimeOperationStoreMigrationFailsCommitReadyUpdateAndReleasesTarget(t *testing.T) {
	clock := &fakeClock{now: time.Unix(70, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	prepareCommitReadyOperation(t, store, "op-update")
	writeHistoricalV1State(t, store.stateRoot, store.state, nil)

	reopened, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	operation := reopened.state.Operations["op-update"]
	if operation.State != gatewayprotocol.RuntimeOperationFailed || operation.Failure == nil || operation.Failure.Code != string(ErrorArtifactInvalid) {
		t.Fatalf("migrated operation = %#v", operation)
	}
	if reopened.state.TargetLocks[operation.LifecycleTargetID] != "" || reopened.state.FenceTokens[operation.OperationID] != "" {
		t.Fatalf("pre-destructive v1 update remained locked: %#v", reopened.state)
	}
	if _, exists := reopened.state.ArtifactPaths[operation.OperationID]; exists {
		t.Fatalf("obsolete v1 staging path remained in v2 state: %#v", reopened.state.ArtifactPaths)
	}
	if operation.Artifact == nil || operation.Artifact.ArchiveSHA256 == "" || operation.Artifact.ExecutableSHA256 != "" {
		t.Fatalf("v1 artifact digest provenance was not preserved honestly: %#v", operation.Artifact)
	}
	if _, err := reopened.Prepare(context.Background(), prepareRequest("op-next", "idem-next"), prepareAuthorization("permit-next")); err != nil {
		t.Fatalf("target remained unavailable after safe migration failure: %v", err)
	}
}

func TestRuntimeOperationStoreMigrationQuarantinesDestructiveV1Operation(t *testing.T) {
	for _, state := range []gatewayprotocol.RuntimeOperationState{
		gatewayprotocol.RuntimeOperationFencing,
		gatewayprotocol.RuntimeOperationCommitting,
		gatewayprotocol.RuntimeOperationRecovering,
	} {
		t.Run(string(state), func(t *testing.T) {
			clock := &fakeClock{now: time.Unix(80, 0)}
			controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
			store := newTestStore(t, controller, clock)
			prepareCommitReadyOperation(t, store, "op-update")
			persistOperationState(t, store, "op-update", state)
			writeHistoricalV1State(t, store.stateRoot, store.state, nil)

			reopened, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
			if err != nil {
				t.Fatal(err)
			}
			operation := reopened.state.Operations["op-update"]
			if operation.State != gatewayprotocol.RuntimeOperationManualRecoveryRequired || operation.Failure == nil || operation.Failure.Code != string(ErrorRecoveryFailed) {
				t.Fatalf("migrated operation = %#v", operation)
			}
			if reopened.state.TargetLocks[operation.LifecycleTargetID] != operation.OperationID || reopened.state.Quarantined[operation.LifecycleTargetID] != operation.OperationID {
				t.Fatalf("destructive v1 operation lost isolation: %#v", reopened.state)
			}
		})
	}
}

func TestRuntimeOperationStoreMigrationRejectsDriftAndFutureVersionsWithoutMutation(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{name: "v1 drift", mutate: func(document map[string]any) { document["unexpected"] = true }},
		{name: "future", mutate: func(document map[string]any) { document["schema_version"] = float64(3) }},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			clock := &fakeClock{now: time.Unix(90, 0)}
			controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
			store := newTestStore(t, controller, clock)
			request := prepareRequest("op-a", "idem-a")
			request.Operation = gatewayprotocol.RuntimeOperationStart
			request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
			if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-a")); err != nil {
				t.Fatal(err)
			}
			original := writeHistoricalV1State(t, store.stateRoot, store.state, testCase.mutate)
			if _, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}}); err == nil {
				t.Fatal("NewStore() succeeded for unsupported state")
			}
			after, err := os.ReadFile(store.statePath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(after, original) {
				t.Fatal("unsupported state was modified")
			}
		})
	}
}

func TestRuntimeOperationStoreMigrationWriteFailureLeavesV1StateUnchanged(t *testing.T) {
	clock := &fakeClock{now: time.Unix(100, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-a", "idem-a")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	original := writeHistoricalV1State(t, store.stateRoot, store.state, nil)
	if err := os.Mkdir(store.statePath+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}}); err == nil {
		t.Fatal("NewStore() succeeded when migration could not be committed")
	}
	after, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, original) {
		t.Fatal("failed migration modified the v1 state file")
	}
}

func writeHistoricalV1State(t *testing.T, stateRoot string, state fileState, mutate func(map[string]any)) []byte {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document["schema_version"] = float64(1)
	operations, _ := document["operations"].(map[string]any)
	for _, rawOperation := range operations {
		operation, _ := rawOperation.(map[string]any)
		delete(operation, "observer_redacted")
		artifact, _ := operation["artifact"].(map[string]any)
		if artifact == nil {
			continue
		}
		artifact["sha256"] = artifact["archive_sha256"]
		delete(artifact, "archive_sha256")
		delete(artifact, "executable_sha256")
	}
	if mutate != nil {
		mutate(document)
	}
	raw, err = json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	statePath := filepath.Join(stateRoot, "runtime-operations-v1.json")
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return raw
}

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

type fakeController struct {
	snapshot           gatewayprotocol.WorkloadSnapshot
	fenced             gatewayprotocol.WorkloadSnapshot
	token              string
	validateErr        error
	beginErr           error
	commitErr          error
	recoverErr         error
	reconcileErr       error
	validations        int
	begins             int
	released           int
	recoveries         int
	reconciliations    int
	commits            int
	commitArtifactPath string
	commitStarted      chan struct{}
	commitContinue     chan struct{}
	commitContextErr   chan error
}

func (c *fakeController) ValidateTarget(_ context.Context, _ string, _ gatewayprotocol.LifecycleTarget) error {
	c.validations++
	return c.validateErr
}

func (c *fakeController) Snapshot(context.Context, gatewayprotocol.LifecycleTarget) (gatewayprotocol.WorkloadSnapshot, error) {
	return c.snapshot, nil
}

func (c *fakeController) BeginLifecycleFence(context.Context, string, gatewayprotocol.LifecycleTarget) (LifecycleFence, error) {
	c.begins++
	return LifecycleFence{Token: c.token, Snapshot: c.fenced}, c.beginErr
}

func (c *fakeController) ReleaseLifecycleFence(context.Context, string) error {
	c.released++
	return nil
}

func (c *fakeController) Commit(ctx context.Context, operation gatewayprotocol.RuntimeOperation, _ string) error {
	c.commits++
	if c.commitStarted != nil {
		close(c.commitStarted)
	}
	if c.commitContinue != nil {
		<-c.commitContinue
	}
	if c.commitContextErr != nil {
		c.commitContextErr <- ctx.Err()
	}
	if operation.Artifact != nil {
		c.commitArtifactPath = operation.Artifact.StagedPath
	}
	return c.commitErr
}

func TestCommitContinuesAfterClientTransportDisconnect(t *testing.T) {
	clock := &fakeClock{now: time.Unix(225, 0)}
	controller := &fakeController{
		snapshot: knownSnapshot(4), fenced: knownSnapshot(4), token: "fence-a",
		commitStarted: make(chan struct{}), commitContinue: make(chan struct{}), commitContextErr: make(chan error, 1),
	}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-detached", "idem-detached")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	prepared, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-detached"))
	if err != nil || prepared.Operation.State != gatewayprotocol.RuntimeOperationCommitReady {
		t.Fatalf("Prepare() = %#v, %v", prepared, err)
	}
	requestContext, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, commitErr := store.Commit(requestContext, request.OperationID, request.AuthorizedClientKeyID)
		result <- commitErr
	}()
	<-controller.commitStarted
	cancel()
	close(controller.commitContinue)
	if commitErr := <-result; commitErr != nil {
		t.Fatalf("Commit() error after transport cancellation = %v", commitErr)
	}
	if contextErr := <-controller.commitContextErr; contextErr != nil {
		t.Fatalf("Gateway execution context inherited transport cancellation: %v", contextErr)
	}
	operation, err := store.Get(context.Background(), request.OperationID, Access{
		ClientKeyID: request.AuthorizedClientKeyID,
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil || operation.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("operation after transport cancellation = %#v, %v", operation, err)
	}
}

func (c *fakeController) Recover(context.Context, gatewayprotocol.RuntimeOperation) error {
	c.recoveries++
	return c.recoverErr
}
func (c *fakeController) Reconcile(context.Context, gatewayprotocol.RuntimeOperation) error {
	c.reconciliations++
	return c.reconcileErr
}

type allowArtifacts struct{}

func (allowArtifacts) Verify(context.Context, gatewayprotocol.RuntimeOperation, gatewayprotocol.RuntimeArtifactMetadata, string) error {
	return nil
}

func knownSnapshot(revision int64, identities ...string) gatewayprotocol.WorkloadSnapshot {
	count := len(identities)
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		RuntimeBinaryVersion:   "v0.10.1",
		SnapshotRevision:       revision,
		ProcessInventoryDigest: "sha256:inventory",
		WorkloadIdentityDigest: "sha256:workload",
		WorkloadIdentities:     identities,
		Impact: gatewayprotocol.WorkloadImpact{
			Knowledge:            gatewayprotocol.WorkloadKnown,
			AffectedProcessCount: &count,
		},
		ObservedAtUnixMS: 1,
	})
}

func prepareRequest(operationID string, idempotencyKey string) gatewayprotocol.RuntimeOperationPrepareRequest {
	return gatewayprotocol.RuntimeOperationPrepareRequest{
		ProtocolVersion:       gatewayprotocol.Version,
		OperationID:           operationID,
		AuthorizedClientKeyID: "client-a",
		GatewayEnvID:          "env-a",
		LifecycleTargetID:     "target-a",
		TargetGeneration:      7,
		Operation:             gatewayprotocol.RuntimeOperationUpdate,
		DesiredRuntime: gatewayprotocol.DesiredRuntime{
			Version:        "v0.11.0",
			Platform:       "linux",
			Architecture:   "amd64",
			ArtifactPolicy: gatewayprotocol.ArtifactPolicyPublishedRelease,
		},
		IdempotencyKey: idempotencyKey,
	}
}

func prepareAuthorization(permit string) Authorization {
	return Authorization{
		Actor:          gatewayprotocol.RuntimeOperationActor{Kind: "provider_user", SubjectID: "user-a"},
		RouteBindingID: "binding-a",
		Grants:         []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
		PermitJTI:      permit,
	}
}

func newTestStore(t *testing.T, controller *fakeController, clock *fakeClock) *Store {
	t.Helper()
	store, err := NewStore(Options{
		StateRoot:        t.TempDir(),
		Clock:            clock,
		Controller:       controller,
		ArtifactVerifier: allowArtifacts{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestPrepareIsAtomicIdempotentAndTargetScoped(t *testing.T) {
	clock := &fakeClock{now: time.Unix(100, 0)}
	controller := &fakeController{snapshot: knownSnapshot(3, "session:a"), fenced: knownSnapshot(3, "session:a"), token: "fence-a"}
	store := newTestStore(t, controller, clock)

	first, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a"))
	if err != nil {
		t.Fatal(err)
	}
	if first.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("state = %q", first.Operation.State)
	}
	replayed, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a"))
	if err != nil || replayed.Operation.OperationID != first.Operation.OperationID {
		t.Fatalf("idempotent prepare = %#v, %v", replayed, err)
	}

	changed := prepareRequest("op-a", "idem-a")
	changed.DesiredRuntime.Version = "v0.11.1"
	_, err = store.Prepare(context.Background(), changed, prepareAuthorization("permit-a"))
	assertCode(t, err, ErrorAuthorizationConflict)
	_, err = store.Prepare(context.Background(), prepareRequest("op-b", "idem-b"), prepareAuthorization("permit-a"))
	assertCode(t, err, ErrorPermitConsumed)
	_, err = store.Prepare(context.Background(), prepareRequest("op-c", "idem-c"), prepareAuthorization("permit-c"))
	assertCode(t, err, ErrorOperationInProgress)
}

func TestListActiveOperationsRequiresManagementAndRedactsOtherClients(t *testing.T) {
	clock := &fakeClock{now: time.Unix(125, 0)}
	controller := &fakeController{snapshot: knownSnapshot(3, "session:a"), fenced: knownSnapshot(3, "session:a"), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	request := gatewayprotocol.RuntimeOperationListRequest{
		ProtocolVersion: gatewayprotocol.Version, GatewayEnvID: "env-a",
		LifecycleTargetID: "target-a", TargetGeneration: 7,
	}
	if _, err := store.List(context.Background(), request, Access{ClientKeyID: "unknown-client"}); err == nil {
		t.Fatal("List() disclosed active operations without manage_runtime")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	observer, err := store.List(context.Background(), request, Access{
		ClientKeyID: "client-b", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(observer.Operations) != 1 || !observer.Operations[0].ObserverRedacted || observer.Operations[0].AuthorizedClientKeyID != "" ||
		observer.Operations[0].DesiredRuntime.Version != "" || observer.Operations[0].DesiredRuntime.ArtifactPolicy != "" ||
		observer.Operations[0].ExpectedSnapshot.ProcessInventoryDigest != "" || observer.Operations[0].ExpectedSnapshot.WorkloadIdentityDigest != "" {
		t.Fatalf("observer operation was not redacted: %#v", observer.Operations)
	}
	original, err := store.List(context.Background(), request, Access{
		ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(original.Operations) != 1 || original.Operations[0].ObserverRedacted || original.Operations[0].AuthorizedClientKeyID != "client-a" {
		t.Fatalf("original client operation = %#v", original.Operations)
	}
	if _, err := store.Cancel(context.Background(), "op-a", Access{ClientKeyID: "client-a"}); err != nil {
		t.Fatal(err)
	}
	terminal, err := store.List(context.Background(), request, Access{
		ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(terminal.Operations) != 0 {
		t.Fatalf("terminal operations remained in active list: %#v", terminal.Operations)
	}
}

func TestTargetMutationCoordinatorRejectsActiveOperationAndQuarantine(t *testing.T) {
	clock := &fakeClock{now: time.Unix(150, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	coordinator, err := NewStore(Options{StateRoot: stateRoot})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.BeginTargetMutation("target-a"); err == nil {
		t.Fatal("target mutation started while a Runtime operation held the target lock")
	} else {
		assertCode(t, err, ErrorOperationInProgress)
	}

	store.mu.Lock()
	next := cloneState(store.state)
	operation := next.Operations["op-a"]
	operation.State = gatewayprotocol.RuntimeOperationManualRecoveryRequired
	next.Operations[operation.OperationID] = operation
	next.Quarantined[operation.LifecycleTargetID] = operation.OperationID
	if err := store.saveLocked(next); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()
	if _, err := coordinator.BeginTargetMutation("target-a"); err == nil {
		t.Fatal("target mutation started while the Runtime target was quarantined")
	} else {
		assertCode(t, err, ErrorRecoveryFailed)
	}
}

func TestTargetMutationCoordinatorSerializesPrepare(t *testing.T) {
	clock := &fakeClock{now: time.Unix(175, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	coordinator, err := NewStore(Options{StateRoot: stateRoot})
	if err != nil {
		t.Fatal(err)
	}
	release, err := coordinator.BeginTargetMutation("target-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err == nil {
		release()
		t.Fatal("Runtime prepare started while target enrollment held the target mutation lock")
	} else {
		assertCode(t, err, ErrorOperationInProgress)
	}
	release()
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatalf("Runtime prepare after target mutation release: %v", err)
	}
}

func TestReconcileConsumesPermitBeforeRecoveryAndIsResponseLossIdempotent(t *testing.T) {
	clock := &fakeClock{now: time.Unix(180, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("prepare-permit")); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	next := cloneState(store.state)
	operation := next.Operations["op-a"]
	operation.State = gatewayprotocol.RuntimeOperationManualRecoveryRequired
	next.Operations[operation.OperationID] = operation
	next.Quarantined[operation.LifecycleTargetID] = operation.OperationID
	if err := store.saveLocked(next); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()

	if _, err := store.Reconcile(context.Background(), "op-a", Access{
		ClientKeyID: "replacement-admin-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManageBinding},
	}); err == nil {
		t.Fatal("Reconcile() accepted binding permission without an exact recovery permit")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}

	access := Access{
		ClientKeyID: "replacement-admin-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManageBinding},
		PermitJTI:   "reconcile-permit",
	}
	reconciled, err := store.Reconcile(context.Background(), "op-a", access)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.State != gatewayprotocol.RuntimeOperationFailed || controller.reconciliations != 1 {
		t.Fatalf("reconciled operation = %#v, calls = %d", reconciled, controller.reconciliations)
	}
	replayed, err := store.Reconcile(context.Background(), "op-a", access)
	if err != nil || replayed.State != gatewayprotocol.RuntimeOperationFailed || controller.reconciliations != 1 {
		t.Fatalf("reconcile response-loss replay = %#v, %v, calls = %d", replayed, err, controller.reconciliations)
	}
	if store.state.PermitUses[digestOptional(access.PermitJTI)] != "op-a" {
		t.Fatal("reconcile permit consumption was not persisted")
	}
}

func TestCancelRequiresOriginalAuthorizedClient(t *testing.T) {
	clock := &fakeClock{now: time.Unix(190, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Cancel(context.Background(), "op-a", Access{
		ClientKeyID: "replacement-admin-client",
		Grants:      []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManageBinding},
	}); err == nil {
		t.Fatal("Cancel() accepted a binding administrator that did not authorize the operation")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	if _, err := store.Cancel(context.Background(), "op-a", Access{ClientKeyID: "client-a"}); err != nil {
		t.Fatalf("Cancel() original client error = %v", err)
	}
}

func TestOperationPersistsAndCommitRequiresExactConfirmedFence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(200, 0)}
	controller := &fakeController{snapshot: knownSnapshot(4, "session:a"), fenced: knownSnapshot(5, "session:b"), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a"))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	_, err = store.Confirm(context.Background(), "op-a", "client-a", gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion:        gatewayprotocol.Version,
		SnapshotRevision:       snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest,
		WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest:      "sha256:risk",
	})
	if err != nil {
		t.Fatal(err)
	}
	artifact := []byte("signed runtime artifact")
	metadata := gatewayprotocol.RuntimeArtifactMetadata{SizeBytes: int64(len(artifact)), ArchiveSHA256: SHA256Digest(artifact), ExecutableSHA256: SHA256Digest([]byte("runtime executable")), ManifestJSON: []byte(`{"release":"v0.11.0"}`)}
	if _, err := store.StageArtifact(context.Background(), "op-a", "client-a", metadata, bytes.NewReader(artifact)); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := reopened.Commit(context.Background(), "op-a", "client-a")
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationConfirmationRequired || controller.released != 1 || controller.commits != 0 {
		t.Fatalf("commit result = %#v released=%d commits=%d", operation, controller.released, controller.commits)
	}
}

func TestStagedArtifactPathPersistsPrivatelyAcrossRestart(t *testing.T) {
	clock := &fakeClock{now: time.Unix(250, 0)}
	controller := &fakeController{snapshot: knownSnapshot(4), fenced: knownSnapshot(4), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a"))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	if _, err := store.Confirm(context.Background(), "op-a", "client-a", gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion: gatewayprotocol.Version, SnapshotRevision: snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest, WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest: "sha256:risk",
	}); err != nil {
		t.Fatal(err)
	}
	artifact := []byte("signed runtime artifact")
	metadata := gatewayprotocol.RuntimeArtifactMetadata{SizeBytes: int64(len(artifact)), ArchiveSHA256: SHA256Digest(artifact), ExecutableSHA256: SHA256Digest([]byte("runtime executable")), ManifestJSON: []byte(`{"release":"v0.11.0"}`)}
	staged, err := store.StageArtifact(context.Background(), "op-a", "client-a", metadata, bytes.NewReader(artifact))
	if err != nil {
		t.Fatal(err)
	}
	if staged.Artifact == nil || staged.Artifact.StagedPath != "" {
		t.Fatalf("public staged artifact leaked private path: %#v", staged.Artifact)
	}
	if staged.Artifact.ArchiveSHA256 == staged.Artifact.ExecutableSHA256 {
		t.Fatalf("archive and executable digests were collapsed: %#v", staged.Artifact)
	}

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	committed, err := restarted.Commit(context.Background(), "op-a", "client-a")
	if err != nil {
		t.Fatal(err)
	}
	if committed.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("state = %q", committed.State)
	}
	if controller.commitArtifactPath == "" {
		t.Fatal("controller did not receive the persisted staged artifact path")
	}
}

func TestOperationEventsPersistAndUseObservationAuthorization(t *testing.T) {
	clock := &fakeClock{now: time.Unix(275, 0)}
	controller := &fakeController{snapshot: knownSnapshot(4), fenced: knownSnapshot(4), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Events(context.Background(), "op-a", Access{ClientKeyID: "client-b"}); err == nil {
		t.Fatal("unprivileged client observed Runtime operation events")
	}

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	response, err := restarted.Events(context.Background(), "op-a", Access{Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Events) != 2 || response.Events[0].State != gatewayprotocol.RuntimeOperationPreflighting || response.Events[1].State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("events = %#v", response.Events)
	}
}

func TestOperationObservationHidesExistenceAndRedactsNonOriginalManager(t *testing.T) {
	clock := &fakeClock{now: time.Unix(280, 0)}
	controller := &fakeController{snapshot: knownSnapshot(4, "session:secret"), fenced: knownSnapshot(4), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	if _, err := store.Prepare(context.Background(), prepareRequest("op-secret", "idem-secret"), prepareAuthorization("permit-secret")); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), "op-secret", Access{ClientKeyID: "unprivileged"}); err == nil {
		t.Fatal("unprivileged client observed an existing operation")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	if _, err := store.Get(context.Background(), "op-missing", Access{ClientKeyID: "unprivileged"}); err == nil {
		t.Fatal("unprivileged client distinguished a missing operation")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	if _, err := store.Get(context.Background(), "op-secret", Access{ClientKeyID: "client-a"}); err == nil {
		t.Fatal("original operation client retained observation after manage_runtime was revoked")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	if _, err := store.Events(context.Background(), "op-secret", Access{ClientKeyID: "client-a"}); err == nil {
		t.Fatal("original operation client retained event access after manage_runtime was revoked")
	} else {
		assertCode(t, err, ErrorUnauthorized)
	}
	observed, err := store.Get(context.Background(), "op-secret", Access{
		ClientKeyID: "other-manager", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !observed.ObserverRedacted || observed.AuthorizedClientKeyID != "" || observed.RequestedActor.SubjectID != "" ||
		observed.DesiredRuntime.Version != "" || observed.DesiredRuntime.ArtifactPolicy != "" || observed.PrepareScopeDigest != "" ||
		observed.ExpectedSnapshot.WorkloadIdentityDigest != "" || len(observed.ExpectedSnapshot.WorkloadIdentities) != 0 || observed.Artifact != nil {
		t.Fatalf("non-original manager received private operation fields: %#v", observed)
	}
}

func TestPrecommitDeadlineSurvivesRestart(t *testing.T) {
	clock := &fakeClock{now: time.Unix(300, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}, PrecommitTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Prepare(context.Background(), prepareRequest("op-a", "idem-a"), prepareAuthorization("permit-a")); err != nil {
		t.Fatal(err)
	}
	clock.now = clock.now.Add(2 * time.Minute)
	reopened, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}, PrecommitTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.Expire(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation, err := reopened.Get(context.Background(), "op-a", Access{ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationExpired {
		t.Fatalf("state = %q", operation.State)
	}
}

func TestCommitRevalidatesTargetBeforeTakingLifecycleFence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(350, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	prepareCommitReadyOperation(t, store, "op-a")
	controller.validateErr = errors.New("target generation changed")

	_, err := store.Commit(context.Background(), "op-a", "client-a")
	assertCode(t, err, ErrorTargetChanged)
	if controller.begins != 0 || controller.commits != 0 {
		t.Fatalf("begin=%d commit=%d, want no lifecycle mutation", controller.begins, controller.commits)
	}
}

func TestRecoverPendingResumesFenceResponseLossAndCommit(t *testing.T) {
	clock := &fakeClock{now: time.Unix(400, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	prepareCommitReadyOperation(t, store, "op-a")
	persistOperationState(t, store, "op-a", gatewayprotocol.RuntimeOperationFencing)

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.RecoverPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation, err := restarted.Get(context.Background(), "op-a", Access{ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationSucceeded || controller.begins != 1 || controller.commits != 1 {
		t.Fatalf("operation=%#v begins=%d commits=%d", operation, controller.begins, controller.commits)
	}
}

func TestRecoverPendingVerifiesLostCommitResponse(t *testing.T) {
	clock := &fakeClock{now: time.Unix(450, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	prepareCommitReadyOperation(t, store, "op-a")
	persistOperationState(t, store, "op-a", gatewayprotocol.RuntimeOperationCommitting)

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.RecoverPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation, err := restarted.Get(context.Background(), "op-a", Access{ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationSucceeded || controller.reconciliations != 1 || controller.recoveries != 0 {
		t.Fatalf("operation=%#v reconciliations=%d recoveries=%d", operation, controller.reconciliations, controller.recoveries)
	}
}

func TestRecoverPendingCompletesInterruptedRecovery(t *testing.T) {
	clock := &fakeClock{now: time.Unix(500, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	prepareCommitReadyOperation(t, store, "op-a")
	persistOperationState(t, store, "op-a", gatewayprotocol.RuntimeOperationRecovering)

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.RecoverPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation, err := restarted.Get(context.Background(), "op-a", Access{ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationFailed || controller.recoveries != 1 {
		t.Fatalf("operation=%#v recoveries=%d", operation, controller.recoveries)
	}
	if _, err := restarted.Prepare(context.Background(), prepareRequest("op-b", "idem-b"), prepareAuthorization("permit-b")); err != nil {
		t.Fatalf("target lock remained after recovery: %v", err)
	}
}

func TestRecoverPendingReacquiresAndReleasesExpiredFence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(550, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	stateRoot := t.TempDir()
	store, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}, PrecommitTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	prepareCommitReadyOperation(t, store, "op-a")
	persistOperationState(t, store, "op-a", gatewayprotocol.RuntimeOperationFencing)
	clock.now = clock.now.Add(2 * time.Minute)

	restarted, err := NewStore(Options{StateRoot: stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}, PrecommitTTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.RecoverPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation, err := restarted.Get(context.Background(), "op-a", Access{ClientKeyID: "client-a", Grants: []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantManage}})
	if err != nil {
		t.Fatal(err)
	}
	if operation.State != gatewayprotocol.RuntimeOperationExpired || controller.begins != 1 || controller.released != 1 || controller.commits != 0 {
		t.Fatalf("operation=%#v begins=%d released=%d commits=%d", operation, controller.begins, controller.released, controller.commits)
	}
}

func prepareCommitReadyOperation(t *testing.T, store *Store, operationID string) {
	t.Helper()
	prepared, err := store.Prepare(context.Background(), prepareRequest(operationID, "idem-"+operationID), prepareAuthorization("permit-"+operationID))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	if _, err := store.Confirm(context.Background(), operationID, "client-a", gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion: gatewayprotocol.Version, SnapshotRevision: snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest, WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest: "sha256:risk",
	}); err != nil {
		t.Fatal(err)
	}
	artifact := []byte("signed runtime artifact")
	metadata := gatewayprotocol.RuntimeArtifactMetadata{SizeBytes: int64(len(artifact)), ArchiveSHA256: SHA256Digest(artifact), ExecutableSHA256: SHA256Digest([]byte("runtime executable")), ManifestJSON: []byte(`{"release":"v0.11.0"}`)}
	if _, err := store.StageArtifact(context.Background(), operationID, "client-a", metadata, bytes.NewReader(artifact)); err != nil {
		t.Fatal(err)
	}
}

func persistOperationState(t *testing.T, store *Store, operationID string, state gatewayprotocol.RuntimeOperationState) {
	t.Helper()
	store.mu.Lock()
	defer store.mu.Unlock()
	next := cloneState(store.state)
	operation := next.Operations[operationID]
	operation.State = state
	operation.UpdatedAtUnixMS = store.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	if err := store.saveLocked(next); err != nil {
		t.Fatal(err)
	}
}

func assertCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	var operationErr *Error
	if !errors.As(err, &operationErr) || operationErr.Code != code {
		t.Fatalf("error = %#v, want code %q", err, code)
	}
}

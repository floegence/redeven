package lifecycle

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestRuntimeOperationStoreUsesSchemaV3ForFreshState(t *testing.T) {
	store := newTestStore(t, &fakeController{}, &fakeClock{now: time.Unix(50, 0)})
	if store.state.SchemaVersion != 3 {
		t.Fatalf("schema version = %d, want 3", store.state.SchemaVersion)
	}
}

func TestRuntimeOperationStoreBlocksAutomaticStartupForLockedTarget(t *testing.T) {
	controller := &fakeController{snapshot: knownSnapshot(1)}
	store := newTestStore(t, controller, &fakeClock{now: time.Unix(51, 0)})
	request := prepareRequest("op-startup-lock", "idem-startup-lock")
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-startup-lock")); err != nil {
		t.Fatal(err)
	}
	if err := store.AssertTargetUnlocked(request.LifecycleTargetID); err == nil {
		t.Fatal("AssertTargetUnlocked() accepted a target reserved by a pending operation")
	} else {
		var lifecycleErr *Error
		if !errors.As(err, &lifecycleErr) || lifecycleErr.Code != ErrorOperationInProgress {
			t.Fatalf("AssertTargetUnlocked() error = %v", err)
		}
	}
	if err := store.AssertTargetUnlocked("another-target"); err != nil {
		t.Fatalf("AssertTargetUnlocked() rejected an unrelated target: %v", err)
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
	if reopened.state.SchemaVersion != 3 || operation.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("migrated state = version %d operation %#v", reopened.state.SchemaVersion, operation)
	}
	migrated, err := os.ReadFile(reopened.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(migrated, original) || !bytes.Contains(migrated, []byte(`"schema_version": 3`)) {
		t.Fatalf("v1 state was not atomically rewritten as v3: %s", migrated)
	}
}

func TestRuntimeOperationStoreMigratesV2UnsafeSnapshotRevision(t *testing.T) {
	clock := &fakeClock{now: time.Unix(65, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-unsafe-revision", "idem-unsafe-revision")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-unsafe-revision")); err != nil {
		t.Fatal(err)
	}

	const unsafeRevision = int64(1787104792250444000)
	const observedAtUnixMS = int64(1787104792250)
	operation := store.state.Operations[request.OperationID]
	operation.ExpectedSnapshot.SnapshotRevision = unsafeRevision
	operation.ExpectedSnapshot.ObservedAtUnixMS = observedAtUnixMS
	store.state.Operations[request.OperationID] = operation
	originalAuthorization := operation.Authorization
	originalLock := store.state.TargetLocks[operation.LifecycleTargetID]
	writeHistoricalV2State(t, store.stateRoot, store.state)

	reopened, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	migrated := reopened.state.Operations[request.OperationID]
	if reopened.state.SchemaVersion != 3 {
		t.Fatalf("schema version = %d, want 3", reopened.state.SchemaVersion)
	}
	if migrated.ExpectedSnapshot.SnapshotRevision != observedAtUnixMS {
		t.Fatalf("snapshot revision = %d, want observed timestamp %d", migrated.ExpectedSnapshot.SnapshotRevision, observedAtUnixMS)
	}
	if migrated.OperationID != operation.OperationID || migrated.State != operation.State || !reflect.DeepEqual(migrated.Authorization, originalAuthorization) {
		t.Fatalf("migration changed operation authority or state: %#v", migrated)
	}
	if reopened.state.TargetLocks[migrated.LifecycleTargetID] != originalLock {
		t.Fatalf("migration changed target lock: %#v", reopened.state.TargetLocks)
	}
}

func TestRuntimeOperationStoreV2MigrationWriteFailureLeavesStateUnchanged(t *testing.T) {
	clock := &fakeClock{now: time.Unix(66, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-v2-write-failure", "idem-v2-write-failure")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-v2-write-failure")); err != nil {
		t.Fatal(err)
	}
	operation := store.state.Operations[request.OperationID]
	operation.ExpectedSnapshot.SnapshotRevision = 1787104792250444000
	operation.ExpectedSnapshot.ObservedAtUnixMS = 1787104792250
	store.state.Operations[request.OperationID] = operation
	original := writeHistoricalV2State(t, store.stateRoot, store.state)
	if err := os.Mkdir(store.statePath+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}}); err == nil {
		t.Fatal("NewStore() succeeded when the v2 migration could not be committed")
	}
	after, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, original) {
		t.Fatal("failed v2 migration modified the original state file")
	}
}

func TestRuntimeOperationStoreRejectsUnsafeSnapshotInSchemaV3WithoutMutation(t *testing.T) {
	clock := &fakeClock{now: time.Unix(67, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1), fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-v3-unsafe", "idem-v3-unsafe")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-v3-unsafe")); err != nil {
		t.Fatal(err)
	}
	operation := store.state.Operations[request.OperationID]
	operation.ExpectedSnapshot.SnapshotRevision = 1787104792250444000
	store.state.Operations[request.OperationID] = operation
	original := writeStateSchemaVersion(t, store.stateRoot, store.state, 3)

	if _, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}}); err == nil {
		t.Fatal("NewStore() accepted an unsafe revision in schema v3")
	}
	after, err := os.ReadFile(store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, original) {
		t.Fatal("rejected schema v3 state was modified")
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
		t.Fatalf("obsolete v1 staging path remained in v3 state: %#v", reopened.state.ArtifactPaths)
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
		{name: "future", mutate: func(document map[string]any) { document["schema_version"] = float64(4) }},
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

func writeHistoricalV2State(t *testing.T, stateRoot string, state fileState) []byte {
	t.Helper()
	return writeStateSchemaVersion(t, stateRoot, state, 2)
}

func writeStateSchemaVersion(t *testing.T, stateRoot string, state fileState, schemaVersion int) []byte {
	t.Helper()
	state.SchemaVersion = schemaVersion
	raw, err := json.MarshalIndent(state, "", "  ")
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

type commitBoundaryError struct {
	cause            error
	recoveryRequired bool
}

func (e commitBoundaryError) Error() string { return e.cause.Error() }
func (e commitBoundaryError) Unwrap() error { return e.cause }
func (e commitBoundaryError) RuntimeRecoveryRequired() bool {
	return e.recoveryRequired
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
	if err != nil || prepared.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("Prepare() = %#v, %v", prepared, err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	if _, err := store.Confirm(context.Background(), request.OperationID, request.AuthorizedClientKeyID, gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion:        gatewayprotocol.Version,
		SnapshotRevision:       snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest,
		WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest:      "sha256:risk",
	}); err != nil {
		t.Fatalf("Confirm() error = %v", err)
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

func TestStopCommitConsumesFenceWithTheStoppedRuntime(t *testing.T) {
	clock := &fakeClock{now: time.Unix(226, 0)}
	controller := &fakeController{
		snapshot: knownSnapshot(4), fenced: knownSnapshot(4), token: "fence-stop",
	}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-stop", "idem-stop")
	request.Operation = gatewayprotocol.RuntimeOperationStop
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	prepared, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-stop"))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	if _, err := store.Confirm(context.Background(), request.OperationID, request.AuthorizedClientKeyID, gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion:        gatewayprotocol.Version,
		SnapshotRevision:       snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest,
		WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest:      "sha256:risk",
	}); err != nil {
		t.Fatal(err)
	}
	committed, err := store.Commit(context.Background(), request.OperationID, request.AuthorizedClientKeyID)
	if err != nil || committed.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("Stop Commit() = %#v, %v", committed, err)
	}
	if controller.released != 0 {
		t.Fatalf("Stop Commit() released a fence through the Runtime after that Runtime exited: %d", controller.released)
	}
}

func TestCommitFailureBeforeRuntimeMutationReleasesFenceWithoutRecovery(t *testing.T) {
	clock := &fakeClock{now: time.Unix(227, 0)}
	controller := &fakeController{
		snapshot: knownSnapshot(4), fenced: knownSnapshot(4), token: "fence-precommit",
		commitErr: commitBoundaryError{
			cause:            errors.New("fresh Linux Runtime artifact is missing required ReDevPlugin companions"),
			recoveryRequired: false,
		},
	}
	store := newTestStore(t, controller, clock)
	prepareCommitReadyOperation(t, store, "op-precommit-failure")

	operation, err := store.Commit(context.Background(), "op-precommit-failure", "client-a")
	assertCode(t, err, ErrorUnavailable)
	if operation.State != gatewayprotocol.RuntimeOperationFailed || operation.Failure == nil ||
		operation.Failure.Message != controller.commitErr.Error() {
		t.Fatalf("Commit() operation = %#v", operation)
	}
	if controller.recoveries != 0 {
		t.Fatalf("pre-mutation failure invoked recovery %d times", controller.recoveries)
	}
	if controller.released != 1 {
		t.Fatalf("pre-mutation failure released fence %d times, want 1", controller.released)
	}
	if _, quarantined := store.state.Quarantined[operation.LifecycleTargetID]; quarantined {
		t.Fatalf("pre-mutation failure quarantined an unchanged target: %#v", store.state.Quarantined)
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

func idleSnapshot(revision int64) gatewayprotocol.WorkloadSnapshot {
	zero := 0
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		RuntimeBinaryVersion:   "v0.10.1",
		SnapshotRevision:       revision,
		ProcessInventoryDigest: "sha256:inventory",
		WorkloadIdentityDigest: "sha256:idle",
		Impact: gatewayprotocol.WorkloadImpact{
			Knowledge:            gatewayprotocol.WorkloadKnown,
			AffectedProcessCount: &zero,
			ActiveSessionCount:   &zero,
		},
		ObservedAtUnixMS: 1,
	})
}

func TestPrepareSkipsConfirmationForKnownIdleWorkload(t *testing.T) {
	for _, operationKind := range []gatewayprotocol.RuntimeOperationKind{
		gatewayprotocol.RuntimeOperationStart,
		gatewayprotocol.RuntimeOperationStop,
		gatewayprotocol.RuntimeOperationRestart,
		gatewayprotocol.RuntimeOperationUpdate,
	} {
		t.Run(string(operationKind), func(t *testing.T) {
			controller := &fakeController{snapshot: idleSnapshot(3)}
			store := newTestStore(t, controller, &fakeClock{now: time.Unix(120, 0)})
			request := prepareRequest("op-idle-"+string(operationKind), "idem-idle-"+string(operationKind))
			request.Operation = operationKind
			if operationKind != gatewayprotocol.RuntimeOperationUpdate {
				request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
			}

			prepared, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-idle-"+string(operationKind)))
			if err != nil {
				t.Fatal(err)
			}
			if prepared.ConfirmationRequired {
				t.Fatalf("Prepare() unexpectedly required confirmation: %#v", prepared.Operation)
			}
			wantState := gatewayprotocol.RuntimeOperationCommitReady
			if operationKind == gatewayprotocol.RuntimeOperationUpdate {
				wantState = gatewayprotocol.RuntimeOperationAwaitingArtifact
			}
			if prepared.Operation.State != wantState {
				t.Fatalf("state = %q, want %q", prepared.Operation.State, wantState)
			}
		})
	}
}

func TestPrepareKeepsConfirmationWhenWorkloadImpactIsNotFullyKnown(t *testing.T) {
	zero := 0
	controller := &fakeController{snapshot: gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		SnapshotRevision:       3,
		ProcessInventoryDigest: "sha256:inventory",
		WorkloadIdentityDigest: "sha256:workload",
		Impact: gatewayprotocol.WorkloadImpact{
			Knowledge:            gatewayprotocol.WorkloadKnown,
			AffectedProcessCount: &zero,
		},
		ObservedAtUnixMS: 1,
	})}
	store := newTestStore(t, controller, &fakeClock{now: time.Unix(121, 0)})
	request := prepareRequest("op-unknown-idle", "idem-unknown-idle")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}

	prepared, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-unknown-idle"))
	if err != nil {
		t.Fatal(err)
	}
	if !prepared.ConfirmationRequired || prepared.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("Prepare() did not require confirmation for an incomplete workload snapshot: %#v", prepared.Operation)
	}
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

func TestRecoverPendingRejectsUnsafeSnapshotRevision(t *testing.T) {
	clock := &fakeClock{now: time.Unix(560, 0)}
	unsafeSnapshot := knownSnapshot(1787104792250444000)
	unsafeSnapshot.ObservedAtUnixMS = 1787104792250
	controller := &fakeController{snapshot: unsafeSnapshot, fenced: knownSnapshot(1), token: "fence-a"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-unsafe-recovery", "idem-unsafe-recovery")
	request.Operation = gatewayprotocol.RuntimeOperationStart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	controller.snapshot = knownSnapshot(1)
	if _, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-unsafe-recovery")); err != nil {
		t.Fatal(err)
	}
	persistOperationState(t, store, request.OperationID, gatewayprotocol.RuntimeOperationPreflighting)
	controller.snapshot = unsafeSnapshot

	restarted, err := NewStore(Options{StateRoot: store.stateRoot, Clock: clock, Controller: controller, ArtifactVerifier: allowArtifacts{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.RecoverPending(context.Background()); err != nil {
		t.Fatal(err)
	}
	operation := restarted.state.Operations[request.OperationID]
	if operation.State != gatewayprotocol.RuntimeOperationFailed || operation.Failure == nil || operation.Failure.Code != string(ErrorUnavailable) {
		t.Fatalf("unsafe recovery snapshot operation = %#v", operation)
	}
	if restarted.state.TargetLocks[operation.LifecycleTargetID] != "" {
		t.Fatalf("unsafe recovery snapshot retained target lock: %#v", restarted.state.TargetLocks)
	}
}

func TestCommitRejectsUnsafeFenceSnapshotAndReleasesFence(t *testing.T) {
	clock := &fakeClock{now: time.Unix(570, 0)}
	controller := &fakeController{snapshot: knownSnapshot(1, "session:a"), fenced: knownSnapshot(1, "session:a"), token: "fence-unsafe"}
	store := newTestStore(t, controller, clock)
	request := prepareRequest("op-unsafe-fence", "idem-unsafe-fence")
	request.Operation = gatewayprotocol.RuntimeOperationRestart
	request.DesiredRuntime = gatewayprotocol.DesiredRuntime{}
	prepared, err := store.Prepare(context.Background(), request, prepareAuthorization("permit-unsafe-fence"))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := prepared.Operation.ExpectedSnapshot
	if _, err := store.Confirm(context.Background(), request.OperationID, "client-a", gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion:        gatewayprotocol.Version,
		SnapshotRevision:       snapshot.SnapshotRevision,
		ProcessInventoryDigest: snapshot.ProcessInventoryDigest,
		WorkloadIdentityDigest: snapshot.WorkloadIdentityDigest,
		RiskSummaryDigest:      "sha256:risk",
	}); err != nil {
		t.Fatal(err)
	}
	controller.fenced = knownSnapshot(1787104792250444000, "session:a")
	controller.fenced.ObservedAtUnixMS = 1787104792250

	operation, err := store.Commit(context.Background(), request.OperationID, "client-a")
	if err == nil {
		t.Fatal("Commit() accepted an unsafe fence snapshot")
	}
	assertCode(t, err, ErrorUnavailable)
	if operation.State != gatewayprotocol.RuntimeOperationFailed || controller.released != 1 || controller.commits != 0 {
		t.Fatalf("operation=%#v released=%d commits=%d", operation, controller.released, controller.commits)
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
	if state.Terminal() {
		delete(next.TargetLocks, operation.LifecycleTargetID)
		delete(next.Quarantined, operation.LifecycleTargetID)
		delete(next.FenceTokens, operation.OperationID)
	}
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

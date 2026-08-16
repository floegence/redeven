package lifecycle

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/lockfile"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const (
	storeSchemaVersion      = 1
	defaultPrecommitTTL     = 30 * time.Minute
	defaultMaximumOperation = 2 * time.Hour
	defaultArtifactMaxBytes = int64(512 << 20)
)

type ErrorCode string

const (
	ErrorInvalidRequest        ErrorCode = "invalid_request"
	ErrorUnauthorized          ErrorCode = "runtime_management_denied"
	ErrorCustomBuildDenied     ErrorCode = "custom_runtime_not_allowed"
	ErrorAuthorizationConflict ErrorCode = "operation_authorization_conflict"
	ErrorPermitConsumed        ErrorCode = "authorization_permit_consumed"
	ErrorOperationInProgress   ErrorCode = "operation_in_progress"
	ErrorOperationNotFound     ErrorCode = "operation_not_found"
	ErrorOperationState        ErrorCode = "operation_state_conflict"
	ErrorConfirmationRequired  ErrorCode = "confirmation_required"
	ErrorArtifactInvalid       ErrorCode = "artifact_invalid"
	ErrorOperationExpired      ErrorCode = "operation_expired"
	ErrorTargetChanged         ErrorCode = "target_changed"
	ErrorRecoveryFailed        ErrorCode = "recovery_failed"
	ErrorUnavailable           ErrorCode = "runtime_management_unavailable"
)

type Error struct {
	Code      ErrorCode
	Message   string
	Retryable bool
}

func (e *Error) Error() string {
	if e == nil {
		return "runtime lifecycle error"
	}
	return strings.TrimSpace(e.Message)
}

type Clock interface {
	Now() time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

type LifecycleFence struct {
	Token    string
	Snapshot gatewayprotocol.WorkloadSnapshot
}

type Controller interface {
	ValidateTarget(context.Context, string, gatewayprotocol.LifecycleTarget) error
	Snapshot(context.Context, gatewayprotocol.LifecycleTarget) (gatewayprotocol.WorkloadSnapshot, error)
	BeginLifecycleFence(context.Context, string, gatewayprotocol.LifecycleTarget) (LifecycleFence, error)
	ReleaseLifecycleFence(context.Context, string) error
	Commit(context.Context, gatewayprotocol.RuntimeOperation, string) error
	Recover(context.Context, gatewayprotocol.RuntimeOperation) error
	Reconcile(context.Context, gatewayprotocol.RuntimeOperation) error
}

type ArtifactVerifier interface {
	Verify(context.Context, gatewayprotocol.RuntimeOperation, gatewayprotocol.RuntimeArtifactMetadata, string) error
}

type Authorization struct {
	Actor          gatewayprotocol.RuntimeOperationActor
	RouteBindingID string
	Grants         []gatewayprotocol.RuntimeGrant
	PermitJTI      string
}

type Access struct {
	ClientKeyID string
	Grants      []gatewayprotocol.RuntimeGrant
	PermitJTI   string
}

type Options struct {
	StateRoot        string
	Clock            Clock
	Controller       Controller
	ArtifactVerifier ArtifactVerifier
	PrecommitTTL     time.Duration
	MaximumOperation time.Duration
	ArtifactMaxBytes int64
}

type Store struct {
	mu               sync.Mutex
	stateRoot        string
	statePath        string
	stagingRoot      string
	clock            Clock
	controller       Controller
	artifactVerifier ArtifactVerifier
	precommitTTL     time.Duration
	maximumOperation time.Duration
	artifactMaxBytes int64
	state            fileState
}

type fileState struct {
	SchemaVersion int                                                `json:"schema_version"`
	Operations    map[string]gatewayprotocol.RuntimeOperation        `json:"operations"`
	ArtifactPaths map[string]string                                  `json:"artifact_paths"`
	Events        map[string][]gatewayprotocol.RuntimeOperationEvent `json:"events"`
	TargetLocks   map[string]string                                  `json:"target_locks"`
	PermitUses    map[string]string                                  `json:"permit_uses"`
	FenceTokens   map[string]string                                  `json:"fence_tokens"`
	Quarantined   map[string]string                                  `json:"quarantined_targets"`
}

func NewStore(options Options) (*Store, error) {
	root := strings.TrimSpace(options.StateRoot)
	if root == "" {
		return nil, errors.New("runtime lifecycle state root is required")
	}
	clock := options.Clock
	if clock == nil {
		clock = systemClock{}
	}
	precommitTTL := options.PrecommitTTL
	if precommitTTL <= 0 {
		precommitTTL = defaultPrecommitTTL
	}
	maximumOperation := options.MaximumOperation
	if maximumOperation <= 0 {
		maximumOperation = defaultMaximumOperation
	}
	if maximumOperation < precommitTTL {
		return nil, errors.New("maximum operation duration must not be shorter than precommit TTL")
	}
	artifactMaxBytes := options.ArtifactMaxBytes
	if artifactMaxBytes <= 0 {
		artifactMaxBytes = defaultArtifactMaxBytes
	}
	store := &Store{
		stateRoot: root, statePath: filepath.Join(root, "runtime-operations-v1.json"),
		stagingRoot: filepath.Join(root, "runtime-operation-staging"), clock: clock,
		controller: options.Controller, artifactVerifier: options.ArtifactVerifier,
		precommitTTL: precommitTTL, maximumOperation: maximumOperation, artifactMaxBytes: artifactMaxBytes,
		state: newFileState(),
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func newFileState() fileState {
	return fileState{
		SchemaVersion: storeSchemaVersion,
		Operations:    make(map[string]gatewayprotocol.RuntimeOperation),
		ArtifactPaths: make(map[string]string),
		Events:        make(map[string][]gatewayprotocol.RuntimeOperationEvent),
		TargetLocks:   make(map[string]string),
		PermitUses:    make(map[string]string),
		FenceTokens:   make(map[string]string),
		Quarantined:   make(map[string]string),
	}
}

func (s *Store) Prepare(ctx context.Context, request gatewayprotocol.RuntimeOperationPrepareRequest, authorization Authorization) (gatewayprotocol.RuntimeOperationPrepareResponse, error) {
	if s == nil || s.controller == nil {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorUnavailable, "Runtime lifecycle supervisor is unavailable.", true)
	}
	request = gatewayprotocol.NormalizeRuntimeOperationPrepareRequest(request)
	if err := gatewayprotocol.ValidateRuntimeOperationPrepareRequest(request); err != nil {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorInvalidRequest, err.Error(), false)
	}
	scopeDigest, err := gatewayprotocol.RuntimeOperationPrepareScopeDigest(request)
	if err != nil {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorInvalidRequest, err.Error(), false)
	}
	grants := normalizeGrants(authorization.Grants)
	if !hasGrant(grants, gatewayprotocol.RuntimeGrantManage) {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorUnauthorized, "Runtime management permission is required.", false)
	}
	if request.DesiredRuntime.ArtifactPolicy == gatewayprotocol.ArtifactPolicyCustomBuild && !hasGrant(grants, gatewayprotocol.RuntimeGrantCustomBuild) {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorCustomBuildDenied, "Custom Runtime deployment permission is required.", false)
	}
	permitHash := digestOptional(authorization.PermitJTI)
	s.mu.Lock()
	if existing, ok := s.state.Operations[request.OperationID]; ok {
		s.mu.Unlock()
		if existing.PrepareScopeDigest == scopeDigest && existing.AuthorizedClientKeyID == request.AuthorizedClientKeyID {
			return s.prepareResponse(existing), nil
		}
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorAuthorizationConflict, "operation_id already exists with a different authorization scope.", false)
	}
	if permitHash != "" && s.state.PermitUses[permitHash] != "" {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorPermitConsumed, "The Runtime operation authorization permit was already consumed.", false)
	}
	s.mu.Unlock()
	releaseTargetMutation, err := s.beginTargetMutation(request.LifecycleTargetID, false)
	if err != nil {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, err
	}
	defer releaseTargetMutation()
	if err := s.controller.ValidateTarget(ctx, request.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: request.LifecycleTargetID,
		TargetGeneration:  request.TargetGeneration,
	}); err != nil {
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorTargetChanged, "Runtime lifecycle target changed before authorization was consumed.", false)
	}

	now := s.clock.Now().UnixMilli()
	s.mu.Lock()
	if existing, ok := s.state.Operations[request.OperationID]; ok {
		s.mu.Unlock()
		if existing.PrepareScopeDigest == scopeDigest && existing.AuthorizedClientKeyID == request.AuthorizedClientKeyID {
			return s.prepareResponse(existing), nil
		}
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorAuthorizationConflict, "operation_id already exists with a different authorization scope.", false)
	}
	if permitHash != "" {
		if operationID := s.state.PermitUses[permitHash]; operationID != "" {
			s.mu.Unlock()
			return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorPermitConsumed, "The Runtime operation authorization permit was already consumed.", false)
		}
	}
	if operationID := s.state.Quarantined[request.LifecycleTargetID]; operationID != "" {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorRecoveryFailed, "The Runtime target is isolated pending administrator recovery.", false)
	}
	if operationID := s.state.TargetLocks[request.LifecycleTargetID]; operationID != "" {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorOperationInProgress, operationID, false)
	}
	expiresAt := s.clock.Now().Add(s.precommitTTL).UnixMilli()
	maximumExpiresAt := s.clock.Now().Add(s.maximumOperation).UnixMilli()
	operation := gatewayprotocol.RuntimeOperation{
		ProtocolVersion: gatewayprotocol.Version, OperationID: request.OperationID, IdempotencyKey: request.IdempotencyKey,
		LifecycleTargetID: request.LifecycleTargetID, TargetGeneration: request.TargetGeneration, GatewayEnvID: request.GatewayEnvID,
		Kind: request.Operation, RequestedActor: gatewayprotocol.RuntimeOperationActor{Kind: strings.TrimSpace(authorization.Actor.Kind), SubjectID: strings.TrimSpace(authorization.Actor.SubjectID)},
		RouteBindingID: strings.TrimSpace(authorization.RouteBindingID), AuthorizedClientKeyID: request.AuthorizedClientKeyID,
		DesiredRuntime: request.DesiredRuntime, BuildInputs: cloneRaw(request.BuildInputs), PrepareScopeDigest: scopeDigest,
		State: gatewayprotocol.RuntimeOperationPreflighting, ExpiresAtUnixMS: expiresAt, MaximumExpiresAtUnixMS: maximumExpiresAt,
		Authorization: gatewayprotocol.RuntimeOperationAuthorization{
			Decision: gatewayprotocol.AuthorizationAllowed, Linearized: true, Grants: grants, PermitJTIHash: permitHash,
			ScopeDigest: scopeDigest, AuthorizedAtUnixMS: now,
		},
		CreatedAtUnixMS: now, UpdatedAtUnixMS: now,
	}
	next := cloneState(s.state)
	next.Operations[operation.OperationID] = operation
	next.TargetLocks[operation.LifecycleTargetID] = operation.OperationID
	if permitHash != "" {
		next.PermitUses[permitHash] = operation.OperationID
	}
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, err
	}
	s.mu.Unlock()

	snapshot, snapshotErr := s.controller.Snapshot(ctx, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID,
		TargetGeneration:  operation.TargetGeneration,
	})
	snapshot = gatewayprotocol.NormalizeWorkloadSnapshot(snapshot)
	s.mu.Lock()
	current, ok := s.state.Operations[operation.OperationID]
	if !ok || current.State != gatewayprotocol.RuntimeOperationPreflighting {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, lifecycleError(ErrorOperationState, "Runtime operation changed during preflight.", true)
	}
	next = cloneState(s.state)
	current = next.Operations[operation.OperationID]
	current.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	if snapshotErr != nil {
		current.State = gatewayprotocol.RuntimeOperationFailed
		current.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorUnavailable), Message: "Runtime workload inspection failed.", Retryable: true}
		delete(next.TargetLocks, current.LifecycleTargetID)
	} else {
		current.ExpectedSnapshot = snapshot
		if requiresInitialConfirmation(current.Kind) {
			current.State = gatewayprotocol.RuntimeOperationAwaitingConfirmation
		} else if current.Kind == gatewayprotocol.RuntimeOperationUpdate {
			current.State = gatewayprotocol.RuntimeOperationAwaitingArtifact
		} else {
			current.State = gatewayprotocol.RuntimeOperationCommitReady
		}
	}
	next.Operations[current.OperationID] = current
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperationPrepareResponse{}, err
	}
	s.mu.Unlock()
	if snapshotErr != nil {
		return s.prepareResponse(current), lifecycleError(ErrorUnavailable, "Runtime workload inspection failed.", true)
	}
	return s.prepareResponse(current), nil
}

func (s *Store) BeginTargetMutation(lifecycleTargetID string) (func(), error) {
	return s.beginTargetMutation(lifecycleTargetID, true)
}

func (s *Store) beginTargetMutation(lifecycleTargetID string, reload bool) (func(), error) {
	if s == nil {
		return nil, lifecycleError(ErrorUnavailable, "Runtime lifecycle supervisor is unavailable.", true)
	}
	lifecycleTargetID = strings.TrimSpace(lifecycleTargetID)
	if lifecycleTargetID == "" {
		return nil, lifecycleError(ErrorInvalidRequest, "lifecycle_target_id is required.", false)
	}
	lockDigest := sha256.Sum256([]byte(lifecycleTargetID))
	lockPath := filepath.Join(s.stateRoot, "target-mutation-locks", hex.EncodeToString(lockDigest[:])+".lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		return nil, fmt.Errorf("create Runtime lifecycle target lock directory: %w", err)
	}
	mutationLock, err := lockfile.Acquire(lockPath)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			return nil, lifecycleError(ErrorOperationInProgress, "A Runtime target mutation is already in progress.", false)
		}
		return nil, fmt.Errorf("lock Runtime lifecycle target mutation: %w", err)
	}
	release := func() { _ = mutationLock.Release() }

	s.mu.Lock()
	if reload {
		state, loadErr := readStateFile(s.statePath)
		if loadErr != nil {
			s.mu.Unlock()
			release()
			return nil, loadErr
		}
		s.state = state
	}
	quarantinedBy := s.state.Quarantined[lifecycleTargetID]
	lockedBy := s.state.TargetLocks[lifecycleTargetID]
	s.mu.Unlock()
	if quarantinedBy != "" {
		release()
		return nil, lifecycleError(ErrorRecoveryFailed, "The Runtime target is isolated pending administrator recovery.", false)
	}
	if lockedBy != "" {
		release()
		return nil, lifecycleError(ErrorOperationInProgress, lockedBy, false)
	}
	return release, nil
}

func (s *Store) Get(_ context.Context, operationID string, access Access) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[strings.TrimSpace(operationID)]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if !canObserve(operation, access) {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Runtime management permission is required.", false)
	}
	return cloneOperation(operation), nil
}

func (s *Store) OperationForAuthorization(operationID string) (gatewayprotocol.RuntimeOperation, error) {
	if s == nil {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnavailable, "Runtime lifecycle supervisor is unavailable.", true)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[strings.TrimSpace(operationID)]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	return cloneOperation(operation), nil
}

func (s *Store) Events(_ context.Context, operationID string, access Access) (gatewayprotocol.RuntimeOperationEventsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operationID = strings.TrimSpace(operationID)
	operation, ok := s.state.Operations[operationID]
	if !ok {
		return gatewayprotocol.RuntimeOperationEventsResponse{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if !canObserve(operation, access) {
		return gatewayprotocol.RuntimeOperationEventsResponse{}, lifecycleError(ErrorUnauthorized, "Runtime management permission is required.", false)
	}
	events := append([]gatewayprotocol.RuntimeOperationEvent(nil), s.state.Events[operationID]...)
	if events == nil {
		events = []gatewayprotocol.RuntimeOperationEvent{}
	}
	return gatewayprotocol.RuntimeOperationEventsResponse{ProtocolVersion: gatewayprotocol.Version, OperationID: operationID, Events: events}, nil
}

func (s *Store) Confirm(_ context.Context, operationID string, clientKeyID string, request gatewayprotocol.RuntimeOperationConfirmationRequest) (gatewayprotocol.RuntimeOperation, error) {
	operationID = strings.TrimSpace(operationID)
	clientKeyID = strings.TrimSpace(clientKeyID)
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[operationID]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if operation.AuthorizedClientKeyID != clientKeyID {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Only the authorized Runtime operation client can confirm this operation.", false)
	}
	if operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation && operation.State != gatewayprotocol.RuntimeOperationConfirmationRequired {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation is not waiting for confirmation.", false)
	}
	if request.ProtocolVersion != gatewayprotocol.Version || request.SnapshotRevision != operation.ExpectedSnapshot.SnapshotRevision ||
		strings.TrimSpace(request.ProcessInventoryDigest) != operation.ExpectedSnapshot.ProcessInventoryDigest ||
		strings.TrimSpace(request.WorkloadIdentityDigest) != operation.ExpectedSnapshot.WorkloadIdentityDigest || strings.TrimSpace(request.RiskSummaryDigest) == "" {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorConfirmationRequired, "Runtime workload confirmation no longer matches the current snapshot.", false)
	}
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.ConfirmedRiskSummaryDigest = strings.TrimSpace(request.RiskSummaryDigest)
	if operation.Kind == gatewayprotocol.RuntimeOperationUpdate {
		operation.State = gatewayprotocol.RuntimeOperationAwaitingArtifact
	} else {
		operation.State = gatewayprotocol.RuntimeOperationCommitReady
	}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), nil
}

func (s *Store) StageArtifact(ctx context.Context, operationID string, clientKeyID string, metadata gatewayprotocol.RuntimeArtifactMetadata, reader io.Reader) (gatewayprotocol.RuntimeOperation, error) {
	operationID = strings.TrimSpace(operationID)
	clientKeyID = strings.TrimSpace(clientKeyID)
	if reader == nil || metadata.SizeBytes <= 0 || metadata.SizeBytes > s.artifactMaxBytes || strings.TrimSpace(metadata.SHA256) == "" || len(metadata.ManifestJSON) == 0 {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorArtifactInvalid, "Runtime artifact metadata is invalid.", false)
	}
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	if !ok {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if operation.AuthorizedClientKeyID != clientKeyID {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Only the authorized Runtime operation client can stage an artifact.", false)
	}
	if operation.State != gatewayprotocol.RuntimeOperationAwaitingArtifact {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation is not waiting for an artifact.", false)
	}
	operation.State = gatewayprotocol.RuntimeOperationStaging
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next := cloneState(s.state)
	next.Operations[operationID] = operation
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, err
	}
	s.mu.Unlock()

	artifactDir := filepath.Join(s.stagingRoot, operationID)
	if err := os.MkdirAll(artifactDir, 0o700); err != nil {
		return s.failStaging(operationID, fmt.Errorf("create artifact staging directory: %w", err))
	}
	artifactPath := filepath.Join(artifactDir, "runtime.artifact")
	temporaryPath := artifactPath + ".partial"
	file, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return s.failStaging(operationID, fmt.Errorf("open artifact staging file: %w", err))
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(reader, metadata.SizeBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written != metadata.SizeBytes {
		_ = os.Remove(temporaryPath)
		return s.failStaging(operationID, errors.New("Runtime artifact length does not match declared size"))
	}
	digest := "sha256:" + hex.EncodeToString(hash.Sum(nil))
	if digest != normalizeSHA256(metadata.SHA256) {
		_ = os.Remove(temporaryPath)
		return s.failStaging(operationID, errors.New("Runtime artifact digest does not match declared SHA-256"))
	}
	if s.artifactVerifier == nil {
		_ = os.Remove(temporaryPath)
		return s.failStaging(operationID, errors.New("Runtime artifact verifier is unavailable"))
	}
	if err := s.artifactVerifier.Verify(ctx, operation, metadata, temporaryPath); err != nil {
		_ = os.Remove(temporaryPath)
		return s.failStaging(operationID, err)
	}
	if err := os.Rename(temporaryPath, artifactPath); err != nil {
		_ = os.Remove(temporaryPath)
		return s.failStaging(operationID, fmt.Errorf("commit artifact staging file: %w", err))
	}
	manifestDigest := SHA256Digest(metadata.ManifestJSON)
	s.mu.Lock()
	defer s.mu.Unlock()
	operation = s.state.Operations[operationID]
	if operation.State != gatewayprotocol.RuntimeOperationStaging {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation changed while staging the artifact.", false)
	}
	next = cloneState(s.state)
	operation = next.Operations[operationID]
	operation.Artifact = &gatewayprotocol.RuntimeArtifact{SizeBytes: written, SHA256: digest, ManifestSHA256: manifestDigest, Policy: operation.DesiredRuntime.ArtifactPolicy}
	operation.State = gatewayprotocol.RuntimeOperationCommitReady
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	next.ArtifactPaths[operationID] = artifactPath
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), nil
}

func (s *Store) Commit(ctx context.Context, operationID string, clientKeyID string) (gatewayprotocol.RuntimeOperation, error) {
	operationID = strings.TrimSpace(operationID)
	clientKeyID = strings.TrimSpace(clientKeyID)
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	if !ok {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if operation.AuthorizedClientKeyID != clientKeyID {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Only the authorized Runtime operation client can commit this operation.", false)
	}
	if operation.State != gatewayprotocol.RuntimeOperationCommitReady {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation is not ready to commit.", false)
	}
	if operation.TargetGeneration <= 0 || s.state.TargetLocks[operation.LifecycleTargetID] != operation.OperationID {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorTargetChanged, "Runtime lifecycle target changed before commit.", false)
	}
	s.mu.Unlock()
	if err := s.controller.ValidateTarget(ctx, operation.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID,
		TargetGeneration:  operation.TargetGeneration,
	}); err != nil {
		return s.failBeforeCommit(operationID, ErrorTargetChanged, "Runtime lifecycle target changed before commit.", false)
	}

	s.mu.Lock()
	operation, ok = s.state.Operations[operationID]
	if !ok || operation.State != gatewayprotocol.RuntimeOperationCommitReady || s.state.TargetLocks[operation.LifecycleTargetID] != operation.OperationID {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation changed before commit.", false)
	}
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationFencing
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, err
	}
	s.mu.Unlock()
	return s.continueFencing(ctx, operationID, false)
}

func (s *Store) continueFencing(ctx context.Context, operationID string, recovering bool) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	if !ok || operation.State != gatewayprotocol.RuntimeOperationFencing {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation is not fencing the target.", false)
	}
	s.mu.Unlock()

	fence, err := s.controller.BeginLifecycleFence(ctx, operationID, gatewayprotocol.LifecycleTarget{LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration})
	if err != nil {
		if recovering {
			return s.enterManualRecovery(operationID, "Runtime lifecycle fence could not be recovered after Gateway restart.")
		}
		return s.failBeforeCommit(operationID, ErrorUnavailable, "Runtime lifecycle fence could not be established.", true)
	}
	fence.Token = strings.TrimSpace(fence.Token)
	fence.Snapshot = gatewayprotocol.NormalizeWorkloadSnapshot(fence.Snapshot)
	if fence.Token == "" {
		return s.failBeforeCommit(operationID, ErrorUnavailable, "Runtime lifecycle fence returned an invalid token.", true)
	}
	s.mu.Lock()
	current := s.state.Operations[operationID]
	if current.State != gatewayprotocol.RuntimeOperationFencing {
		s.mu.Unlock()
		_ = s.controller.ReleaseLifecycleFence(ctx, fence.Token)
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation changed while fencing.", false)
	}
	next := cloneState(s.state)
	next.FenceTokens[operationID] = fence.Token
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		_ = s.controller.ReleaseLifecycleFence(ctx, fence.Token)
		return gatewayprotocol.RuntimeOperation{}, err
	}
	s.mu.Unlock()

	if !snapshotWithinConfirmation(current.ExpectedSnapshot, fence.Snapshot) {
		if err := s.controller.ReleaseLifecycleFence(ctx, fence.Token); err != nil {
			return s.enterManualRecovery(operationID, "Runtime lifecycle fence could not be released after workload changed.")
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		next = cloneState(s.state)
		current = next.Operations[operationID]
		current.ExpectedSnapshot = fence.Snapshot
		current.ConfirmedRiskSummaryDigest = ""
		current.State = gatewayprotocol.RuntimeOperationConfirmationRequired
		current.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
		next.Operations[operationID] = current
		delete(next.FenceTokens, operationID)
		if err := s.saveLocked(next); err != nil {
			return gatewayprotocol.RuntimeOperation{}, err
		}
		return cloneOperation(current), nil
	}
	if err := s.controller.ValidateTarget(ctx, current.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: current.LifecycleTargetID,
		TargetGeneration:  current.TargetGeneration,
	}); err != nil {
		if releaseErr := s.controller.ReleaseLifecycleFence(ctx, fence.Token); releaseErr != nil {
			return s.enterManualRecovery(operationID, "Runtime target changed and the lifecycle fence could not be released.")
		}
		return s.failBeforeCommit(operationID, ErrorTargetChanged, "Runtime lifecycle target changed before atomic replacement.", false)
	}

	s.mu.Lock()
	next = cloneState(s.state)
	current = next.Operations[operationID]
	current.State = gatewayprotocol.RuntimeOperationCommitting
	current.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	stagedPath := next.ArtifactPaths[operationID]
	current.Checkpoint = &gatewayprotocol.RuntimeCommitCheckpoint{StagedArtifactPath: stagedPath, FenceTokenHash: digestOptional(fence.Token), CreatedAtUnixMS: s.clock.Now().UnixMilli()}
	next.Operations[operationID] = current
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		_ = s.controller.ReleaseLifecycleFence(ctx, fence.Token)
		return gatewayprotocol.RuntimeOperation{}, err
	}
	s.mu.Unlock()

	current = s.operationWithPrivateState(current)
	if err := s.controller.Commit(ctx, current, fence.Token); err != nil {
		return s.recover(ctx, current, err)
	}
	return s.markSucceeded(operationID)
}

func (s *Store) markSucceeded(operationID string) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	current, ok := next.Operations[operationID]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	current.State = gatewayprotocol.RuntimeOperationSucceeded
	current.ExpiresAtUnixMS = 0
	current.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = current
	delete(next.TargetLocks, current.LifecycleTargetID)
	delete(next.FenceTokens, operationID)
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(current), nil
}

func (s *Store) Cancel(_ context.Context, operationID string, access Access) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[strings.TrimSpace(operationID)]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if operation.AuthorizedClientKeyID != strings.TrimSpace(access.ClientKeyID) && !hasGrant(normalizeGrants(access.Grants), gatewayprotocol.RuntimeGrantManageBinding) {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Runtime operation cancellation is not authorized.", false)
	}
	if !operation.State.Cancellable() {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation can no longer be cancelled.", false)
	}
	next := cloneState(s.state)
	operation = next.Operations[operation.OperationID]
	operation.State = gatewayprotocol.RuntimeOperationCancelled
	operation.ExpiresAtUnixMS = 0
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operation.OperationID] = operation
	delete(next.TargetLocks, operation.LifecycleTargetID)
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), nil
}

func (s *Store) Renew(_ context.Context, operationID string, clientKeyID string, requestedUnixMS int64) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[strings.TrimSpace(operationID)]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if operation.AuthorizedClientKeyID != strings.TrimSpace(clientKeyID) {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Only the authorized Runtime operation client can renew this deadline.", false)
	}
	if !operation.State.Cancellable() || requestedUnixMS <= operation.ExpiresAtUnixMS || requestedUnixMS > operation.MaximumExpiresAtUnixMS {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation deadline cannot be renewed to the requested time.", false)
	}
	next := cloneState(s.state)
	operation = next.Operations[operation.OperationID]
	operation.ExpiresAtUnixMS = requestedUnixMS
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operation.OperationID] = operation
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), nil
}

func (s *Store) Reconcile(ctx context.Context, operationID string, access Access) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	operation, ok := s.state.Operations[strings.TrimSpace(operationID)]
	if !ok {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	if !hasGrant(normalizeGrants(access.Grants), gatewayprotocol.RuntimeGrantManageBinding) {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Runtime binding management permission is required.", false)
	}
	if operation.AuthorizedClientKeyID != strings.TrimSpace(access.ClientKeyID) {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorUnauthorized, "Only the authorized Runtime operation client can reconcile this operation.", false)
	}
	permitHash := digestOptional(access.PermitJTI)
	if permitHash != "" {
		if usedBy := s.state.PermitUses[permitHash]; usedBy != "" {
			s.mu.Unlock()
			if usedBy == operation.OperationID && operation.State.Terminal() {
				return cloneOperation(operation), nil
			}
			return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorPermitConsumed, "The Runtime reconcile authorization permit was already consumed.", false)
		}
	}
	if operation.State != gatewayprotocol.RuntimeOperationManualRecoveryRequired {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationState, "Runtime operation does not require manual recovery.", false)
	}
	if permitHash != "" {
		next := cloneState(s.state)
		next.PermitUses[permitHash] = operation.OperationID
		if err := s.saveLocked(next); err != nil {
			s.mu.Unlock()
			return gatewayprotocol.RuntimeOperation{}, err
		}
	}
	s.mu.Unlock()
	operation = s.operationWithPrivateState(operation)
	if err := s.controller.Reconcile(ctx, operation); err != nil {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorRecoveryFailed, "Runtime recovery did not verify a complete installation.", false)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	operation = next.Operations[operation.OperationID]
	operation.State = gatewayprotocol.RuntimeOperationFailed
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorRecoveryFailed), Message: "Runtime installation was reconciled after a failed update."}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operation.OperationID] = operation
	delete(next.Quarantined, operation.LifecycleTargetID)
	delete(next.TargetLocks, operation.LifecycleTargetID)
	delete(next.FenceTokens, operation.OperationID)
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), nil
}

func (s *Store) Expire(ctx context.Context) error {
	now := s.clock.Now().UnixMilli()
	s.mu.Lock()
	candidates := make([]gatewayprotocol.RuntimeOperation, 0)
	for _, operation := range s.state.Operations {
		if operation.ExpiresAtUnixMS > 0 && operation.ExpiresAtUnixMS <= now && (operation.State.Cancellable() || operation.State == gatewayprotocol.RuntimeOperationFencing) {
			candidates = append(candidates, operation)
		}
	}
	s.mu.Unlock()
	for _, operation := range candidates {
		if operation.State == gatewayprotocol.RuntimeOperationFencing {
			s.mu.Lock()
			token := s.state.FenceTokens[operation.OperationID]
			s.mu.Unlock()
			if token == "" {
				fence, err := s.controller.BeginLifecycleFence(ctx, operation.OperationID, gatewayprotocol.LifecycleTarget{
					LifecycleTargetID: operation.LifecycleTargetID,
					TargetGeneration:  operation.TargetGeneration,
				})
				if err != nil || strings.TrimSpace(fence.Token) == "" {
					_, _ = s.enterManualRecovery(operation.OperationID, "Expired Runtime lifecycle fence could not be recovered and released.")
					continue
				}
				token = strings.TrimSpace(fence.Token)
			}
			if err := s.controller.ReleaseLifecycleFence(ctx, token); err != nil {
				_, _ = s.enterManualRecovery(operation.OperationID, "Expired Runtime lifecycle fence could not be released.")
				continue
			}
		}
		s.mu.Lock()
		current, ok := s.state.Operations[operation.OperationID]
		if ok && current.ExpiresAtUnixMS > 0 && current.ExpiresAtUnixMS <= now && (current.State.Cancellable() || current.State == gatewayprotocol.RuntimeOperationFencing) {
			next := cloneState(s.state)
			current = next.Operations[operation.OperationID]
			current.State = gatewayprotocol.RuntimeOperationExpired
			current.ExpiresAtUnixMS = 0
			current.UpdatedAtUnixMS = now
			next.Operations[current.OperationID] = current
			delete(next.TargetLocks, current.LifecycleTargetID)
			delete(next.FenceTokens, current.OperationID)
			if err := s.saveLocked(next); err != nil {
				s.mu.Unlock()
				return err
			}
		}
		s.mu.Unlock()
	}
	return nil
}

// RecoverPending resumes the single authoritative operation state after a
// Gateway restart. It is called before the Gateway starts accepting requests.
func (s *Store) RecoverPending(ctx context.Context) error {
	if s == nil || s.controller == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := s.Expire(ctx); err != nil {
		return fmt.Errorf("expire Runtime operations during recovery: %w", err)
	}

	s.mu.Lock()
	operationIDs := make([]string, 0, len(s.state.Operations))
	for operationID, operation := range s.state.Operations {
		switch operation.State {
		case gatewayprotocol.RuntimeOperationPreflighting,
			gatewayprotocol.RuntimeOperationStaging,
			gatewayprotocol.RuntimeOperationFencing,
			gatewayprotocol.RuntimeOperationCommitting,
			gatewayprotocol.RuntimeOperationRecovering:
			operationIDs = append(operationIDs, operationID)
		}
	}
	s.mu.Unlock()
	sort.Strings(operationIDs)

	for _, operationID := range operationIDs {
		s.mu.Lock()
		operation, ok := s.state.Operations[operationID]
		s.mu.Unlock()
		if !ok {
			continue
		}
		var err error
		switch operation.State {
		case gatewayprotocol.RuntimeOperationPreflighting:
			err = s.resumePreflight(ctx, operationID)
		case gatewayprotocol.RuntimeOperationStaging:
			err = s.resetInterruptedStaging(operationID)
		case gatewayprotocol.RuntimeOperationFencing:
			_, err = s.continueFencing(ctx, operationID, true)
		case gatewayprotocol.RuntimeOperationCommitting:
			err = s.resumeCommitting(ctx, operationID)
		case gatewayprotocol.RuntimeOperationRecovering:
			err = s.resumeRecovery(ctx, operationID)
		}
		if err != nil {
			var lifecycleErr *Error
			if errors.As(err, &lifecycleErr) {
				continue
			}
			return fmt.Errorf("recover Runtime operation %s: %w", operationID, err)
		}
	}
	return nil
}

func (s *Store) resumePreflight(ctx context.Context, operationID string) error {
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	s.mu.Unlock()
	if !ok || operation.State != gatewayprotocol.RuntimeOperationPreflighting {
		return nil
	}
	snapshot, snapshotErr := s.controller.Snapshot(ctx, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID,
		TargetGeneration:  operation.TargetGeneration,
	})
	snapshot = gatewayprotocol.NormalizeWorkloadSnapshot(snapshot)
	s.mu.Lock()
	defer s.mu.Unlock()
	current, ok := s.state.Operations[operationID]
	if !ok || current.State != gatewayprotocol.RuntimeOperationPreflighting {
		return nil
	}
	next := cloneState(s.state)
	current = next.Operations[operationID]
	current.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	if snapshotErr != nil {
		current.State = gatewayprotocol.RuntimeOperationFailed
		current.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorUnavailable), Message: "Runtime workload inspection failed after Gateway restart.", Retryable: true}
		delete(next.TargetLocks, current.LifecycleTargetID)
	} else {
		current.ExpectedSnapshot = snapshot
		if requiresInitialConfirmation(current.Kind) {
			current.State = gatewayprotocol.RuntimeOperationAwaitingConfirmation
		} else if current.Kind == gatewayprotocol.RuntimeOperationUpdate {
			current.State = gatewayprotocol.RuntimeOperationAwaitingArtifact
		} else {
			current.State = gatewayprotocol.RuntimeOperationCommitReady
		}
	}
	next.Operations[operationID] = current
	return s.saveLocked(next)
}

func (s *Store) resetInterruptedStaging(operationID string) error {
	artifactDir := filepath.Join(s.stagingRoot, operationID)
	if err := os.RemoveAll(artifactDir); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[operationID]
	if !ok || operation.State != gatewayprotocol.RuntimeOperationStaging {
		return nil
	}
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationAwaitingArtifact
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorUnavailable), Message: "Artifact staging was interrupted by a Gateway restart.", Retryable: true}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	delete(next.ArtifactPaths, operationID)
	return s.saveLocked(next)
}

func (s *Store) resumeCommitting(ctx context.Context, operationID string) error {
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	if ok {
		operation = s.operationWithPrivateState(cloneOperation(operation))
	}
	s.mu.Unlock()
	if !ok || operation.State != gatewayprotocol.RuntimeOperationCommitting {
		return nil
	}
	if err := s.controller.ValidateTarget(ctx, operation.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID,
		TargetGeneration:  operation.TargetGeneration,
	}); err != nil {
		_, recoveryErr := s.enterManualRecovery(operationID, "Runtime target changed while a commit outcome was being recovered.")
		return recoveryErr
	}
	if err := s.controller.Reconcile(ctx, operation); err == nil {
		_, saveErr := s.markSucceeded(operationID)
		return saveErr
	}
	_, recoveryErr := s.recover(ctx, operation, errors.New("Gateway restarted before the Runtime commit outcome was persisted"))
	return recoveryErr
}

func (s *Store) resumeRecovery(ctx context.Context, operationID string) error {
	s.mu.Lock()
	operation, ok := s.state.Operations[operationID]
	if ok {
		operation = s.operationWithPrivateState(cloneOperation(operation))
	}
	s.mu.Unlock()
	if !ok || operation.State != gatewayprotocol.RuntimeOperationRecovering {
		return nil
	}
	if err := s.controller.Recover(ctx, operation); err != nil {
		_, recoveryErr := s.enterManualRecovery(operationID, "Runtime recovery could not verify a complete installation after Gateway restart.")
		return recoveryErr
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationFailed
	operation.ExpiresAtUnixMS = 0
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: "commit_failed", Message: "Runtime commit failed before Gateway restart; the previous installation was restored."}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	delete(next.TargetLocks, operation.LifecycleTargetID)
	delete(next.FenceTokens, operationID)
	return s.saveLocked(next)
}

func (s *Store) prepareResponse(operation gatewayprotocol.RuntimeOperation) gatewayprotocol.RuntimeOperationPrepareResponse {
	return gatewayprotocol.RuntimeOperationPrepareResponse{
		ProtocolVersion: gatewayprotocol.Version, Operation: cloneOperation(operation),
		ConfirmationRequired: operation.State == gatewayprotocol.RuntimeOperationAwaitingConfirmation || operation.State == gatewayprotocol.RuntimeOperationConfirmationRequired,
		ArtifactMaxBytes:     s.artifactMaxBytes,
	}
}

func (s *Store) failStaging(operationID string, cause error) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation, ok := s.state.Operations[operationID]
	if !ok {
		return gatewayprotocol.RuntimeOperation{}, lifecycleError(ErrorOperationNotFound, "Runtime operation was not found.", false)
	}
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationAwaitingArtifact
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorArtifactInvalid), Message: cause.Error()}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), lifecycleError(ErrorArtifactInvalid, cause.Error(), false)
}

func (s *Store) failBeforeCommit(operationID string, code ErrorCode, message string, retryable bool) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	operation := s.state.Operations[operationID]
	next := cloneState(s.state)
	operation = next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationFailed
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(code), Message: message, Retryable: retryable}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	delete(next.TargetLocks, operation.LifecycleTargetID)
	delete(next.FenceTokens, operationID)
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), lifecycleError(code, message, retryable)
}

func (s *Store) recover(ctx context.Context, operation gatewayprotocol.RuntimeOperation, commitErr error) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	next := cloneState(s.state)
	operation = next.Operations[operation.OperationID]
	operation.State = gatewayprotocol.RuntimeOperationRecovering
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: "commit_failed_recovering", Message: "Runtime update failed and recovery started."}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operation.OperationID] = operation
	if err := s.saveLocked(next); err != nil {
		s.mu.Unlock()
		return gatewayprotocol.RuntimeOperation{}, err
	}
	s.mu.Unlock()
	if err := s.controller.Recover(ctx, operation); err != nil {
		return s.enterManualRecovery(operation.OperationID, "Runtime recovery could not verify a complete installation.")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next = cloneState(s.state)
	operation = next.Operations[operation.OperationID]
	operation.State = gatewayprotocol.RuntimeOperationFailed
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: "commit_failed", Message: commitErr.Error()}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operation.OperationID] = operation
	delete(next.TargetLocks, operation.LifecycleTargetID)
	delete(next.FenceTokens, operation.OperationID)
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), lifecycleError(ErrorUnavailable, "Runtime update failed and the previous installation was restored.", false)
}

func (s *Store) enterManualRecovery(operationID string, message string) (gatewayprotocol.RuntimeOperation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	operation := next.Operations[operationID]
	operation.State = gatewayprotocol.RuntimeOperationManualRecoveryRequired
	operation.ExpiresAtUnixMS = 0
	operation.Failure = &gatewayprotocol.RuntimeOperationFailure{Code: string(ErrorRecoveryFailed), Message: message}
	operation.UpdatedAtUnixMS = s.clock.Now().UnixMilli()
	next.Operations[operationID] = operation
	next.TargetLocks[operation.LifecycleTargetID] = operationID
	next.Quarantined[operation.LifecycleTargetID] = operationID
	if err := s.saveLocked(next); err != nil {
		return gatewayprotocol.RuntimeOperation{}, err
	}
	return cloneOperation(operation), lifecycleError(ErrorRecoveryFailed, message, false)
}

func (s *Store) load() error {
	state, err := readStateFile(s.statePath)
	if err != nil {
		return err
	}
	s.state = state
	return nil
}

func readStateFile(statePath string) (fileState, error) {
	raw, err := os.ReadFile(statePath)
	if errors.Is(err, os.ErrNotExist) {
		return newFileState(), nil
	}
	if err != nil {
		return fileState{}, fmt.Errorf("read Runtime operation store: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var state fileState
	if err := decoder.Decode(&state); err != nil {
		return fileState{}, fmt.Errorf("parse Runtime operation store: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fileState{}, errors.New("Runtime operation store contains trailing data")
	}
	if state.SchemaVersion != storeSchemaVersion {
		return fileState{}, fmt.Errorf("Runtime operation store schema_version=%d is unsupported", state.SchemaVersion)
	}
	if state.Operations == nil || state.ArtifactPaths == nil || state.Events == nil || state.TargetLocks == nil || state.PermitUses == nil || state.FenceTokens == nil || state.Quarantined == nil {
		return fileState{}, errors.New("Runtime operation store shape is incomplete")
	}
	return state, nil
}

func (s *Store) saveLocked(next fileState) error {
	appendTransitionEvents(s.state, &next, s.clock.Now().UnixMilli())
	if err := os.MkdirAll(s.stateRoot, 0o700); err != nil {
		return fmt.Errorf("create Runtime operation state root: %w", err)
	}
	raw, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal Runtime operation store: %w", err)
	}
	raw = append(raw, '\n')
	temporaryPath := s.statePath + ".tmp"
	if err := os.WriteFile(temporaryPath, raw, 0o600); err != nil {
		return fmt.Errorf("write Runtime operation store: %w", err)
	}
	if err := os.Rename(temporaryPath, s.statePath); err != nil {
		return fmt.Errorf("commit Runtime operation store: %w", err)
	}
	s.state = next
	return nil
}

func appendTransitionEvents(previous fileState, next *fileState, timestampUnixMS int64) {
	if next == nil {
		return
	}
	if next.Events == nil {
		next.Events = make(map[string][]gatewayprotocol.RuntimeOperationEvent)
	}
	for operationID, operation := range next.Operations {
		prior, existed := previous.Operations[operationID]
		if existed && prior.State == operation.State {
			continue
		}
		reasonCode := ""
		if operation.Failure != nil {
			reasonCode = strings.TrimSpace(operation.Failure.Code)
		}
		events := next.Events[operationID]
		next.Events[operationID] = append(events, gatewayprotocol.RuntimeOperationEvent{
			Sequence: int64(len(events) + 1), OperationID: operation.OperationID,
			LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration,
			Operation: operation.Kind, State: operation.State, ReasonCode: reasonCode, TimestampUnixMS: timestampUnixMS,
		})
	}
}

func (s *Store) operationWithPrivateState(operation gatewayprotocol.RuntimeOperation) gatewayprotocol.RuntimeOperation {
	stagedPath := s.state.ArtifactPaths[operation.OperationID]
	if operation.Artifact != nil {
		operation.Artifact.StagedPath = stagedPath
	}
	if operation.Checkpoint != nil {
		operation.Checkpoint.StagedArtifactPath = stagedPath
	}
	return operation
}

func requiresInitialConfirmation(kind gatewayprotocol.RuntimeOperationKind) bool {
	switch kind {
	case gatewayprotocol.RuntimeOperationStop, gatewayprotocol.RuntimeOperationRestart, gatewayprotocol.RuntimeOperationUpdate:
		return true
	default:
		return false
	}
}

func snapshotWithinConfirmation(expected gatewayprotocol.WorkloadSnapshot, observed gatewayprotocol.WorkloadSnapshot) bool {
	expected = gatewayprotocol.NormalizeWorkloadSnapshot(expected)
	observed = gatewayprotocol.NormalizeWorkloadSnapshot(observed)
	if expected.Impact.Knowledge != observed.Impact.Knowledge {
		return false
	}
	if expected.Impact.Knowledge == gatewayprotocol.WorkloadUnknown {
		return expected.ProcessInventoryDigest == observed.ProcessInventoryDigest && expected.WorkloadIdentityDigest == observed.WorkloadIdentityDigest
	}
	if !expected.Impact.ProtectedWorkloadPresent && observed.Impact.ProtectedWorkloadPresent {
		return false
	}
	expectedSet := make(map[string]struct{}, len(expected.WorkloadIdentities))
	for _, identity := range expected.WorkloadIdentities {
		expectedSet[identity] = struct{}{}
	}
	for _, identity := range observed.WorkloadIdentities {
		if _, ok := expectedSet[identity]; !ok {
			return false
		}
	}
	return true
}

func canObserve(operation gatewayprotocol.RuntimeOperation, access Access) bool {
	return strings.TrimSpace(access.ClientKeyID) == operation.AuthorizedClientKeyID || hasGrant(normalizeGrants(access.Grants), gatewayprotocol.RuntimeGrantManage)
}

func normalizeGrants(values []gatewayprotocol.RuntimeGrant) []gatewayprotocol.RuntimeGrant {
	capability := gatewayprotocol.NormalizeRuntimeManagementCapability(gatewayprotocol.RuntimeManagementCapability{
		Support:       gatewayprotocol.CapabilitySupportSupported,
		Authorization: gatewayprotocol.RuntimeManagementAuthorization{State: gatewayprotocol.AuthorizationAllowed, Grants: values},
		Readiness:     gatewayprotocol.ManagementReady,
	})
	return capability.Authorization.Grants
}

func hasGrant(values []gatewayprotocol.RuntimeGrant, target gatewayprotocol.RuntimeGrant) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func lifecycleError(code ErrorCode, message string, retryable bool) *Error {
	return &Error{Code: code, Message: strings.TrimSpace(message), Retryable: retryable}
}

func digestOptional(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return SHA256Digest([]byte(value))
}

func SHA256Digest(value []byte) string {
	sum := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func normalizeSHA256(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) == 64 {
		return "sha256:" + value
	}
	return value
}

func cloneState(state fileState) fileState {
	raw, _ := json.Marshal(state)
	var out fileState
	_ = json.Unmarshal(raw, &out)
	return out
}

func cloneOperation(operation gatewayprotocol.RuntimeOperation) gatewayprotocol.RuntimeOperation {
	raw, _ := json.Marshal(operation)
	var out gatewayprotocol.RuntimeOperation
	_ = json.Unmarshal(raw, &out)
	return out
}

func cloneRaw(value json.RawMessage) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), value...)
}

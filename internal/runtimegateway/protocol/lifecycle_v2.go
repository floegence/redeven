package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var runtimeOperationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

// ValidateRuntimeOperationID keeps operation identifiers suitable for use as
// durable map keys and rejects path syntax before it can reach staging paths.
func ValidateRuntimeOperationID(value string) error {
	if value != strings.TrimSpace(value) || !runtimeOperationIDPattern.MatchString(value) {
		return errors.New("operation_id must contain 1-128 letters, digits, dot, underscore, colon, or hyphen")
	}
	return nil
}

const (
	RuntimeServiceProtocolV2    = "redeven-runtime-v2"
	RuntimeCompatibilityEpochV2 = 9
)

type RuntimeGrant string

const (
	RuntimeGrantManage        RuntimeGrant = "manage_runtime"
	RuntimeGrantCustomBuild   RuntimeGrant = "deploy_custom_runtime"
	RuntimeGrantManageBinding RuntimeGrant = "manage_runtime_binding"
)

type CapabilitySupport string

const (
	CapabilitySupportSupported   CapabilitySupport = "supported"
	CapabilitySupportUnsupported CapabilitySupport = "unsupported"
	CapabilitySupportUnknown     CapabilitySupport = "unknown"
)

type AuthorizationState string

const (
	AuthorizationAllowed AuthorizationState = "allowed"
	AuthorizationDenied  AuthorizationState = "denied"
	AuthorizationUnknown AuthorizationState = "unknown"
)

type ManagementReadiness string

const (
	ManagementReady                  ManagementReadiness = "ready"
	ManagementSetupRequired          ManagementReadiness = "setup_required"
	ManagementTemporarilyUnavailable ManagementReadiness = "temporarily_unavailable"
	ManagementReadinessUnknown       ManagementReadiness = "unknown"
)

type ManagementPresentationState string

const (
	ManagementPresentationAllowed                ManagementPresentationState = "allowed"
	ManagementPresentationDenied                 ManagementPresentationState = "denied"
	ManagementPresentationSetupRequired          ManagementPresentationState = "setup_required"
	ManagementPresentationTemporarilyUnavailable ManagementPresentationState = "temporarily_unavailable"
	ManagementPresentationUnsupported            ManagementPresentationState = "unsupported"
	ManagementPresentationUnknown                ManagementPresentationState = "unknown"
)

type RuntimeManagementAuthorization struct {
	State  AuthorizationState `json:"state"`
	Grants []RuntimeGrant     `json:"grants,omitempty"`
}

type LifecycleTarget struct {
	LifecycleTargetID string `json:"lifecycle_target_id"`
	TargetGeneration  int64  `json:"target_generation"`
}

type RuntimeManagementCompatibility struct {
	GatewayVersion         string   `json:"gateway_version,omitempty"`
	GatewayProtocol        string   `json:"gateway_protocol"`
	RuntimeBinaryVersion   string   `json:"runtime_binary_version,omitempty"`
	RuntimePlatform        string   `json:"runtime_platform"`
	RuntimeArchitecture    string   `json:"runtime_architecture"`
	RuntimeServiceProtocol string   `json:"runtime_service_protocol"`
	CompatibilityEpoch     int      `json:"compatibility_epoch"`
	Capabilities           []string `json:"capabilities"`
	RuntimeArtifactSHA256  string   `json:"runtime_artifact_sha256,omitempty"`
}

type RuntimeManagementCapability struct {
	Authorization     RuntimeManagementAuthorization  `json:"authorization"`
	Support           CapabilitySupport               `json:"support"`
	Readiness         ManagementReadiness             `json:"readiness"`
	PresentationState ManagementPresentationState     `json:"presentation_state"`
	Target            *LifecycleTarget                `json:"target,omitempty"`
	Compatibility     *RuntimeManagementCompatibility `json:"compatibility,omitempty"`
	Operations        []RuntimeOperationKind          `json:"operations,omitempty"`
	ArtifactPolicies  []ArtifactPolicy                `json:"artifact_policies,omitempty"`
	BindingActions    []string                        `json:"binding_actions,omitempty"`
	SupervisionMode   string                          `json:"supervision_mode,omitempty"`
	ReasonCode        string                          `json:"reason_code,omitempty"`
	CheckedAtUnixMS   int64                           `json:"checked_at_unix_ms"`
}

type RuntimeManagementCapabilityRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	GatewayEnvID    string `json:"gateway_env_id"`
}

func ProjectRuntimeManagementState(support CapabilitySupport, authorization AuthorizationState, readiness ManagementReadiness) ManagementPresentationState {
	switch support {
	case CapabilitySupportUnsupported:
		return ManagementPresentationUnsupported
	case CapabilitySupportUnknown:
		return ManagementPresentationUnknown
	case CapabilitySupportSupported:
	default:
		return ManagementPresentationUnknown
	}
	switch authorization {
	case AuthorizationDenied:
		return ManagementPresentationDenied
	case AuthorizationUnknown:
		return ManagementPresentationUnknown
	case AuthorizationAllowed:
	default:
		return ManagementPresentationUnknown
	}
	switch readiness {
	case ManagementReady:
		return ManagementPresentationAllowed
	case ManagementSetupRequired:
		return ManagementPresentationSetupRequired
	case ManagementTemporarilyUnavailable:
		return ManagementPresentationTemporarilyUnavailable
	default:
		return ManagementPresentationUnknown
	}
}

func NormalizeRuntimeManagementCapability(value RuntimeManagementCapability) RuntimeManagementCapability {
	value.Authorization.State = normalizeAuthorizationState(value.Authorization.State)
	value.Authorization.Grants = normalizeRuntimeGrants(value.Authorization.Grants)
	value.Support = normalizeCapabilitySupport(value.Support)
	value.Readiness = normalizeManagementReadiness(value.Readiness)
	value.ReasonCode = strings.TrimSpace(value.ReasonCode)
	value.SupervisionMode = strings.TrimSpace(value.SupervisionMode)
	value.Operations = normalizeRuntimeOperationKinds(value.Operations)
	value.ArtifactPolicies = normalizeArtifactPolicies(value.ArtifactPolicies)
	value.BindingActions = compactSorted(value.BindingActions)
	if value.CheckedAtUnixMS < 0 {
		value.CheckedAtUnixMS = 0
	}
	value.PresentationState = ProjectRuntimeManagementState(value.Support, value.Authorization.State, value.Readiness)
	if value.Support != CapabilitySupportSupported || value.Authorization.State != AuthorizationAllowed {
		value.Readiness = ManagementReadinessUnknown
		value.Target = nil
		value.Compatibility = nil
		value.Operations = nil
		value.ArtifactPolicies = nil
		value.BindingActions = nil
		value.SupervisionMode = ""
		value.PresentationState = ProjectRuntimeManagementState(value.Support, value.Authorization.State, value.Readiness)
		if value.Authorization.State != AuthorizationAllowed {
			value.Authorization.Grants = nil
		}
		return value
	}
	if value.Target != nil {
		value.Target.LifecycleTargetID = strings.TrimSpace(value.Target.LifecycleTargetID)
		if value.Target.LifecycleTargetID == "" || value.Target.TargetGeneration <= 0 {
			value.Target = nil
		}
	}
	return value
}

type RuntimeOperationKind string

const (
	RuntimeOperationStart     RuntimeOperationKind = "start"
	RuntimeOperationStop      RuntimeOperationKind = "stop"
	RuntimeOperationRestart   RuntimeOperationKind = "restart"
	RuntimeOperationUpdate    RuntimeOperationKind = "update_runtime"
	RuntimeOperationReconcile RuntimeOperationKind = "reconcile"
)

type ArtifactPolicy string

const (
	ArtifactPolicyPublishedRelease ArtifactPolicy = "published_release"
	ArtifactPolicyCustomBuild      ArtifactPolicy = "custom_build"
)

type RuntimeOperationState string

const (
	RuntimeOperationPreflighting           RuntimeOperationState = "preflighting"
	RuntimeOperationAwaitingConfirmation   RuntimeOperationState = "awaiting_confirmation"
	RuntimeOperationAwaitingArtifact       RuntimeOperationState = "awaiting_artifact"
	RuntimeOperationStaging                RuntimeOperationState = "staging"
	RuntimeOperationCommitReady            RuntimeOperationState = "commit_ready"
	RuntimeOperationConfirmationRequired   RuntimeOperationState = "confirmation_required"
	RuntimeOperationFencing                RuntimeOperationState = "fencing"
	RuntimeOperationCommitting             RuntimeOperationState = "committing"
	RuntimeOperationRecovering             RuntimeOperationState = "recovering"
	RuntimeOperationManualRecoveryRequired RuntimeOperationState = "manual_recovery_required"
	RuntimeOperationSucceeded              RuntimeOperationState = "succeeded"
	RuntimeOperationFailed                 RuntimeOperationState = "failed"
	RuntimeOperationCancelled              RuntimeOperationState = "cancelled"
	RuntimeOperationExpired                RuntimeOperationState = "expired"
)

func (state RuntimeOperationState) Terminal() bool {
	switch state {
	case RuntimeOperationSucceeded, RuntimeOperationFailed, RuntimeOperationCancelled, RuntimeOperationExpired:
		return true
	default:
		return false
	}
}

func (state RuntimeOperationState) Cancellable() bool {
	switch state {
	case RuntimeOperationPreflighting, RuntimeOperationAwaitingConfirmation, RuntimeOperationAwaitingArtifact,
		RuntimeOperationStaging, RuntimeOperationCommitReady, RuntimeOperationConfirmationRequired:
		return true
	default:
		return false
	}
}

type WorkloadKnowledge string

const (
	WorkloadKnown   WorkloadKnowledge = "known"
	WorkloadUnknown WorkloadKnowledge = "unknown"
)

type WorkloadImpact struct {
	Knowledge                WorkloadKnowledge `json:"knowledge"`
	AffectedProcessCount     *int              `json:"affected_process_count,omitempty"`
	ActiveSessionCount       *int              `json:"active_session_count,omitempty"`
	ProtectedWorkloadPresent bool              `json:"protected_workload_present"`
}

type WorkloadSnapshot struct {
	RuntimeBinaryVersion   string         `json:"runtime_binary_version,omitempty"`
	SnapshotRevision       int64          `json:"snapshot_revision"`
	ProcessInventoryDigest string         `json:"process_inventory_digest"`
	WorkloadIdentityDigest string         `json:"workload_identity_digest"`
	WorkloadIdentities     []string       `json:"workload_identities,omitempty"`
	Impact                 WorkloadImpact `json:"workload"`
	ObservedAtUnixMS       int64          `json:"observed_at_unix_ms"`
}

func NormalizeWorkloadSnapshot(snapshot WorkloadSnapshot) WorkloadSnapshot {
	snapshot.RuntimeBinaryVersion = strings.TrimSpace(snapshot.RuntimeBinaryVersion)
	snapshot.ProcessInventoryDigest = strings.TrimSpace(snapshot.ProcessInventoryDigest)
	snapshot.WorkloadIdentityDigest = strings.TrimSpace(snapshot.WorkloadIdentityDigest)
	snapshot.WorkloadIdentities = compactSorted(snapshot.WorkloadIdentities)
	if snapshot.SnapshotRevision < 0 {
		snapshot.SnapshotRevision = 0
	}
	if snapshot.ObservedAtUnixMS < 0 {
		snapshot.ObservedAtUnixMS = 0
	}
	if snapshot.Impact.Knowledge != WorkloadKnown {
		snapshot.Impact = WorkloadImpact{Knowledge: WorkloadUnknown}
		snapshot.WorkloadIdentities = nil
		if snapshot.WorkloadIdentityDigest == "" {
			snapshot.WorkloadIdentityDigest = unknownDigest
		}
		if snapshot.ProcessInventoryDigest == "" {
			snapshot.ProcessInventoryDigest = unknownDigest
		}
		return snapshot
	}
	snapshot.Impact.Knowledge = WorkloadKnown
	if snapshot.Impact.AffectedProcessCount == nil || *snapshot.Impact.AffectedProcessCount < 0 || snapshot.ProcessInventoryDigest == "" || snapshot.WorkloadIdentityDigest == "" {
		return NormalizeWorkloadSnapshot(WorkloadSnapshot{
			RuntimeBinaryVersion: snapshot.RuntimeBinaryVersion,
			SnapshotRevision:     snapshot.SnapshotRevision,
			ObservedAtUnixMS:     snapshot.ObservedAtUnixMS,
			Impact:               WorkloadImpact{Knowledge: WorkloadUnknown},
		})
	}
	if snapshot.Impact.ActiveSessionCount != nil && *snapshot.Impact.ActiveSessionCount < 0 {
		snapshot.Impact.ActiveSessionCount = nil
	}
	return snapshot
}

const unknownDigest = "unknown"

type DesiredRuntime struct {
	Version        string         `json:"version"`
	Platform       string         `json:"platform"`
	Architecture   string         `json:"architecture"`
	ArtifactPolicy ArtifactPolicy `json:"artifact_policy"`
}

type RuntimeOperationPrepareRequest struct {
	ProtocolVersion       string               `json:"protocol_version"`
	OperationID           string               `json:"operation_id"`
	AuthorizedClientKeyID string               `json:"authorized_client_key_id"`
	GatewayEnvID          string               `json:"gateway_env_id"`
	LifecycleTargetID     string               `json:"lifecycle_target_id"`
	TargetGeneration      int64                `json:"target_generation"`
	Operation             RuntimeOperationKind `json:"operation"`
	DesiredRuntime        DesiredRuntime       `json:"desired_runtime"`
	BuildInputs           json.RawMessage      `json:"build_inputs,omitempty"`
	IdempotencyKey        string               `json:"idempotency_key"`
	AuthorizationPermit   string               `json:"authorization_permit,omitempty"`
}

type RuntimeOperationAuthorization struct {
	Decision           AuthorizationState `json:"decision"`
	Linearized         bool               `json:"linearized"`
	Grants             []RuntimeGrant     `json:"grants"`
	PermitJTIHash      string             `json:"permit_jti_hash,omitempty"`
	ScopeDigest        string             `json:"scope_digest"`
	AuthorizedAtUnixMS int64              `json:"authorized_at_unix_ms"`
}

type RuntimeOperationActor struct {
	Kind      string `json:"kind"`
	SubjectID string `json:"subject_id"`
}

type RuntimeArtifact struct {
	SizeBytes        int64          `json:"size_bytes"`
	ArchiveSHA256    string         `json:"archive_sha256"`
	ExecutableSHA256 string         `json:"executable_sha256"`
	ManifestSHA256   string         `json:"manifest_sha256"`
	Policy           ArtifactPolicy `json:"policy"`
	StagedPath       string         `json:"-"`
}

type RuntimeOperationFailure struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable,omitempty"`
}

type RuntimeCommitCheckpoint struct {
	PreviousArtifactPath string `json:"previous_artifact_path,omitempty"`
	StagedArtifactPath   string `json:"-"`
	FenceTokenHash       string `json:"fence_token_hash"`
	CreatedAtUnixMS      int64  `json:"created_at_unix_ms"`
}

type RuntimeOperation struct {
	ProtocolVersion            string                        `json:"protocol_version"`
	OperationID                string                        `json:"operation_id"`
	IdempotencyKey             string                        `json:"idempotency_key"`
	LifecycleTargetID          string                        `json:"lifecycle_target_id"`
	TargetGeneration           int64                         `json:"target_generation"`
	GatewayEnvID               string                        `json:"gateway_env_id"`
	Kind                       RuntimeOperationKind          `json:"kind"`
	RequestedActor             RuntimeOperationActor         `json:"requested_actor"`
	RouteBindingID             string                        `json:"route_binding_id,omitempty"`
	AuthorizedClientKeyID      string                        `json:"authorized_client_key_id"`
	DesiredRuntime             DesiredRuntime                `json:"desired_runtime"`
	BuildInputs                json.RawMessage               `json:"build_inputs,omitempty"`
	PrepareScopeDigest         string                        `json:"prepare_scope_digest"`
	State                      RuntimeOperationState         `json:"state"`
	ExpiresAtUnixMS            int64                         `json:"expires_at_unix_ms,omitempty"`
	MaximumExpiresAtUnixMS     int64                         `json:"maximum_expires_at_unix_ms,omitempty"`
	ExpectedSnapshot           WorkloadSnapshot              `json:"expected_snapshot"`
	ConfirmedRiskSummaryDigest string                        `json:"confirmed_risk_summary_digest,omitempty"`
	Artifact                   *RuntimeArtifact              `json:"artifact,omitempty"`
	Authorization              RuntimeOperationAuthorization `json:"authorization"`
	Checkpoint                 *RuntimeCommitCheckpoint      `json:"checkpoint,omitempty"`
	Failure                    *RuntimeOperationFailure      `json:"failure,omitempty"`
	CreatedAtUnixMS            int64                         `json:"created_at_unix_ms"`
	UpdatedAtUnixMS            int64                         `json:"updated_at_unix_ms"`
	ObserverRedacted           bool                          `json:"observer_redacted,omitempty"`
}

type RuntimeOperationPrepareResponse struct {
	ProtocolVersion      string           `json:"protocol_version"`
	Operation            RuntimeOperation `json:"operation"`
	ConfirmationRequired bool             `json:"confirmation_required"`
	ArtifactMaxBytes     int64            `json:"artifact_max_bytes"`
}

type RuntimeOperationListRequest struct {
	ProtocolVersion   string `json:"protocol_version"`
	GatewayEnvID      string `json:"gateway_env_id"`
	LifecycleTargetID string `json:"lifecycle_target_id"`
	TargetGeneration  int64  `json:"target_generation"`
}

type RuntimeOperationListResponse struct {
	ProtocolVersion string             `json:"protocol_version"`
	Operations      []RuntimeOperation `json:"operations"`
}

type RuntimeOperationEvent struct {
	Sequence          int64                 `json:"sequence"`
	OperationID       string                `json:"operation_id"`
	LifecycleTargetID string                `json:"lifecycle_target_id"`
	TargetGeneration  int64                 `json:"target_generation"`
	Operation         RuntimeOperationKind  `json:"operation"`
	State             RuntimeOperationState `json:"state"`
	ReasonCode        string                `json:"reason_code,omitempty"`
	TimestampUnixMS   int64                 `json:"timestamp_unix_ms"`
}

type RuntimeOperationEventsResponse struct {
	ProtocolVersion string                  `json:"protocol_version"`
	OperationID     string                  `json:"operation_id"`
	Events          []RuntimeOperationEvent `json:"events"`
}

type RuntimeOperationConfirmationRequest struct {
	ProtocolVersion        string `json:"protocol_version"`
	SnapshotRevision       int64  `json:"snapshot_revision"`
	ProcessInventoryDigest string `json:"process_inventory_digest"`
	WorkloadIdentityDigest string `json:"workload_identity_digest"`
	RiskSummaryDigest      string `json:"risk_summary_digest"`
}

type RuntimeArtifactMetadata struct {
	SizeBytes           int64           `json:"size_bytes"`
	ArchiveSHA256       string          `json:"archive_sha256"`
	ExecutableSHA256    string          `json:"executable_sha256"`
	ManifestJSON        json.RawMessage `json:"manifest"`
	ManifestSignature   string          `json:"manifest_signature,omitempty"`
	ManifestCertificate string          `json:"manifest_certificate,omitempty"`
	BuildAttestation    json.RawMessage `json:"build_attestation,omitempty"`
}

type RuntimeOperationRenewRequest struct {
	ProtocolVersion string `json:"protocol_version"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms"`
}

type RuntimeOperationReconcileRequest struct {
	ProtocolVersion     string `json:"protocol_version"`
	AuthorizationPermit string `json:"authorization_permit,omitempty"`
}

func NormalizeRuntimeOperationPrepareRequest(req RuntimeOperationPrepareRequest) RuntimeOperationPrepareRequest {
	req.ProtocolVersion = strings.TrimSpace(req.ProtocolVersion)
	req.OperationID = strings.TrimSpace(req.OperationID)
	req.AuthorizedClientKeyID = strings.TrimSpace(req.AuthorizedClientKeyID)
	req.GatewayEnvID = strings.TrimSpace(req.GatewayEnvID)
	req.LifecycleTargetID = strings.TrimSpace(req.LifecycleTargetID)
	req.Operation = normalizeRuntimeOperationKind(req.Operation)
	req.DesiredRuntime.Version = strings.TrimSpace(req.DesiredRuntime.Version)
	req.DesiredRuntime.Platform = strings.ToLower(strings.TrimSpace(req.DesiredRuntime.Platform))
	req.DesiredRuntime.Architecture = strings.ToLower(strings.TrimSpace(req.DesiredRuntime.Architecture))
	req.DesiredRuntime.ArtifactPolicy = normalizeArtifactPolicy(req.DesiredRuntime.ArtifactPolicy)
	req.BuildInputs = compactRawJSON(req.BuildInputs)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.AuthorizationPermit = strings.TrimSpace(req.AuthorizationPermit)
	return req
}

func ValidateRuntimeOperationPrepareRequest(req RuntimeOperationPrepareRequest) error {
	req = NormalizeRuntimeOperationPrepareRequest(req)
	if req.ProtocolVersion != Version {
		return ErrUnsupportedProtocolVersion
	}
	if req.OperationID == "" || req.AuthorizedClientKeyID == "" || req.GatewayEnvID == "" || req.LifecycleTargetID == "" || req.IdempotencyKey == "" {
		return errors.New("operation_id, authorized_client_key_id, gateway_env_id, lifecycle_target_id, and idempotency_key are required")
	}
	if err := ValidateRuntimeOperationID(req.OperationID); err != nil {
		return err
	}
	if req.TargetGeneration <= 0 {
		return errors.New("target_generation must be positive")
	}
	if req.Operation == "" {
		return ErrMissingLifecycleOperation
	}
	if req.Operation == RuntimeOperationUpdate {
		if req.DesiredRuntime.Version == "" || req.DesiredRuntime.Platform == "" || req.DesiredRuntime.Architecture == "" || req.DesiredRuntime.ArtifactPolicy == "" {
			return errors.New("desired runtime version, platform, architecture, and artifact_policy are required")
		}
	}
	if req.DesiredRuntime.ArtifactPolicy == ArtifactPolicyCustomBuild && len(req.BuildInputs) == 0 {
		return errors.New("custom_build requires build_inputs")
	}
	if req.DesiredRuntime.ArtifactPolicy != ArtifactPolicyCustomBuild && len(req.BuildInputs) != 0 {
		return errors.New("build_inputs are allowed only for custom_build")
	}
	return nil
}

func RuntimeOperationPrepareScopeDigest(req RuntimeOperationPrepareRequest) (string, error) {
	req = NormalizeRuntimeOperationPrepareRequest(req)
	if err := ValidateRuntimeOperationPrepareRequest(req); err != nil {
		return "", err
	}
	scope := struct {
		ProtocolVersion       string               `json:"protocol_version"`
		OperationID           string               `json:"operation_id"`
		AuthorizedClientKeyID string               `json:"authorized_client_key_id"`
		GatewayEnvID          string               `json:"gateway_env_id"`
		LifecycleTargetID     string               `json:"lifecycle_target_id"`
		TargetGeneration      int64                `json:"target_generation"`
		Operation             RuntimeOperationKind `json:"operation"`
		DesiredRuntime        DesiredRuntime       `json:"desired_runtime"`
		BuildInputs           json.RawMessage      `json:"build_inputs,omitempty"`
		IdempotencyKey        string               `json:"idempotency_key"`
	}{
		ProtocolVersion: req.ProtocolVersion, OperationID: req.OperationID,
		AuthorizedClientKeyID: req.AuthorizedClientKeyID, GatewayEnvID: req.GatewayEnvID,
		LifecycleTargetID: req.LifecycleTargetID, TargetGeneration: req.TargetGeneration,
		Operation: req.Operation, DesiredRuntime: req.DesiredRuntime, BuildInputs: req.BuildInputs,
		IdempotencyKey: req.IdempotencyKey,
	}
	raw, err := json.Marshal(scope)
	if err != nil {
		return "", fmt.Errorf("marshal prepare scope: %w", err)
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func normalizeAuthorizationState(value AuthorizationState) AuthorizationState {
	switch value {
	case AuthorizationAllowed, AuthorizationDenied:
		return value
	default:
		return AuthorizationUnknown
	}
}

func normalizeCapabilitySupport(value CapabilitySupport) CapabilitySupport {
	switch value {
	case CapabilitySupportSupported, CapabilitySupportUnsupported:
		return value
	default:
		return CapabilitySupportUnknown
	}
}

func normalizeManagementReadiness(value ManagementReadiness) ManagementReadiness {
	switch value {
	case ManagementReady, ManagementSetupRequired, ManagementTemporarilyUnavailable:
		return value
	default:
		return ManagementReadinessUnknown
	}
}

func normalizeRuntimeGrants(values []RuntimeGrant) []RuntimeGrant {
	out := make([]RuntimeGrant, 0, len(values))
	seen := make(map[RuntimeGrant]struct{}, len(values))
	for _, value := range values {
		switch value {
		case RuntimeGrantManage, RuntimeGrantCustomBuild, RuntimeGrantManageBinding:
		default:
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func normalizeRuntimeOperationKinds(values []RuntimeOperationKind) []RuntimeOperationKind {
	out := make([]RuntimeOperationKind, 0, len(values))
	seen := make(map[RuntimeOperationKind]struct{}, len(values))
	for _, value := range values {
		value = normalizeRuntimeOperationKind(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func normalizeRuntimeOperationKind(value RuntimeOperationKind) RuntimeOperationKind {
	switch value {
	case RuntimeOperationStart, RuntimeOperationStop, RuntimeOperationRestart, RuntimeOperationUpdate, RuntimeOperationReconcile:
		return value
	default:
		return ""
	}
}

func normalizeArtifactPolicies(values []ArtifactPolicy) []ArtifactPolicy {
	out := make([]ArtifactPolicy, 0, len(values))
	seen := make(map[ArtifactPolicy]struct{}, len(values))
	for _, value := range values {
		value = normalizeArtifactPolicy(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func normalizeArtifactPolicy(value ArtifactPolicy) ArtifactPolicy {
	switch value {
	case ArtifactPolicyPublishedRelease, ArtifactPolicyCustomBuild:
		return value
	default:
		return ""
	}
}

func compactSorted(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func compactRawJSON(value json.RawMessage) json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return value
	}
	raw, err := json.Marshal(decoded)
	if err != nil {
		return value
	}
	return raw
}

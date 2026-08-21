package supervisor

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type ControllerOptions struct {
	BindingStore                  *BindingStore
	PrecompiledRuntimeManifest    string
	PrecompiledRuntimeLocalUIBind string
	StartupWait                   time.Duration
	ShutdownWait                  time.Duration
	ControlTimeout                time.Duration
	ArtifactProbeTimeout          time.Duration
}

type Controller struct {
	mu                            sync.Mutex
	startupMu                     sync.Mutex
	offlineFences                 map[string]gatewayprotocol.LifecycleTarget
	legacyFences                  map[string]gatewayprotocol.LifecycleTarget
	bindings                      *BindingStore
	precompiledRuntimeManifest    string
	precompiledRuntimeLocalUIBind string
	startupWait                   time.Duration
	shutdownWait                  time.Duration
	controlTimeout                time.Duration
	artifactProbeTimeout          time.Duration
}

type operationCheckpoint struct {
	OperationID              string                    `json:"operation_id"`
	Phase                    operationCheckpointPhase  `json:"phase"`
	ManagedRoot              string                    `json:"managed_root"`
	PreviousManagedRoot      string                    `json:"previous_managed_root,omitempty"`
	PreviousManagedPresent   bool                      `json:"previous_managed_present"`
	PreviousExecutableSHA256 string                    `json:"previous_executable_sha256,omitempty"`
	StagingRoot              string                    `json:"staging_root,omitempty"`
	RuntimeWasRunning        bool                      `json:"runtime_was_running"`
	PreviousRuntimeLegacy    bool                      `json:"previous_runtime_legacy,omitempty"`
	PreviousDesktopOwnerID   string                    `json:"previous_desktop_owner_id,omitempty"`
	Candidate                *candidateProcessIdentity `json:"candidate,omitempty"`
}

type legacyRuntimeUpgradeCandidate struct {
	status           runtimemanagement.RuntimeAttachStatus
	inventory        runtimemanagement.RuntimeProcessInventory
	executableSHA256 string
}

type runtimeCommitError struct {
	cause            error
	recoveryRequired bool
}

func (e *runtimeCommitError) Error() string { return e.cause.Error() }
func (e *runtimeCommitError) Unwrap() error { return e.cause }
func (e *runtimeCommitError) RuntimeRecoveryRequired() bool {
	return e.recoveryRequired
}

type operationCheckpointPhase string

const (
	checkpointPrepared           operationCheckpointPhase = "prepared"
	checkpointRuntimeStopped     operationCheckpointPhase = "runtime_stopped"
	checkpointArtifactActive     operationCheckpointPhase = "artifact_active"
	checkpointCandidateLaunching operationCheckpointPhase = "candidate_launching"
	checkpointCandidateStarted   operationCheckpointPhase = "candidate_started"
	checkpointVerified           operationCheckpointPhase = "verified"
	checkpointRecovering         operationCheckpointPhase = "recovering"
	checkpointRecovered          operationCheckpointPhase = "recovered"
)

type candidateProcessIdentity struct {
	PID                    int    `json:"pid"`
	ProcessStartedAtUnixMS int64  `json:"process_started_at_unix_ms"`
	ExecutablePath         string `json:"executable_path"`
	ExecutableDevice       uint64 `json:"executable_device"`
	ExecutableInode        uint64 `json:"executable_inode"`
	ExecutableSHA256       string `json:"executable_sha256"`
	RuntimeInstanceID      string `json:"runtime_instance_id,omitempty"`
}

func NewController(options ControllerOptions) (*Controller, error) {
	if options.BindingStore == nil {
		return nil, errors.New("Runtime target binding store is required")
	}
	startupWait := options.StartupWait
	if startupWait <= 0 {
		startupWait = 30 * time.Second
	}
	shutdownWait := options.ShutdownWait
	if shutdownWait <= 0 {
		shutdownWait = 15 * time.Second
	}
	controlTimeout := options.ControlTimeout
	if controlTimeout <= 0 {
		controlTimeout = 5 * time.Second
	}
	artifactProbeTimeout := options.ArtifactProbeTimeout
	if artifactProbeTimeout <= 0 {
		artifactProbeTimeout = 5 * time.Second
	}
	localUIBind, err := normalizePrecompiledRuntimeLocalUIBind(options.PrecompiledRuntimeLocalUIBind)
	if err != nil {
		return nil, err
	}
	return &Controller{
		bindings: options.BindingStore, offlineFences: make(map[string]gatewayprotocol.LifecycleTarget),
		legacyFences:                  make(map[string]gatewayprotocol.LifecycleTarget),
		precompiledRuntimeManifest:    strings.TrimSpace(options.PrecompiledRuntimeManifest),
		precompiledRuntimeLocalUIBind: localUIBind,
		startupWait:                   startupWait, shutdownWait: shutdownWait, controlTimeout: controlTimeout, artifactProbeTimeout: artifactProbeTimeout,
	}, nil
}

func normalizePrecompiledRuntimeLocalUIBind(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "127.0.0.1:0", nil
	}
	host, portText, err := net.SplitHostPort(value)
	if err != nil {
		return "", errors.New("precompiled Runtime Local UI bind is invalid")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 0 || port > 65535 {
		return "", errors.New("precompiled Runtime Local UI port is invalid")
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return "", errors.New("precompiled Runtime Local UI bind must use an exact loopback host")
	}
	return value, nil
}

func (c *Controller) ValidateTarget(_ context.Context, gatewayEnvID string, target gatewayprotocol.LifecycleTarget) error {
	return c.bindings.Validate(gatewayEnvID, target)
}

func (c *Controller) RefreshRuntimeValidation(ctx context.Context) (RuntimeValidation, error) {
	if c == nil || c.bindings == nil {
		return RuntimeValidation{}, errors.New("Runtime lifecycle controller is unavailable")
	}
	identity, err := c.controlClient().identity(ctx)
	if err != nil {
		return c.persistedOfflineRuntimeValidation(ctx)
	}
	if err := c.validateAndRecordIdentity(identity, nil); err != nil {
		return RuntimeValidation{}, err
	}
	validation := c.bindings.Binding().ValidatedRuntime
	if validation == nil {
		return RuntimeValidation{}, errors.New("Runtime validation facts were not persisted")
	}
	return *validation, nil
}

func (c *Controller) persistedOfflineRuntimeValidation(ctx context.Context) (RuntimeValidation, error) {
	snapshot, err := c.offlineSnapshot(ctx)
	if err != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
		return RuntimeValidation{}, errors.New("Runtime validation cannot be reused while the offline workload identity is unknown")
	}
	binding := c.bindings.Binding()
	validated := binding.ValidatedRuntime
	if !runtimeValidationCompatible(validated) {
		return RuntimeValidation{}, errors.New("persisted Runtime validation is unavailable or incompatible")
	}
	managedBinary := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	digest, err := fileSHA256(managedBinary)
	if err != nil || digest != normalizeSHA256(validated.ArtifactSHA256) {
		return RuntimeValidation{}, errors.New("managed Runtime executable no longer matches persisted validation")
	}
	if strings.TrimSpace(validated.ManagedSuiteSHA256) != "" {
		suiteDigest, _, suiteErr := managedRuntimeSuiteSHA256(filepath.Join(binding.RuntimeRoot, "runtime", "managed"))
		if suiteErr != nil || suiteDigest != normalizeSHA256(validated.ManagedSuiteSHA256) {
			return RuntimeValidation{}, errors.New("managed Runtime suite no longer matches persisted validation")
		}
	}
	return *validated, nil
}

func (c *Controller) RuntimeManagementCapability(ctx context.Context, gatewayEnvID string, access gatewaylifecycle.Access) (gatewayprotocol.RuntimeManagementCapability, error) {
	capability := gatewayprotocol.RuntimeManagementCapability{
		Support: gatewayprotocol.CapabilitySupportSupported,
		Authorization: gatewayprotocol.RuntimeManagementAuthorization{
			State: gatewayprotocol.AuthorizationDenied,
		},
		Readiness:       gatewayprotocol.ManagementReadinessUnknown,
		ReasonCode:      "runtime_management_permission_required",
		CheckedAtUnixMS: time.Now().UnixMilli(),
	}
	if strings.TrimSpace(gatewayEnvID) != gatewayprotocol.ReservedLocalEnvironmentID {
		capability.Support = gatewayprotocol.CapabilitySupportUnsupported
		capability.ReasonCode = "gateway_environment_not_supervised"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}
	grants := normalizeControllerGrants(access.Grants)
	if !hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManage) {
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}

	binding := c.bindings.Binding()
	capability.Authorization = gatewayprotocol.RuntimeManagementAuthorization{
		State:  gatewayprotocol.AuthorizationAllowed,
		Grants: grants,
	}
	capability.Target = &gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: binding.LifecycleTargetID,
		TargetGeneration:  binding.TargetGeneration,
	}
	capability.Compatibility = &gatewayprotocol.RuntimeManagementCompatibility{
		GatewayProtocol: gatewayprotocol.Version, RuntimePlatform: runtime.GOOS, RuntimeArchitecture: runtime.GOARCH,
		RuntimeServiceProtocol: gatewayprotocol.RuntimeServiceProtocolV2, CompatibilityEpoch: gatewayprotocol.RuntimeCompatibilityEpochV2,
		Capabilities: providerSupervisorCapabilities(),
	}
	capability.SupervisionMode = "gateway_supervisor"
	capability.ArtifactPolicies = []gatewayprotocol.ArtifactPolicy{gatewayprotocol.ArtifactPolicyPublishedRelease}
	if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantCustomBuild) {
		capability.ArtifactPolicies = append(capability.ArtifactPolicies, gatewayprotocol.ArtifactPolicyCustomBuild)
	}

	identity, err := c.controlClient().identity(ctx)
	if err == nil {
		if validationErr := c.validateAndRecordIdentity(identity, nil); validationErr != nil {
			// The running Runtime is not trusted for normal lifecycle control, but
			// an authorized update must remain available to replace and re-verify
			// an externally changed managed binary. Do not expose stop/restart
			// until a fresh artifact has passed the normal validation path.
			capability.Compatibility.RuntimeBinaryVersion = identity.RuntimeBinaryVersion
			capability.Compatibility.RuntimeArtifactSHA256 = normalizeSHA256(identity.ArtifactSHA256)
			capability.Readiness = gatewayprotocol.ManagementReady
			capability.Operations = []gatewayprotocol.RuntimeOperationKind{
				gatewayprotocol.RuntimeOperationUpdate,
			}
			if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
				capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
			}
			capability.ReasonCode = "runtime_identity_incompatible"
			return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
		}
		capability.Compatibility.RuntimeBinaryVersion = identity.RuntimeBinaryVersion
		capability.Compatibility.RuntimeArtifactSHA256 = normalizeSHA256(identity.ArtifactSHA256)
		capability.Readiness = gatewayprotocol.ManagementReady
		capability.Operations = []gatewayprotocol.RuntimeOperationKind{
			gatewayprotocol.RuntimeOperationStop,
			gatewayprotocol.RuntimeOperationRestart,
			gatewayprotocol.RuntimeOperationUpdate,
		}
		if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
			capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
		}
		capability.ReasonCode = "runtime_management_ready"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}
	if legacy, legacyErr := c.legacyRuntimeUpgradeCandidate(ctx); legacyErr == nil {
		capability.Compatibility.RuntimeBinaryVersion = strings.TrimSpace(legacy.status.RuntimeService.RuntimeVersion)
		capability.Compatibility.RuntimePlatform = runtime.GOOS
		capability.Compatibility.RuntimeArchitecture = runtime.GOARCH
		capability.Compatibility.RuntimeServiceProtocol = strings.TrimSpace(legacy.status.RuntimeService.ProtocolVersion)
		capability.Compatibility.CompatibilityEpoch = legacy.status.RuntimeService.CompatibilityEpoch
		capability.Compatibility.RuntimeArtifactSHA256 = legacy.executableSHA256
		capability.Readiness = gatewayprotocol.ManagementReady
		capability.Operations = []gatewayprotocol.RuntimeOperationKind{
			gatewayprotocol.RuntimeOperationStop,
			gatewayprotocol.RuntimeOperationRestart,
			gatewayprotocol.RuntimeOperationUpdate,
		}
		if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
			// Reconciliation is a Gateway-supervisor action. It remains available
			// for an authorized binding administrator even when the attached Runtime
			// is legacy and can only be upgraded.
			capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
		}
		capability.ReasonCode = "runtime_update_required"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}

	inventory, inventoryErr := c.runtimeProcessInventory(ctx)
	if inventoryErr != nil || inventory.Summary.Blocked != 0 {
		capability.Readiness = gatewayprotocol.ManagementTemporarilyUnavailable
		capability.ReasonCode = "runtime_supervisor_temporarily_unavailable"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}
	capability.Readiness = gatewayprotocol.ManagementReady
	capability.Operations = []gatewayprotocol.RuntimeOperationKind{
		gatewayprotocol.RuntimeOperationStop,
		gatewayprotocol.RuntimeOperationUpdate,
	}
	managedBinary := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	if c.runtimeInstalled() {
		digest, digestErr := fileSHA256(managedBinary)
		validated := binding.ValidatedRuntime
		if digestErr != nil || validated == nil || normalizeSHA256(validated.ArtifactSHA256) != digest {
			capability.Operations = []gatewayprotocol.RuntimeOperationKind{gatewayprotocol.RuntimeOperationUpdate}
			capability.ReasonCode = "runtime_identity_validation_required"
			if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
				capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
			}
			return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
		}
		capability.Compatibility.RuntimeBinaryVersion = validated.RuntimeBinaryVersion
		capability.Compatibility.RuntimePlatform = strings.ToLower(strings.TrimSpace(validated.Platform))
		capability.Compatibility.RuntimeArchitecture = strings.ToLower(strings.TrimSpace(validated.Architecture))
		capability.Compatibility.RuntimeServiceProtocol = strings.TrimSpace(validated.ServiceProtocol)
		capability.Compatibility.CompatibilityEpoch = validated.CompatibilityEpoch
		capability.Compatibility.RuntimeArtifactSHA256 = normalizeSHA256(validated.ArtifactSHA256)
		if !runtimeValidationCompatible(validated) {
			capability.ReasonCode = "runtime_identity_incompatible"
			if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
				capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
			}
			return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
		}
		if len(inventory.Instances) == 0 {
			capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationStart)
		} else {
			capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationRestart)
		}
	}
	if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantManageBinding) {
		capability.Operations = append(capability.Operations, gatewayprotocol.RuntimeOperationReconcile)
	}
	if len(inventory.Instances) > 0 {
		capability.ReasonCode = "runtime_process_recovery_required"
	} else {
		capability.ReasonCode = "runtime_management_ready"
	}
	return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
}

func normalizeControllerGrants(values []gatewayprotocol.RuntimeGrant) []gatewayprotocol.RuntimeGrant {
	seen := make(map[gatewayprotocol.RuntimeGrant]struct{}, len(values))
	grants := make([]gatewayprotocol.RuntimeGrant, 0, len(values))
	for _, value := range values {
		switch value {
		case gatewayprotocol.RuntimeGrantManage, gatewayprotocol.RuntimeGrantCustomBuild, gatewayprotocol.RuntimeGrantManageBinding:
		default:
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		grants = append(grants, value)
	}
	sort.Slice(grants, func(i, j int) bool { return grants[i] < grants[j] })
	return grants
}

func hasControllerGrant(values []gatewayprotocol.RuntimeGrant, expected gatewayprotocol.RuntimeGrant) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func (c *Controller) Snapshot(ctx context.Context, target gatewayprotocol.LifecycleTarget, operationKind gatewayprotocol.RuntimeOperationKind) (gatewayprotocol.WorkloadSnapshot, error) {
	if err := c.bindings.Validate(gatewayprotocol.ReservedLocalEnvironmentID, target); err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	client := c.controlClient()
	identity, err := client.identity(ctx)
	if err != nil {
		if legacy, legacyErr := c.legacyRuntimeUpgradeCandidate(ctx); legacyErr == nil {
			return legacyRuntimeWorkloadSnapshot(legacy), nil
		}
		return c.offlineSnapshot(ctx)
	}
	if err := c.validateAndRecordIdentity(identity, nil); err != nil {
		if operationKind == gatewayprotocol.RuntimeOperationUpdate {
			// A controlled update is the repair path for an externally changed
			// managed binary. The Runtime identity is not trusted for lifecycle
			// control, so use the host process inventory until the new artifact
			// has been installed and verified.
			inventory, inventoryErr := c.runtimeProcessInventory(ctx)
			if inventoryErr != nil || inventory.Summary.Blocked != 0 {
				if inventoryErr != nil {
					return gatewayprotocol.WorkloadSnapshot{}, inventoryErr
				}
				return gatewayprotocol.WorkloadSnapshot{}, errors.New("Runtime process inventory contains an unmanaged process")
			}
			return offlineSnapshotFromInventory(inventory), nil
		}
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	return client.snapshot(ctx)
}

func (c *Controller) BeginLifecycleFence(ctx context.Context, operationID string, operationKind gatewayprotocol.RuntimeOperationKind, target gatewayprotocol.LifecycleTarget) (gatewaylifecycle.LifecycleFence, error) {
	if err := c.bindings.Validate(gatewayprotocol.ReservedLocalEnvironmentID, target); err != nil {
		return gatewaylifecycle.LifecycleFence{}, err
	}
	identity, err := c.controlClient().identity(ctx)
	if err != nil {
		if legacy, legacyErr := c.legacyRuntimeUpgradeCandidate(ctx); legacyErr == nil {
			tokenBytes := make([]byte, 24)
			if _, err := rand.Read(tokenBytes); err != nil {
				return gatewaylifecycle.LifecycleFence{}, err
			}
			token := "gwlf_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
			c.mu.Lock()
			c.legacyFences[token] = target
			c.mu.Unlock()
			return gatewaylifecycle.LifecycleFence{Token: token, Snapshot: legacyRuntimeWorkloadSnapshot(legacy)}, nil
		}
		inventory, inventoryErr := c.runtimeProcessInventory(ctx)
		if inventoryErr != nil || inventory.Summary.Blocked != 0 {
			return gatewaylifecycle.LifecycleFence{}, errors.New("Runtime is not reachable and the supervisor cannot prove that the target has no active Runtime workload")
		}
		snapshot := offlineSnapshotFromInventory(inventory)
		tokenBytes := make([]byte, 24)
		if _, err := rand.Read(tokenBytes); err != nil {
			return gatewaylifecycle.LifecycleFence{}, err
		}
		token := "gwof_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
		c.mu.Lock()
		c.offlineFences[token] = target
		c.mu.Unlock()
		return gatewaylifecycle.LifecycleFence{Token: token, Snapshot: snapshot}, nil
	}
	if err := c.validateAndRecordIdentity(identity, nil); err != nil {
		if operationKind != gatewayprotocol.RuntimeOperationUpdate {
			return gatewaylifecycle.LifecycleFence{}, err
		}
		inventory, inventoryErr := c.runtimeProcessInventory(ctx)
		if inventoryErr != nil {
			return gatewaylifecycle.LifecycleFence{}, inventoryErr
		}
		if inventory.Summary.Blocked != 0 {
			return gatewaylifecycle.LifecycleFence{}, errors.New("Runtime process inventory contains an unmanaged process")
		}
		tokenBytes := make([]byte, 24)
		if _, err := rand.Read(tokenBytes); err != nil {
			return gatewaylifecycle.LifecycleFence{}, err
		}
		token := "gwof_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
		c.mu.Lock()
		c.offlineFences[token] = target
		c.mu.Unlock()
		return gatewaylifecycle.LifecycleFence{Token: token, Snapshot: offlineSnapshotFromInventory(inventory)}, nil
	}
	return c.controlClient().beginFence(ctx, operationID, target.TargetGeneration)
}

func (c *Controller) ReleaseLifecycleFence(ctx context.Context, token string) error {
	if strings.HasPrefix(strings.TrimSpace(token), "gwlf_") {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, ok := c.legacyFences[strings.TrimSpace(token)]; !ok {
			// Legacy fences are Gateway-local coordination records. After a Gateway
			// restart, absence means there is no live Runtime fence left to release.
			return nil
		}
		delete(c.legacyFences, strings.TrimSpace(token))
		return nil
	}
	if strings.HasPrefix(strings.TrimSpace(token), "gwof_") {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, ok := c.offlineFences[strings.TrimSpace(token)]; !ok {
			return errors.New("offline Runtime lifecycle fence is stale")
		}
		delete(c.offlineFences, strings.TrimSpace(token))
		return nil
	}
	return c.controlClient().releaseFence(ctx, token)
}

func (c *Controller) Commit(ctx context.Context, operation gatewayprotocol.RuntimeOperation, fenceToken string) (commitErr error) {
	recoveryRequired := false
	stagingRoot := ""
	defer func() {
		if commitErr == nil {
			return
		}
		if !recoveryRequired && stagingRoot != "" {
			if cleanupErr := durableRemoveAll(stagingRoot); cleanupErr != nil {
				commitErr = errors.Join(commitErr, fmt.Errorf("clean rejected Runtime staging: %w", cleanupErr))
			}
		}
		commitErr = &runtimeCommitError{cause: commitErr, recoveryRequired: recoveryRequired}
	}()
	if err := c.bindings.Validate(operation.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration,
	}); err != nil {
		return err
	}
	binding := c.bindings.Binding()
	legacyFence := strings.HasPrefix(strings.TrimSpace(fenceToken), "gwlf_")
	offlineFence := strings.HasPrefix(strings.TrimSpace(fenceToken), "gwof_")
	if legacyFence {
		if operation.Kind != gatewayprotocol.RuntimeOperationStart &&
			operation.Kind != gatewayprotocol.RuntimeOperationStop &&
			operation.Kind != gatewayprotocol.RuntimeOperationRestart &&
			operation.Kind != gatewayprotocol.RuntimeOperationUpdate {
			return errors.New("legacy Runtime lifecycle fences support start, stop, restart, and update only")
		}
		c.mu.Lock()
		fencedTarget, ok := c.legacyFences[strings.TrimSpace(fenceToken)]
		c.mu.Unlock()
		if !ok || fencedTarget.LifecycleTargetID != operation.LifecycleTargetID || fencedTarget.TargetGeneration != operation.TargetGeneration {
			return errors.New("legacy Runtime lifecycle fence is stale")
		}
	}
	checkpoint := operationCheckpoint{
		OperationID:       operation.OperationID,
		Phase:             checkpointPrepared,
		ManagedRoot:       filepath.Join(binding.RuntimeRoot, "runtime", "managed"),
		RuntimeWasRunning: c.runtimeStatusPresent(), PreviousRuntimeLegacy: legacyFence,
	}
	if legacyFence {
		legacy, err := c.legacyRuntimeUpgradeCandidate(ctx)
		if err != nil {
			return err
		}
		checkpoint.PreviousDesktopOwnerID = strings.TrimSpace(legacy.status.Identity.DesktopOwnerID)
		checkpoint.PreviousExecutableSHA256 = legacy.executableSHA256
		checkpoint.PreviousManagedPresent = true
		checkpoint.RuntimeWasRunning = true
	}
	if offlineFence {
		c.mu.Lock()
		fencedTarget, ok := c.offlineFences[strings.TrimSpace(fenceToken)]
		c.mu.Unlock()
		if !ok || fencedTarget.LifecycleTargetID != operation.LifecycleTargetID || fencedTarget.TargetGeneration != operation.TargetGeneration {
			return errors.New("offline Runtime lifecycle fence is stale")
		}
		inventory, err := c.runtimeProcessInventory(ctx)
		if err != nil || inventory.Summary.Blocked != 0 ||
			(operation.Kind != gatewayprotocol.RuntimeOperationStart &&
				!offlineRuntimeSnapshotMatches(operation.ExpectedSnapshot, offlineSnapshotFromInventory(inventory))) {
			return errors.New("Runtime workload changed after the offline lifecycle fence was established")
		}
		if len(inventory.Instances) > 0 {
			if operation.Kind == gatewayprotocol.RuntimeOperationStart {
				// Start is idempotent. A process that appeared while its service
				// status was unavailable is already the target we need to open; wait
				// briefly for the status publication instead of replacing it or
				// launching a duplicate Runtime.
				if !c.waitForRuntimeReady(ctx, 5*time.Second) {
					return errors.New("Runtime is already running, but its Runtime Service status is unavailable; retry after it becomes ready or restart the Runtime")
				}
				checkpoint.RuntimeWasRunning = true
				if err := c.writeCheckpoint(checkpoint); err != nil {
					return err
				}
			} else if err := c.stopOfflineRuntimeProcesses(ctx, inventory); err != nil {
				return err
			}
		}
		if operation.Kind != gatewayprotocol.RuntimeOperationStart {
			// The offline fence has already stopped the old process. Do not call
			// its untrusted control endpoint again during update or recovery.
			checkpoint.RuntimeWasRunning = false
		}
	}
	if operation.Kind == gatewayprotocol.RuntimeOperationUpdate {
		if operation.Artifact == nil || strings.TrimSpace(operation.Artifact.StagedPath) == "" {
			return errors.New("staged Runtime artifact is unavailable")
		}
		var err error
		stagingRoot, err = c.extractRuntimeArtifact(ctx, operation)
		if err != nil {
			return err
		}
		checkpoint.StagingRoot = stagingRoot
		checkpoint.PreviousManagedRoot = checkpoint.ManagedRoot + ".previous." + safeOperationID(operation.OperationID)
		previousBinary := filepath.Join(checkpoint.ManagedRoot, "bin", "redeven")
		if digest, err := fileSHA256(previousBinary); err == nil {
			checkpoint.PreviousManagedPresent = true
			checkpoint.PreviousExecutableSHA256 = digest
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	// The complete recovery plan and verified staging root must be durable before
	// crossing the Runtime shutdown boundary.
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return err
	}
	recoveryRequired = true
	if checkpoint.RuntimeWasRunning && operation.Kind == gatewayprotocol.RuntimeOperationStart {
		if legacyFence {
			if _, err := c.legacyRuntimeUpgradeCandidate(ctx); err != nil {
				return fmt.Errorf("verify already-running legacy Runtime before start: %w", err)
			}
			checkpoint.Phase = checkpointVerified
			return c.writeCheckpoint(checkpoint)
		}
		if err := c.controlClient().health(ctx); err != nil {
			return fmt.Errorf("verify already-running Runtime before start: %w", err)
		}
		checkpoint.Phase = checkpointVerified
		return c.writeCheckpoint(checkpoint)
	}
	if checkpoint.RuntimeWasRunning {
		if legacyFence {
			if err := c.stopLegacyRuntimeForUpdate(ctx, operation.ExpectedSnapshot); err != nil {
				return err
			}
		} else if !offlineFence {
			inventory, inventoryErr := c.runtimeProcessInventory(ctx)
			if err := c.controlClient().shutdown(ctx, fenceToken); err != nil {
				return fmt.Errorf("request Runtime shutdown: %w", err)
			}
			if err := c.waitForRuntimeStopped(ctx); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if inventoryErr != nil {
					return errors.Join(err, fmt.Errorf("capture Runtime process identity before shutdown: %w", inventoryErr))
				}
				if stopErr := c.stopVerifiedRuntimeProcesses(ctx, inventory); stopErr != nil {
					return errors.Join(err, stopErr)
				}
			}
			if err := c.waitForNoRuntimeProcesses(ctx); err != nil {
				return err
			}
		}
	}
	checkpoint.Phase = checkpointRuntimeStopped
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return err
	}

	switch operation.Kind {
	case gatewayprotocol.RuntimeOperationStop:
		return nil
	case gatewayprotocol.RuntimeOperationStart, gatewayprotocol.RuntimeOperationRestart:
		if legacyFence {
			return c.startLegacyAndVerify(ctx, &checkpoint)
		}
		return c.startAndVerify(ctx, operation, &checkpoint)
	case gatewayprotocol.RuntimeOperationUpdate:
		if err := c.activateStaging(checkpoint); err != nil {
			return err
		}
		checkpoint.Phase = checkpointArtifactActive
		if err := c.writeCheckpoint(checkpoint); err != nil {
			return err
		}
		if err := c.startAndVerify(ctx, operation, &checkpoint); err != nil {
			return err
		}
		if err := durableRemoveAll(checkpoint.PreviousManagedRoot); err != nil {
			return err
		}
		return nil
	default:
		return errors.New("Runtime operation kind is unsupported by the target supervisor")
	}
}

func (c *Controller) Recover(ctx context.Context, operation gatewayprotocol.RuntimeOperation) error {
	checkpoint, err := c.readCheckpoint(operation.OperationID)
	if err != nil {
		return err
	}
	if checkpoint.Phase == checkpointRecovered {
		return c.cleanupRecoveryArtifacts(checkpoint)
	}
	if checkpoint.Phase == checkpointPrepared {
		return c.recoverPrepared(ctx, &checkpoint)
	}
	if err := c.terminateCandidate(ctx, checkpoint); err != nil {
		return err
	}
	checkpoint.Candidate = nil
	checkpoint.Phase = checkpointRecovering
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return err
	}
	if checkpoint.PreviousManagedRoot != "" {
		if !checkpoint.PreviousManagedPresent {
			if err := durableRemoveAll(checkpoint.ManagedRoot); err != nil {
				return err
			}
			if checkpoint.RuntimeWasRunning {
				return errors.New("Runtime recovery plan is inconsistent: a running Runtime had no previous managed installation")
			}
			if err := c.cleanupRecoveryArtifacts(checkpoint); err != nil {
				return err
			}
			checkpoint.Phase = checkpointRecovered
			return c.writeCheckpoint(checkpoint)
		}
		if _, previousErr := os.Stat(checkpoint.PreviousManagedRoot); previousErr == nil {
			failedRoot := checkpoint.ManagedRoot + ".failed." + safeOperationID(operation.OperationID)
			if err := durableRemoveAll(failedRoot); err != nil {
				return err
			}
			if _, managedErr := os.Stat(checkpoint.ManagedRoot); managedErr == nil {
				if err := durableRename(checkpoint.ManagedRoot, failedRoot); err != nil {
					return err
				}
			} else if !errors.Is(managedErr, os.ErrNotExist) {
				return managedErr
			}
			if err := durableRename(checkpoint.PreviousManagedRoot, checkpoint.ManagedRoot); err != nil {
				return err
			}
			if err := durableRemoveAll(failedRoot); err != nil {
				return err
			}
		} else if !errors.Is(previousErr, os.ErrNotExist) {
			return previousErr
		}
		restoredDigest, digestErr := fileSHA256(filepath.Join(checkpoint.ManagedRoot, "bin", "redeven"))
		if digestErr != nil || restoredDigest == "" || restoredDigest != normalizeSHA256(checkpoint.PreviousExecutableSHA256) {
			return errors.New("Runtime recovery cannot prove that the previous executable was restored")
		}
	}
	if checkpoint.RuntimeWasRunning {
		var startErr error
		if checkpoint.PreviousRuntimeLegacy {
			startErr = c.startLegacyAndVerify(ctx, &checkpoint)
		} else {
			startErr = c.startAndVerify(ctx, gatewayprotocol.RuntimeOperation{}, &checkpoint)
		}
		if startErr != nil {
			return startErr
		}
	}
	if err := c.cleanupRecoveryArtifacts(checkpoint); err != nil {
		return err
	}
	checkpoint.Candidate = nil
	checkpoint.Phase = checkpointRecovered
	return c.writeCheckpoint(checkpoint)
}

func (c *Controller) recoverPrepared(ctx context.Context, checkpoint *operationCheckpoint) error {
	if checkpoint.PreviousManagedPresent {
		digest, err := fileSHA256(filepath.Join(checkpoint.ManagedRoot, "bin", "redeven"))
		if err != nil || digest != normalizeSHA256(checkpoint.PreviousExecutableSHA256) {
			return errors.New("Runtime recovery cannot prove that the pre-commit executable is intact")
		}
	}
	if checkpoint.RuntimeWasRunning {
		if c.runtimeStatusPresent() {
			if checkpoint.PreviousRuntimeLegacy {
				if _, err := c.legacyRuntimeUpgradeCandidate(ctx); err != nil {
					return err
				}
				return c.finishPreparedRecovery(checkpoint)
			}
			identity, err := c.controlClient().identity(ctx)
			if err != nil {
				return err
			}
			if err := c.validateAndRecordIdentity(identity, nil); err != nil {
				return err
			}
			if err := c.controlClient().health(ctx); err != nil {
				return err
			}
		} else {
			if err := c.waitForNoRuntimeProcesses(ctx); err != nil {
				return err
			}
			var startErr error
			if checkpoint.PreviousRuntimeLegacy {
				startErr = c.startLegacyAndVerify(ctx, checkpoint)
			} else {
				startErr = c.startAndVerify(ctx, gatewayprotocol.RuntimeOperation{}, checkpoint)
			}
			if startErr != nil {
				return startErr
			}
		}
	}
	return c.finishPreparedRecovery(checkpoint)
}

func (c *Controller) Reconcile(ctx context.Context, operation gatewayprotocol.RuntimeOperation) error {
	if operation.Kind == gatewayprotocol.RuntimeOperationUpdate {
		reconciled, err := c.reconcileRestoredUpdate(ctx, operation)
		if err != nil {
			return err
		}
		if reconciled {
			return nil
		}
		// A failed legacy update may retain a checkpoint even when installation
		// never changed the running process. Verify that exact pre-update
		// workload before clearing the stale recovery state so the next update can
		// start from a clean lifecycle operation.
		legacy, legacyErr := c.legacyRuntimeUpgradeCandidate(ctx)
		if legacyErr == nil && legacyRuntimeSnapshotMatches(operation.ExpectedSnapshot, legacyRuntimeWorkloadSnapshot(legacy)) {
			return nil
		}
	}
	if operation.Kind == gatewayprotocol.RuntimeOperationStop {
		if c.runtimeStatusPresent() {
			return errors.New("Runtime is still running after the stop operation")
		}
		snapshot, err := c.offlineSnapshot(ctx)
		if err != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
			return errors.New("supervisor cannot verify that the Runtime stop operation completed")
		}
		return nil
	}
	identity, err := c.controlClient().identity(ctx)
	if err != nil {
		return err
	}
	if operation.DesiredRuntime.Version != "" && normalizeVersion(identity.RuntimeBinaryVersion) != normalizeVersion(operation.DesiredRuntime.Version) {
		return errors.New("Runtime version does not match the operation target")
	}
	if operation.Artifact != nil && normalizeSHA256(identity.ArtifactSHA256) != normalizeSHA256(operation.Artifact.ExecutableSHA256) {
		return errors.New("Runtime artifact digest does not match the operation target")
	}
	if err := c.validateAndRecordIdentity(identity, nil); err != nil {
		return err
	}
	return c.controlClient().health(ctx)
}

func (c *Controller) reconcileRestoredUpdate(
	ctx context.Context,
	operation gatewayprotocol.RuntimeOperation,
) (bool, error) {
	checkpoint, err := c.readCheckpoint(operation.OperationID)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if checkpoint.Phase != checkpointRecovering || !checkpoint.PreviousManagedPresent ||
		filepath.Clean(checkpoint.ManagedRoot) != filepath.Clean(filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed")) {
		return false, nil
	}
	inventory, err := c.runtimeProcessInventory(ctx)
	if err != nil {
		return false, err
	}
	if inventory.Summary.Blocked > 0 || len(inventory.Instances) > 0 {
		return false, errors.New("Runtime recovery cannot be reconciled while a residual process remains")
	}
	digest, err := fileSHA256(filepath.Join(checkpoint.ManagedRoot, "bin", "redeven"))
	if err != nil || normalizeSHA256(digest) != normalizeSHA256(checkpoint.PreviousExecutableSHA256) {
		return false, nil
	}
	if err := c.cleanupRecoveryArtifacts(checkpoint); err != nil {
		return false, err
	}
	checkpoint.Candidate = nil
	checkpoint.Phase = checkpointRecovered
	if err := c.writeCheckpoint(checkpoint); err != nil {
		return false, err
	}
	return true, nil
}

func (c *Controller) controlClient() runtimeControlClient {
	return runtimeControlClient{socketPath: c.bindings.Binding().RuntimeControlSocketPath, timeout: c.controlTimeout}
}

func (c *Controller) validateAndRecordIdentity(identity runtimeservice.RuntimeIdentity, provenance *RuntimeInstallationProvenance) error {
	managedRoot := filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed")
	suiteDigest, executableDigest, err := managedRuntimeSuiteSHA256(managedRoot)
	if err != nil {
		return fmt.Errorf("verify managed Runtime suite: %w", err)
	}
	if executableDigest != normalizeSHA256(identity.ArtifactSHA256) {
		return errors.New("managed Runtime executable does not match the running Runtime identity")
	}
	if provenance == nil {
		existing := c.bindings.Binding().ValidatedRuntime
		if existing == nil || normalizeSHA256(existing.ArtifactSHA256) != executableDigest ||
			normalizeSHA256(existing.ManagedSuiteSHA256) != suiteDigest || !validRuntimeInstallationProvenance(existing.InstallationProvenance) {
			return errors.New("managed Runtime installation provenance is unavailable for the running identity")
		}
		preserved := existing.InstallationProvenance
		provenance = &preserved
	}
	validation := RuntimeValidation{
		RuntimeInstanceID: identity.RuntimeInstanceID, RuntimeBinaryVersion: identity.RuntimeBinaryVersion,
		Platform: strings.ToLower(strings.TrimSpace(identity.Platform)), Architecture: strings.ToLower(strings.TrimSpace(identity.Architecture)),
		ServiceProtocol: identity.ServiceProtocol, CompatibilityEpoch: identity.CompatibilityEpoch,
		Capabilities: identity.Capabilities, ArtifactSHA256: normalizeSHA256(identity.ArtifactSHA256),
		ManagedSuiteSHA256: suiteDigest, InstallationProvenance: *provenance,
	}
	if !runtimeValidationCompatible(&validation) {
		return errors.New("Runtime identity, protocol, epoch, capabilities, or digest is incompatible with managed lifecycle")
	}
	return c.bindings.RecordRuntimeValidation(validation)
}

func runtimeOperationInstallationProvenance(operation gatewayprotocol.RuntimeOperation) *RuntimeInstallationProvenance {
	if operation.Kind != gatewayprotocol.RuntimeOperationUpdate || strings.TrimSpace(operation.OperationID) == "" {
		return nil
	}
	provenance := RuntimeInstallationProvenance{
		Kind: "verified_lifecycle_update", OperationID: strings.TrimSpace(operation.OperationID),
		OperationKind: string(operation.Kind), ArtifactPolicy: string(operation.DesiredRuntime.ArtifactPolicy),
	}
	return &provenance
}

func runtimeValidationCompatible(validation *RuntimeValidation) bool {
	if validation == nil || strings.TrimSpace(validation.RuntimeInstanceID) == "" || strings.TrimSpace(validation.Platform) == "" || strings.TrimSpace(validation.Architecture) == "" ||
		strings.TrimSpace(validation.ServiceProtocol) != gatewayprotocol.RuntimeServiceProtocolV2 || validation.CompatibilityEpoch != gatewayprotocol.RuntimeCompatibilityEpochV2 ||
		!validSHA256(validation.ArtifactSHA256) {
		return false
	}
	for _, value := range validation.Capabilities {
		if strings.TrimSpace(value) == "lifecycle_fence_v1" {
			return true
		}
	}
	return false
}

func validSHA256(value string) bool {
	value = normalizeSHA256(value)
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func (c *Controller) runtimeInstalled() bool {
	info, err := os.Stat(filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "managed", "bin", "redeven"))
	return err == nil && info.Mode().IsRegular()
}

func (c *Controller) runtimeStatusPresent() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	status, err := runtimemanagement.LoadStatus(ctx, c.bindings.Binding().RuntimeControlSocketPath, 300*time.Millisecond)
	return err == nil && status.State == runtimemanagement.AttachStateReady
}

func (c *Controller) runtimeProcessInventoryOptions() runtimemanagement.RuntimeProcessInventoryOptions {
	binding := c.bindings.Binding()
	return runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot:        binding.RuntimeRoot,
		StateRoot:          binding.RuntimeRoot,
		CurrentExecutables: []string{filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")},
	}
}

func (c *Controller) runtimeProcessInventory(ctx context.Context) (runtimemanagement.RuntimeProcessInventory, error) {
	return runtimemanagement.InspectRuntimeProcesses(ctx, c.runtimeProcessInventoryOptions())
}

func (c *Controller) legacyRuntimeUpgradeCandidate(ctx context.Context) (legacyRuntimeUpgradeCandidate, error) {
	binding := c.bindings.Binding()
	status, err := runtimemanagement.LoadStatus(ctx, binding.RuntimeControlSocketPath, c.controlTimeout)
	if err != nil {
		return legacyRuntimeUpgradeCandidate{}, err
	}
	service := status.RuntimeService
	managedBinary := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	if status.State != runtimemanagement.AttachStateReady || !status.Identity.DesktopManaged || strings.TrimSpace(status.Identity.DesktopOwnerID) == "" ||
		!isLegacyRuntimeService(service) ||
		status.Identity.PID <= 0 || filepath.Clean(status.Identity.StateRoot) != filepath.Clean(binding.RuntimeRoot) ||
		filepath.Clean(status.Identity.BinaryPath) != filepath.Clean(managedBinary) {
		return legacyRuntimeUpgradeCandidate{}, errors.New("running Runtime is not an eligible managed legacy update target")
	}
	inventory, err := runtimemanagement.InspectRuntimeProcesses(ctx, c.runtimeProcessInventoryOptions())
	if err != nil {
		return legacyRuntimeUpgradeCandidate{}, err
	}
	if len(inventory.Instances) != 1 || inventory.Summary.Automatic != 1 || inventory.Summary.Blocked != 0 {
		return legacyRuntimeUpgradeCandidate{}, errors.New("legacy Runtime process inventory is not a single verified managed process")
	}
	instance := inventory.Instances[0]
	if instance.PID != status.Identity.PID || instance.IdentityStatus != runtimemanagement.RuntimeProcessIdentityVerified ||
		instance.StopAuthority != runtimemanagement.RuntimeProcessStopAutomatic ||
		filepath.Clean(instance.ExecutablePath) != filepath.Clean(managedBinary) ||
		filepath.Clean(instance.StateRoot) != filepath.Clean(binding.RuntimeRoot) {
		return legacyRuntimeUpgradeCandidate{}, errors.New("legacy Runtime process identity does not match its management status")
	}
	executableSHA256, err := fileSHA256(managedBinary)
	if err != nil {
		return legacyRuntimeUpgradeCandidate{}, err
	}
	return legacyRuntimeUpgradeCandidate{status: status, inventory: inventory, executableSHA256: executableSHA256}, nil
}

func isLegacyRuntimeService(service runtimeservice.Snapshot) bool {
	return strings.TrimSpace(service.ProtocolVersion) != "" &&
		service.CompatibilityEpoch > 0 &&
		service.CompatibilityEpoch < gatewayprotocol.RuntimeCompatibilityEpochV2
}

func legacyRuntimeWorkloadSnapshot(candidate legacyRuntimeUpgradeCandidate) gatewayprotocol.WorkloadSnapshot {
	workload := candidate.status.RuntimeService.ActiveWorkload
	workloadDigest := digestStrings([]string{fmt.Sprintf(
		"legacy-runtime:%s:%d:%d:%d:%d:%d",
		strings.TrimSpace(candidate.status.Identity.InstanceID),
		candidate.status.Identity.PID,
		workload.TerminalCount,
		workload.SessionCount,
		workload.TaskCount,
		workload.PortForwardCount,
	)})
	now := time.Now().UnixMilli()
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		RuntimeBinaryVersion:   strings.TrimSpace(candidate.status.RuntimeService.RuntimeVersion),
		SnapshotRevision:       now,
		ProcessInventoryDigest: "sha256:" + candidate.inventory.InventoryDigest,
		WorkloadIdentityDigest: workloadDigest,
		Impact:                 gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown},
		ObservedAtUnixMS:       now,
	})
}

func legacyRuntimeSnapshotMatches(expected gatewayprotocol.WorkloadSnapshot, observed gatewayprotocol.WorkloadSnapshot) bool {
	expected = gatewayprotocol.NormalizeWorkloadSnapshot(expected)
	observed = gatewayprotocol.NormalizeWorkloadSnapshot(observed)
	return expected.Impact.Knowledge == gatewayprotocol.WorkloadUnknown &&
		observed.Impact.Knowledge == gatewayprotocol.WorkloadUnknown &&
		expected.ProcessInventoryDigest == observed.ProcessInventoryDigest &&
		expected.WorkloadIdentityDigest == observed.WorkloadIdentityDigest
}

func (c *Controller) stopLegacyRuntimeForUpdate(ctx context.Context, expected gatewayprotocol.WorkloadSnapshot) error {
	candidate, err := c.legacyRuntimeUpgradeCandidate(ctx)
	if err != nil {
		return fmt.Errorf("recheck legacy Runtime before update: %w", err)
	}
	if !legacyRuntimeSnapshotMatches(expected, legacyRuntimeWorkloadSnapshot(candidate)) {
		return errors.New("legacy Runtime workload changed after confirmation")
	}
	result, err := runtimemanagement.StopRuntimeProcesses(
		ctx,
		c.runtimeProcessInventoryOptions(),
		candidate.inventory.InventoryDigest,
		c.shutdownWait,
	)
	if err != nil {
		return fmt.Errorf("stop verified legacy Runtime process: %w", err)
	}
	if len(result.After.Instances) != 0 {
		return errors.New("legacy Runtime process remained after the update fence")
	}
	return nil
}

func (c *Controller) stopOfflineRuntimeProcesses(
	ctx context.Context,
	inventory runtimemanagement.RuntimeProcessInventory,
) error {
	if len(inventory.Instances) == 0 {
		return nil
	}
	if inventory.Summary.Blocked != 0 || inventory.Summary.Automatic != len(inventory.Instances) {
		return errors.New("Runtime process inventory contains a process that the supervisor cannot stop safely")
	}
	result, err := runtimemanagement.StopRuntimeProcesses(
		ctx,
		c.runtimeProcessInventoryOptions(),
		inventory.InventoryDigest,
		c.shutdownWait,
	)
	if err != nil {
		return fmt.Errorf("stop verified residual Runtime processes: %w", err)
	}
	if len(result.After.Instances) != 0 {
		return errors.New("verified residual Runtime processes remained after the lifecycle fence")
	}
	return nil
}

func (c *Controller) stopVerifiedRuntimeProcesses(
	ctx context.Context,
	expected runtimemanagement.RuntimeProcessInventory,
) error {
	if expected.Summary.Blocked != 0 || expected.Summary.Automatic != len(expected.Instances) || len(expected.Instances) == 0 {
		return errors.New("Runtime graceful shutdown failed and the supervisor cannot safely stop the remaining process inventory")
	}
	result, err := runtimemanagement.StopRuntimeProcesses(
		ctx,
		c.runtimeProcessInventoryOptions(),
		expected.InventoryDigest,
		c.shutdownWait,
	)
	if err != nil {
		return fmt.Errorf("stop verified Runtime processes after graceful shutdown failed: %w", err)
	}
	if len(result.After.Instances) != 0 {
		return errors.New("verified Runtime processes remained after graceful shutdown recovery")
	}
	return nil
}

func (c *Controller) startLegacyAndVerify(ctx context.Context, checkpoint *operationCheckpoint) error {
	if checkpoint == nil || !checkpoint.PreviousRuntimeLegacy {
		return errors.New("legacy Runtime recovery checkpoint is unavailable")
	}
	binding := c.bindings.Binding()
	binaryPath := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	digest, err := fileSHA256(binaryPath)
	if err != nil || digest != normalizeSHA256(checkpoint.PreviousExecutableSHA256) {
		return errors.New("legacy Runtime recovery executable does not match the checkpoint")
	}
	logRoot := filepath.Join(binding.RuntimeRoot, "runtime", "logs")
	if err := os.MkdirAll(logRoot, 0o700); err != nil {
		return err
	}
	logPath := filepath.Join(logRoot, "gateway-legacy-recovery-"+safeOperationID(checkpoint.OperationID)+".log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	command := exec.Command(
		binaryPath,
		"run",
		"--state-root", binding.RuntimeRoot,
		"--mode", "desktop",
		"--desktop-managed",
		"--presentation", "machine",
		"--local-ui-bind", c.precompiledRuntimeLocalUIBind,
	)
	command.Env = append(os.Environ(), "REDEVEN_DESKTOP_OWNER_ID="+strings.TrimSpace(checkpoint.PreviousDesktopOwnerID))
	command.Stdin = nil
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	_ = command.Process.Release()
	_ = logFile.Close()
	deadline := time.Now().Add(c.startupWait)
	for time.Now().Before(deadline) {
		candidate, candidateErr := c.legacyRuntimeUpgradeCandidate(ctx)
		if candidateErr == nil && candidate.executableSHA256 == normalizeSHA256(checkpoint.PreviousExecutableSHA256) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
	return errors.New("restored legacy Runtime did not become ready before the recovery deadline")
}

func (c *Controller) finishPreparedRecovery(checkpoint *operationCheckpoint) error {
	if checkpoint == nil {
		return errors.New("Runtime recovery checkpoint is unavailable")
	}
	if err := c.cleanupRecoveryArtifacts(*checkpoint); err != nil {
		return err
	}
	checkpoint.Candidate = nil
	checkpoint.Phase = checkpointRecovered
	return c.writeCheckpoint(*checkpoint)
}

func (c *Controller) offlineSnapshot(ctx context.Context) (gatewayprotocol.WorkloadSnapshot, error) {
	inventory, err := c.runtimeProcessInventory(ctx)
	if err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	return offlineSnapshotFromInventory(inventory), nil
}

func offlineSnapshotFromInventory(inventory runtimemanagement.RuntimeProcessInventory) gatewayprotocol.WorkloadSnapshot {
	identities := make([]string, 0, len(inventory.Instances))
	for _, instance := range inventory.Instances {
		identities = append(identities, fmt.Sprintf("process:%d:%d:%s", instance.PID, instance.ProcessStartedAtUnixMS, instance.ExecutablePath))
	}
	observedAt := time.Now().UnixMilli()
	if len(identities) > 0 {
		return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
			SnapshotRevision: observedAt, ProcessInventoryDigest: "sha256:" + inventory.InventoryDigest,
			WorkloadIdentityDigest: digestStrings(identities), WorkloadIdentities: identities,
			Impact: gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown}, ObservedAtUnixMS: observedAt,
		})
	}
	zero := 0
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		SnapshotRevision: observedAt, ProcessInventoryDigest: "sha256:" + inventory.InventoryDigest,
		WorkloadIdentityDigest: digestStrings(nil), WorkloadIdentities: []string{},
		Impact:           gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadKnown, AffectedProcessCount: &zero, ActiveSessionCount: &zero},
		ObservedAtUnixMS: observedAt,
	})
}

func offlineRuntimeSnapshotMatches(expected gatewayprotocol.WorkloadSnapshot, observed gatewayprotocol.WorkloadSnapshot) bool {
	expected = gatewayprotocol.NormalizeWorkloadSnapshot(expected)
	observed = gatewayprotocol.NormalizeWorkloadSnapshot(observed)
	return expected.Impact.Knowledge == observed.Impact.Knowledge &&
		expected.ProcessInventoryDigest == observed.ProcessInventoryDigest &&
		expected.WorkloadIdentityDigest == observed.WorkloadIdentityDigest
}

func digestStrings(values []string) string {
	raw, _ := json.Marshal(values)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (c *Controller) waitForRuntimeStopped(ctx context.Context) error {
	deadline := time.Now().Add(c.shutdownWait)
	for time.Now().Before(deadline) {
		if !c.runtimeStatusPresent() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return errors.New("Runtime did not stop before the supervisor deadline")
}

func (c *Controller) waitForRuntimeReady(ctx context.Context, wait time.Duration) bool {
	if wait <= 0 {
		wait = 5 * time.Second
	}
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		if c.runtimeStatusPresent() {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(150 * time.Millisecond):
		}
	}
	return c.runtimeStatusPresent()
}

func (c *Controller) waitForNoRuntimeProcesses(ctx context.Context) error {
	deadline := time.Now().Add(c.shutdownWait)
	for time.Now().Before(deadline) {
		snapshot, err := c.offlineSnapshot(ctx)
		if err == nil && snapshot.Impact.Knowledge == gatewayprotocol.WorkloadKnown && len(snapshot.WorkloadIdentities) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return errors.New("Runtime recovery cannot prove that the previous process exited before restart")
}

func (c *Controller) extractRuntimeArtifact(ctx context.Context, operation gatewayprotocol.RuntimeOperation) (string, error) {
	binding := c.bindings.Binding()
	stagingRoot := filepath.Join(binding.RuntimeRoot, "runtime", "staging", safeOperationID(operation.OperationID))
	if err := os.RemoveAll(stagingRoot); err != nil {
		return "", err
	}
	completed := false
	defer func() {
		if !completed {
			_ = durableRemoveAll(stagingRoot)
		}
	}()
	if err := os.MkdirAll(filepath.Join(stagingRoot, "bin"), 0o700); err != nil {
		return "", err
	}
	for _, directory := range []string{filepath.Dir(stagingRoot), stagingRoot, filepath.Join(stagingRoot, "bin")} {
		if err := syncDirectory(directory); err != nil {
			return "", err
		}
	}
	archive, err := os.Open(operation.Artifact.StagedPath)
	if err != nil {
		return "", err
	}
	defer archive.Close()
	gzipReader, err := gzip.NewReader(archive)
	if err != nil {
		return "", errors.New("Runtime artifact is not a gzip archive")
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	allowedFiles := map[string]bool{
		"redeven":             true,
		"redevplugin-runtime": true,
		".redevplugin-release-artifacts-verified.json": false,
		"REDEVPLUGIN_THIRD_PARTY_NOTICES.md":           false,
		"REDEVPLUGIN_RUNTIME.spdx.json":                false,
		"redevplugin-runtime.provenance.json":          false,
		"redevplugin-runtime.sig":                      false,
		"redevplugin-runtime.pem":                      false,
		"LICENSE":                                      false,
		"THIRD_PARTY_NOTICES.md":                       false,
	}
	darwinFiles := map[string]struct{}{
		"redeven":                {},
		"LICENSE":                {},
		"THIRD_PARTY_NOTICES.md": {},
	}
	found := make(map[string]struct{}, len(allowedFiles))
	var totalSize int64
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(header.Name)), "./")
		executable, allowed := allowedFiles[name]
		if !allowed || header.Typeflag != tar.TypeReg {
			return "", errors.New("Runtime artifact contains an unsupported entry")
		}
		if _, duplicate := found[name]; duplicate {
			return "", errors.New("Runtime artifact contains a duplicate entry")
		}
		if operation.DesiredRuntime.Platform == "darwin" {
			if _, allowedOnDarwin := darwinFiles[name]; !allowedOnDarwin {
				return "", errors.New("Darwin Runtime artifact contains Linux-only companion evidence")
			}
		}
		if header.Size < 0 || totalSize > (512<<20)-header.Size {
			return "", errors.New("Runtime artifact exceeds the extraction size limit")
		}
		totalSize += header.Size
		mode := os.FileMode(0o600)
		if executable {
			mode = 0o700
		}
		destinationPath := filepath.Join(stagingRoot, "bin", name)
		file, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return "", err
		}
		_, copyErr := io.CopyN(file, tarReader, header.Size)
		syncErr := error(nil)
		if copyErr == nil {
			syncErr = file.Sync()
		}
		closeErr := file.Close()
		if copyErr != nil || syncErr != nil || closeErr != nil {
			return "", errors.New("extract Runtime suite file failed")
		}
		found[name] = struct{}{}
	}
	if _, ok := found["redeven"]; !ok {
		return "", errors.New("Runtime artifact did not contain redeven")
	}
	binaryPath := filepath.Join(stagingRoot, "bin", "redeven")
	binaryDigest, err := fileSHA256(binaryPath)
	if err != nil {
		return "", err
	}
	if operation.Artifact == nil || binaryDigest != normalizeSHA256(operation.Artifact.ExecutableSHA256) {
		return "", errors.New("staged Runtime executable digest does not match the authorized artifact")
	}
	probeContext, cancelProbe := context.WithTimeout(ctx, c.artifactProbeTimeout)
	defer cancelProbe()
	versionOutput, err := exec.CommandContext(probeContext, binaryPath, "version").CombinedOutput()
	if err != nil {
		if errors.Is(probeContext.Err(), context.DeadlineExceeded) {
			return "", errors.New("staged Runtime version check timed out")
		}
		return "", fmt.Errorf("staged Runtime version check failed: %s", strings.TrimSpace(string(versionOutput)))
	}
	fields := strings.Fields(string(versionOutput))
	if len(fields) < 2 || fields[0] != "redeven" || normalizeVersion(fields[1]) != normalizeVersion(operation.DesiredRuntime.Version) {
		return "", errors.New("staged Runtime version does not match the operation target")
	}
	if err := ensureRequiredRuntimeCompanions(
		filepath.Join(binding.RuntimeRoot, "runtime", "managed"),
		stagingRoot,
		operation.DesiredRuntime.Platform,
	); err != nil {
		return "", err
	}
	if err := syncDirectory(filepath.Join(stagingRoot, "bin")); err != nil {
		return "", err
	}
	if err := syncDirectory(stagingRoot); err != nil {
		return "", err
	}
	completed = true
	return stagingRoot, nil
}

func ensureRequiredRuntimeCompanions(managedRoot string, stagingRoot string, platform string) error {
	if strings.ToLower(strings.TrimSpace(platform)) != "linux" {
		return nil
	}
	companions := []struct {
		name       string
		executable bool
	}{
		{name: "redevplugin-runtime", executable: true},
		{name: ".redevplugin-release-artifacts-verified.json"},
	}
	for _, companion := range companions {
		destinationPath := filepath.Join(stagingRoot, "bin", companion.name)
		if info, err := os.Lstat(destinationPath); err == nil {
			if !info.Mode().IsRegular() || (companion.executable && info.Mode().Perm()&0o111 == 0) {
				return errors.New("fresh Linux Runtime artifact contains invalid ReDevPlugin companions")
			}
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		sourcePath := filepath.Join(managedRoot, "bin", companion.name)
		if err := copyRuntimeCompanion(sourcePath, destinationPath, companion.executable); err != nil {
			if os.IsNotExist(err) {
				return errors.New("fresh Linux Runtime artifact is missing required ReDevPlugin companions")
			}
			return fmt.Errorf("preserve managed Runtime companion %q: %w", companion.name, err)
		}
	}
	return nil
}

func copyRuntimeCompanion(sourcePath string, destinationPath string, executable bool) error {
	pathInfo, err := os.Lstat(sourcePath)
	if err != nil {
		return err
	}
	if !pathInfo.Mode().IsRegular() {
		return errors.New("source is not a regular file")
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	openedInfo, err := source.Stat()
	if err != nil {
		return err
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(pathInfo, openedInfo) {
		return errors.New("source identity changed while opening")
	}
	if executable && openedInfo.Mode().Perm()&0o111 == 0 {
		return errors.New("source is not executable")
	}

	destination, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, openedInfo.Mode().Perm())
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.Remove(destinationPath)
		}
	}()
	if _, err := io.Copy(destination, source); err != nil {
		_ = destination.Close()
		return err
	}
	if err := destination.Sync(); err != nil {
		_ = destination.Close()
		return err
	}
	if err := destination.Close(); err != nil {
		return err
	}
	completed = true
	return nil
}

func (c *Controller) cleanupRecoveryArtifacts(checkpoint operationCheckpoint) error {
	for _, path := range []string{
		checkpoint.StagingRoot,
		checkpoint.PreviousManagedRoot,
		checkpoint.ManagedRoot + ".failed." + safeOperationID(checkpoint.OperationID),
	} {
		if err := durableRemoveAll(path); err != nil {
			return err
		}
	}
	return nil
}

func (c *Controller) activateStaging(checkpoint operationCheckpoint) error {
	if err := durableRemoveAll(checkpoint.PreviousManagedRoot); err != nil {
		return err
	}
	if _, err := os.Stat(checkpoint.ManagedRoot); err == nil {
		if err := durableRename(checkpoint.ManagedRoot, checkpoint.PreviousManagedRoot); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := durableRename(checkpoint.StagingRoot, checkpoint.ManagedRoot); err != nil {
		rollbackErr := error(nil)
		if _, previousErr := os.Stat(checkpoint.PreviousManagedRoot); previousErr == nil {
			rollbackErr = durableRename(checkpoint.PreviousManagedRoot, checkpoint.ManagedRoot)
		} else if !errors.Is(previousErr, os.ErrNotExist) {
			rollbackErr = previousErr
		}
		if rollbackErr != nil {
			return fmt.Errorf("activate staged Runtime: %w; restore previous Runtime: %v", err, rollbackErr)
		}
		return err
	}
	return nil
}

func (c *Controller) startAndVerify(ctx context.Context, operation gatewayprotocol.RuntimeOperation, checkpoint *operationCheckpoint) error {
	return c.startAndVerifyWithProvenance(ctx, operation, checkpoint, runtimeOperationInstallationProvenance(operation))
}

func (c *Controller) startAndVerifyWithProvenance(ctx context.Context, operation gatewayprotocol.RuntimeOperation, checkpoint *operationCheckpoint, provenance *RuntimeInstallationProvenance) error {
	binding := c.bindings.Binding()
	binaryPath := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	if info, err := os.Stat(binaryPath); err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return errors.New("managed Runtime binary is missing or not executable")
	}
	logRoot := filepath.Join(binding.RuntimeRoot, "runtime", "logs")
	if err := os.MkdirAll(logRoot, 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(logRoot, "gateway-runtime.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	args := []string{"run", "--state-root", binding.RuntimeRoot, "--mode", "desktop", "--presentation", "machine", "--local-ui-bind", c.precompiledRuntimeLocalUIBind}
	cmd := exec.Command(binaryPath, args...)
	cmd.Stdin = nil
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if checkpoint != nil {
		checkpoint.Candidate = nil
		checkpoint.Phase = checkpointCandidateLaunching
		if err := c.writeCheckpoint(*checkpoint); err != nil {
			_ = logFile.Close()
			return err
		}
	}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	candidate, err := c.captureCandidateIdentity(ctx, cmd.Process.Pid, binaryPath)
	if err != nil {
		_ = cmd.Process.Kill()
		_ = logFile.Close()
		return err
	}
	if checkpoint != nil {
		checkpoint.Candidate = &candidate
		checkpoint.Phase = checkpointCandidateStarted
		if err := c.writeCheckpoint(*checkpoint); err != nil {
			_ = cmd.Process.Kill()
			_ = logFile.Close()
			return err
		}
	}
	_ = cmd.Process.Release()
	_ = logFile.Close()
	deadline := time.Now().Add(c.startupWait)
	for time.Now().Before(deadline) {
		identity, err := c.controlClient().identity(ctx)
		if err == nil {
			if operation.DesiredRuntime.Version != "" && normalizeVersion(identity.RuntimeBinaryVersion) != normalizeVersion(operation.DesiredRuntime.Version) {
				return errors.New("started Runtime version does not match the operation target")
			}
			if operation.Artifact != nil && normalizeSHA256(identity.ArtifactSHA256) != normalizeSHA256(operation.Artifact.ExecutableSHA256) {
				return errors.New("started Runtime artifact digest does not match the operation target")
			}
			if err := c.validateAndRecordIdentity(identity, provenance); err != nil {
				return err
			}
			if err := c.controlClient().health(ctx); err != nil {
				return err
			}
			if checkpoint != nil {
				checkpoint.Candidate.RuntimeInstanceID = strings.TrimSpace(identity.RuntimeInstanceID)
				checkpoint.Phase = checkpointVerified
				if err := c.writeCheckpoint(*checkpoint); err != nil {
					return err
				}
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(150 * time.Millisecond):
		}
	}
	return errors.New("Runtime did not become healthy before the supervisor deadline")
}

func (c *Controller) checkpointPath(operationID string) string {
	return filepath.Join(c.bindings.Binding().RuntimeRoot, "runtime", "supervisor-checkpoints", safeOperationID(operationID)+".json")
}

func (c *Controller) writeCheckpoint(checkpoint operationCheckpoint) error {
	path := c.checkpointPath(checkpoint.OperationID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(checkpoint, "", "  ")
	if err != nil {
		return err
	}
	return writeFileDurably(path, append(raw, '\n'), 0o600)
}

func (c *Controller) readCheckpoint(operationID string) (operationCheckpoint, error) {
	raw, err := os.ReadFile(c.checkpointPath(operationID))
	if err != nil {
		return operationCheckpoint{}, err
	}
	var checkpoint operationCheckpoint
	if err := json.Unmarshal(raw, &checkpoint); err != nil {
		return operationCheckpoint{}, err
	}
	operationID = strings.TrimSpace(operationID)
	binding := c.bindings.Binding()
	expectedManagedRoot := filepath.Join(binding.RuntimeRoot, "runtime", "managed")
	expectedStagingRoot := filepath.Join(binding.RuntimeRoot, "runtime", "staging", safeOperationID(operationID))
	expectedPreviousRoot := expectedManagedRoot + ".previous." + safeOperationID(operationID)
	if checkpoint.OperationID != operationID || !sameControllerPath(checkpoint.ManagedRoot, expectedManagedRoot) || checkpoint.Phase == "" ||
		(checkpoint.StagingRoot != "" && !sameControllerPath(checkpoint.StagingRoot, expectedStagingRoot)) ||
		(checkpoint.PreviousManagedRoot != "" && !sameControllerPath(checkpoint.PreviousManagedRoot, expectedPreviousRoot)) {
		return operationCheckpoint{}, errors.New("Runtime supervisor checkpoint is invalid for the bound Runtime root")
	}
	return checkpoint, nil
}

func sameControllerPath(left string, right string) bool {
	canonical := func(value string) string {
		clean, err := filepath.Abs(filepath.Clean(value))
		if err != nil {
			return filepath.Clean(value)
		}
		missing := make([]string, 0, 4)
		for {
			if resolved, resolveErr := filepath.EvalSymlinks(clean); resolveErr == nil {
				for index := len(missing) - 1; index >= 0; index-- {
					resolved = filepath.Join(resolved, missing[index])
				}
				return filepath.Clean(resolved)
			}
			parent := filepath.Dir(clean)
			if parent == clean {
				return filepath.Clean(value)
			}
			missing = append(missing, filepath.Base(clean))
			clean = parent
		}
	}
	return canonical(left) == canonical(right)
}

func (c *Controller) captureCandidateIdentity(ctx context.Context, pid int, binaryPath string) (candidateProcessIdentity, error) {
	deadline := time.Now().Add(2 * time.Second)
	options := runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot: c.bindings.Binding().RuntimeRoot, StateRoot: c.bindings.Binding().RuntimeRoot,
		CurrentExecutables: []string{binaryPath},
	}
	for time.Now().Before(deadline) {
		inventory, err := runtimemanagement.InspectRuntimeProcesses(ctx, options)
		if err == nil {
			for _, instance := range inventory.Instances {
				if instance.PID == pid && instance.ProcessStartedAtUnixMS > 0 {
					digest, digestErr := fileSHA256(binaryPath)
					if digestErr != nil {
						return candidateProcessIdentity{}, digestErr
					}
					return candidateProcessIdentity{
						PID: pid, ProcessStartedAtUnixMS: instance.ProcessStartedAtUnixMS,
						ExecutablePath: instance.ExecutablePath, ExecutableDevice: instance.ExecutableDevice,
						ExecutableInode: instance.ExecutableInode, ExecutableSHA256: digest,
					}, nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return candidateProcessIdentity{}, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
	return candidateProcessIdentity{}, errors.New("started Runtime candidate identity could not be captured")
}

func (c *Controller) terminateCandidate(ctx context.Context, checkpoint operationCheckpoint) error {
	if checkpoint.Candidate == nil && checkpoint.Phase == checkpointCandidateLaunching {
		candidate, err := c.discoverLaunchingCandidate(ctx, checkpoint)
		if err != nil {
			return err
		}
		checkpoint.Candidate = candidate
	}
	if checkpoint.Candidate == nil || checkpoint.Candidate.PID <= 0 {
		return nil
	}
	options := runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot: c.bindings.Binding().RuntimeRoot, StateRoot: c.bindings.Binding().RuntimeRoot,
		CurrentExecutables: candidateExecutablePaths(checkpoint),
	}
	inventory, err := runtimemanagement.InspectRuntimeProcesses(ctx, options)
	if err != nil {
		return err
	}
	for _, instance := range inventory.Instances {
		if instance.PID != checkpoint.Candidate.PID {
			continue
		}
		if instance.ProcessStartedAtUnixMS != checkpoint.Candidate.ProcessStartedAtUnixMS {
			return errors.New("Runtime recovery refused to signal a reused candidate PID")
		}
		if checkpoint.Candidate.ExecutableDevice == 0 || checkpoint.Candidate.ExecutableInode == 0 ||
			instance.ExecutableDevice != checkpoint.Candidate.ExecutableDevice || instance.ExecutableInode != checkpoint.Candidate.ExecutableInode {
			return errors.New("Runtime recovery refused to signal a candidate with different executable bytes")
		}
		process, err := os.FindProcess(instance.PID)
		if err != nil {
			return err
		}
		if err := process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		deadline := time.Now().Add(c.shutdownWait)
		for time.Now().Before(deadline) {
			observed, inspectErr := runtimemanagement.InspectRuntimeProcesses(ctx, options)
			if inspectErr != nil {
				return inspectErr
			}
			alive := false
			for _, candidate := range observed.Instances {
				if candidate.PID == instance.PID && candidate.ProcessStartedAtUnixMS == instance.ProcessStartedAtUnixMS {
					alive = true
					break
				}
			}
			if !alive {
				return nil
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(50 * time.Millisecond):
			}
		}
		return errors.New("failed Runtime candidate did not terminate before recovery")
	}
	return nil
}

func (c *Controller) discoverLaunchingCandidate(ctx context.Context, checkpoint operationCheckpoint) (*candidateProcessIdentity, error) {
	options := runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot: c.bindings.Binding().RuntimeRoot, StateRoot: c.bindings.Binding().RuntimeRoot,
		CurrentExecutables: candidateExecutablePaths(checkpoint),
	}
	inventory, err := runtimemanagement.InspectRuntimeProcesses(ctx, options)
	if err != nil {
		return nil, err
	}
	if len(inventory.Instances) == 0 {
		return nil, nil
	}
	if len(inventory.Instances) != 1 {
		return nil, errors.New("Runtime recovery cannot uniquely identify the candidate started after the durable launch intent")
	}
	instance := inventory.Instances[0]
	if instance.IdentityStatus != runtimemanagement.RuntimeProcessIdentityVerified ||
		instance.StopAuthority != runtimemanagement.RuntimeProcessStopAutomatic ||
		instance.PID <= 0 || instance.ProcessStartedAtUnixMS <= 0 ||
		instance.ExecutableDevice == 0 || instance.ExecutableInode == 0 {
		return nil, errors.New("Runtime recovery cannot prove the identity of the candidate started after the durable launch intent")
	}
	digest, err := fileSHA256(instance.ExecutablePath)
	if err != nil {
		return nil, err
	}
	return &candidateProcessIdentity{
		PID: instance.PID, ProcessStartedAtUnixMS: instance.ProcessStartedAtUnixMS,
		ExecutablePath: instance.ExecutablePath, ExecutableDevice: instance.ExecutableDevice,
		ExecutableInode: instance.ExecutableInode, ExecutableSHA256: digest,
	}, nil
}

func candidateExecutablePaths(checkpoint operationCheckpoint) []string {
	roots := []string{checkpoint.ManagedRoot, checkpoint.PreviousManagedRoot, checkpoint.StagingRoot}
	if checkpoint.ManagedRoot != "" {
		roots = append(roots, checkpoint.ManagedRoot+".failed."+safeOperationID(checkpoint.OperationID))
	}
	paths := make([]string, 0, len(roots)+1)
	if checkpoint.Candidate != nil && strings.TrimSpace(checkpoint.Candidate.ExecutablePath) != "" {
		paths = append(paths, checkpoint.Candidate.ExecutablePath)
	}
	for _, root := range roots {
		if strings.TrimSpace(root) != "" {
			paths = append(paths, filepath.Join(root, "bin", "redeven"))
		}
	}
	return paths
}

func writeFileDurably(path string, value []byte, mode os.FileMode) error {
	temporaryPath := path + ".tmp"
	file, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err = file.Write(value); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func durableRename(from string, to string) error {
	if err := os.Rename(from, to); err != nil {
		return err
	}
	if err := syncDirectory(filepath.Dir(from)); err != nil {
		return err
	}
	if filepath.Dir(to) != filepath.Dir(from) {
		return syncDirectory(filepath.Dir(to))
	}
	return nil
}

func durableRemoveAll(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func safeOperationID(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:16])
}

func normalizeVersion(value string) string {
	return strings.TrimPrefix(strings.TrimSpace(value), "v")
}

func normalizeSHA256(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if strings.HasPrefix(value, "sha256:") && len(value) == len("sha256:")+64 {
		return value
	}
	if len(value) == 64 {
		return "sha256:" + value
	}
	return ""
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), nil
}

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
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type ControllerOptions struct {
	BindingStore   *BindingStore
	StartupWait    time.Duration
	ShutdownWait   time.Duration
	ControlTimeout time.Duration
}

type Controller struct {
	mu             sync.Mutex
	offlineFences  map[string]gatewayprotocol.LifecycleTarget
	bindings       *BindingStore
	startupWait    time.Duration
	shutdownWait   time.Duration
	controlTimeout time.Duration
}

type operationCheckpoint struct {
	OperationID         string `json:"operation_id"`
	ManagedRoot         string `json:"managed_root"`
	PreviousManagedRoot string `json:"previous_managed_root,omitempty"`
	StagingRoot         string `json:"staging_root,omitempty"`
	RuntimeWasRunning   bool   `json:"runtime_was_running"`
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
	return &Controller{bindings: options.BindingStore, offlineFences: make(map[string]gatewayprotocol.LifecycleTarget), startupWait: startupWait, shutdownWait: shutdownWait, controlTimeout: controlTimeout}, nil
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
		return RuntimeValidation{}, err
	}
	if err := c.validateAndRecordIdentity(identity); err != nil {
		return RuntimeValidation{}, err
	}
	validation := c.bindings.Binding().ValidatedRuntime
	if validation == nil {
		return RuntimeValidation{}, errors.New("Runtime validation facts were not persisted")
	}
	return *validation, nil
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
	capability.SupervisionMode = "gateway_supervisor"
	capability.ArtifactPolicies = []gatewayprotocol.ArtifactPolicy{gatewayprotocol.ArtifactPolicyPublishedRelease}
	if hasControllerGrant(grants, gatewayprotocol.RuntimeGrantCustomBuild) {
		capability.ArtifactPolicies = append(capability.ArtifactPolicies, gatewayprotocol.ArtifactPolicyCustomBuild)
	}

	identity, err := c.controlClient().identity(ctx)
	if err == nil {
		if err := c.validateAndRecordIdentity(identity); err != nil {
			capability.Readiness = gatewayprotocol.ManagementTemporarilyUnavailable
			capability.ReasonCode = "runtime_identity_incompatible"
			return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
		}
		capability.Readiness = gatewayprotocol.ManagementReady
		capability.Operations = []gatewayprotocol.RuntimeOperationKind{
			gatewayprotocol.RuntimeOperationStop,
			gatewayprotocol.RuntimeOperationRestart,
			gatewayprotocol.RuntimeOperationUpdate,
		}
		capability.ReasonCode = "runtime_management_ready"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}

	snapshot, snapshotErr := c.offlineSnapshot(ctx)
	if snapshotErr != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
		capability.Readiness = gatewayprotocol.ManagementTemporarilyUnavailable
		capability.ReasonCode = "runtime_supervisor_temporarily_unavailable"
		return gatewayprotocol.NormalizeRuntimeManagementCapability(capability), nil
	}
	capability.Readiness = gatewayprotocol.ManagementReady
	capability.Operations = []gatewayprotocol.RuntimeOperationKind{
		gatewayprotocol.RuntimeOperationStart,
		gatewayprotocol.RuntimeOperationUpdate,
	}
	capability.ReasonCode = "runtime_management_ready"
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

func (c *Controller) Snapshot(ctx context.Context, target gatewayprotocol.LifecycleTarget) (gatewayprotocol.WorkloadSnapshot, error) {
	if err := c.bindings.Validate(gatewayprotocol.ReservedLocalEnvironmentID, target); err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	client := c.controlClient()
	identity, err := client.identity(ctx)
	if err != nil {
		return c.offlineSnapshot(ctx)
	}
	if err := c.validateAndRecordIdentity(identity); err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	return client.snapshot(ctx)
}

func (c *Controller) BeginLifecycleFence(ctx context.Context, operationID string, target gatewayprotocol.LifecycleTarget) (gatewaylifecycle.LifecycleFence, error) {
	if err := c.bindings.Validate(gatewayprotocol.ReservedLocalEnvironmentID, target); err != nil {
		return gatewaylifecycle.LifecycleFence{}, err
	}
	identity, err := c.controlClient().identity(ctx)
	if err != nil {
		snapshot, snapshotErr := c.offlineSnapshot(ctx)
		if snapshotErr != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
			return gatewaylifecycle.LifecycleFence{}, errors.New("Runtime is not reachable and the supervisor cannot prove that the target has no active Runtime workload")
		}
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
	if err := c.validateAndRecordIdentity(identity); err != nil {
		return gatewaylifecycle.LifecycleFence{}, err
	}
	return c.controlClient().beginFence(ctx, operationID, target.TargetGeneration)
}

func (c *Controller) ReleaseLifecycleFence(ctx context.Context, token string) error {
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

func (c *Controller) Commit(ctx context.Context, operation gatewayprotocol.RuntimeOperation, fenceToken string) error {
	if err := c.bindings.Validate(operation.GatewayEnvID, gatewayprotocol.LifecycleTarget{
		LifecycleTargetID: operation.LifecycleTargetID, TargetGeneration: operation.TargetGeneration,
	}); err != nil {
		return err
	}
	binding := c.bindings.Binding()
	checkpoint := operationCheckpoint{
		OperationID:       operation.OperationID,
		ManagedRoot:       filepath.Join(binding.RuntimeRoot, "runtime", "managed"),
		RuntimeWasRunning: c.runtimeStatusPresent(),
	}
	if strings.HasPrefix(strings.TrimSpace(fenceToken), "gwof_") {
		c.mu.Lock()
		fencedTarget, ok := c.offlineFences[strings.TrimSpace(fenceToken)]
		c.mu.Unlock()
		if !ok || fencedTarget.LifecycleTargetID != operation.LifecycleTargetID || fencedTarget.TargetGeneration != operation.TargetGeneration {
			return errors.New("offline Runtime lifecycle fence is stale")
		}
		snapshot, err := c.offlineSnapshot(ctx)
		if err != nil || snapshot.Impact.Knowledge != gatewayprotocol.WorkloadKnown || len(snapshot.WorkloadIdentities) != 0 {
			return errors.New("Runtime workload changed after the offline lifecycle fence was established")
		}
	}
	if checkpoint.RuntimeWasRunning {
		if err := c.controlClient().shutdown(ctx, fenceToken); err != nil {
			return fmt.Errorf("request Runtime shutdown: %w", err)
		}
		if err := c.waitForRuntimeStopped(ctx); err != nil {
			return err
		}
	}

	switch operation.Kind {
	case gatewayprotocol.RuntimeOperationStop:
		return c.writeCheckpoint(checkpoint)
	case gatewayprotocol.RuntimeOperationStart, gatewayprotocol.RuntimeOperationRestart:
		if err := c.writeCheckpoint(checkpoint); err != nil {
			return err
		}
		return c.startAndVerify(ctx, operation)
	case gatewayprotocol.RuntimeOperationUpdate:
		if operation.Artifact == nil || strings.TrimSpace(operation.Artifact.StagedPath) == "" {
			return errors.New("staged Runtime artifact is unavailable")
		}
		stagingRoot, err := c.extractRuntimeArtifact(operation)
		if err != nil {
			return err
		}
		checkpoint.StagingRoot = stagingRoot
		checkpoint.PreviousManagedRoot = checkpoint.ManagedRoot + ".previous." + safeOperationID(operation.OperationID)
		if err := c.writeCheckpoint(checkpoint); err != nil {
			return err
		}
		if err := c.activateStaging(checkpoint); err != nil {
			return err
		}
		if err := c.startAndVerify(ctx, operation); err != nil {
			return err
		}
		_ = os.RemoveAll(checkpoint.PreviousManagedRoot)
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
	if checkpoint.PreviousManagedRoot != "" {
		failedRoot := checkpoint.ManagedRoot + ".failed." + safeOperationID(operation.OperationID)
		_ = os.RemoveAll(failedRoot)
		if _, err := os.Stat(checkpoint.ManagedRoot); err == nil {
			if err := os.Rename(checkpoint.ManagedRoot, failedRoot); err != nil {
				return err
			}
		}
		if err := os.Rename(checkpoint.PreviousManagedRoot, checkpoint.ManagedRoot); err != nil {
			return err
		}
		_ = os.RemoveAll(failedRoot)
	}
	if checkpoint.RuntimeWasRunning {
		if err := c.startAndVerify(ctx, gatewayprotocol.RuntimeOperation{}); err != nil {
			return err
		}
	}
	return nil
}

func (c *Controller) Reconcile(ctx context.Context, operation gatewayprotocol.RuntimeOperation) error {
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
	if operation.Artifact != nil && normalizeSHA256(identity.ArtifactSHA256) != normalizeSHA256(operation.Artifact.SHA256) {
		return errors.New("Runtime artifact digest does not match the operation target")
	}
	if err := c.validateAndRecordIdentity(identity); err != nil {
		return err
	}
	return c.controlClient().health(ctx)
}

func (c *Controller) controlClient() runtimeControlClient {
	return runtimeControlClient{socketPath: c.bindings.Binding().RuntimeControlSocketPath, timeout: c.controlTimeout}
}

func (c *Controller) validateAndRecordIdentity(identity runtimeservice.RuntimeIdentity) error {
	capability := false
	for _, value := range identity.Capabilities {
		if strings.TrimSpace(value) == "lifecycle_fence_v1" {
			capability = true
			break
		}
	}
	if strings.TrimSpace(identity.RuntimeInstanceID) == "" || identity.ServiceProtocol != gatewayprotocol.RuntimeServiceProtocolV2 ||
		identity.CompatibilityEpoch != gatewayprotocol.RuntimeCompatibilityEpochV2 || !capability || normalizeSHA256(identity.ArtifactSHA256) == "" {
		return errors.New("Runtime identity, protocol, epoch, capabilities, or digest is incompatible with managed lifecycle")
	}
	return c.bindings.RecordRuntimeValidation(RuntimeValidation{
		RuntimeInstanceID: identity.RuntimeInstanceID, RuntimeBinaryVersion: identity.RuntimeBinaryVersion,
		ServiceProtocol: identity.ServiceProtocol, CompatibilityEpoch: identity.CompatibilityEpoch,
		Capabilities: identity.Capabilities, ArtifactSHA256: normalizeSHA256(identity.ArtifactSHA256),
	})
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

func (c *Controller) offlineSnapshot(ctx context.Context) (gatewayprotocol.WorkloadSnapshot, error) {
	binding := c.bindings.Binding()
	managedBinary := filepath.Join(binding.RuntimeRoot, "runtime", "managed", "bin", "redeven")
	inventory, err := runtimemanagement.InspectRuntimeProcesses(ctx, runtimemanagement.RuntimeProcessInventoryOptions{
		RuntimeRoot:        binding.RuntimeRoot,
		StateRoot:          binding.RuntimeRoot,
		CurrentExecutables: []string{managedBinary},
	})
	if err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	identities := make([]string, 0, len(inventory.Instances))
	for _, instance := range inventory.Instances {
		identities = append(identities, fmt.Sprintf("process:%d:%d:%s", instance.PID, instance.ProcessStartedAtUnixMS, instance.ExecutablePath))
	}
	if len(identities) > 0 {
		return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
			SnapshotRevision: time.Now().UnixNano(), ProcessInventoryDigest: "sha256:" + inventory.InventoryDigest,
			WorkloadIdentityDigest: digestStrings(identities), WorkloadIdentities: identities,
			Impact: gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadUnknown}, ObservedAtUnixMS: time.Now().UnixMilli(),
		}), nil
	}
	zero := 0
	return gatewayprotocol.NormalizeWorkloadSnapshot(gatewayprotocol.WorkloadSnapshot{
		SnapshotRevision: time.Now().UnixNano(), ProcessInventoryDigest: "sha256:" + inventory.InventoryDigest,
		WorkloadIdentityDigest: digestStrings(nil), WorkloadIdentities: []string{},
		Impact:           gatewayprotocol.WorkloadImpact{Knowledge: gatewayprotocol.WorkloadKnown, AffectedProcessCount: &zero, ActiveSessionCount: &zero},
		ObservedAtUnixMS: time.Now().UnixMilli(),
	}), nil
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

func (c *Controller) extractRuntimeArtifact(operation gatewayprotocol.RuntimeOperation) (string, error) {
	binding := c.bindings.Binding()
	stagingRoot := filepath.Join(binding.RuntimeRoot, "runtime", "staging", safeOperationID(operation.OperationID))
	if err := os.RemoveAll(stagingRoot); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Join(stagingRoot, "bin"), 0o700); err != nil {
		return "", err
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
	found := false
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(header.Name)), "./")
		if name != "redeven" || header.Typeflag != tar.TypeReg || found {
			return "", errors.New("Runtime artifact must contain exactly one regular redeven binary")
		}
		binaryPath := filepath.Join(stagingRoot, "bin", "redeven")
		file, err := os.OpenFile(binaryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700)
		if err != nil {
			return "", err
		}
		_, copyErr := io.Copy(file, io.LimitReader(tarReader, 512<<20))
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			return "", errors.New("extract Runtime binary failed")
		}
		found = true
	}
	if !found {
		return "", errors.New("Runtime artifact did not contain redeven")
	}
	binaryPath := filepath.Join(stagingRoot, "bin", "redeven")
	versionOutput, err := exec.Command(binaryPath, "version").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("staged Runtime version check failed: %s", strings.TrimSpace(string(versionOutput)))
	}
	fields := strings.Fields(string(versionOutput))
	if len(fields) < 2 || fields[0] != "redeven" || normalizeVersion(fields[1]) != normalizeVersion(operation.DesiredRuntime.Version) {
		return "", errors.New("staged Runtime version does not match the operation target")
	}
	return stagingRoot, nil
}

func (c *Controller) activateStaging(checkpoint operationCheckpoint) error {
	if err := os.RemoveAll(checkpoint.PreviousManagedRoot); err != nil {
		return err
	}
	if _, err := os.Stat(checkpoint.ManagedRoot); err == nil {
		if err := os.Rename(checkpoint.ManagedRoot, checkpoint.PreviousManagedRoot); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(checkpoint.StagingRoot, checkpoint.ManagedRoot); err != nil {
		_ = os.Rename(checkpoint.PreviousManagedRoot, checkpoint.ManagedRoot)
		return err
	}
	return nil
}

func (c *Controller) startAndVerify(ctx context.Context, operation gatewayprotocol.RuntimeOperation) error {
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
	cmd := exec.Command(binaryPath, "run", "--state-root", binding.RuntimeRoot, "--mode", "desktop", "--presentation", "machine", "--local-ui-bind", "127.0.0.1:0")
	cmd.Stdin = nil
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
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
			if operation.Artifact != nil && normalizeSHA256(identity.ArtifactSHA256) != normalizeSHA256(operation.Artifact.SHA256) {
				return errors.New("started Runtime artifact digest does not match the operation target")
			}
			if err := c.validateAndRecordIdentity(identity); err != nil {
				return err
			}
			return c.controlClient().health(ctx)
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
	temporaryPath := path + ".tmp"
	if err := os.WriteFile(temporaryPath, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
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
	if checkpoint.OperationID != strings.TrimSpace(operationID) || checkpoint.ManagedRoot == "" {
		return operationCheckpoint{}, errors.New("Runtime supervisor checkpoint is invalid")
	}
	return checkpoint, nil
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

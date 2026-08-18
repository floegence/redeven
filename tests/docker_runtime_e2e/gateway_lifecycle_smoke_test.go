//go:build docker_e2e

package docker_runtime_e2e

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const (
	gatewayEnvironmentID                = gatewayprotocol.ReservedLocalEnvironmentID
	gatewayDesktopBridgeTransportHeader = "X-Redeven-Gateway-Transport"
	applicationJSONContentType          = "application/json"
	gatewayServiceWrapperPIDPath        = "/tmp/redeven-gateway-service-wrapper.pid"
)

type gatewayServiceStatus struct {
	Status                 string `json:"status"`
	PID                    int    `json:"pid,omitempty"`
	Listen                 string `json:"listen,omitempty"`
	StateRoot              string `json:"state_root"`
	ProcessStartedAtUnixMS int64  `json:"process_started_at_unix_ms,omitempty"`
}

type gatewayEnvelope struct {
	OK    bool                       `json:"ok"`
	Data  json.RawMessage            `json:"data,omitempty"`
	Error *gatewayProtocolErrorShape `json:"error,omitempty"`
}

type gatewayProtocolErrorShape struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message"`
}

type gatewayBridgeClient struct {
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	reader    *bufio.Reader
	stderr    *bytes.Buffer
	cancel    context.CancelFunc
	closeOnce sync.Once
	streamSeq uint64
}

type gatewayLifecycleClient struct {
	bridge        *gatewayBridgeClient
	audience      string
	gatewayID     string
	clientKeyID   string
	clientPrivate string
	nonceCounter  uint64
}

func TestDockerUbuntuGatewayRuntimeLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Minute)
	defer cancel()

	f := newFixture(t)
	f.requireDocker(ctx)
	f.startContainer(ctx)
	defer f.cleanup(context.Background())
	f.detectContainerArch(ctx)
	f.buildBinaries(ctx)

	serviceBeforeStart, err := f.readGatewayServiceStatus(ctx)
	if err != nil || serviceBeforeStart.Status != "not_running" {
		t.Fatalf("Gateway service status before startup = %#v, %v", serviceBeforeStart, err)
	}
	// Runtime data flow remains available before Gateway starts.
	f.startRuntime(ctx)
	initial := f.waitReady(ctx)
	initialPing := f.runHelper(ctx, initial.LocalUIURL, "ping", "")
	if initialPing.Ping == nil || initialPing.Ping.ProcessStartedAtMs <= 0 {
		t.Fatalf("Runtime is not independently usable before Gateway startup: %#v", initialPing)
	}
	initialIdentity := f.runtimeLifecycleIdentity(ctx, initial)
	if !containsString(initialIdentity.Capabilities, "lifecycle_fence_v1") {
		t.Fatalf("Runtime identity does not expose lifecycle fencing: %#v", initialIdentity)
	}
	f.openBridgeAndAssertRequests(ctx, initial)

	service := f.startGatewayService(ctx)
	if service.Status != "running" || service.PID <= 0 || service.Listen == "" {
		t.Fatalf("Gateway service status = %#v", service)
	}
	bridge := f.startGatewayBridge(ctx)
	defer bridge.close()
	lifecycleClient := pairGatewayLifecycleClient(t, bridge, service.Listen)

	capability := readRuntimeCapability(t, lifecycleClient)
	if capability.Support != gatewayprotocol.CapabilitySupportSupported ||
		capability.Authorization.State != gatewayprotocol.AuthorizationAllowed ||
		capability.Readiness != gatewayprotocol.ManagementReady ||
		capability.Target == nil || capability.Target.LifecycleTargetID == "" || capability.Target.TargetGeneration <= 0 || capability.Compatibility == nil {
		t.Fatalf("unexpected Runtime management capability: %#v", capability)
	}
	if capability.SupervisionMode != "gateway_supervisor" ||
		capability.Compatibility.GatewayProtocol != gatewayprotocol.Version ||
		capability.Compatibility.RuntimeServiceProtocol != runtimeservice.ProtocolVersion ||
		capability.Compatibility.CompatibilityEpoch != runtimeservice.CurrentCompatibilityContract().CompatibilityEpoch ||
		!containsString(capability.Compatibility.Capabilities, "runtime_operations_v2") ||
		!containsString(capability.Compatibility.Capabilities, "signed_artifact_policy_v1") ||
		capability.Compatibility.RuntimeArtifactSHA256 != initialIdentity.ArtifactSHA256 ||
		capability.Compatibility.RuntimeBinaryVersion != initialIdentity.RuntimeBinaryVersion {
		t.Fatalf("capability does not expose Gateway target identity and Runtime digest: %#v", capability)
	}

	target := *capability.Target
	compatibility := *capability.Compatibility
	restartID := "gateway-e2e-restart"
	restartPrepare := prepareRuntimeOperation(t, lifecycleClient, target, compatibility, restartID, gatewayprotocol.RuntimeOperationRestart, gatewayprotocol.ArtifactPolicyPublishedRelease, nil)
	if restartPrepare.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("restart prepare state = %q, want awaiting_confirmation", restartPrepare.Operation.State)
	}
	if response := lifecycleClient.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+restartID+"/commit", []byte(`{}`), nil, nil); response.OK || response.Error == nil || response.Error.Code != "operation_state_conflict" {
		t.Fatalf("restart commit before confirmation = %#v, want operation_state_conflict", response)
	}
	lockPrepare := prepareRuntimeOperationResponse(t, lifecycleClient, target, compatibility, "gateway-e2e-lock-conflict", gatewayprotocol.RuntimeOperationRestart, gatewayprotocol.ArtifactPolicyPublishedRelease, nil)
	if lockPrepare.OK || lockPrepare.Error == nil || lockPrepare.Error.Code != "operation_in_progress" || lockPrepare.Error.Message != restartID {
		t.Fatalf("second operation target-lock response = %#v, want operation_in_progress for %q", lockPrepare, restartID)
	}

	confirmedRestart := confirmRuntimeOperation(t, lifecycleClient, restartPrepare.Operation)
	if confirmedRestart.State != gatewayprotocol.RuntimeOperationCommitReady {
		t.Fatalf("restart confirmation state = %q, want commit_ready", confirmedRestart.State)
	}
	committedRestart := decodeOperationResponse(t, lifecycleClient.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+restartID+"/commit", []byte(`{}`), nil, nil))
	if committedRestart.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("restart commit state = %q, want succeeded", committedRestart.State)
	}
	afterRestart := f.waitPingAfter(ctx, initialPing.Ping.ProcessStartedAtMs)
	afterRestartStatus := f.waitReady(ctx)
	afterRestartIdentity := f.runtimeLifecycleIdentity(ctx, afterRestartStatus)
	afterRestartPing := f.runHelper(ctx, afterRestart.LocalUIURL, "ping", "")
	if afterRestartPing.Ping == nil || afterRestartIdentity.RuntimeInstanceID == initialIdentity.RuntimeInstanceID || afterRestartPing.Ping.ProcessStartedAtMs <= initialPing.Ping.ProcessStartedAtMs || afterRestartStatus.PID == initial.PID {
		t.Fatalf("Gateway restart did not produce a new Runtime process identity: initial=%#v/%#v after=%#v/%#v", initialIdentity, initial, afterRestartIdentity, afterRestartStatus)
	}
	assertLifecycleEvents(t, lifecycleClient, restartID, []gatewayprotocol.RuntimeOperationState{
		gatewayprotocol.RuntimeOperationPreflighting,
		gatewayprotocol.RuntimeOperationAwaitingConfirmation,
		gatewayprotocol.RuntimeOperationCommitReady,
		gatewayprotocol.RuntimeOperationFencing,
		gatewayprotocol.RuntimeOperationCommitting,
		gatewayprotocol.RuntimeOperationSucceeded,
	})

	buildInputs := json.RawMessage(`{"source":"docker-runtime-e2e","target_version":"v9.9.9-e2e"}`)
	tamperID := "gateway-e2e-tampered-artifact"
	tamperPrepare := prepareRuntimeOperation(t, lifecycleClient, target, compatibility, tamperID, gatewayprotocol.RuntimeOperationUpdate, gatewayprotocol.ArtifactPolicyCustomBuild, buildInputs)
	if confirmRuntimeOperation(t, lifecycleClient, tamperPrepare.Operation).State != gatewayprotocol.RuntimeOperationAwaitingArtifact {
		t.Fatalf("tampered artifact operation did not await artifact")
	}
	tamperedArtifact, tamperedMetadata := makeCustomRuntimeArtifact(t, f, tamperID, target, compatibility, buildInputs)
	tamperedMetadata.ExecutableSHA256 = "sha256:" + strings.Repeat("0", 64)
	tamperedMetadataJSON := mustJSON(t, tamperedMetadata)
	tamperedResponse := lifecycleClient.call(t, http.MethodPut, "/gateway/v2/runtime-operations/"+tamperID+"/artifact", tamperedArtifact,
		map[string]string{"X-Redeven-Runtime-Artifact-Metadata": base64.RawURLEncoding.EncodeToString(tamperedMetadataJSON)}, tamperedMetadataJSON)
	if tamperedResponse.OK || tamperedResponse.Error == nil || tamperedResponse.Error.Code != "artifact_invalid" {
		t.Fatalf("tampered executable digest response = %#v, want artifact_invalid", tamperedResponse)
	}
	unchangedPing := f.runHelper(ctx, afterRestart.LocalUIURL, "ping", "")
	if unchangedPing.Ping == nil || unchangedPing.Ping.ProcessStartedAtMs != afterRestart.ProcessStartedAtMs || unchangedPing.Ping.Version != compatibility.RuntimeBinaryVersion {
		t.Fatalf("tampered artifact changed the running Runtime: %#v", unchangedPing)
	}
	if cancelled := decodeOperationResponse(t, lifecycleClient.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+tamperID+"/cancel", []byte(`{}`), nil, nil)); cancelled.State != gatewayprotocol.RuntimeOperationCancelled {
		t.Fatalf("tampered artifact cancellation state = %q", cancelled.State)
	}

	updateID := "gateway-e2e-custom-build"
	updatePrepare := prepareRuntimeOperation(t, lifecycleClient, target, compatibility, updateID, gatewayprotocol.RuntimeOperationUpdate, gatewayprotocol.ArtifactPolicyCustomBuild, buildInputs)
	if updatePrepare.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("custom-build prepare state = %q, want awaiting_confirmation", updatePrepare.Operation.State)
	}
	confirmedUpdate := confirmRuntimeOperation(t, lifecycleClient, updatePrepare.Operation)
	if confirmedUpdate.State != gatewayprotocol.RuntimeOperationAwaitingArtifact {
		t.Fatalf("custom-build confirmation state = %q, want awaiting_artifact", confirmedUpdate.State)
	}

	artifact, metadata := makeCustomRuntimeArtifact(t, f, updateID, target, compatibility, buildInputs)
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal custom-build metadata: %v", err)
	}
	metadataHeader := base64.RawURLEncoding.EncodeToString(metadataJSON)
	staged := lifecycleClient.call(t, http.MethodPut, "/gateway/v2/runtime-operations/"+updateID+"/artifact", artifact,
		map[string]string{"X-Redeven-Runtime-Artifact-Metadata": metadataHeader}, metadataJSON)
	if !staged.OK {
		t.Fatalf("custom-build artifact upload failed: %#v", staged.Error)
	}
	stagedOperation := decodeOperationResponse(t, staged)
	if stagedOperation.State != gatewayprotocol.RuntimeOperationCommitReady || stagedOperation.Artifact == nil {
		t.Fatalf("custom-build artifact state = %#v", stagedOperation)
	}
	updateCommit := lifecycleClient.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+updateID+"/commit", []byte(`{}`), nil, nil)
	if !updateCommit.OK {
		persistedFailure := lifecycleClient.call(t, http.MethodGet, "/gateway/v2/runtime-operations/"+updateID, nil, nil, nil)
		f.dumpContainerDiagnostics(ctx)
		t.Fatalf("custom-build commit failed: error=%#v operation=%s checkpoint=%s runtime_log=%s service_log=%s",
			updateCommit.Error, persistedFailure.Data,
			f.readContainerFile(ctx, containerStateRoot+"/runtime/supervisor-checkpoints/"+updateID+".json"),
			f.readContainerFile(ctx, containerStateRoot+"/runtime/logs/gateway-runtime.log"),
			f.readContainerFile(ctx, gatewayStateRoot+"/gateway-service.log"))
	}
	updated := decodeOperationResponse(t, updateCommit)
	if updated.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("custom-build commit state = %q, want succeeded", updated.State)
	}
	afterUpdate := f.waitPingAfter(ctx, afterRestart.ProcessStartedAtMs)
	afterUpdateStatus := f.waitReady(ctx)
	afterUpdateIdentity := f.runtimeLifecycleIdentity(ctx, afterUpdateStatus)
	afterUpdatePing := f.runHelper(ctx, afterUpdate.LocalUIURL, "ping", "")
	if afterUpdatePing.Ping == nil || afterUpdatePing.Ping.Version != targetVersion || afterUpdatePing.Ping.RuntimeService == nil || afterUpdatePing.Ping.RuntimeService.RuntimeVersion != targetVersion || afterUpdateIdentity.RuntimeInstanceID == afterRestartIdentity.RuntimeInstanceID || afterUpdateStatus.PID == afterRestartStatus.PID {
		t.Fatalf("custom-build update did not replace Runtime identity/version: ping=%#v identity=%#v status=%#v", afterUpdatePing, afterUpdateIdentity, afterUpdateStatus)
	}
	if afterUpdateIdentity.ArtifactSHA256 != metadata.ExecutableSHA256 {
		t.Fatalf("custom-build Runtime identity digest = %q, want %q", afterUpdateIdentity.ArtifactSHA256, metadata.ExecutableSHA256)
	}
	updatedCapability := readRuntimeCapability(t, lifecycleClient)
	if updatedCapability.Compatibility == nil || updatedCapability.Compatibility.RuntimeBinaryVersion != targetVersion || updatedCapability.Compatibility.RuntimeArtifactSHA256 != metadata.ExecutableSHA256 {
		t.Fatalf("updated capability does not expose target version/digest: %#v", updatedCapability)
	}
	assertLifecycleEvents(t, lifecycleClient, updateID, []gatewayprotocol.RuntimeOperationState{
		gatewayprotocol.RuntimeOperationPreflighting,
		gatewayprotocol.RuntimeOperationAwaitingConfirmation,
		gatewayprotocol.RuntimeOperationAwaitingArtifact,
		gatewayprotocol.RuntimeOperationStaging,
		gatewayprotocol.RuntimeOperationCommitReady,
		gatewayprotocol.RuntimeOperationFencing,
		gatewayprotocol.RuntimeOperationCommitting,
		gatewayprotocol.RuntimeOperationSucceeded,
	})

	bridge.close()
	f.stopGatewayService(ctx)
	restartedService := f.startGatewayService(ctx)
	if restartedService.PID == service.PID || restartedService.ProcessStartedAtUnixMS <= service.ProcessStartedAtUnixMS {
		t.Fatalf("Gateway service did not restart with a new process identity: before=%#v after=%#v", service, restartedService)
	}
	bridge = f.startGatewayBridge(ctx)
	lifecycleClient.bridge = bridge
	persisted := decodeOperationResponse(t, lifecycleClient.call(t, http.MethodGet, "/gateway/v2/runtime-operations/"+updateID, nil, nil, nil))
	if persisted.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("operation state after Gateway restart = %q, want succeeded", persisted.State)
	}
	assertLifecycleEvents(t, lifecycleClient, updateID, []gatewayprotocol.RuntimeOperationState{
		gatewayprotocol.RuntimeOperationPreflighting,
		gatewayprotocol.RuntimeOperationAwaitingConfirmation,
		gatewayprotocol.RuntimeOperationAwaitingArtifact,
		gatewayprotocol.RuntimeOperationStaging,
		gatewayprotocol.RuntimeOperationCommitReady,
		gatewayprotocol.RuntimeOperationFencing,
		gatewayprotocol.RuntimeOperationCommitting,
		gatewayprotocol.RuntimeOperationSucceeded,
	})
	bridge.close()
	f.stopGatewayService(ctx)
	finalPing := f.runHelper(ctx, afterUpdate.LocalUIURL, "ping", "")
	if finalPing.Ping == nil || finalPing.Ping.Version != targetVersion {
		t.Fatalf("Runtime stopped responding after Gateway shutdown: %#v", finalPing)
	}
	f.openBridgeAndAssertRequests(ctx, afterUpdateStatus)
}

func (f *fixture) startGatewayService(ctx context.Context) gatewayServiceStatus {
	f.t.Helper()
	const statusPath = "/tmp/redeven-gateway-service-start.json"
	const stderrPath = "/tmp/redeven-gateway-service-start.stderr"
	const exitPath = "/tmp/redeven-gateway-service-start.exit"
	f.dockerExec(ctx, nil, "rm", "-f", statusPath, stderrPath, exitPath, gatewayServiceWrapperPIDPath)
	// Docker exec tears down released descendants with its session, so keep the
	// detached service-start session alive until stopGatewayService releases it.
	command := fmt.Sprintf(
		"echo $$ > %s; %s service-start --state-root %s --runtime-root %s --listen 127.0.0.1:0 --enable-profile-write >%s 2>%s; echo $? >%s; exec sleep infinity",
		gatewayServiceWrapperPIDPath, containerGateway, gatewayStateRoot, containerStateRoot, statusPath, stderrPath, exitPath,
	)
	_, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-d", f.containerName, "sh", "-c", command)
	if err != nil {
		f.dumpContainerDiagnostics(ctx)
		f.t.Fatalf("start Gateway service: %v", err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		status, statusErr := f.readGatewayServiceStatus(ctx)
		if statusErr == nil && status.Status == "running" && status.PID > 0 && status.Listen != "" {
			return status
		}
		time.Sleep(100 * time.Millisecond)
	}
	f.t.Fatalf("Gateway service did not remain running; status=%s stderr=%s exit=%s log=%s",
		f.readContainerFile(ctx, statusPath), f.readContainerFile(ctx, stderrPath), f.readContainerFile(ctx, exitPath),
		f.readContainerFile(ctx, gatewayStateRoot+"/gateway-service.log"))
	return gatewayServiceStatus{}
}

func (f *fixture) readGatewayServiceStatus(ctx context.Context) (gatewayServiceStatus, error) {
	result, commandErr := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, containerGateway, "service-status", "--state-root", gatewayStateRoot)
	var status gatewayServiceStatus
	if err := json.Unmarshal([]byte(result.Stdout), &status); err != nil {
		return gatewayServiceStatus{}, fmt.Errorf("decode Gateway service status: %w; command=%v stdout=%q stderr=%q", err, commandErr, result.Stdout, result.Stderr)
	}
	if commandErr != nil && status.Status != "not_running" {
		return gatewayServiceStatus{}, commandErr
	}
	return status, nil
}

func (f *fixture) readContainerFile(ctx context.Context, path string) string {
	f.t.Helper()
	result, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "cat", path)
	if err != nil {
		return err.Error()
	}
	return strings.TrimSpace(result.Stdout)
}

func (f *fixture) runtimeLifecycleIdentity(ctx context.Context, status launchReport) runtimeservice.RuntimeIdentity {
	f.t.Helper()
	if status.RuntimeControl == nil || status.RuntimeControl.Token == "" {
		f.t.Fatalf("Runtime status does not expose Runtime control: %#v", status)
	}
	bridgeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(bridgeCtx, "docker", "exec", "-i", f.containerName, containerRedeven, "desktop-bridge", "--state-root", containerStateRoot)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		f.t.Fatalf("Runtime bridge stdin: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		f.t.Fatalf("Runtime bridge stdout: %v", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		f.t.Fatalf("start Runtime desktop bridge: %v", err)
	}
	defer func() {
		_ = desktopbridge.WriteFrame(stdin, desktopbridge.FrameHeader{StreamID: "shutdown", Type: desktopbridge.FrameTypeShutdownRuntime}, nil)
		_ = stdin.Close()
		cancel()
		_ = cmd.Wait()
	}()
	reader := bufio.NewReader(stdout)
	header, _, err := desktopbridge.ReadFrame(reader)
	if err != nil || header.Type != desktopbridge.FrameTypeHello {
		f.t.Fatalf("read Runtime bridge hello: %v; stderr=%s", err, stderr.String())
	}
	controlURL, err := url.Parse(status.RuntimeControl.BaseURL)
	if err != nil || controlURL.Host == "" {
		f.t.Fatalf("parse Runtime control URL %q: %v", status.RuntimeControl.BaseURL, err)
	}
	request := fmt.Sprintf("GET /v2/runtime/identity HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nConnection: close\r\n\r\n", controlURL.Host, status.RuntimeControl.Token)
	body := bridgeHTTPRequest(f.t, reader, stdin, "runtime-identity", desktopbridge.StreamSurfaceRuntimeControl, request)
	var envelope struct {
		OK   bool                           `json:"ok"`
		Data runtimeservice.RuntimeIdentity `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || !envelope.OK || envelope.Data.RuntimeInstanceID == "" || envelope.Data.ArtifactSHA256 == "" {
		f.t.Fatalf("decode Runtime lifecycle identity: %v; body=%s", err, body)
	}
	return envelope.Data
}

func (f *fixture) stopGatewayService(ctx context.Context) {
	f.t.Helper()
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, containerGateway, "service-stop", "--state-root", gatewayStateRoot); err != nil {
		f.t.Fatalf("stop Gateway service: %v", err)
	}
	f.stopGatewayServiceWrapper(ctx)
	status, err := f.readGatewayServiceStatus(ctx)
	if err != nil || status.Status != "not_running" {
		f.t.Fatalf("Gateway service status after stop = %#v, %v", status, err)
	}
}

func (f *fixture) stopGatewayServiceWrapper(ctx context.Context) {
	f.t.Helper()
	rawPID := f.readContainerFile(ctx, gatewayServiceWrapperPIDPath)
	pid, err := strconv.Atoi(strings.TrimSpace(rawPID))
	if err != nil || pid <= 0 {
		f.t.Fatalf("invalid Gateway service wrapper PID %q: %v", rawPID, err)
	}
	processPath := fmt.Sprintf("/proc/%d/exe", pid)
	result, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "readlink", processPath)
	if err != nil || filepath.Base(strings.TrimSpace(result.Stdout)) != "sleep" {
		f.t.Fatalf("refuse to stop unverified Gateway service wrapper %d: %v stdout=%q", pid, err, result.Stdout)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "kill", strconv.Itoa(pid)); err != nil {
		f.t.Fatalf("stop Gateway service wrapper %d: %v", pid, err)
	}
	f.dockerExec(ctx, nil, "rm", "-f", gatewayServiceWrapperPIDPath)
}

func (f *fixture) startGatewayBridge(ctx context.Context) *gatewayBridgeClient {
	f.t.Helper()
	bridgeCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(bridgeCtx, "docker", "exec", "-i", f.containerName, containerGateway, "desktop-bridge", "--state-root", gatewayStateRoot)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		f.t.Fatalf("Gateway bridge stdin: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		f.t.Fatalf("Gateway bridge stdout: %v", err)
	}
	stderr := &bytes.Buffer{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		cancel()
		f.t.Fatalf("start Gateway desktop bridge: %v", err)
	}
	bridge := &gatewayBridgeClient{cmd: cmd, stdin: stdin, reader: bufio.NewReader(stdout), stderr: stderr}
	header, payload, err := desktopbridge.ReadFrame(bridge.reader)
	if err != nil || header.Type != desktopbridge.FrameTypeHello {
		bridge.closeWithCancel(cancel)
		status, _ := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, containerGateway, "service-status", "--state-root", gatewayStateRoot)
		log, _ := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "sh", "-c", "cat "+gatewayStateRoot+"/gateway-service.log")
		processes, _ := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "sh", "-c", "cat "+gatewayStateRoot+"/gateway-service.pid.json; ps -ef")
		f.t.Fatalf("read Gateway bridge hello: %v; stderr=%s; status=%s; log=%s; processes=%s", err, stderr.String(), status.Stdout+status.Stderr, log.Stdout+log.Stderr, processes.Stdout+processes.Stderr)
	}
	var hello desktopbridge.Hello
	if err := json.Unmarshal(payload, &hello); err != nil || !hello.GatewayProtocol.Available || hello.GatewayService == nil {
		bridge.closeWithCancel(cancel)
		f.t.Fatalf("invalid Gateway bridge hello: %v %#v", err, hello)
	}
	bridge.cancel = cancel
	return bridge
}

func (b *gatewayBridgeClient) close() {
	if b == nil {
		return
	}
	b.closeWithCancel(b.cancel)
}

func (b *gatewayBridgeClient) closeWithCancel(cancel context.CancelFunc) {
	if b == nil {
		return
	}
	b.closeOnce.Do(func() {
		_ = desktopbridge.WriteFrame(b.stdin, desktopbridge.FrameHeader{StreamID: "shutdown", Type: desktopbridge.FrameTypeShutdownRuntime}, nil)
		_ = b.stdin.Close()
		if cancel != nil {
			cancel()
		}
		_ = b.cmd.Wait()
	})
}

func (b *gatewayBridgeClient) request(t *testing.T, host, method, path string, body []byte, headers map[string]string) gatewayEnvelope {
	t.Helper()
	seq := atomic.AddUint64(&b.streamSeq, 1)
	streamID := fmt.Sprintf("gateway-e2e-%d", seq)
	var request bytes.Buffer
	fmt.Fprintf(&request, "%s %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nContent-Length: %d\r\n", method, path, host, len(body))
	for key, value := range headers {
		fmt.Fprintf(&request, "%s: %s\r\n", key, value)
	}
	request.WriteString("\r\n")
	if err := desktopbridge.WriteFrame(b.stdin, desktopbridge.FrameHeader{StreamID: streamID, Type: desktopbridge.FrameTypeStreamOpen}, mustJSON(t, desktopbridge.StreamOpen{Surface: desktopbridge.StreamSurfaceGatewayProtocol})); err != nil {
		t.Fatalf("open Gateway bridge stream: %v", err)
	}
	if err := desktopbridge.WriteFrame(b.stdin, desktopbridge.FrameHeader{StreamID: streamID, Type: desktopbridge.FrameTypeStreamData}, request.Bytes()); err != nil {
		t.Fatalf("write Gateway bridge HTTP headers: %v", err)
	}
	for len(body) > 0 {
		chunk := body
		if len(chunk) > 8<<20 {
			chunk = chunk[:8<<20]
		}
		if err := desktopbridge.WriteFrame(b.stdin, desktopbridge.FrameHeader{StreamID: streamID, Type: desktopbridge.FrameTypeStreamData}, chunk); err != nil {
			t.Fatalf("write Gateway bridge HTTP body: %v", err)
		}
		body = body[len(chunk):]
	}
	var raw bytes.Buffer
	for {
		header, payload, err := desktopbridge.ReadFrame(b.reader)
		if err != nil {
			t.Fatalf("read Gateway bridge response: %v", err)
		}
		if header.StreamID != streamID {
			continue
		}
		switch header.Type {
		case desktopbridge.FrameTypeStreamData:
			raw.Write(payload)
		case desktopbridge.FrameTypeStreamClose:
			return decodeGatewayEnvelope(t, raw.Bytes())
		case desktopbridge.FrameTypeStreamError:
			t.Fatalf("Gateway bridge stream error: %s", payload)
		}
	}
}

func pairGatewayLifecycleClient(t *testing.T, bridge *gatewayBridgeClient, listen string) *gatewayLifecycleClient {
	t.Helper()
	audience := "http://" + strings.TrimSpace(listen) + "/"
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate lifecycle client key: %v", err)
	}
	clientPublicKey := strings.TrimSpace(keys.PublicKeyPEM)
	clientNonce := "gateway-e2e-client-nonce"
	challengeRequest := gatewayprotocol.PairingChallengeRequest{
		ProtocolVersion: gatewayprotocol.Version, ClientNonce: clientNonce, ClientPublicKey: clientPublicKey, BindingAudience: audience,
	}
	challengeResponse := bridge.request(t, listen, http.MethodPost, "/gateway/v2/pairing/challenge", mustJSON(t, challengeRequest), map[string]string{
		"Content-Type": applicationJSONContentType, gatewayDesktopBridgeTransportHeader: "desktop_bridge",
	})
	if !challengeResponse.OK {
		t.Fatalf("Gateway pairing challenge failed: %#v", challengeResponse.Error)
	}
	var challenge gatewayprotocol.PairingChallengeResponse
	decodeEnvelopeData(t, challengeResponse, &challenge)
	if challenge.GatewayID == "" || challenge.GatewayNonce == "" || challenge.GatewayPublicKey == "" {
		t.Fatalf("incomplete Gateway pairing challenge: %#v", challenge)
	}
	fingerprint, err := security.PublicKeyFingerprint(challenge.GatewayPublicKey)
	if err != nil || fingerprint != challenge.GatewayPublicKeyFingerprint {
		t.Fatalf("Gateway pairing fingerprint mismatch: %q %q %v", fingerprint, challenge.GatewayPublicKeyFingerprint, err)
	}
	challengePayload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": audience, "client_nonce": clientNonce, "client_public_key": clientPublicKey,
		"expires_at_unix_ms": challenge.ExpiresAtUnixMS, "gateway_id": challenge.GatewayID, "gateway_nonce": challenge.GatewayNonce,
		"gateway_public_key": challenge.GatewayPublicKey, "protocol_version": gatewayprotocol.Version,
	})
	if err != nil || !security.VerifySignature(challenge.GatewayPublicKey, challengePayload, challenge.Signature) {
		t.Fatalf("Gateway pairing challenge signature is invalid: %v", err)
	}
	clientKeyID := security.ClientKeyID(clientPublicKey)
	grants := []gatewayprotocol.RuntimeGrant{gatewayprotocol.RuntimeGrantCustomBuild, gatewayprotocol.RuntimeGrantManage, gatewayprotocol.RuntimeGrantManageBinding}
	completeFields := map[string]any{
		"binding_audience": audience, "client_key_id": clientKeyID, "client_nonce": clientNonce,
		"gateway_id": challenge.GatewayID, "gateway_nonce": challenge.GatewayNonce, "protocol_version": gatewayprotocol.Version,
		"client_capability": string(gatewayprotocol.GatewayCapabilityEnvProfileWrite), "runtime_grants": grants,
	}
	completePayload, err := security.CanonicalJSON(completeFields)
	if err != nil {
		t.Fatalf("canonicalize Gateway pairing completion: %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, completePayload)
	if err != nil {
		t.Fatalf("sign Gateway pairing completion: %v", err)
	}
	completeRequest := gatewayprotocol.PairingCompleteRequest{
		ProtocolVersion: gatewayprotocol.Version, ClientNonce: clientNonce, GatewayNonce: challenge.GatewayNonce,
		GatewayID: challenge.GatewayID, BindingAudience: audience, ClientKeyID: clientKeyID,
		ClientCapability: string(gatewayprotocol.GatewayCapabilityEnvProfileWrite), RuntimeGrants: grants, Proof: proof,
	}
	completeResponse := bridge.request(t, listen, http.MethodPost, "/gateway/v2/pairing/complete", mustJSON(t, completeRequest), map[string]string{
		"Content-Type": applicationJSONContentType, gatewayDesktopBridgeTransportHeader: "desktop_bridge",
	})
	if !completeResponse.OK {
		t.Fatalf("Gateway pairing completion failed: %#v", completeResponse.Error)
	}
	var completed gatewayprotocol.PairingCompleteResponse
	decodeEnvelopeData(t, completeResponse, &completed)
	if completed.ClientKeyID != clientKeyID || completed.GatewayID != challenge.GatewayID {
		t.Fatalf("Gateway pairing completion identity mismatch: %#v", completed)
	}
	responsePayload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": audience, "client_key_id": clientKeyID, "client_nonce": clientNonce,
		"gateway_id": challenge.GatewayID, "gateway_nonce": challenge.GatewayNonce, "paired_at_unix_ms": completed.PairedAtUnixMS,
		"protocol_version": gatewayprotocol.Version, "client_capability": string(gatewayprotocol.GatewayCapabilityEnvProfileWrite), "runtime_grants": grants,
	})
	if err != nil || !security.VerifySignature(challenge.GatewayPublicKey, responsePayload, completed.Proof) {
		t.Fatalf("Gateway pairing completion proof is invalid: %v", err)
	}
	return &gatewayLifecycleClient{bridge: bridge, audience: audience, gatewayID: challenge.GatewayID, clientKeyID: clientKeyID, clientPrivate: keys.PrivateKeyPEM}
}

func (c *gatewayLifecycleClient) call(t *testing.T, method, path string, body []byte, extraHeaders map[string]string, signedBody []byte) gatewayEnvelope {
	t.Helper()
	if body == nil {
		body = []byte{}
	}
	if signedBody == nil {
		signedBody = body
	}
	digest, err := security.CanonicalJSONDigestFromBytes(signedBody)
	if err != nil {
		t.Fatalf("digest signed Gateway request: %v", err)
	}
	nonce := fmt.Sprintf("gateway-e2e-nonce-%d", atomic.AddUint64(&c.nonceCounter, 1))
	timestamp := time.Now().UnixMilli()
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": c.audience, "body_digest": digest, "gateway_id": c.gatewayID,
		"method": method, "nonce": nonce, "protocol_version": gatewayprotocol.Version, "route": path, "timestamp_unix_ms": timestamp,
	})
	if err != nil {
		t.Fatalf("canonicalize signed Gateway request: %v", err)
	}
	signature, err := security.SignPayload(c.clientPrivate, payload)
	if err != nil {
		t.Fatalf("sign Gateway request: %v", err)
	}
	headers := map[string]string{
		"Content-Type": applicationJSONContentType, gatewayDesktopBridgeTransportHeader: "desktop_bridge", "X-Redeven-Gateway-Binding-Audience": c.audience,
		"X-Redeven-Gateway-ID": c.gatewayID, "X-Redeven-Client-Key-ID": c.clientKeyID,
		"X-Redeven-Client-Nonce": nonce, "X-Redeven-Request-Signature": signature, "X-Redeven-Request-TS": fmt.Sprint(timestamp),
	}
	for key, value := range extraHeaders {
		headers[key] = value
	}
	host := strings.TrimSuffix(strings.TrimPrefix(c.audience, "http://"), "/")
	return c.bridge.request(t, host, method, path, body, headers)
}

func prepareRuntimeOperation(t *testing.T, client *gatewayLifecycleClient, target gatewayprotocol.LifecycleTarget, compatibility gatewayprotocol.RuntimeManagementCompatibility, operationID string, kind gatewayprotocol.RuntimeOperationKind, policy gatewayprotocol.ArtifactPolicy, buildInputs json.RawMessage) gatewayprotocol.RuntimeOperationPrepareResponse {
	t.Helper()
	response := prepareRuntimeOperationResponse(t, client, target, compatibility, operationID, kind, policy, buildInputs)
	if !response.OK {
		t.Fatalf("prepare Runtime operation %q failed: %#v", operationID, response.Error)
	}
	var prepared gatewayprotocol.RuntimeOperationPrepareResponse
	decodeEnvelopeData(t, response, &prepared)
	return prepared
}

func prepareRuntimeOperationResponse(t *testing.T, client *gatewayLifecycleClient, target gatewayprotocol.LifecycleTarget, compatibility gatewayprotocol.RuntimeManagementCompatibility, operationID string, kind gatewayprotocol.RuntimeOperationKind, policy gatewayprotocol.ArtifactPolicy, buildInputs json.RawMessage) gatewayEnvelope {
	t.Helper()
	desired := gatewayprotocol.DesiredRuntime{Platform: compatibility.RuntimePlatform, Architecture: compatibility.RuntimeArchitecture, ArtifactPolicy: policy}
	if kind == gatewayprotocol.RuntimeOperationUpdate {
		desired.Version = targetVersion
	} else {
		desired.Version = compatibility.RuntimeBinaryVersion
	}
	request := gatewayprotocol.RuntimeOperationPrepareRequest{
		ProtocolVersion: gatewayprotocol.Version, OperationID: operationID, AuthorizedClientKeyID: client.clientKeyID,
		GatewayEnvID: gatewayEnvironmentID, LifecycleTargetID: target.LifecycleTargetID, TargetGeneration: target.TargetGeneration,
		Operation: kind, DesiredRuntime: desired, BuildInputs: buildInputs, IdempotencyKey: "idem-" + operationID,
	}
	return client.call(t, http.MethodPost, "/gateway/v2/runtime-operations/prepare", mustJSON(t, request), nil, nil)
}

func confirmRuntimeOperation(t *testing.T, client *gatewayLifecycleClient, operation gatewayprotocol.RuntimeOperation) gatewayprotocol.RuntimeOperation {
	t.Helper()
	request := gatewayprotocol.RuntimeOperationConfirmationRequest{
		ProtocolVersion: gatewayprotocol.Version, SnapshotRevision: operation.ExpectedSnapshot.SnapshotRevision,
		ProcessInventoryDigest: operation.ExpectedSnapshot.ProcessInventoryDigest, WorkloadIdentityDigest: operation.ExpectedSnapshot.WorkloadIdentityDigest,
		RiskSummaryDigest: security.SHA256Base64URL(operation.OperationID + ":risk"),
	}
	return decodeOperationResponse(t, client.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+operation.OperationID+"/confirm", mustJSON(t, request), nil, nil))
}

func readRuntimeCapability(t *testing.T, client *gatewayLifecycleClient) gatewayprotocol.RuntimeManagementCapability {
	t.Helper()
	request := gatewayprotocol.RuntimeManagementCapabilityRequest{ProtocolVersion: gatewayprotocol.Version, GatewayEnvID: gatewayEnvironmentID}
	response := client.call(t, http.MethodPost, "/gateway/v2/runtime-management/capability", mustJSON(t, request), nil, nil)
	if !response.OK {
		t.Fatalf("read Runtime capability failed: %#v", response.Error)
	}
	var capability gatewayprotocol.RuntimeManagementCapability
	decodeEnvelopeData(t, response, &capability)
	return capability
}

func makeCustomRuntimeArtifact(t *testing.T, f *fixture, operationID string, target gatewayprotocol.LifecycleTarget, compatibility gatewayprotocol.RuntimeManagementCompatibility, buildInputs json.RawMessage) ([]byte, gatewayprotocol.RuntimeArtifactMetadata) {
	t.Helper()
	binary, err := os.ReadFile(filepath.Join(f.tempRoot, "redeven-linux-upgraded"))
	if err != nil {
		t.Fatalf("read upgraded Runtime binary: %v", err)
	}
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "redeven", Mode: 0o755, Size: int64(len(binary)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatalf("write Runtime artifact header: %v", err)
	}
	if _, err := tarWriter.Write(binary); err != nil {
		t.Fatalf("write Runtime artifact binary: %v", err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatalf("close Runtime artifact tar: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close Runtime artifact gzip: %v", err)
	}
	archiveBytes := archive.Bytes()
	archiveSum := sha256.Sum256(archiveBytes)
	binarySum := sha256.Sum256(binary)
	buildInputsDigest, err := security.CanonicalJSONDigestFromBytes(buildInputs)
	if err != nil {
		t.Fatalf("digest custom-build inputs: %v", err)
	}
	attestation := struct {
		OperationID       string `json:"operation_id"`
		LifecycleTargetID string `json:"lifecycle_target_id"`
		TargetGeneration  int64  `json:"target_generation"`
		BuildInputsDigest string `json:"build_inputs_digest"`
		ArchiveSHA256     string `json:"archive_sha256"`
		ExecutableSHA256  string `json:"executable_sha256"`
		Platform          string `json:"platform"`
		Architecture      string `json:"architecture"`
	}{operationID, target.LifecycleTargetID, target.TargetGeneration, buildInputsDigest, "sha256:" + hex.EncodeToString(archiveSum[:]), "sha256:" + hex.EncodeToString(binarySum[:]), compatibility.RuntimePlatform, compatibility.RuntimeArchitecture}
	attestationJSON, err := json.Marshal(attestation)
	if err != nil {
		t.Fatalf("marshal custom-build attestation: %v", err)
	}
	return archiveBytes, gatewayprotocol.RuntimeArtifactMetadata{
		SizeBytes: int64(len(archiveBytes)), ArchiveSHA256: attestation.ArchiveSHA256, ExecutableSHA256: attestation.ExecutableSHA256,
		ManifestJSON: json.RawMessage(`{"schema_version":1,"source":"docker-runtime-e2e"}`), BuildAttestation: attestationJSON,
	}
}

func assertLifecycleEvents(t *testing.T, client *gatewayLifecycleClient, operationID string, expected []gatewayprotocol.RuntimeOperationState) {
	t.Helper()
	response := client.call(t, http.MethodGet, "/gateway/v2/runtime-operations/"+operationID+"/events", nil, nil, nil)
	if !response.OK {
		t.Fatalf("read Runtime lifecycle events failed: %#v", response.Error)
	}
	var events gatewayprotocol.RuntimeOperationEventsResponse
	decodeEnvelopeData(t, response, &events)
	if len(events.Events) < len(expected) {
		t.Fatalf("Runtime lifecycle events = %#v, want at least %v", events.Events, expected)
	}
	lastSequence := int64(0)
	for index, state := range expected {
		event := events.Events[index]
		if event.State != state || event.Sequence <= lastSequence || event.OperationID != operationID {
			t.Fatalf("Runtime lifecycle event[%d] = %#v, want state %q in sequence", index, event, state)
		}
		lastSequence = event.Sequence
	}
}

func decodeOperationResponse(t *testing.T, response gatewayEnvelope) gatewayprotocol.RuntimeOperation {
	t.Helper()
	if !response.OK {
		t.Fatalf("Runtime lifecycle request failed: %#v", response.Error)
	}
	var operation gatewayprotocol.RuntimeOperation
	decodeEnvelopeData(t, response, &operation)
	return operation
}

func decodeEnvelopeData(t *testing.T, response gatewayEnvelope, out any) {
	t.Helper()
	if len(response.Data) == 0 {
		t.Fatalf("Gateway response did not include data: %#v", response)
	}
	if err := json.Unmarshal(response.Data, out); err != nil {
		t.Fatalf("decode Gateway response data: %v; data=%s", err, response.Data)
	}
}

func decodeGatewayEnvelope(t *testing.T, raw []byte) gatewayEnvelope {
	t.Helper()
	response, err := http.ReadResponse(bufio.NewReader(bytes.NewReader(raw)), nil)
	if err != nil {
		t.Fatalf("decode Gateway HTTP response: %v; raw=%q", err, raw)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read Gateway HTTP response: %v", err)
	}
	var envelope gatewayEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("decode Gateway envelope: %v; status=%d body=%q", err, response.StatusCode, body)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return envelope
	}
	return envelope
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON: %v", err)
	}
	return raw
}

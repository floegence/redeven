//go:build docker_e2e

package docker_runtime_e2e

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type nativeGatewayLifecycleFixture struct {
	t                *testing.T
	repoRoot         string
	tempRoot         string
	runtimeRoot      string
	gatewayStateRoot string
	runtimeBinary    string
	managedRuntime   string
	gatewayBinary    string
	runtimeCommand   *exec.Cmd
	runtimeWait      chan error
	runtimeLog       *os.File
}

func TestNativeHostGatewayStartsLocalRuntimeAfterDesktopRestart(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skipf("native Local Env lifecycle smoke is supported on macOS and Linux, not %s", runtime.GOOS)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	f := newNativeGatewayLifecycleFixture(t)
	f.buildBinaries(ctx)
	f.installManagedRuntime()
	t.Cleanup(func() {
		f.cleanup(context.Background())
	})

	f.startRuntime(ctx)
	initial := f.waitRuntimeReady(ctx, 0)
	service := f.startGatewayService(ctx)
	bridge := f.startGatewayBridge(ctx)
	client := pairGatewayLifecycleClient(t, bridge, service.Listen)
	capability := readRuntimeCapability(t, client)
	if capability.Readiness != gatewayprotocol.ManagementReady || capability.Target == nil || capability.Compatibility == nil {
		t.Fatalf("native Runtime management capability is not ready: %#v", capability)
	}
	if capability.Compatibility.RuntimePlatform != runtime.GOOS ||
		capability.Compatibility.RuntimeArchitecture != runtime.GOARCH ||
		capability.Compatibility.RuntimeArtifactSHA256 == "" {
		t.Fatalf("native Runtime capability identity does not match host %s/%s: %#v", runtime.GOOS, runtime.GOARCH, capability.Compatibility)
	}
	initialIdentity := f.runtimeIdentityAndWorkspace(ctx, initial)

	bridge.close()
	f.stopGatewayService(ctx)
	f.stopTrackedRuntime(ctx)
	f.waitRuntimeStopped(ctx)
	if status := f.gatewayServiceStatus(ctx); status.Status != "not_running" {
		t.Fatalf("Gateway service remained active across simulated Desktop restart: %#v", status)
	}

	restartedService := f.startGatewayService(ctx)
	if restartedService.PID == service.PID || restartedService.ProcessStartedAtUnixMS <= service.ProcessStartedAtUnixMS {
		t.Fatalf("native Gateway service did not restart with a new process identity: before=%#v after=%#v", service, restartedService)
	}
	bridge = f.startGatewayBridge(ctx)
	defer bridge.close()
	client.bridge = bridge
	offlineCapability := readRuntimeCapability(t, client)
	if offlineCapability.Readiness != gatewayprotocol.ManagementReady ||
		offlineCapability.Target == nil || offlineCapability.Compatibility == nil ||
		!containsRuntimeOperation(offlineCapability.Operations, gatewayprotocol.RuntimeOperationStart) ||
		offlineCapability.Compatibility.RuntimeArtifactSHA256 != initialIdentity.ArtifactSHA256 {
		t.Fatalf("native stopped Runtime does not expose its verified start operation: %#v", offlineCapability)
	}

	operationID := "native-host-start-after-desktop-restart"
	prepared := prepareRuntimeOperation(
		t,
		client,
		*offlineCapability.Target,
		*offlineCapability.Compatibility,
		operationID,
		gatewayprotocol.RuntimeOperationStart,
		gatewayprotocol.ArtifactPolicyPublishedRelease,
		nil,
	)
	if prepared.Operation.State != gatewayprotocol.RuntimeOperationAwaitingConfirmation {
		t.Fatalf("native start prepare state = %q, want awaiting_confirmation", prepared.Operation.State)
	}
	confirmed := confirmRuntimeOperation(t, client, prepared.Operation)
	if confirmed.State != gatewayprotocol.RuntimeOperationCommitReady {
		t.Fatalf("native start confirmation state = %q, want commit_ready", confirmed.State)
	}
	committed := decodeOperationResponse(t, client.call(t, http.MethodPost, "/gateway/v2/runtime-operations/"+operationID+"/commit", []byte(`{}`), nil, nil))
	if committed.State != gatewayprotocol.RuntimeOperationSucceeded {
		t.Fatalf("native start commit state = %q, want succeeded", committed.State)
	}
	afterStart := f.waitRuntimeReady(ctx, initial.PID)
	afterStartIdentity := f.runtimeIdentityAndWorkspace(ctx, afterStart)
	if afterStart.PID == initial.PID || afterStartIdentity.RuntimeInstanceID == initialIdentity.RuntimeInstanceID {
		t.Fatalf("native lifecycle start reused the stopped Runtime identity: before=%#v/%#v after=%#v/%#v", initial, initialIdentity, afterStart, afterStartIdentity)
	}
	assertLifecycleEvents(t, client, operationID, []gatewayprotocol.RuntimeOperationState{
		gatewayprotocol.RuntimeOperationPreflighting,
		gatewayprotocol.RuntimeOperationAwaitingConfirmation,
		gatewayprotocol.RuntimeOperationCommitReady,
		gatewayprotocol.RuntimeOperationFencing,
		gatewayprotocol.RuntimeOperationCommitting,
		gatewayprotocol.RuntimeOperationSucceeded,
	})
}

func newNativeGatewayLifecycleFixture(t *testing.T) *nativeGatewayLifecycleFixture {
	t.Helper()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("resolve native smoke working directory: %v", err)
	}
	repoRoot, err := filepath.Abs(filepath.Join(workingDirectory, "..", ".."))
	if err != nil {
		t.Fatalf("resolve native smoke repository root: %v", err)
	}
	tempRoot, err := os.MkdirTemp("/tmp", "redeven-host-lifecycle-")
	if err != nil {
		t.Fatalf("create short native smoke temp root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(tempRoot)
	})
	runtimeRoot := filepath.Join(tempRoot, "runtime-state")
	return &nativeGatewayLifecycleFixture{
		t:                t,
		repoRoot:         repoRoot,
		tempRoot:         tempRoot,
		runtimeRoot:      runtimeRoot,
		gatewayStateRoot: filepath.Join(tempRoot, "gateway-state"),
		runtimeBinary:    filepath.Join(tempRoot, "redeven"),
		managedRuntime:   filepath.Join(runtimeRoot, "runtime", "managed", "bin", "redeven"),
		gatewayBinary:    filepath.Join(tempRoot, "redeven-gateway"),
	}
}

func (f *nativeGatewayLifecycleFixture) buildBinaries(ctx context.Context) {
	f.t.Helper()
	environment := append(os.Environ(), "GOWORK=off", "CGO_ENABLED=0")
	f.run(ctx, environment, "go", "build", "-o", f.runtimeBinary, "./cmd/redeven")
	f.run(ctx, environment, "go", "build", "-o", f.gatewayBinary, "./cmd/redeven-gateway")
}

func (f *nativeGatewayLifecycleFixture) installManagedRuntime() {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(f.managedRuntime), 0o755); err != nil {
		f.t.Fatalf("create native managed Runtime directory: %v", err)
	}
	runtimeBytes, err := os.ReadFile(f.runtimeBinary)
	if err != nil {
		f.t.Fatalf("read native Runtime binary: %v", err)
	}
	if err := os.WriteFile(f.managedRuntime, runtimeBytes, 0o755); err != nil {
		f.t.Fatalf("install native managed Runtime binary: %v", err)
	}
}

func (f *nativeGatewayLifecycleFixture) startRuntime(ctx context.Context) {
	f.t.Helper()
	logFile, err := os.Create(filepath.Join(f.tempRoot, "native-runtime.log"))
	if err != nil {
		f.t.Fatalf("create native Runtime log: %v", err)
	}
	command := exec.CommandContext(
		ctx,
		f.managedRuntime,
		"run",
		"--mode", "desktop",
		"--state-root", f.runtimeRoot,
		"--local-ui-bind", "127.0.0.1:0",
		"--presentation", "machine",
		"--startup-report-file", filepath.Join(f.tempRoot, "native-runtime-startup.json"),
	)
	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		_ = logFile.Close()
		f.t.Fatalf("start native Runtime: %v", err)
	}
	f.runtimeCommand = command
	f.runtimeWait = make(chan error, 1)
	go func() {
		f.runtimeWait <- command.Wait()
	}()
	f.runtimeLog = logFile
}

func (f *nativeGatewayLifecycleFixture) stopTrackedRuntime(ctx context.Context) {
	f.t.Helper()
	if f.runtimeCommand == nil || f.runtimeCommand.Process == nil {
		return
	}
	_ = f.runtimeCommand.Process.Signal(os.Interrupt)
	select {
	case <-ctx.Done():
		f.t.Fatalf("native Runtime did not stop after interrupt: %v", ctx.Err())
	case <-time.After(15 * time.Second):
		f.t.Fatal("native Runtime did not stop after interrupt")
	case <-f.runtimeWait:
	}
	if f.runtimeLog != nil {
		_ = f.runtimeLog.Close()
	}
	f.runtimeCommand = nil
	f.runtimeWait = nil
	f.runtimeLog = nil
}

func (f *nativeGatewayLifecycleFixture) runtimeStatus(ctx context.Context) (launchReport, error) {
	output, err := f.runResult(ctx, nil, f.runtimeBinary, "desktop-runtime-status", "--state-root", f.runtimeRoot, "--probe-timeout", "2s")
	if err != nil {
		return launchReport{}, err
	}
	var report launchReport
	if err := json.Unmarshal(output, &report); err != nil {
		return launchReport{}, fmt.Errorf("decode native Runtime status: %w", err)
	}
	return report, nil
}

func (f *nativeGatewayLifecycleFixture) waitRuntimeReady(ctx context.Context, previousPID int) launchReport {
	f.t.Helper()
	var lastReport launchReport
	var lastErr error
	for {
		report, err := f.runtimeStatus(ctx)
		if err == nil && report.Status == "ready" && report.PID > 0 && report.PID != previousPID && report.LocalUIURL != "" {
			return report
		}
		lastReport = report
		lastErr = err
		select {
		case processErr := <-f.runtimeWait:
			if f.runtimeLog != nil {
				_ = f.runtimeLog.Close()
			}
			f.runtimeCommand = nil
			f.runtimeWait = nil
			f.runtimeLog = nil
			logBytes, _ := os.ReadFile(filepath.Join(f.tempRoot, "native-runtime.log"))
			f.t.Fatalf("native Runtime exited before readiness: %v; report=%#v error=%v log=%s", processErr, lastReport, lastErr, logBytes)
		case <-ctx.Done():
			f.t.Fatalf("native Runtime did not become ready: %v; report=%#v error=%v", ctx.Err(), lastReport, lastErr)
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (f *nativeGatewayLifecycleFixture) waitRuntimeStopped(ctx context.Context) {
	f.t.Helper()
	for {
		report, err := f.runtimeStatus(ctx)
		if err == nil && report.Status != "ready" {
			return
		}
		select {
		case <-ctx.Done():
			f.t.Fatalf("native Runtime did not stop: %v; report=%#v error=%v", ctx.Err(), report, err)
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func (f *nativeGatewayLifecycleFixture) startGatewayService(ctx context.Context) gatewayServiceStatus {
	f.t.Helper()
	output := f.run(ctx, nil, f.gatewayBinary, "service-start", "--state-root", f.gatewayStateRoot, "--runtime-root", f.runtimeRoot, "--listen", "127.0.0.1:0", "--enable-profile-write")
	var status gatewayServiceStatus
	if err := json.Unmarshal(output, &status); err != nil || status.Status != "running" || status.PID <= 0 || status.Listen == "" {
		f.t.Fatalf("start native Gateway service: %v; output=%s", err, output)
	}
	return status
}

func (f *nativeGatewayLifecycleFixture) gatewayServiceStatus(ctx context.Context) gatewayServiceStatus {
	f.t.Helper()
	output, _ := f.runResult(ctx, nil, f.gatewayBinary, "service-status", "--state-root", f.gatewayStateRoot)
	var status gatewayServiceStatus
	if err := json.Unmarshal(output, &status); err != nil {
		return gatewayServiceStatus{Status: "invalid", StateRoot: f.gatewayStateRoot}
	}
	return status
}

func (f *nativeGatewayLifecycleFixture) stopGatewayService(ctx context.Context) {
	f.t.Helper()
	if _, err := f.runResult(ctx, nil, f.gatewayBinary, "service-stop", "--state-root", f.gatewayStateRoot); err != nil {
		f.t.Fatalf("stop native Gateway service: %v", err)
	}
}

func (f *nativeGatewayLifecycleFixture) startGatewayBridge(ctx context.Context) *gatewayBridgeClient {
	f.t.Helper()
	bridgeContext, cancel := context.WithCancel(ctx)
	command := exec.CommandContext(bridgeContext, f.gatewayBinary, "desktop-bridge", "--state-root", f.gatewayStateRoot)
	stdin, err := command.StdinPipe()
	if err != nil {
		cancel()
		f.t.Fatalf("native Gateway bridge stdin: %v", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		cancel()
		f.t.Fatalf("native Gateway bridge stdout: %v", err)
	}
	stderr := &bytes.Buffer{}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		cancel()
		f.t.Fatalf("start native Gateway bridge: %v", err)
	}
	bridge := &gatewayBridgeClient{cmd: command, stdin: stdin, reader: bufio.NewReader(stdout), stderr: stderr, cancel: cancel}
	header, payload, err := desktopbridge.ReadFrame(bridge.reader)
	if err != nil || header.Type != desktopbridge.FrameTypeHello {
		bridge.close()
		f.t.Fatalf("read native Gateway bridge hello: %v; stderr=%s", err, stderr.String())
	}
	var hello desktopbridge.Hello
	if err := json.Unmarshal(payload, &hello); err != nil || !hello.GatewayProtocol.Available || hello.GatewayService == nil {
		bridge.close()
		f.t.Fatalf("invalid native Gateway bridge hello: %v %#v", err, hello)
	}
	return bridge
}

func (f *nativeGatewayLifecycleFixture) runtimeIdentityAndWorkspace(ctx context.Context, status launchReport) runtimeservice.RuntimeIdentity {
	f.t.Helper()
	if status.RuntimeControl == nil || status.RuntimeControl.Token == "" {
		f.t.Fatalf("native Runtime status does not expose Runtime control: %#v", status)
	}
	bridgeContext, cancel := context.WithCancel(ctx)
	defer cancel()
	command := exec.CommandContext(bridgeContext, f.runtimeBinary, "desktop-bridge", "--state-root", f.runtimeRoot)
	stdin, err := command.StdinPipe()
	if err != nil {
		f.t.Fatalf("native Runtime bridge stdin: %v", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		f.t.Fatalf("native Runtime bridge stdout: %v", err)
	}
	stderr := &bytes.Buffer{}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		f.t.Fatalf("start native Runtime bridge: %v", err)
	}
	defer func() {
		_ = desktopbridge.WriteFrame(stdin, desktopbridge.FrameHeader{StreamID: "shutdown", Type: desktopbridge.FrameTypeShutdownRuntime}, nil)
		_ = stdin.Close()
		cancel()
		_ = command.Wait()
	}()
	reader := bufio.NewReader(stdout)
	header, _, err := desktopbridge.ReadFrame(reader)
	if err != nil || header.Type != desktopbridge.FrameTypeHello {
		f.t.Fatalf("read native Runtime bridge hello: %v; stderr=%s", err, stderr.String())
	}
	controlURL, err := url.Parse(status.RuntimeControl.BaseURL)
	if err != nil || controlURL.Host == "" {
		f.t.Fatalf("parse native Runtime control URL %q: %v", status.RuntimeControl.BaseURL, err)
	}
	identityBody := bridgeHTTPRequest(f.t, reader, stdin, "native-runtime-identity", desktopbridge.StreamSurfaceRuntimeControl,
		fmt.Sprintf("GET /v2/runtime/identity HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nConnection: close\r\n\r\n", controlURL.Host, status.RuntimeControl.Token))
	var identityEnvelope struct {
		OK   bool                           `json:"ok"`
		Data runtimeservice.RuntimeIdentity `json:"data"`
	}
	if err := json.Unmarshal(identityBody, &identityEnvelope); err != nil || !identityEnvelope.OK || identityEnvelope.Data.RuntimeInstanceID == "" {
		f.t.Fatalf("decode native Runtime identity: %v; body=%s", err, identityBody)
	}
	localURL, err := url.Parse(status.LocalUIURL)
	if err != nil || localURL.Host == "" {
		f.t.Fatalf("parse native Local UI URL %q: %v", status.LocalUIURL, err)
	}
	healthBody := bridgeHTTPRequest(f.t, reader, stdin, "native-runtime-health", desktopbridge.StreamSurfaceLocalUI,
		"GET /api/local/runtime/health HTTP/1.1\r\nHost: "+localURL.Host+"\r\nConnection: close\r\n\r\n")
	if !bytes.Contains(healthBody, []byte(`"status":"online"`)) {
		f.t.Fatalf("native Runtime Local UI is not online: %s", healthBody)
	}
	workspaceBody := bridgeHTTPRequest(f.t, reader, stdin, "native-runtime-workspace", desktopbridge.StreamSurfaceLocalUI,
		"GET /_redeven_proxy/env/ HTTP/1.1\r\nHost: "+localURL.Host+"\r\nConnection: close\r\n\r\n")
	if !bytes.Contains(bytes.ToLower(workspaceBody), []byte("<html")) {
		f.t.Fatalf("native Runtime Workspace did not return HTML: %s", workspaceBody)
	}
	return identityEnvelope.Data
}

func (f *nativeGatewayLifecycleFixture) cleanup(ctx context.Context) {
	if bridgeStatus := f.gatewayServiceStatus(ctx); bridgeStatus.Status == "running" {
		_, _ = f.runResult(ctx, nil, f.gatewayBinary, "service-stop", "--state-root", f.gatewayStateRoot)
	}
	if f.runtimeCommand != nil && f.runtimeCommand.Process != nil {
		_ = f.runtimeCommand.Process.Signal(os.Interrupt)
		if f.runtimeWait != nil {
			select {
			case <-f.runtimeWait:
			case <-time.After(10 * time.Second):
			}
		}
	}
	if report, err := f.runtimeStatus(ctx); err == nil && report.Status == "ready" && report.PID > 0 {
		if process, findErr := os.FindProcess(report.PID); findErr == nil {
			_ = process.Signal(os.Interrupt)
		}
	}
	if f.runtimeLog != nil {
		_ = f.runtimeLog.Close()
	}
}

func (f *nativeGatewayLifecycleFixture) run(ctx context.Context, environment []string, name string, args ...string) []byte {
	f.t.Helper()
	output, err := f.runResult(ctx, environment, name, args...)
	if err != nil {
		f.t.Fatalf("run native smoke command %s: %v; output=%s", name, err, output)
	}
	return output
}

func (f *nativeGatewayLifecycleFixture) runResult(ctx context.Context, environment []string, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Dir = f.repoRoot
	if environment != nil {
		command.Env = environment
	}
	return command.CombinedOutput()
}

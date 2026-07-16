//go:build docker_e2e

package docker_runtime_e2e

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

const (
	ubuntuImage         = "ubuntu:24.04"
	containerStateRoot  = "/root/.redeven-e2e"
	containerRedeven    = "/usr/local/bin/redeven"
	managedRedeven      = containerStateRoot + "/runtime/managed/bin/redeven"
	managedRuntimeStamp = containerStateRoot + "/runtime/managed/managed-runtime.stamp"
	stagedUpgrade       = "/tmp/redeven-upgraded"
	runtimeLockPath     = containerStateRoot + "/local-environment/agent.lock"
	containerHelper     = "/tmp/redeven-e2e-client"
	targetVersion       = "v9.9.9-e2e"
	desktopOwnerID      = "redeven-docker-e2e-desktop-owner"
	networkTestPort     = "23998"
	networkTestPassword = "redeven-network-e2e-password"
)

type commandResult struct {
	Stdout string
	Stderr string
}

type launchReport struct {
	Status                   string                            `json:"status,omitempty"`
	Code                     string                            `json:"code,omitempty"`
	Message                  string                            `json:"message,omitempty"`
	LocalUIURL               string                            `json:"local_ui_url,omitempty"`
	LocalUIURLs              []string                          `json:"local_ui_urls,omitempty"`
	RuntimeControl           *runtimeControlEndpoint           `json:"runtime_control,omitempty"`
	PasswordRequired         bool                              `json:"password_required"`
	Exposure                 runtimemanagement.LocalUIExposure `json:"exposure"`
	EffectiveRunMode         string                            `json:"effective_run_mode,omitempty"`
	RemoteEnabled            bool                              `json:"remote_enabled"`
	DesktopManaged           bool                              `json:"desktop_managed"`
	DesktopOwnerID           string                            `json:"desktop_owner_id,omitempty"`
	StateDir                 string                            `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string                            `json:"runtime_control_socket_path,omitempty"`
	PID                      int                               `json:"pid,omitempty"`
	RuntimeService           map[string]any                    `json:"runtime_service,omitempty"`
	LockOwner                *runtimeLockOwner                 `json:"lock_owner,omitempty"`
	Diagnostics              *runtimeDiagnostics               `json:"diagnostics,omitempty"`
}

type runtimeControlEndpoint struct {
	ProtocolVersion string `json:"protocol_version"`
	BaseURL         string `json:"base_url"`
	Token           string `json:"token"`
	DesktopOwnerID  string `json:"desktop_owner_id"`
}

type runtimeLockOwner struct {
	PID            int    `json:"pid,omitempty"`
	DesktopManaged bool   `json:"desktop_managed"`
	DesktopOwnerID string `json:"desktop_owner_id,omitempty"`
}

type runtimeDiagnostics struct {
	LockPID         int    `json:"lock_pid,omitempty"`
	AttachState     string `json:"attach_state,omitempty"`
	FailureCode     string `json:"failure_code,omitempty"`
	PIDAlive        bool   `json:"pid_alive,omitempty"`
	SocketReachable bool   `json:"socket_reachable,omitempty"`
}

type helperResult struct {
	Action string `json:"action"`
	Ping   *struct {
		ServerTimeMs       int64  `json:"server_time_ms,omitempty"`
		AgentInstanceID    string `json:"agent_instance_id,omitempty"`
		ProcessStartedAtMs int64  `json:"process_started_at_ms,omitempty"`
		Version            string `json:"version,omitempty"`
		Commit             string `json:"commit,omitempty"`
		RuntimeService     *struct {
			RuntimeVersion string `json:"runtime_version,omitempty"`
		} `json:"runtime_service,omitempty"`
	} `json:"ping,omitempty"`
	Restart *struct {
		OK      bool   `json:"ok"`
		Message string `json:"message,omitempty"`
	} `json:"restart,omitempty"`
	Upgrade *struct {
		OK      bool   `json:"ok"`
		Message string `json:"message,omitempty"`
	} `json:"upgrade,omitempty"`
	NetworkCheck *struct {
		AccessStatus struct {
			PasswordRequired bool                              `json:"password_required"`
			Unlocked         bool                              `json:"unlocked"`
			Exposure         runtimemanagement.LocalUIExposure `json:"exposure"`
			URLs             []string                          `json:"urls"`
		} `json:"access_status"`
		EnvAppLoaded          bool          `json:"env_app_loaded"`
		WrongHostStatus       int           `json:"wrong_host_status"`
		WrongOriginWSRejected bool          `json:"wrong_origin_ws_rejected"`
		Ping                  *pingResponse `json:"ping,omitempty"`
	} `json:"network_check,omitempty"`
}

type pingResponse struct {
	ServerTimeMs       int64 `json:"server_time_ms,omitempty"`
	ProcessStartedAtMs int64 `json:"process_started_at_ms,omitempty"`
}

type fixture struct {
	t             *testing.T
	repoRoot      string
	tempRoot      string
	containerName string
	goarch        string
}

func TestDockerUbuntuDesktopRuntimeLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	f := newFixture(t)
	f.requireDocker(ctx)
	f.startContainer(ctx)
	defer f.cleanup(context.Background())
	f.detectContainerArch(ctx)
	f.buildBinaries(ctx)
	f.assertRuntimeNotStarted(ctx)
	f.assertInventoryRequiresConfirmedTakeover(ctx)

	f.startRuntime(ctx)
	initial := f.waitReady(ctx)
	initialPing := f.runHelper(ctx, initial.LocalUIURL, "ping", "")
	if initialPing.Ping == nil || initialPing.Ping.ProcessStartedAtMs <= 0 {
		t.Fatalf("unexpected initial ping result: %#v", initialPing)
	}

	hello := f.openBridgeAndAssertRequests(ctx, initial)
	if hello.ProtocolVersion != desktopbridge.ProtocolVersion {
		t.Fatalf("bridge protocol = %q, want %q", hello.ProtocolVersion, desktopbridge.ProtocolVersion)
	}

	conflict := f.runSecondRuntimeAttach(ctx)
	if conflict.Status != "attached" {
		t.Fatalf("second runtime status = %q, want attached; report=%#v", conflict.Status, conflict)
	}
	if conflict.PID != initial.PID {
		t.Fatalf("second runtime attached PID = %d, want existing PID %d", conflict.PID, initial.PID)
	}

	afterSocketRecovery := f.recoverRuntimeAfterManagementSocketLoss(ctx, initialPing.Ping.ProcessStartedAtMs)

	restart := f.runHelper(ctx, afterSocketRecovery.LocalUIURL, "restart", "")
	if restart.Restart == nil || !restart.Restart.OK {
		t.Fatalf("unexpected restart result: %#v", restart)
	}
	afterRestart := f.waitPingAfter(ctx, afterSocketRecovery.ProcessStartedAtMs)

	stoppedAfterStop := f.stopRuntime(ctx)
	f.assertStoppedRuntimeStatus(stoppedAfterStop)
	f.startRuntime(ctx)
	afterManualStart := f.waitPingAfter(ctx, afterRestart.ProcessStartedAtMs)

	if _, err := f.tryHelper(ctx, afterManualStart.LocalUIURL, "upgrade", targetVersion); err == nil || !strings.Contains(err.Error(), "upgrade not supported") {
		t.Fatalf("desktop-managed sys.upgrade error = %v, want unsupported", err)
	}
	f.performDesktopOwnedUpgrade(ctx)
	afterUpgrade := f.waitPingAfter(ctx, afterManualStart.ProcessStartedAtMs)

	finalStatus := f.waitReady(ctx)
	if finalStatus.LocalUIURL == "" {
		t.Fatalf("final Local UI URL is empty")
	}
	finalPing := f.runHelper(ctx, finalStatus.LocalUIURL, "ping", "")
	if finalPing.Ping == nil || finalPing.Ping.ProcessStartedAtMs != afterUpgrade.ProcessStartedAtMs {
		t.Fatalf("unexpected final ping result: %#v; afterUpgrade=%#v", finalPing, afterUpgrade)
	}
	if finalPing.Ping.Version != targetVersion {
		t.Fatalf("final sys.ping version = %q, want %q", finalPing.Ping.Version, targetVersion)
	}
	if finalPing.Ping.RuntimeService == nil || finalPing.Ping.RuntimeService.RuntimeVersion != targetVersion {
		t.Fatalf("final runtime_service version = %#v, want %q", finalPing.Ping.RuntimeService, targetVersion)
	}
	if afterUpgrade.Version != targetVersion || afterUpgrade.RuntimeServiceVersion != targetVersion {
		t.Fatalf("afterUpgrade versions = %#v, want %q", afterUpgrade, targetVersion)
	}
}

func TestDockerUbuntuPlaintextNetworkExposure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	f := newFixture(t)
	f.requireDocker(ctx)
	f.ensureUbuntuImage(ctx)
	networkName := f.containerName + "-network"
	clientName := f.containerName + "-client"
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "network", "create", networkName); err != nil {
		t.Fatalf("create Docker network: %v", err)
	}
	defer func() {
		_, _ = f.runHost(context.Background(), f.repoRoot, nil, "docker", "rm", "-f", clientName)
		f.cleanup(context.Background())
		_, _ = f.runHost(context.Background(), f.repoRoot, nil, "docker", "network", "rm", networkName)
	}()
	for _, name := range []string{f.containerName, clientName} {
		if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "run", "-d", "--network", networkName, "--name", name, ubuntuImage, "sleep", "infinity"); err != nil {
			t.Fatalf("start network container %s: %v", name, err)
		}
	}

	f.detectContainerArch(ctx)
	f.buildBinaries(ctx)
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", filepath.Join(f.tempRoot, "redeven-e2e-client"), clientName+":"+containerHelper); err != nil {
		t.Fatalf("copy network client helper: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", clientName, "chmod", "0755", containerHelper); err != nil {
		t.Fatalf("prepare network client helper: %v", err)
	}

	passwordPath := "/tmp/redeven-network-password"
	f.dockerExec(ctx, strings.NewReader(networkTestPassword+"\n"), "sh", "-c", "umask 077; cat > "+passwordPath)
	f.assertNetworkExposureStartFailures(ctx, passwordPath)

	reportPath := "/tmp/redeven-network-report.json"
	stateRoot := "/root/.redeven-network-e2e"
	if _, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-d", f.containerName,
		containerRedeven, "run",
		"--mode", "local",
		"--state-root", stateRoot,
		"--local-ui-bind", "0.0.0.0:"+networkTestPort,
		"--password-file", passwordPath,
		"--acknowledge-plaintext-network-exposure",
		"--presentation", "machine",
		"--startup-report-file", reportPath,
	); err != nil {
		t.Fatalf("start network-exposed runtime: %v", err)
	}
	report := f.waitNetworkExposureReady(ctx, reportPath)
	if report.Exposure.Scope != runtimemanagement.LocalUIExposureScopeNetwork ||
		report.Exposure.Transport != runtimemanagement.LocalUITransportPlaintext ||
		!report.Exposure.PasswordRequired || !report.PasswordRequired {
		t.Fatalf("unexpected network exposure report: %#v", report)
	}
	if strings.Contains(report.LocalUIURL, "0.0.0.0") || strings.Contains(report.LocalUIURL, "[::]") {
		t.Fatalf("network report exposed wildcard URL: %#v", report)
	}

	clientOutput, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-i", clientName,
		containerHelper,
		"--base-url", report.LocalUIURL,
		"--action", "network-check",
		"--password", networkTestPassword,
	)
	if err != nil {
		f.dumpContainerDiagnostics(ctx)
		t.Fatalf("run cross-container network check: %v", err)
	}
	var result helperResult
	if err := json.Unmarshal([]byte(clientOutput.Stdout), &result); err != nil {
		t.Fatalf("decode network helper output: %v; stdout=%q", err, clientOutput.Stdout)
	}
	if result.NetworkCheck == nil || !result.NetworkCheck.EnvAppLoaded || result.NetworkCheck.Ping == nil {
		t.Fatalf("network helper did not load Env App and Direct RPC: %#v", result)
	}
	if result.NetworkCheck.WrongHostStatus != http.StatusMisdirectedRequest || !result.NetworkCheck.WrongOriginWSRejected {
		t.Fatalf("network helper did not reject Host/Origin attacks: %#v", result.NetworkCheck)
	}
	if result.NetworkCheck.AccessStatus.Exposure.Scope != runtimemanagement.LocalUIExposureScopeNetwork ||
		result.NetworkCheck.AccessStatus.Exposure.Transport != runtimemanagement.LocalUITransportPlaintext ||
		!result.NetworkCheck.AccessStatus.Exposure.PasswordRequired || !result.NetworkCheck.AccessStatus.PasswordRequired ||
		result.NetworkCheck.AccessStatus.Unlocked {
		t.Fatalf("unexpected public access status: %#v", result.NetworkCheck.AccessStatus)
	}
	if !containsString(result.NetworkCheck.AccessStatus.URLs, report.LocalUIURL) {
		t.Fatalf("access status URLs %v do not include startup URL %q", result.NetworkCheck.AccessStatus.URLs, report.LocalUIURL)
	}
}

type pingSnapshot struct {
	LocalUIURL            string
	ProcessStartedAtMs    int64
	Version               string
	RuntimeServiceVersion string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd() error = %v", err)
	}
	repoRoot, err := filepath.Abs(filepath.Join(wd, "..", ".."))
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return &fixture{
		t:             t,
		repoRoot:      repoRoot,
		tempRoot:      t.TempDir(),
		containerName: fmt.Sprintf("redeven-e2e-%d", time.Now().UnixNano()),
	}
}

func (f *fixture) requireDocker(ctx context.Context) {
	f.t.Helper()
	if _, err := exec.LookPath("docker"); err != nil {
		f.t.Fatalf("docker not found: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "version", "--format", "{{.Server.Version}}"); err != nil {
		f.t.Fatalf("docker daemon is not available: %v", err)
	}
}

func (f *fixture) startContainer(ctx context.Context) {
	f.t.Helper()
	f.ensureUbuntuImage(ctx)
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "run", "-d", "--name", f.containerName, ubuntuImage, "sleep", "infinity"); err != nil {
		f.t.Fatalf("start container: %v", err)
	}
}

func (f *fixture) ensureUbuntuImage(ctx context.Context) {
	f.t.Helper()
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "image", "inspect", ubuntuImage); err == nil {
		return
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "pull", ubuntuImage); err != nil {
		f.t.Fatalf("pull %s: %v", ubuntuImage, err)
	}
}

func (f *fixture) detectContainerArch(ctx context.Context) {
	f.t.Helper()
	raw := strings.TrimSpace(f.dockerExec(ctx, nil, "uname", "-m").Stdout)
	switch raw {
	case "x86_64", "amd64":
		f.goarch = "amd64"
	case "aarch64", "arm64":
		f.goarch = "arm64"
	default:
		f.t.Fatalf("unsupported container architecture %q", raw)
	}
}

func (f *fixture) buildBinaries(ctx context.Context) {
	f.t.Helper()
	redevenOut := filepath.Join(f.tempRoot, "redeven-linux")
	upgradedRedevenOut := filepath.Join(f.tempRoot, "redeven-linux-upgraded")
	helperOut := filepath.Join(f.tempRoot, "redeven-e2e-client")
	env := append(os.Environ(), "GOOS=linux", "GOARCH="+f.goarch, "CGO_ENABLED=0")
	if _, err := f.runHostEnv(ctx, f.repoRoot, env, "go", "build", "-o", redevenOut, "./cmd/redeven"); err != nil {
		f.t.Fatalf("build redeven: %v", err)
	}
	if _, err := f.runHostEnv(ctx, f.repoRoot, env, "go", "build",
		"-ldflags", "-X main.Version="+targetVersion,
		"-o", upgradedRedevenOut,
		"./cmd/redeven",
	); err != nil {
		f.t.Fatalf("build upgraded redeven: %v", err)
	}
	if _, err := f.runHostEnv(ctx, f.repoRoot, env, "go", "build", "-o", helperOut, "./tests/docker_runtime_e2e/testclient"); err != nil {
		f.t.Fatalf("build e2e helper: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", redevenOut, f.containerName+":"+containerRedeven); err != nil {
		f.t.Fatalf("copy redeven: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", helperOut, f.containerName+":"+containerHelper); err != nil {
		f.t.Fatalf("copy helper: %v", err)
	}
	f.dockerExec(ctx, nil, "mkdir", "-p", filepath.Dir(managedRedeven))
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", redevenOut, f.containerName+":"+managedRedeven); err != nil {
		f.t.Fatalf("copy managed redeven: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", upgradedRedevenOut, f.containerName+":"+stagedUpgrade); err != nil {
		f.t.Fatalf("copy upgraded redeven: %v", err)
	}
	f.dockerExec(ctx, nil, "chmod", "0755", containerRedeven, managedRedeven, stagedUpgrade, containerHelper)
}

func (f *fixture) assertNetworkExposureStartFailures(ctx context.Context, passwordPath string) {
	f.t.Helper()
	tests := []struct {
		name       string
		stateRoot  string
		args       []string
		wantDetail string
	}{
		{
			name:      "missing acknowledgement",
			stateRoot: "/root/.redeven-network-missing-ack",
			args: []string{
				"--password-file", passwordPath,
			},
			wantDetail: "requires `--acknowledge-plaintext-network-exposure`",
		},
		{
			name:      "missing password",
			stateRoot: "/root/.redeven-network-missing-password",
			args: []string{
				"--acknowledge-plaintext-network-exposure",
			},
			wantDetail: "requires a non-empty access password",
		},
	}
	for _, test := range tests {
		args := []string{
			"docker", "exec", "-i", f.containerName,
			containerRedeven, "run",
			"--mode", "local",
			"--state-root", test.stateRoot,
			"--local-ui-bind", "0.0.0.0:" + networkTestPort,
			"--presentation", "plain",
		}
		args = append(args, test.args...)
		_, err := f.runHost(ctx, f.repoRoot, nil, args[0], args[1:]...)
		if err == nil || !strings.Contains(err.Error(), test.wantDetail) {
			f.t.Fatalf("%s error = %v, want detail %q", test.name, err, test.wantDetail)
		}
	}
}

func (f *fixture) waitNetworkExposureReady(ctx context.Context, reportPath string) launchReport {
	f.t.Helper()
	deadline := time.Now().Add(35 * time.Second)
	var lastReport launchReport
	var lastErr error
	for time.Now().Before(deadline) {
		result, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "cat", reportPath)
		if err == nil {
			var report launchReport
			if decodeErr := json.Unmarshal([]byte(result.Stdout), &report); decodeErr == nil {
				lastReport = report
				if report.Status == "ready" && report.LocalUIURL != "" && report.PID > 0 {
					return report
				}
				lastErr = fmt.Errorf("network report is not ready: %#v", report)
			} else {
				lastErr = decodeErr
			}
		} else {
			lastErr = err
		}
		time.Sleep(250 * time.Millisecond)
	}
	f.dumpContainerDiagnostics(ctx)
	f.t.Fatalf("network runtime did not become ready: %v; last=%#v", lastErr, lastReport)
	return launchReport{}
}

func (f *fixture) startRuntime(ctx context.Context) {
	f.startRuntimeWithOwner(ctx, desktopOwnerID)
}

func (f *fixture) startOwnerlessRuntime(ctx context.Context) {
	f.startRuntimeWithOwner(ctx, "")
}

func (f *fixture) startRuntimeWithOwner(ctx context.Context, ownerID string) {
	f.t.Helper()
	args := []string{
		"exec", "-d",
	}
	if ownerID != "" {
		args = append(args, "--env", "REDEVEN_DESKTOP_OWNER_ID="+ownerID)
	}
	args = append(args,
		f.containerName,
		managedRedeven,
		"run",
		"--mode", "desktop",
		"--desktop-managed",
		"--state-root", containerStateRoot,
		"--local-ui-bind", "127.0.0.1:0",
	)
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", args...); err != nil {
		f.t.Fatalf("start runtime: %v", err)
	}
}

func (f *fixture) assertInventoryRequiresConfirmedTakeover(ctx context.Context) {
	f.t.Helper()
	isolationContainer := f.containerName + "-isolation"
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "run", "-d", "--name", isolationContainer, ubuntuImage, "sleep", "infinity"); err != nil {
		f.t.Fatalf("start isolation container: %v", err)
	}
	defer func() {
		_, _ = f.runHost(context.Background(), f.repoRoot, nil, "docker", "rm", "-f", isolationContainer)
	}()
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", isolationContainer, "mkdir", "-p", filepath.Dir(managedRedeven)); err != nil {
		f.t.Fatalf("prepare isolation runtime directory: %v", err)
	}
	for _, path := range []string{containerRedeven, managedRedeven} {
		if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "cp", filepath.Join(f.tempRoot, "redeven-linux"), isolationContainer+":"+path); err != nil {
			f.t.Fatalf("copy isolation runtime to %s: %v", path, err)
		}
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", isolationContainer, "chmod", "0755", containerRedeven, managedRedeven); err != nil {
		f.t.Fatalf("prepare isolation runtime: %v", err)
	}
	if _, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-d",
		"--env", "REDEVEN_DESKTOP_OWNER_ID="+desktopOwnerID,
		isolationContainer,
		managedRedeven, "run",
		"--mode", "desktop",
		"--desktop-managed",
		"--state-root", containerStateRoot,
		"--local-ui-bind", "127.0.0.1:0",
	); err != nil {
		f.t.Fatalf("start isolation runtime: %v", err)
	}
	isolationDeadline := time.Now().Add(20 * time.Second)
	var isolationInventory runtimemanagement.RuntimeProcessInventory
	for time.Now().Before(isolationDeadline) {
		isolationInventory = f.runtimeInventoryInContainer(ctx, isolationContainer)
		if isolationInventory.Summary.Automatic == 1 {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if isolationInventory.Summary.Automatic != 1 {
		f.t.Fatalf("isolation runtime inventory did not become ready: %#v", isolationInventory)
	}

	f.startOwnerlessRuntime(ctx)
	deadline := time.Now().Add(20 * time.Second)
	var inventory runtimemanagement.RuntimeProcessInventory
	for time.Now().Before(deadline) {
		inventory = f.runtimeInventory(ctx)
		if inventory.Summary.ConfirmedTakeover == 1 {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if inventory.Summary.ConfirmedTakeover != 1 || inventory.Summary.Blocked != 0 || len(inventory.Instances) != 1 {
		f.dumpContainerDiagnostics(ctx)
		f.t.Fatalf("runtime inventory did not require confirmed takeover: %#v", inventory)
	}
	f.dockerExec(ctx, nil, "rm", "-f", runtimeLockPath)
	inventory = f.runtimeInventory(ctx)
	instance := inventory.Instances[0]
	if inventory.Summary.ConfirmedTakeover != 1 || instance.IdentityStatus != runtimemanagement.RuntimeProcessIdentityVerified ||
		instance.OwnerStatus != runtimemanagement.RuntimeProcessOwnerMissing || instance.LayoutStatus != runtimemanagement.RuntimeProcessLayoutCurrent ||
		instance.OwnerEvidence != runtimemanagement.RuntimeProcessOwnerEvidenceMissing || instance.StopAuthority != runtimemanagement.RuntimeProcessStopConfirmedTakeover {
		f.t.Fatalf("ownerless runtime inventory after lease removal = %#v", inventory)
	}
	if err := f.stopRuntimeInventoryInContainer(ctx, f.containerName, inventory, runtimemanagement.RuntimeProcessReconciliationAutomatic); err == nil ||
		!strings.Contains(err.Error(), runtimemanagement.RuntimeProcessErrorTakeoverRequired) {
		f.t.Fatalf("automatic stop error = %v, want %s", err, runtimemanagement.RuntimeProcessErrorTakeoverRequired)
	}
	if err := f.stopRuntimeInventoryInContainer(ctx, f.containerName, inventory, runtimemanagement.RuntimeProcessReconciliationConfirmedTakeover); err != nil {
		f.t.Fatalf("confirmed takeover stop: %v", err)
	}
	if after := f.runtimeInventory(ctx); len(after.Instances) != 0 {
		f.t.Fatalf("confirmed takeover left target processes: %#v", after)
	}
	isolationAfter := f.runtimeInventoryInContainer(ctx, isolationContainer)
	if isolationAfter.Summary.Automatic != 1 || len(isolationAfter.Instances) != 1 {
		f.t.Fatalf("stopping the target container affected the isolation container: %#v", isolationAfter)
	}
	if err := f.stopRuntimeInventoryInContainer(ctx, isolationContainer, isolationAfter, runtimemanagement.RuntimeProcessReconciliationAutomatic); err != nil {
		f.t.Fatalf("stop isolation inventory: %v", err)
	}
}

func (f *fixture) performDesktopOwnedUpgrade(ctx context.Context) {
	f.t.Helper()
	f.stopRuntime(ctx)
	f.dockerExec(ctx, nil, "cp", stagedUpgrade, managedRedeven)
	stamp := strings.Join([]string{
		"schema_version=1",
		"managed_by=redeven-desktop",
		"runtime_release_tag=" + targetVersion,
		"install_strategy=desktop_upload",
		"",
	}, "\n")
	f.dockerExec(ctx, strings.NewReader(stamp), "sh", "-c", "cat > "+managedRuntimeStamp)
	f.startRuntime(ctx)
}

func (f *fixture) stopRuntime(ctx context.Context) launchReport {
	f.t.Helper()
	inventory := f.runtimeInventory(ctx)
	if inventory.Summary.Blocked > 0 {
		f.t.Fatalf("runtime inventory contains blocking instances: %#v", inventory)
	}
	if len(inventory.Instances) > 0 {
		if err := f.stopRuntimeInventoryInContainer(ctx, f.containerName, inventory, runtimemanagement.RuntimeProcessReconciliationAutomatic); err != nil {
			f.t.Fatalf("stop runtime inventory: %v", err)
		}
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		report, err := f.runtimeStatus(ctx)
		if err == nil && report.Status != "ready" {
			f.assertStoppedRuntimeStatus(report)
			return report
		}
		time.Sleep(250 * time.Millisecond)
	}
	f.dumpContainerDiagnostics(ctx)
	f.t.Fatalf("runtime did not stop")
	return launchReport{}
}

func (f *fixture) runtimeInventory(ctx context.Context) runtimemanagement.RuntimeProcessInventory {
	f.t.Helper()
	result := f.dockerExec(ctx, nil,
		containerRedeven,
		"desktop-runtime-inventory",
		"--runtime-root", containerStateRoot,
		"--state-root", containerStateRoot,
		"--desktop-owner-id", desktopOwnerID,
		"--current-executable", managedRedeven,
	)
	var inventory runtimemanagement.RuntimeProcessInventory
	if err := json.Unmarshal([]byte(result.Stdout), &inventory); err != nil {
		f.t.Fatalf("decode desktop-runtime-inventory: %v; stdout=%q", err, result.Stdout)
	}
	return inventory
}

func (f *fixture) runtimeInventoryInContainer(ctx context.Context, containerName string) runtimemanagement.RuntimeProcessInventory {
	f.t.Helper()
	result, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-i", containerName,
		containerRedeven,
		"desktop-runtime-inventory",
		"--runtime-root", containerStateRoot,
		"--state-root", containerStateRoot,
		"--desktop-owner-id", desktopOwnerID,
		"--current-executable", managedRedeven,
	)
	if err != nil {
		return runtimemanagement.RuntimeProcessInventory{}
	}
	var inventory runtimemanagement.RuntimeProcessInventory
	if err := json.Unmarshal([]byte(result.Stdout), &inventory); err != nil {
		f.t.Fatalf("decode container %s inventory: %v; stdout=%q", containerName, err, result.Stdout)
	}
	return inventory
}

func (f *fixture) stopRuntimeInventoryInContainer(
	ctx context.Context,
	containerName string,
	inventory runtimemanagement.RuntimeProcessInventory,
	mode runtimemanagement.RuntimeProcessReconciliationMode,
) error {
	f.t.Helper()
	if len(inventory.Instances) == 0 {
		return nil
	}
	result, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-i", containerName,
		containerRedeven,
		"desktop-runtime-stop",
		"--runtime-root", containerStateRoot,
		"--state-root", containerStateRoot,
		"--desktop-owner-id", desktopOwnerID,
		"--current-executable", managedRedeven,
		"--reconciliation-mode", string(mode),
		"--all-matching",
		"--expected-inventory-digest", inventory.InventoryDigest,
		"--grace-period", "10s",
		"--json",
	)
	if err != nil {
		return err
	}
	var stopped runtimemanagement.RuntimeProcessStopResult
	if err := json.Unmarshal([]byte(result.Stdout), &stopped); err != nil {
		return fmt.Errorf("decode runtime stop: %w; stdout=%q", err, result.Stdout)
	}
	if len(stopped.After.Instances) != 0 {
		return fmt.Errorf("runtime stop left processes: %#v", stopped.After)
	}
	return nil
}

func (f *fixture) recoverRuntimeAfterManagementSocketLoss(ctx context.Context, previousProcessStartedAtMs int64) pingSnapshot {
	f.t.Helper()
	status := f.waitReady(ctx)
	if strings.TrimSpace(status.RuntimeControlSocketPath) == "" {
		f.t.Fatalf("runtime status did not report a management socket path: %#v", status)
	}
	f.dockerExec(ctx, nil, "rm", "-f", status.RuntimeControlSocketPath)
	blocked, err := f.runtimeStatus(ctx)
	if err != nil {
		f.t.Fatalf("runtime status after socket removal: %v", err)
	}
	if blocked.Status != "blocked" || blocked.Code != "live_process_without_management_socket" {
		f.t.Fatalf("socket removal status = %#v, want live_process_without_management_socket", blocked)
	}
	if blocked.LockOwner == nil || !blocked.LockOwner.DesktopManaged || blocked.LockOwner.PID != status.PID {
		f.t.Fatalf("blocked status did not preserve desktop-managed lock owner: %#v", blocked)
	}
	if blocked.Diagnostics == nil || !blocked.Diagnostics.PIDAlive || blocked.Diagnostics.SocketReachable {
		f.t.Fatalf("blocked status did not expose socket diagnostics: %#v", blocked)
	}
	if blocked.Diagnostics.AttachState != "live_process_without_management_socket" || blocked.Diagnostics.FailureCode != "management_socket_unreachable" {
		f.t.Fatalf("blocked diagnostics = %#v, want live_process_without_management_socket/management_socket_unreachable", blocked.Diagnostics)
	}
	f.stopRuntime(ctx)
	f.startRuntime(ctx)
	return f.waitPingAfter(ctx, previousProcessStartedAtMs)
}

func (f *fixture) assertRuntimeNotStarted(ctx context.Context) launchReport {
	f.t.Helper()
	report, err := f.runtimeStatus(ctx)
	if err != nil {
		f.t.Fatalf("runtime status before start: %v", err)
	}
	f.assertStoppedRuntimeStatus(report)
	if report.Code != "not_running" {
		f.t.Fatalf("runtime status before start code = %q, want not_running; report=%#v", report.Code, report)
	}
	return report
}

func (f *fixture) assertStoppedRuntimeStatus(report launchReport) {
	f.t.Helper()
	if report.Status != "blocked" {
		f.t.Fatalf("stopped runtime status = %q, want blocked; report=%#v", report.Status, report)
	}
	if report.Code != "not_running" {
		f.t.Fatalf("stopped runtime code = %q, want not_running; report=%#v", report.Code, report)
	}
	if report.LocalUIURL != "" || report.RuntimeControl != nil {
		f.t.Fatalf("stopped runtime exposed open surfaces: %#v", report)
	}
	if report.Diagnostics == nil {
		f.t.Fatalf("stopped runtime did not expose diagnostics: %#v", report)
	}
	if report.Diagnostics.AttachState != report.Code {
		f.t.Fatalf("stopped runtime attach_state = %q, want %q; diagnostics=%#v", report.Diagnostics.AttachState, report.Code, report.Diagnostics)
	}
	if report.Diagnostics.PIDAlive || report.Diagnostics.SocketReachable {
		f.t.Fatalf("stopped runtime diagnostics should not report a live reachable runtime: %#v", report.Diagnostics)
	}
}

func (f *fixture) waitReady(ctx context.Context) launchReport {
	f.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	var lastErr error
	var last launchReport
	for time.Now().Before(deadline) {
		report, err := f.runtimeStatus(ctx)
		if err == nil {
			last = report
			if report.Status == "ready" && report.LocalUIURL != "" && report.RuntimeControl != nil && report.PID > 0 {
				f.assertReadyRuntimeStatus(report)
				return report
			}
			lastErr = fmt.Errorf("runtime status is not ready: %#v", report)
		} else {
			lastErr = err
		}
		time.Sleep(250 * time.Millisecond)
	}
	f.dumpContainerDiagnostics(ctx)
	f.t.Fatalf("runtime did not become ready: %v; last=%#v", lastErr, last)
	return launchReport{}
}

func (f *fixture) assertReadyRuntimeStatus(report launchReport) {
	f.t.Helper()
	if !report.DesktopManaged || report.DesktopOwnerID != desktopOwnerID {
		f.t.Fatalf("ready runtime ownership = desktop_managed:%v owner:%q, want owner %q; report=%#v", report.DesktopManaged, report.DesktopOwnerID, desktopOwnerID, report)
	}
	if report.RuntimeControl == nil || report.RuntimeControl.DesktopOwnerID != desktopOwnerID || report.RuntimeControl.Token == "" {
		f.t.Fatalf("ready runtime-control endpoint is incomplete: %#v", report.RuntimeControl)
	}
	if report.RuntimeService == nil {
		f.t.Fatalf("ready status did not include runtime_service: %#v", report)
	}
}

func (f *fixture) waitPingAfter(ctx context.Context, previousProcessStartedAtMs int64) pingSnapshot {
	f.t.Helper()
	deadline := time.Now().Add(35 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		status, err := f.runtimeStatus(ctx)
		if err == nil && status.Status == "ready" && status.LocalUIURL != "" {
			result, helperErr := f.tryHelper(ctx, status.LocalUIURL, "ping", "")
			if helperErr == nil && result.Ping != nil && result.Ping.ProcessStartedAtMs > previousProcessStartedAtMs {
				return pingSnapshot{
					LocalUIURL:            status.LocalUIURL,
					ProcessStartedAtMs:    result.Ping.ProcessStartedAtMs,
					Version:               result.Ping.Version,
					RuntimeServiceVersion: runtimeServiceVersion(result.Ping.RuntimeService),
				}
			}
			lastErr = helperErr
		} else if err != nil {
			lastErr = err
		}
		time.Sleep(300 * time.Millisecond)
	}
	f.dumpContainerDiagnostics(ctx)
	f.t.Fatalf("runtime did not restart after process_started_at_ms=%d: %v", previousProcessStartedAtMs, lastErr)
	return pingSnapshot{}
}

func runtimeServiceVersion(snapshot *struct {
	RuntimeVersion string `json:"runtime_version,omitempty"`
}) string {
	if snapshot == nil {
		return ""
	}
	return strings.TrimSpace(snapshot.RuntimeVersion)
}

func (f *fixture) runtimeStatus(ctx context.Context) (launchReport, error) {
	out, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-i", f.containerName,
		containerRedeven, "desktop-runtime-status",
		"--state-root", containerStateRoot,
		"--probe-timeout", "2s",
	)
	if err != nil {
		return launchReport{}, err
	}
	var report launchReport
	if err := json.Unmarshal([]byte(out.Stdout), &report); err != nil {
		return launchReport{}, fmt.Errorf("decode desktop-runtime-status: %w; stdout=%q", err, out.Stdout)
	}
	return report, nil
}

func (f *fixture) runHelper(ctx context.Context, baseURL string, action string, targetVersion string) helperResult {
	f.t.Helper()
	result, err := f.tryHelper(ctx, baseURL, action, targetVersion)
	if err != nil {
		f.dumpContainerDiagnostics(ctx)
		f.t.Fatalf("helper %s failed: %v", action, err)
	}
	return result
}

func (f *fixture) tryHelper(ctx context.Context, baseURL string, action string, targetVersion string) (helperResult, error) {
	args := []string{
		"exec", "-i", f.containerName,
		containerHelper,
		"--base-url", baseURL,
		"--action", action,
	}
	if strings.TrimSpace(targetVersion) != "" {
		args = append(args, "--target-version", targetVersion)
	}
	out, err := f.runHost(ctx, f.repoRoot, nil, "docker", args...)
	if err != nil {
		return helperResult{}, err
	}
	var result helperResult
	if err := json.Unmarshal([]byte(out.Stdout), &result); err != nil {
		return helperResult{}, fmt.Errorf("decode helper output: %w; stdout=%q", err, out.Stdout)
	}
	return result, nil
}

func (f *fixture) openBridgeAndAssertRequests(ctx context.Context, status launchReport) desktopbridge.Hello {
	f.t.Helper()
	bridgeCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(bridgeCtx,
		"docker", "exec", "-i",
		"--env", "REDEVEN_DESKTOP_OWNER_ID="+desktopOwnerID,
		f.containerName,
		containerRedeven, "desktop-bridge",
		"--state-root", containerStateRoot,
	)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		f.t.Fatalf("bridge stdin: %v", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		f.t.Fatalf("bridge stdout: %v", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		f.t.Fatalf("start bridge: %v", err)
	}
	defer func() {
		_ = desktopbridge.WriteFrame(stdin, desktopbridge.FrameHeader{StreamID: "shutdown", Type: desktopbridge.FrameTypeShutdownRuntime}, nil)
		_ = stdin.Close()
		cancel()
		_ = cmd.Wait()
	}()

	reader := bufio.NewReader(stdout)
	header, payload, err := desktopbridge.ReadFrame(reader)
	if err != nil {
		f.t.Fatalf("read bridge hello: %v; stderr=%s", err, stderr.String())
	}
	if header.Type != desktopbridge.FrameTypeHello {
		f.t.Fatalf("first bridge frame type = %q, want hello", header.Type)
	}
	var hello desktopbridge.Hello
	if err := json.Unmarshal(payload, &hello); err != nil {
		f.t.Fatalf("decode bridge hello: %v", err)
	}
	if !hello.LocalUI.Available || !hello.RuntimeControl.Available {
		f.t.Fatalf("bridge hello missing surfaces: %#v", hello)
	}
	if hello.RuntimeControl.Token == "" || hello.RuntimeControl.DesktopOwnerID != desktopOwnerID {
		f.t.Fatalf("unexpected runtime-control hello: %#v", hello.RuntimeControl)
	}

	localURL, err := url.Parse(status.LocalUIURL)
	if err != nil || localURL.Host == "" {
		f.t.Fatalf("parse Local UI URL %q: %v", status.LocalUIURL, err)
	}
	localBody := bridgeHTTPRequest(f.t, reader, stdin, "local-ui-e2e", desktopbridge.StreamSurfaceLocalUI, "GET /api/local/runtime/health HTTP/1.1\r\nHost: "+localURL.Host+"\r\nConnection: close\r\n\r\n")
	assertContains(f.t, string(localBody), `"status":"online"`)
	assertContains(f.t, string(localBody), `"desktop_managed":true`)

	if status.RuntimeControl == nil {
		f.t.Fatal("runtime status did not include runtime-control")
	}
	controlURL, err := url.Parse(status.RuntimeControl.BaseURL)
	if err != nil || controlURL.Host == "" {
		f.t.Fatalf("parse runtime-control URL %q: %v", status.RuntimeControl.BaseURL, err)
	}
	controlRequest := fmt.Sprintf(
		"GET /v1/provider-link HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nX-Redeven-Desktop-Owner-ID: %s\r\nConnection: close\r\n\r\n",
		controlURL.Host,
		hello.RuntimeControl.Token,
		hello.RuntimeControl.DesktopOwnerID,
	)
	controlBody := bridgeHTTPRequest(f.t, reader, stdin, "runtime-control-e2e", desktopbridge.StreamSurfaceRuntimeControl, controlRequest)
	assertContains(f.t, string(controlBody), `"ok":true`)
	assertContains(f.t, string(controlBody), `"runtime_service"`)

	if status.RuntimeControl.Token != hello.RuntimeControl.Token {
		f.t.Fatalf("bridge hello token does not match status endpoint")
	}
	return hello
}

func bridgeHTTPRequest(t *testing.T, reader *bufio.Reader, writer io.Writer, streamID string, surface desktopbridge.StreamSurface, request string) []byte {
	t.Helper()
	payload, err := json.Marshal(desktopbridge.StreamOpen{Surface: surface})
	if err != nil {
		t.Fatalf("marshal stream open: %v", err)
	}
	if err := desktopbridge.WriteFrame(writer, desktopbridge.FrameHeader{StreamID: streamID, Type: desktopbridge.FrameTypeStreamOpen}, payload); err != nil {
		t.Fatalf("write stream open: %v", err)
	}
	if err := desktopbridge.WriteFrame(writer, desktopbridge.FrameHeader{StreamID: streamID, Type: desktopbridge.FrameTypeStreamData}, []byte(request)); err != nil {
		t.Fatalf("write stream data: %v", err)
	}
	var raw bytes.Buffer
	for {
		header, payload, err := desktopbridge.ReadFrame(reader)
		if err != nil {
			t.Fatalf("read bridge frame: %v", err)
		}
		if header.StreamID != streamID {
			continue
		}
		switch header.Type {
		case desktopbridge.FrameTypeStreamData:
			raw.Write(payload)
		case desktopbridge.FrameTypeStreamClose:
			return httpBody(t, raw.Bytes())
		case desktopbridge.FrameTypeStreamError:
			t.Fatalf("bridge stream error: %s", string(payload))
		}
	}
}

func httpBody(t *testing.T, raw []byte) []byte {
	t.Helper()
	resp, err := http.ReadResponse(bufio.NewReader(bytes.NewReader(raw)), nil)
	if err != nil {
		t.Fatalf("parse HTTP response: %v; raw=%q", err, string(raw))
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read HTTP response body: %v", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		t.Fatalf("HTTP status = %d; body=%s", resp.StatusCode, string(body))
	}
	return body
}

func (f *fixture) runSecondRuntimeAttach(ctx context.Context) launchReport {
	f.t.Helper()
	reportPath := "/tmp/redeven-e2e/second-runtime-report.json"
	f.dockerExec(ctx, nil, "rm", "-f", reportPath)
	out, err := f.runHost(ctx, f.repoRoot, nil,
		"docker", "exec", "-i",
		"--env", "REDEVEN_DESKTOP_OWNER_ID="+desktopOwnerID,
		f.containerName,
		managedRedeven, "run",
		"--mode", "desktop",
		"--desktop-managed",
		"--state-root", containerStateRoot,
		"--local-ui-bind", "127.0.0.1:0",
		"--startup-report-file", reportPath,
	)
	if err != nil {
		f.t.Fatalf("second runtime attach command failed: %v; stdout=%s", err, out.Stdout)
	}
	reportRaw := f.dockerExec(ctx, nil, "cat", reportPath).Stdout
	var report launchReport
	if err := json.Unmarshal([]byte(reportRaw), &report); err != nil {
		f.t.Fatalf("decode second runtime report: %v; report=%s", err, reportRaw)
	}
	return report
}

func (f *fixture) dockerExec(ctx context.Context, stdin io.Reader, args ...string) commandResult {
	f.t.Helper()
	fullArgs := append([]string{"exec", "-i", f.containerName}, args...)
	out, err := f.runHost(ctx, f.repoRoot, stdin, "docker", fullArgs...)
	if err != nil {
		f.t.Fatalf("docker %s failed: %v", strings.Join(fullArgs, " "), err)
	}
	return out
}

func (f *fixture) runHost(ctx context.Context, dir string, stdin io.Reader, name string, args ...string) (commandResult, error) {
	return f.runHostCommand(ctx, dir, nil, stdin, name, args...)
}

func (f *fixture) runHostEnv(ctx context.Context, dir string, env []string, name string, args ...string) (commandResult, error) {
	return f.runHostCommand(ctx, dir, env, nil, name, args...)
}

func (f *fixture) runHostCommand(ctx context.Context, dir string, env []string, stdin io.Reader, name string, args ...string) (commandResult, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	if len(env) > 0 {
		cmd.Env = env
	}
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	result := commandResult{Stdout: stdout.String(), Stderr: stderr.String()}
	if err != nil {
		return result, fmt.Errorf("%s %s: %w\nstdout:\n%s\nstderr:\n%s", name, strings.Join(args, " "), err, result.Stdout, result.Stderr)
	}
	return result, nil
}

func (f *fixture) cleanup(ctx context.Context) {
	_, _ = f.runHost(ctx, f.repoRoot, nil, "docker", "rm", "-f", f.containerName)
}

func (f *fixture) dumpContainerDiagnostics(ctx context.Context) {
	if f == nil || f.t == nil || f.containerName == "" {
		return
	}
	if status, err := f.runtimeStatus(ctx); err == nil {
		body, _ := json.MarshalIndent(status, "", "  ")
		f.t.Logf("last runtime status:\n%s", string(body))
	}
	if logs, err := f.runHost(ctx, f.repoRoot, nil, "docker", "logs", "--tail", "200", f.containerName); err == nil {
		f.t.Logf("container logs stdout:\n%s\nstderr:\n%s", logs.Stdout, logs.Stderr)
	}
	if ps, err := f.runHost(ctx, f.repoRoot, nil, "docker", "exec", "-i", f.containerName, "ps", "-ef"); err == nil {
		f.t.Logf("container ps:\n%s", ps.Stdout)
	}
}

func assertContains(t *testing.T, haystack string, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Fatalf("expected %q to contain %q", haystack, needle)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestMain(m *testing.M) {
	if runtime.GOOS == "windows" {
		fmt.Fprintln(os.Stderr, "docker runtime e2e is not supported on Windows")
		os.Exit(1)
	}
	os.Exit(m.Run())
}

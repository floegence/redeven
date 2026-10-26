package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayhost"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/processenv"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	processlib "github.com/shirou/gopsutil/v4/process"
)

var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
)

const managedDesktopBridgeEnv = "REDEVEN_GATEWAY_MANAGED_DESKTOP_BRIDGE"

const gatewayServiceReadyWait = 15 * time.Second

type cli struct {
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
}

type serviceStatus = gatewayhost.ServiceRecord

type gatewayStartupFailure struct {
	SchemaVersion    int    `json:"schema_version"`
	PID              int    `json:"pid,omitempty"`
	Code             string `json:"code"`
	Reason           string `json:"reason"`
	Recovery         string `json:"recovery,omitempty"`
	StateFile        string `json:"state_file,omitempty"`
	StateFingerprint string `json:"state_fingerprint,omitempty"`
}

func main() {
	os.Exit(runCLI(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func runCLI(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	return (&cli{stdin: stdin, stdout: stdout, stderr: stderr}).run(args)
}

func (c *cli) run(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, rootHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "members", "invite", "policy", "endpoints", "clients":
		return c.membershipCmd(args)
	case "cloud-status":
		return c.cloudStatusCmd(args[1:])
	case "cloud-connect":
		return c.cloudConnectCmd(args[1:])
	case "serve":
		return c.serveCmd(args[1:])
	case "desktop-bridge":
		return c.desktopBridgeCmd(args[1:])
	case "service-status":
		return c.serviceStatusCmd(args[1:])
	case "service-start":
		return c.serviceStartCmd(args[1:])
	case "service-stop":
		return c.serviceStopCmd(args[1:])
	case "version":
		fmt.Fprintf(c.stdout, "redeven-gateway %s (%s) %s\n", Version, Commit, BuildTime)
		return 0
	default:
		writeError(c.stderr, fmt.Sprintf("unknown command: %s", strings.TrimSpace(args[0])))
		return 2
	}
}

func (c *cli) cloudConnectCmd(args []string) int {
	fs := newFlagSet("cloud-connect")
	jsonOutput := fs.Bool("json", false, "Return machine-readable Cloud approval details.")
	reauthorize := fs.Bool("reauthorize", false, "Register a new identity after revocation or expiry; requires new Namespace approval. Existing local memberships are retained.")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	cloudOrigin := fs.String("cloud", gatewaycloud.DefaultCloudOrigin, "Redeven Cloud HTTPS origin (advanced override; defaults to the official Cloud).")
	if err := parseFlags(fs, args); err != nil || fs.NArg() != 0 {
		writeError(c.stderr, "Usage: redeven-gateway cloud-connect [--cloud https://custom-cloud.example] [--state-root path]")
		return 2
	}
	origin := strings.TrimSpace(*cloudOrigin)
	if origin == "" {
		origin = gatewaycloud.DefaultCloudOrigin
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	root := normalizeStateRoot(*stateRoot)
	starter := *c
	starter.stdout = c.stderr
	if code := starter.serviceStartCmd([]string{"--state-root", root}); code != 0 {
		return code
	}
	client, err := newHostAdminClient(root)
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	defer client.client.Close()
	var response gc.Gateway
	err = client.request(ctx, "/gateway/v6/cloud/configure", gp.ConfigureCloudRequest{ProtocolVersion: gp.Version, CloudOrigin: origin, Reauthorize: *reauthorize}, &response)
	gateway := &response
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	if *jsonOutput {
		_ = json.NewEncoder(c.stdout).Encode(gatewaycloud.Summary{Configured: true, CloudOrigin: origin, GatewayPublicID: gateway.PublicID, NamespacePublicID: gateway.NamespacePublicID, Region: gateway.Region, State: gateway.State, ManagementURL: gatewaycloud.GatewayManagementURL(origin, gateway.NamespacePublicID, gateway.PublicID, gateway.PublicKeySHA256)})
		return 0
	}
	fmt.Fprintf(c.stdout, "Approve Gateway access in Redeven Cloud:\n%s\n", gatewaycloud.GatewayManagementURL(origin, gateway.NamespacePublicID, gateway.PublicID, gateway.PublicKeySHA256))
	return 0
}

func (c *cli) serveCmd(args []string) int {
	fs := newFlagSet("serve")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	listen := fs.String("listen", "127.0.0.1:0", "Gateway listen address.")
	memberURL := fs.String("member-url", "", "Advertised HTTPS member endpoint.")
	memberListen := fs.String("member-listen", "", "Member TLS listen address (new Gateway default: :7443).")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, serveHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	if fs.NArg() != 0 {
		writeError(c.stderr, "`redeven-gateway serve` does not accept positional arguments")
		return 2
	}
	ctx, stop := signalContext()
	defer stop()
	stateRootValue := normalizeStateRoot(*stateRoot)
	managedBridgeToken := ""
	if managedDesktopBridgeService() {
		managedBridgeToken = readManagedBridgeToken(stateRootValue)
		if managedBridgeToken == "" {
			writeError(c.stderr, "serve failed: managed Gateway bridge token is missing")
			return 1
		}
	}
	return c.runGatewayService(ctx, stateRootValue, *listen, managedDesktopBridgeService(), true, *memberURL, *memberListen, managedBridgeToken)
}

func (c *cli) desktopBridgeCmd(args []string) int {
	fs := newFlagSet("desktop-bridge")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, desktopBridgeHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	if fs.NArg() != 0 {
		writeError(c.stderr, "`redeven-gateway desktop-bridge` does not accept positional arguments")
		return 2
	}
	stateRootValue := normalizeStateRoot(*stateRoot)
	status := readServiceStatus(stateRootValue)
	if status.Status != "running" || strings.TrimSpace(status.Listen) == "" {
		writeError(c.stderr, "desktop-bridge failed: Gateway service is not running")
		return 1
	}
	managedBridgeToken := readManagedBridgeToken(stateRootValue)
	hostClient, err := newHostAdminClient(stateRootValue)
	if err != nil {
		writeError(c.stderr, "desktop-bridge failed: Gateway host management credential is unavailable")
		return 1
	}
	defer hostClient.client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	executablePath, err := os.Executable()
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("desktop-bridge failed: resolve Gateway executable: %v", err))
		return 1
	}
	bridge := desktopbridge.Server{
		DialSurface: hostClient.client.SurfaceDialer("https://" + status.MemberListen),
		Hello: desktopbridge.Hello{
			RuntimeVersion:  Version,
			RuntimeCommit:   Commit,
			StartedAtUnixMS: time.Now().UnixMilli(),
			LocalUI: desktopbridge.HelloLocalUI{
				Available: false,
				BasePath:  "/",
			},
			RuntimeControl: desktopbridge.RuntimeControl{Available: false},
			GatewayProtocol: desktopbridge.GatewayProtocol{
				Available:          true,
				CompatibilityEpoch: gp.CompatibilityEpoch,
			},
			GatewayService: &desktopbridge.GatewayService{
				StateRoot:          stateRootValue,
				ExecutablePath:     filepath.Clean(executablePath),
				ServicePID:         status.PID,
				ManagedBridgeToken: managedBridgeToken,
			},
		},
		OnShutdown: cancel,
	}
	if err := bridge.Serve(ctx, c.stdin, c.stdout); err != nil && !errors.Is(err, context.Canceled) {
		writeError(c.stderr, fmt.Sprintf("desktop-bridge failed: %v", err))
		return 1
	}
	return 0
}

func (c *cli) serviceStatusCmd(args []string) int {
	fs := newFlagSet("service-status")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, serviceStatusHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	status := readServiceStatus(normalizeStateRoot(*stateRoot))
	_ = json.NewEncoder(c.stdout).Encode(status)
	if status.Status == "running" {
		return 0
	}
	return 1
}

func (c *cli) serviceStartCmd(args []string) int {
	fs := newFlagSet("service-start")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	listen := fs.String("listen", "127.0.0.1:0", "Gateway listen address.")
	memberURL := fs.String("member-url", "", "Advertised HTTPS member endpoint.")
	memberListen := fs.String("member-listen", "", "Member TLS listen address (new Gateway default: :7443).")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, serviceStartHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	stateRootValue := normalizeStateRoot(*stateRoot)
	if status := readServiceStatus(stateRootValue); status.Status == "running" {
		_ = json.NewEncoder(c.stdout).Encode(status)
		return 0
	}
	exe, err := os.Executable()
	if err != nil {
		return c.failServiceStart(stateRootValue, err)
	}
	logPath := filepath.Join(stateRootValue, "gateway-service.log")
	if err := os.MkdirAll(stateRootValue, 0o700); err != nil {
		return c.failServiceStart(stateRootValue, err)
	}
	if _, err := ensureManagedBridgeToken(stateRootValue); err != nil {
		return c.failServiceStart(stateRootValue, err)
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return c.failServiceStart(stateRootValue, err)
	}
	defer logFile.Close()
	cmdArgs := gatewayServiceServeArgs(stateRootValue, strings.TrimSpace(*listen))
	if *memberURL != "" {
		cmdArgs = append(cmdArgs, "--member-url", *memberURL)
	}
	if *memberListen != "" {
		cmdArgs = append(cmdArgs, "--member-listen", *memberListen)
	}
	cmd := exec.Command(exe, cmdArgs...)
	configureDetachedProcess(cmd)
	cmd.Env = append(processenv.Current(), managedDesktopBridgeEnv+"=1")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	_ = removePIDFile(stateRootValue)
	_ = os.Remove(gatewayStartupFailurePath(stateRootValue))
	if err := cmd.Start(); err != nil {
		return c.failServiceStart(stateRootValue, err)
	}
	childPID := cmd.Process.Pid
	// Reap failed children. Signal zero also succeeds for zombies and cannot
	// distinguish an exited Gateway from one still preparing its listeners.
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	status, err := waitServiceReady(stateRootValue, childPID, exited, gatewayServiceReadyWait)
	if err != nil {
		_ = cmd.Process.Kill()
		select {
		case <-exited:
		case <-time.After(time.Second):
		}
		failure := gatewayStartupFailureForError(err)
		failure.PID = childPID
		_ = writeGatewayStartupFailure(stateRootValue, failure)
		_ = json.NewEncoder(c.stdout).Encode(startupFailureStatus(stateRootValue, failure))
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	_ = json.NewEncoder(c.stdout).Encode(status)
	return 0
}

func (c *cli) failServiceStart(root string, err error) int {
	failure := gatewayStartupFailureForError(err)
	failure.PID = 0
	_ = writeGatewayStartupFailure(root, failure)
	_ = json.NewEncoder(c.stdout).Encode(startupFailureStatus(root, failure))
	writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
	return 1
}

func gatewayServiceServeArgs(stateRoot string, listen string) []string {
	return []string{"serve", "--state-root", stateRoot, "--listen", listen}
}

func (c *cli) serviceStopCmd(args []string) int {
	fs := newFlagSet("service-stop")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, serviceStopHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	stateRootValue := normalizeStateRoot(*stateRoot)
	status := readServiceStatus(stateRootValue)
	if status.Status != "running" || status.PID <= 0 {
		_ = removePIDFile(stateRootValue)
		_ = removeManagedBridgeToken(stateRootValue)
		_ = json.NewEncoder(c.stdout).Encode(serviceStatus{Status: "not_running", StateRoot: stateRootValue})
		return 0
	}
	if !serviceProcessMatches(status) {
		_ = removePIDFile(stateRootValue)
		_ = removeManagedBridgeToken(stateRootValue)
		_ = json.NewEncoder(c.stdout).Encode(serviceStatus{Status: "not_running", StateRoot: stateRootValue})
		return 0
	}
	process, err := os.FindProcess(status.PID)
	if err == nil {
		_ = process.Signal(syscall.SIGTERM)
	}
	stopped, stopErr := waitGatewayServiceStopped(stateRootValue, status, 5*time.Second)
	if stopErr != nil {
		writeError(c.stderr, fmt.Sprintf("service-stop failed: %v", stopErr))
		return 1
	}
	if !stopped && process != nil && serviceProcessMatches(status) {
		_ = process.Kill()
	}
	if !stopped {
		stopped, stopErr = waitGatewayServiceStopped(stateRootValue, status, 2*time.Second)
	}
	if stopErr != nil || !stopped {
		if stopErr == nil {
			stopErr = errors.New("gateway service did not release its state-root lock before the shutdown timeout")
		}
		writeError(c.stderr, fmt.Sprintf("service-stop failed: %v", stopErr))
		return 1
	}
	_ = removePIDFile(stateRootValue)
	_ = removeManagedBridgeToken(stateRootValue)
	_ = json.NewEncoder(c.stdout).Encode(serviceStatus{Status: "not_running", StateRoot: stateRootValue})
	return 0
}

func waitGatewayServiceStopped(stateRoot string, status serviceStatus, timeout time.Duration) (bool, error) {
	deadline := time.Now().Add(timeout)
	for {
		stopped, err := gatewayServiceStopped(stateRoot, status)
		if err != nil || stopped {
			return stopped, err
		}
		if !time.Now().Before(deadline) {
			return false, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func gatewayServiceStopped(stateRoot string, status serviceStatus) (bool, error) {
	if serviceProcessMatches(status) {
		return false, nil
	}
	serviceLock, err := lockfile.Acquire(filepath.Join(stateRoot, "gateway-service.lock"))
	if errors.Is(err, lockfile.ErrAlreadyLocked) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := serviceLock.Release(); err != nil {
		return false, err
	}
	return true, nil
}

func (c *cli) runGatewayService(ctx context.Context, stateRoot string, listen string, desktopBridgeTransport bool, printListen bool, memberURL string, memberListen string, managedBridgeToken string) int {
	stateRootValue := normalizeStateRoot(stateRoot)
	if err := os.MkdirAll(stateRootValue, 0o700); err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: initialize Gateway state root: %v", err))
		return 1
	}
	serviceLock, err := lockfile.Acquire(filepath.Join(stateRootValue, "gateway-service.lock"))
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			writeError(c.stderr, "serve failed: another Gateway service is already running for this state root")
			return 1
		}
		writeError(c.stderr, fmt.Sprintf("serve failed: acquire Gateway service lock: %v", err))
		return 1
	}
	defer func() { _ = serviceLock.Release() }()
	_ = os.Remove(gatewayStartupFailurePath(stateRootValue))
	hostToken, err := randomTokenB64u(32)
	if err != nil {
		return c.failGatewayStartup(stateRootValue, err)
	}
	if err := gatewaystate.Write(hostAdminTokenPath(stateRootValue), hostToken); err != nil {
		return c.failGatewayStartup(stateRootValue, err)
	}
	defer os.Remove(hostAdminTokenPath(stateRootValue))
	serviceOptions := gatewayservice.Options{Version: Version,
		StateRoot:              stateRootValue,
		DesktopBridgeTransport: desktopBridgeTransport,
		MemberURL:              memberURL,
		MemberListen:           memberListen,
		ManagedBridgeToken:     managedBridgeToken,
		HostAdminToken:         hostToken,
	}
	svc, err := gatewayservice.New(serviceOptions)
	if err != nil {
		return c.failGatewayStartup(stateRootValue, err)
	}
	srv, listeners, err := svc.Start(ctx, listen)
	if err != nil {
		return c.failGatewayStartup(stateRootValue, err)
	}
	defer srv.Close()
	if len(listeners) > 0 {
		actualListen := listeners[0].Addr().String()
		memberAddress := listeners[1].Addr().(*net.TCPAddr)
		memberHost := memberAddress.IP.String()
		if memberAddress.IP.IsUnspecified() {
			memberHost = "127.0.0.1"
			if memberAddress.IP.To4() == nil {
				memberHost = "::1"
			}
		}
		if err := writePIDFile(stateRootValue, os.Getpid(), actualListen, net.JoinHostPort(memberHost, strconv.Itoa(memberAddress.Port))); err != nil {
			return c.failGatewayStartup(stateRootValue, err)
		}
		if printListen {
			fmt.Fprintf(c.stdout, "redeven-gateway listening on %s\n", actualListen)
		}
	}
	reload := make(chan os.Signal, 1)
	signal.Notify(reload, syscall.SIGHUP)
	defer signal.Stop(reload)
	for running := true; running; {
		select {
		case <-ctx.Done():
			running = false
		case <-reload:
			if err := svc.ReloadHooks(); err != nil {
				// Never print hook content or executable output.
				writeError(c.stderr, "POLICY_CONFIG_INVALID: Gateway hooks now deny access; correct policy-hooks.json and reload")
			}
		}
	}
	_ = removePIDFile(stateRootValue)
	return 0
}

func (c *cli) failGatewayStartup(stateRoot string, err error) int {
	failure := gatewayStartupFailureForError(err)
	if failure.StateFile != "" {
		failure.StateFingerprint = startupStateFingerprint(stateRoot, failure.StateFile)
	}
	_ = writeGatewayStartupFailure(stateRoot, failure)
	writeError(c.stderr, fmt.Sprintf("serve failed: %v", err))
	return 1
}

func gatewayStartupFailureForError(err error) gatewayStartupFailure {
	failure := gatewayStartupFailure{SchemaVersion: 1, PID: os.Getpid(), Code: "gateway_startup_failed"}
	if err != nil {
		failure.Reason = err.Error()
	}
	var startup *gatewayStartupError
	var state *gatewaystate.ReadError
	switch {
	case errors.As(err, &startup):
		return startup.failure
	case errors.As(err, &state):
		failure.Code = state.Code
		failure.StateFile = state.File
	case errors.Is(err, gatewaymembership.ErrState):
		failure.Code = "gateway_state_invalid"
		failure.StateFile = "members.json"
	}
	switch failure.Code {
	case "gateway_state_unsupported", "gateway_state_invalid":
		failure.Recovery = "Stop Gateway and recreate its local configuration on its host, then enroll members again. Preserve the machine identity. Cloud authorizations are unchanged."
	case "gateway_state_unavailable":
		failure.Recovery = "Correct access to the Gateway state directory, then retry. Existing state was not changed."
	}
	return failure
}

type gatewayStartupError struct{ failure gatewayStartupFailure }

func (e *gatewayStartupError) Error() string {
	message := e.failure.Code + ": " + e.failure.Reason
	if e.failure.Recovery != "" {
		message += " Recovery: " + e.failure.Recovery
	}
	return message
}

func startupFailureStatus(root string, failure gatewayStartupFailure) serviceStatus {
	return serviceStatus{Status: "error", StateRoot: root, ErrorCode: failure.Code, ErrorMessage: failure.Reason, Recovery: failure.Recovery}
}

func stoppedServiceStatus(root string) serviceStatus {
	if failure := readGatewayStartupFailure(root); failure.Code != "" {
		// A repaired or deliberately recreated file invalidates its diagnostic.
		// Status inspection stays read-only and never repairs the private state.
		if failure.StateFile != "" && failure.StateFingerprint != startupStateFingerprint(root, failure.StateFile) {
			return serviceStatus{Status: "not_running", StateRoot: root}
		}
		return startupFailureStatus(root, failure)
	}
	return serviceStatus{Status: "not_running", StateRoot: root}
}

func startupStateFingerprint(root, name string) string {
	if filepath.Base(name) != name {
		return "invalid-path"
	}
	file := filepath.Join(root, name)
	hash := sha256.New()
	info, err := os.Lstat(file)
	if err != nil {
		return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("stat:%T:%v", err, err))))
	}
	fmt.Fprintf(hash, "mode:%d:size:%d:", info.Mode(), info.Size())
	if info.Mode().IsRegular() {
		reader, err := os.Open(file)
		if err != nil {
			fmt.Fprintf(hash, "open:%T:%v", err, err)
		} else {
			_, _ = io.Copy(hash, io.LimitReader(reader, (64<<20)+1))
			_ = reader.Close()
		}
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}

func normalizeStateRoot(raw string) string {
	clean := strings.TrimSpace(raw)
	if clean != "" {
		return clean
	}
	if env := strings.TrimSpace(os.Getenv("REDEVEN_GATEWAY_STATE_ROOT")); env != "" {
		return env
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return filepath.Join(".redeven", "gateways", "default", "state")
	}
	return filepath.Join(home, ".redeven", "gateways", "default", "state")
}

func pidFilePath(stateRoot string) string {
	return filepath.Join(stateRoot, "gateway-service.pid.json")
}

func gatewayStartupFailurePath(stateRoot string) string {
	return filepath.Join(stateRoot, "gateway-startup-failure-v1.json")
}

func writeGatewayStartupFailure(stateRoot string, failure gatewayStartupFailure) error {
	raw, err := json.MarshalIndent(failure, "", "  ")
	if err != nil {
		return err
	}
	temporaryPath := gatewayStartupFailurePath(stateRoot) + ".tmp"
	if err := os.WriteFile(temporaryPath, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporaryPath, gatewayStartupFailurePath(stateRoot))
}

func readGatewayStartupFailure(stateRoot string) gatewayStartupFailure {
	raw, err := os.ReadFile(gatewayStartupFailurePath(stateRoot))
	if err != nil {
		return gatewayStartupFailure{}
	}
	var failure gatewayStartupFailure
	if json.Unmarshal(raw, &failure) != nil || failure.SchemaVersion != 1 {
		return gatewayStartupFailure{}
	}
	return failure
}

func writePIDFile(stateRoot string, pid int, listen string, memberListen string) error {
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		return err
	}
	exe, _ := os.Executable()
	body, err := json.MarshalIndent(serviceStatus{
		Status:                 "running",
		PID:                    pid,
		Listen:                 strings.TrimSpace(listen),
		MemberListen:           strings.TrimSpace(memberListen),
		StateRoot:              stateRoot,
		Executable:             strings.TrimSpace(exe),
		ProcessStartedAtUnixMS: processStartedAtUnixMS(pid),
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(pidFilePath(stateRoot), append(body, '\n'), 0o600)
}

func removePIDFile(stateRoot string) error {
	return os.Remove(pidFilePath(stateRoot))
}

func managedBridgeTokenPath(stateRoot string) string {
	return filepath.Join(stateRoot, "gateway-managed-bridge.token")
}

func ensureManagedBridgeToken(stateRoot string) (string, error) {
	existing := readManagedBridgeToken(stateRoot)
	if existing != "" {
		return existing, nil
	}
	token, err := randomTokenB64u(32)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(managedBridgeTokenPath(stateRoot), []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	return token, nil
}

func readManagedBridgeToken(stateRoot string) string {
	body, err := os.ReadFile(managedBridgeTokenPath(stateRoot))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

func removeManagedBridgeToken(stateRoot string) error {
	return os.Remove(managedBridgeTokenPath(stateRoot))
}

func randomTokenB64u(n int) (string, error) {
	if n <= 0 {
		return "", errors.New("token byte length must be positive")
	}
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func readServiceStatus(stateRoot string) serviceStatus {
	body, err := os.ReadFile(pidFilePath(stateRoot))
	if err != nil {
		return stoppedServiceStatus(stateRoot)
	}
	var status serviceStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return serviceStatus{Status: "error", StateRoot: stateRoot, ErrorMessage: "Gateway status file is invalid."}
	}
	status.StateRoot = stateRoot
	if status.PID <= 0 || !serviceProcessMatchesEventually(status, 3, 10*time.Millisecond, serviceProcessMatches) {
		return stoppedServiceStatus(stateRoot)
	}
	if strings.TrimSpace(status.Listen) == "" || strings.TrimSpace(status.Listen) == "127.0.0.1:0" {
		return serviceStatus{Status: "not_running", StateRoot: stateRoot, ErrorMessage: "Gateway service has not published a listen address yet."}
	}
	status.Status = "running"
	return status
}

func serviceProcessMatchesEventually(status serviceStatus, attempts int, delay time.Duration, probe func(serviceStatus) bool) bool {
	if attempts <= 0 || probe == nil {
		return false
	}
	for attempt := 0; attempt < attempts; attempt++ {
		if probe(status) {
			return true
		}
		if attempt+1 < attempts && delay > 0 {
			time.Sleep(delay)
		}
	}
	return false
}

func processStartedAtUnixMS(pid int) int64 {
	if pid <= 0 {
		return 0
	}
	process, err := processlib.NewProcess(int32(pid))
	if err != nil {
		return 0
	}
	started, err := process.CreateTime()
	if err != nil {
		return 0
	}
	return started
}

func serviceProcessMatches(status serviceStatus) bool {
	if status.PID <= 0 || !pidRunning(status.PID) || strings.TrimSpace(status.Executable) == "" {
		return false
	}
	process, err := processlib.NewProcess(int32(status.PID))
	if err != nil {
		return false
	}
	if status.ProcessStartedAtUnixMS > 0 {
		started, err := process.CreateTime()
		if err != nil || started != status.ProcessStartedAtUnixMS {
			return false
		}
	}
	actual, err := process.Exe()
	if err != nil {
		return false
	}
	expectedPath, expectedErr := filepath.EvalSymlinks(status.Executable)
	actualPath, actualErr := filepath.EvalSymlinks(actual)
	if expectedErr == nil && actualErr == nil {
		return filepath.Clean(expectedPath) == filepath.Clean(actualPath)
	}
	return filepath.Clean(status.Executable) == filepath.Clean(actual)
}

func waitServiceReady(stateRoot string, expectedPID int, exited <-chan struct{}, timeout time.Duration) (serviceStatus, error) {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	exitFailure := func() (serviceStatus, error) {
		failure := readGatewayStartupFailure(stateRoot)
		if failure.PID != expectedPID || failure.Code == "" || failure.Reason == "" {
			failure = gatewayStartupFailure{SchemaVersion: 1, PID: expectedPID, Code: "gateway_startup_failed", Reason: "Gateway service exited before it became ready."}
		}
		return serviceStatus{}, &gatewayStartupError{failure: failure}
	}
	for {
		// Check exit before accepting a ready record written just before a crash.
		select {
		case <-exited:
			return exitFailure()
		default:
		}
		status := readServiceStatus(stateRoot)
		if status.Status == "running" && status.PID == expectedPID && strings.TrimSpace(status.Listen) != "" {
			return status, nil
		}
		select {
		case <-deadline.C:
			return serviceStatus{}, &gatewayStartupError{failure: gatewayStartupFailure{SchemaVersion: 1, PID: expectedPID, Code: "gateway_startup_timeout", Reason: "Gateway service did not become ready before the startup timeout."}}
		case <-exited:
			return exitFailure()
		case <-ticker.C:
		}
	}
}

// Service identity checks also verify executable and process start time. This
// preliminary existence probe is never used to wait for a child startup result.
func pidRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	return err == nil && process.Signal(syscall.Signal(0)) == nil
}

func managedDesktopBridgeService() bool {
	return strings.TrimSpace(os.Getenv(managedDesktopBridgeEnv)) == "1"
}

func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
}

func newFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func parseFlags(fs *flag.FlagSet, args []string) error {
	return fs.Parse(args)
}

func isHelpToken(value string) bool {
	clean := strings.TrimSpace(strings.ToLower(value))
	return clean == "-h" || clean == "--help"
}

func writeText(w io.Writer, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	_, _ = io.WriteString(w, text)
}

func writeError(w io.Writer, text string) {
	writeText(w, strings.TrimSpace(text))
}

func rootHelpText() string {
	return strings.TrimLeft(`
redeven-gateway

Redeven Gateway service.

Usage:
  redeven-gateway <command> [flags]

Commands:
  invite            Create a one-use Runtime membership invitation.
  members           List members, remove membership, or set member Cloud policy.
  policy            View or update Gateway Cloud publication policy.
  endpoints         Show or update administrator-confirmed connection addresses.
  serve             Run the Gateway HTTP service.
  desktop-bridge    Run the Gateway desktop bridge over stdio.
  service-status    Probe a managed Gateway service.
  service-start     Start a managed Gateway service in the background.
  service-stop      Stop a managed Gateway service.
  version           Print build information.
`, "\n")
}

func serveHelpText() string {
	return strings.TrimLeft(`
redeven-gateway serve

Run the Gateway HTTP service.

Flags:
  --state-root <path>   Gateway state root.
  --listen <addr>       Listen address (default 127.0.0.1:0).
  --member-url <url>     Advertised HTTPS endpoint for Runtime members.
  --member-listen <addr> Comma-separated member listen addresses (default :7443).
`, "\n")
}

func desktopBridgeHelpText() string {
	return strings.TrimLeft(`
redeven-gateway desktop-bridge

Run the Gateway protocol bridge over stdio for Redeven Desktop SSH transports.

Flags:
  --state-root <path>   Gateway state root.
`, "\n")
}

func serviceStatusHelpText() string { return "redeven-gateway service-status --state-root <path>\n" }
func serviceStartHelpText() string {
	return "redeven-gateway service-start --state-root <path> [--listen <addr>] [--member-url <url>] [--member-listen <addr>]\n"
}
func serviceStopHelpText() string { return "redeven-gateway service-stop --state-root <path>\n" }

func (c *cli) cloudStatusCmd(args []string) int {
	fs := newFlagSet("cloud-status")
	root := fs.String("state-root", "", "Gateway state root.")
	if parseFlags(fs, args) != nil || fs.NArg() != 0 {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client, err := newHostAdminClient(normalizeStateRoot(*root))
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	defer client.client.Close()
	var status gatewaycloud.Summary
	err = client.request(ctx, "/gateway/v6/cloud/status", gp.CatalogRequest{ProtocolVersion: gp.Version}, &status)
	if err != nil {
		writeError(c.stderr, err.Error())
		return 1
	}
	if json.NewEncoder(c.stdout).Encode(status) != nil {
		return 1
	}
	return 0
}

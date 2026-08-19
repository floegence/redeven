package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/processenv"
	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewaysupervisor "github.com/floegence/redeven/internal/runtimegateway/supervisor"
	processlib "github.com/shirou/gopsutil/v4/process"
	"golang.org/x/term"
)

var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
)

const managedDesktopBridgeEnv = "REDEVEN_GATEWAY_MANAGED_DESKTOP_BRIDGE"

type cli struct {
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
}

type serviceStatus struct {
	Status                 string `json:"status"`
	PID                    int    `json:"pid,omitempty"`
	Listen                 string `json:"listen,omitempty"`
	StateRoot              string `json:"state_root"`
	Executable             string `json:"executable,omitempty"`
	ProcessStartedAtUnixMS int64  `json:"process_started_at_unix_ms,omitempty"`
	ErrorMessage           string `json:"error_message,omitempty"`
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
	case "supervisor":
		return c.supervisorCmd(args[1:])
	case "version":
		fmt.Fprintf(c.stdout, "redeven-gateway %s (%s) %s\n", Version, Commit, BuildTime)
		return 0
	default:
		writeError(c.stderr, fmt.Sprintf("unknown command: %s", strings.TrimSpace(args[0])))
		return 2
	}
}

func (c *cli) supervisorCmd(args []string) int {
	if len(args) == 0 || isHelpToken(args[0]) {
		writeText(c.stdout, supervisorHelpText())
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	if strings.TrimSpace(strings.ToLower(args[0])) != "enroll" {
		writeError(c.stderr, fmt.Sprintf("unknown supervisor command: %s", strings.TrimSpace(args[0])))
		return 2
	}
	return c.supervisorEnrollCmd(args[1:])
}

func (c *cli) supervisorEnrollCmd(args []string) int {
	fs := newFlagSet("supervisor enroll")
	provider := fs.String("provider", "", "Provider access-point origin.")
	environment := fs.String("environment", "", "Provider Environment public ID.")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	runtimeRoot := fs.String("runtime-root", "", "Target Runtime root managed by this Gateway supervisor.")
	if err := parseFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, supervisorEnrollHelpText())
			return 0
		}
		writeError(c.stderr, err.Error())
		return 2
	}
	if fs.NArg() != 0 {
		writeError(c.stderr, "`redeven-gateway supervisor enroll` does not accept positional arguments")
		return 2
	}
	if strings.TrimSpace(*provider) == "" || strings.TrimSpace(*environment) == "" {
		writeError(c.stderr, "supervisor enroll requires --provider and --environment")
		return 2
	}
	code, err := readEnrollmentCode(c.stdin, c.stderr)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("supervisor enroll failed: %v", err))
		return 1
	}
	stateRootValue := normalizeStateRoot(*stateRoot)
	runtimeRootValue := normalizeRuntimeRoot(*runtimeRoot)
	bindingStore, err := gatewaysupervisor.OpenLocalBindingStore(stateRootValue, runtimeRootValue)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("supervisor enroll failed: initialize Runtime target binding: %v", err))
		return 1
	}
	controller, err := gatewaysupervisor.NewController(gatewaysupervisor.ControllerOptions{BindingStore: bindingStore})
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("supervisor enroll failed: initialize Runtime lifecycle controller: %v", err))
		return 1
	}
	targetCoordinator, err := gatewaylifecycle.NewStore(gatewaylifecycle.Options{StateRoot: filepath.Join(stateRootValue, "runtime-lifecycle")})
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("supervisor enroll failed: open Runtime lifecycle coordination: %v", err))
		return 1
	}
	signalCtx, stop := signalContext()
	defer stop()
	ctx, cancel := context.WithTimeout(signalCtx, 2*time.Minute)
	defer cancel()
	binding, err := gatewaysupervisor.EnrollProvider(ctx, gatewaysupervisor.ProviderEnrollmentOptions{
		AccessPointOrigin: strings.TrimSpace(*provider), EnvironmentID: strings.TrimSpace(*environment),
		EnrollmentCode: code, GatewayVersion: Version, BindingStore: bindingStore, Controller: controller, TargetCoordinator: targetCoordinator,
	})
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("supervisor enroll failed: %v", err))
		return 1
	}
	result := struct {
		Status                 string `json:"status"`
		BindingID              string `json:"binding_id"`
		EnvironmentPublicID    string `json:"environment_public_id"`
		LifecycleTargetID      string `json:"lifecycle_target_id"`
		TargetGeneration       int64  `json:"target_generation"`
		SupervisorInstanceID   string `json:"supervisor_instance_id"`
		InstallationRootSHA256 string `json:"installation_root_sha256"`
	}{
		Status: "enrolled", BindingID: binding.BindingID, EnvironmentPublicID: binding.EnvironmentPublicID,
		LifecycleTargetID: binding.LifecycleTargetID, TargetGeneration: binding.TargetGeneration,
		SupervisorInstanceID: binding.SupervisorInstanceID, InstallationRootSHA256: binding.InstallationRootDigest,
	}
	_ = json.NewEncoder(c.stdout).Encode(result)
	return 0
}

func (c *cli) serveCmd(args []string) int {
	fs := newFlagSet("serve")
	stateRoot := fs.String("state-root", "", "Gateway state root.")
	runtimeRoot := fs.String("runtime-root", "", "Target Runtime root managed by this Gateway supervisor.")
	precompiledRuntimeManifest := fs.String("precompiled-runtime-manifest", "", "Validated Desktop bundle manifest used for automatic Runtime startup.")
	listen := fs.String("listen", "127.0.0.1:0", "Gateway listen address.")
	allowPrivateProfileTargets := fs.Bool("allow-private-profile-targets", false, "Allow URL profile targets on private networks.")
	enableProfileWrite := fs.Bool("enable-profile-write", false, "Allow paired clients to create, edit, and delete Gateway environment profiles.")
	pairingCode := fs.String("pairing-code", "", "One-time pairing code required by URL Gateway clients.")
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
	return c.runGatewayService(ctx, stateRootValue, normalizeRuntimeRoot(*runtimeRoot), *precompiledRuntimeManifest, *listen, managedDesktopBridgeService(), true, *allowPrivateProfileTargets, *enableProfileWrite, *pairingCode, managedBridgeToken)
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
	if managedBridgeToken == "" {
		writeError(c.stderr, "desktop-bridge failed: managed Gateway bridge token is missing")
		return 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	executablePath, err := os.Executable()
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("desktop-bridge failed: resolve Gateway executable: %v", err))
		return 1
	}
	gatewayURL := fmt.Sprintf("http://%s/", strings.TrimSpace(status.Listen))
	bridge := desktopbridge.Server{
		DialSurface: desktopbridge.NewGatewaySurfaceDialer(gatewayURL, managedBridgeToken),
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
				Available: true,
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
	runtimeRoot := fs.String("runtime-root", "", "Target Runtime root managed by this Gateway supervisor.")
	precompiledRuntimeManifest := fs.String("precompiled-runtime-manifest", "", "Validated Desktop bundle manifest used for automatic Runtime startup.")
	listen := fs.String("listen", "127.0.0.1:0", "Gateway listen address.")
	allowPrivateProfileTargets := fs.Bool("allow-private-profile-targets", false, "Allow URL profile targets on private networks.")
	enableProfileWrite := fs.Bool("enable-profile-write", true, "Allow paired clients to create, edit, and delete Gateway environment profiles.")
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
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	logPath := filepath.Join(stateRootValue, "gateway-service.log")
	if err := os.MkdirAll(stateRootValue, 0o700); err != nil {
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	if _, err := ensureManagedBridgeToken(stateRootValue); err != nil {
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	defer logFile.Close()
	cmdArgs := gatewayServiceServeArgs(stateRootValue, normalizeRuntimeRoot(*runtimeRoot), strings.TrimSpace(*precompiledRuntimeManifest), strings.TrimSpace(*listen))
	if *allowPrivateProfileTargets {
		cmdArgs = append(cmdArgs, "--allow-private-profile-targets")
	}
	if *enableProfileWrite {
		cmdArgs = append(cmdArgs, "--enable-profile-write")
	}
	cmd := exec.Command(exe, cmdArgs...)
	cmd.Env = append(processenv.Current(), managedDesktopBridgeEnv+"=1")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	_ = removePIDFile(stateRootValue)
	if err := cmd.Start(); err != nil {
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	childPID := cmd.Process.Pid
	_ = cmd.Process.Release()
	status, err := waitServiceReady(stateRootValue, childPID)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("service-start failed: %v", err))
		return 1
	}
	_ = json.NewEncoder(c.stdout).Encode(status)
	return 0
}

func gatewayServiceServeArgs(stateRoot string, runtimeRoot string, precompiledRuntimeManifest string, listen string) []string {
	args := []string{"serve", "--state-root", stateRoot, "--runtime-root", runtimeRoot, "--listen", listen}
	if manifestPath := strings.TrimSpace(precompiledRuntimeManifest); manifestPath != "" {
		args = append(args, "--precompiled-runtime-manifest", manifestPath)
	}
	return args
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
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !serviceProcessMatches(status) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if process != nil && serviceProcessMatches(status) {
		_ = process.Kill()
	}
	_ = removePIDFile(stateRootValue)
	_ = removeManagedBridgeToken(stateRootValue)
	_ = json.NewEncoder(c.stdout).Encode(serviceStatus{Status: "not_running", StateRoot: stateRootValue})
	return 0
}

func (c *cli) runGatewayService(ctx context.Context, stateRoot string, runtimeRoot string, precompiledRuntimeManifest string, listen string, desktopBridgeTransport bool, printListen bool, allowPrivateProfileTargets bool, enableProfileWrite bool, pairingCode string, managedBridgeToken string) int {
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
	bindingStore, err := gatewaysupervisor.OpenLocalBindingStore(stateRootValue, runtimeRoot)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: initialize Runtime target binding: %v", err))
		return 1
	}
	lifecycleController, err := gatewaysupervisor.NewController(gatewaysupervisor.ControllerOptions{
		BindingStore:               bindingStore,
		PrecompiledRuntimeManifest: strings.TrimSpace(precompiledRuntimeManifest),
	})
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: initialize Runtime lifecycle controller: %v", err))
		return 1
	}
	lifecycleAuthorizer, err := gatewaysupervisor.NewAuthorizer(bindingStore)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: initialize Runtime lifecycle authorizer: %v", err))
		return 1
	}
	serviceOptions := gatewayservice.Options{
		StateRoot:                   stateRootValue,
		DesktopBridgeTransport:      desktopBridgeTransport,
		AllowPrivateProfileTargets:  allowPrivateProfileTargets,
		ProfileWriteEnabled:         enableProfileWrite,
		PairingCode:                 pairingCode,
		ManagedBridgeToken:          managedBridgeToken,
		LifecycleController:         lifecycleController,
		LifecycleArtifactVerifier:   gatewaysupervisor.ArtifactVerifier{BindingStore: bindingStore},
		LifecycleAuthorizer:         lifecycleAuthorizer,
		LifecycleCapabilityProvider: lifecycleController,
	}
	if strings.TrimSpace(precompiledRuntimeManifest) != "" {
		serviceOptions.PrecompiledRuntimeStartup = lifecycleController
	}
	svc, err := gatewayservice.New(serviceOptions)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: %v", err))
		return 1
	}
	srv, listeners, err := svc.Start(ctx, listen)
	if err != nil {
		writeError(c.stderr, fmt.Sprintf("serve failed: %v", err))
		return 1
	}
	defer srv.Close()
	go gatewaysupervisor.MaintainProviderHeartbeat(ctx, bindingStore, lifecycleController, Version)
	go gatewaysupervisor.MaintainProviderRuntimeManagementTransport(ctx, nil, bindingStore, svc)
	if len(listeners) > 0 {
		actualListen := listeners[0].Addr().String()
		_ = writePIDFile(stateRootValue, os.Getpid(), actualListen)
		if printListen {
			fmt.Fprintf(c.stdout, "redeven-gateway listening on %s\n", actualListen)
		}
	}
	<-ctx.Done()
	_ = removePIDFile(stateRootValue)
	return 0
}

func normalizeRuntimeRoot(raw string) string {
	if value := strings.TrimSpace(raw); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("REDEVEN_STATE_ROOT")); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ".redeven"
	}
	return filepath.Join(home, ".redeven")
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

func writePIDFile(stateRoot string, pid int, listen string) error {
	if err := os.MkdirAll(stateRoot, 0o700); err != nil {
		return err
	}
	exe, _ := os.Executable()
	body, err := json.MarshalIndent(serviceStatus{
		Status:                 "running",
		PID:                    pid,
		Listen:                 strings.TrimSpace(listen),
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
		return serviceStatus{Status: "not_running", StateRoot: stateRoot}
	}
	var status serviceStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return serviceStatus{Status: "error", StateRoot: stateRoot, ErrorMessage: "Gateway status file is invalid."}
	}
	status.StateRoot = stateRoot
	if status.PID <= 0 || !serviceProcessMatches(status) {
		return serviceStatus{Status: "not_running", StateRoot: stateRoot}
	}
	if strings.TrimSpace(status.Listen) == "" || strings.TrimSpace(status.Listen) == "127.0.0.1:0" {
		return serviceStatus{Status: "not_running", StateRoot: stateRoot, ErrorMessage: "Gateway service has not published a listen address yet."}
	}
	status.Status = "running"
	return status
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

func waitServiceReady(stateRoot string, expectedPID int) (serviceStatus, error) {
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		status := readServiceStatus(stateRoot)
		if status.Status == "running" && status.PID == expectedPID && strings.TrimSpace(status.Listen) != "" {
			return status, nil
		}
		if expectedPID > 0 && !pidRunning(expectedPID) {
			return serviceStatus{}, errors.New("Gateway service exited before it became ready")
		}
		time.Sleep(100 * time.Millisecond)
	}
	return serviceStatus{}, errors.New("Gateway service did not become ready before the startup timeout")
}

func pidRunning(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil
}

func managedDesktopBridgeService() bool {
	return strings.TrimSpace(os.Getenv(managedDesktopBridgeEnv)) == "1"
}

func readEnrollmentCode(reader io.Reader, prompt io.Writer) (string, error) {
	if reader == nil {
		return "", errors.New("Runtime enrollment code is required on stdin")
	}
	var raw []byte
	var err error
	if file, ok := reader.(*os.File); ok && term.IsTerminal(int(file.Fd())) {
		_, _ = io.WriteString(prompt, "Enrollment code: ")
		raw, err = term.ReadPassword(int(file.Fd()))
		_, _ = io.WriteString(prompt, "\n")
	} else {
		raw, err = io.ReadAll(io.LimitReader(reader, 16*1024+1))
	}
	if err != nil {
		return "", err
	}
	if len(raw) > 16*1024 {
		return "", errors.New("Runtime enrollment code is too long")
	}
	code := strings.TrimSpace(string(raw))
	if code == "" {
		return "", errors.New("Runtime enrollment code is required on stdin")
	}
	return code, nil
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
  serve             Run the Gateway HTTP service.
  desktop-bridge    Run the Gateway desktop bridge over stdio.
  service-status    Probe a managed Gateway service.
  service-start     Start a managed Gateway service in the background.
  service-stop      Stop a managed Gateway service.
  supervisor        Configure Runtime lifecycle supervision.
  version           Print build information.
`, "\n")
}

func serveHelpText() string {
	return strings.TrimLeft(`
redeven-gateway serve

Run the Gateway HTTP service.

Flags:
  --state-root <path>   Gateway state root.
  --runtime-root <path> Target Runtime root managed by this Gateway.
  --precompiled-runtime-manifest <path>
                        Validated Desktop bundle manifest used for automatic Runtime startup.
  --listen <addr>       Listen address (default 127.0.0.1:0).
  --allow-private-profile-targets
                        Allow URL profiles to target private networks.
  --enable-profile-write
                        Allow paired clients to create, edit, and delete Gateway Environment profiles.
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
	return "redeven-gateway service-start --state-root <path> --runtime-root <path> [--precompiled-runtime-manifest <path>] [--listen <addr>] [--allow-private-profile-targets] [--enable-profile-write]\n"
}
func serviceStopHelpText() string { return "redeven-gateway service-stop --state-root <path>\n" }

func supervisorHelpText() string {
	return "redeven-gateway supervisor enroll --provider <access-point-origin> --environment <env-public-id> [--state-root <path>] [--runtime-root <path>]\n"
}

func supervisorEnrollHelpText() string {
	return strings.TrimLeft(`
redeven-gateway supervisor enroll

Enroll this target for Provider Runtime lifecycle management.
The one-time enrollment code is read from stdin and is never accepted as a command argument.

Flags:
  --provider <origin>     Provider access-point origin.
  --environment <id>     Provider Environment public ID.
  --state-root <path>    Gateway state root.
  --runtime-root <path>  Target Runtime root managed by this Gateway.
`, "\n")
}

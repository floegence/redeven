package codeserver

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultInstallScriptURL         = "https://code-server.dev/install.sh"
	installScriptURLOverrideEnv     = "REDEVEN_CODE_SERVER_INSTALL_SCRIPT_URL"
	defaultInstallerDownloadTimeout = 2 * time.Minute
	runtimeLogTailLimit             = 80
)

type RuntimeDetectionState string

const (
	RuntimeDetectionReady    RuntimeDetectionState = "ready"
	RuntimeDetectionMissing  RuntimeDetectionState = "missing"
	RuntimeDetectionUnusable RuntimeDetectionState = "unusable"
)

type RuntimeOperationAction string

const (
	RuntimeOperationActionInstall   RuntimeOperationAction = "install"
	RuntimeOperationActionUninstall RuntimeOperationAction = "uninstall"
)

type RuntimeOperationState string

const (
	RuntimeOperationStateIdle      RuntimeOperationState = "idle"
	RuntimeOperationStateRunning   RuntimeOperationState = "running"
	RuntimeOperationStateSucceeded RuntimeOperationState = "succeeded"
	RuntimeOperationStateFailed    RuntimeOperationState = "failed"
	RuntimeOperationStateCancelled RuntimeOperationState = "cancelled"
)

type RuntimeOperationStage string

const (
	RuntimeOperationStagePreparing   RuntimeOperationStage = "preparing"
	RuntimeOperationStageDownloading RuntimeOperationStage = "downloading"
	RuntimeOperationStageInstalling  RuntimeOperationStage = "installing"
	RuntimeOperationStageRemoving    RuntimeOperationStage = "removing"
	RuntimeOperationStageValidating  RuntimeOperationStage = "validating"
	RuntimeOperationStageFinalizing  RuntimeOperationStage = "finalizing"
)

type RuntimeTargetStatus struct {
	DetectionState RuntimeDetectionState `json:"detection_state"`
	Present        bool                  `json:"present"`
	Source         string                `json:"source"`
	BinaryPath     string                `json:"binary_path,omitempty"`
	ErrorCode      string                `json:"error_code,omitempty"`
	ErrorMessage   string                `json:"error_message,omitempty"`
}

type RuntimeOperationStatus struct {
	Action           RuntimeOperationAction `json:"action,omitempty"`
	State            RuntimeOperationState  `json:"state"`
	Stage            RuntimeOperationStage  `json:"stage,omitempty"`
	LastError        string                 `json:"last_error,omitempty"`
	LastErrorCode    string                 `json:"last_error_code,omitempty"`
	StartedAtUnixMs  int64                  `json:"started_at_unix_ms,omitempty"`
	FinishedAtUnixMs int64                  `json:"finished_at_unix_ms,omitempty"`
	LogTail          []string               `json:"log_tail,omitempty"`
}

type RuntimeStatus struct {
	ActiveRuntime      RuntimeTargetStatus    `json:"active_runtime"`
	ManagedRuntime     RuntimeTargetStatus    `json:"managed_runtime"`
	ManagedPrefix      string                 `json:"managed_prefix"`
	InstallerScriptURL string                 `json:"installer_script_url"`
	Operation          RuntimeOperationStatus `json:"operation"`
	UpdatedAtUnixMs    int64                  `json:"updated_at_unix_ms"`
}

type RuntimeManagerOptions struct {
	Logger               *slog.Logger
	StateDir             string
	InstallScriptURL     string
	InstallScriptContent []byte
	HTTPClient           *http.Client
	Now                  func() time.Time
}

type RuntimeManager struct {
	log *slog.Logger

	stateDir          string
	installScriptURL  string
	installScriptBody []byte
	httpClient        *http.Client
	now               func() time.Time

	mu                  sync.Mutex
	operationAction     RuntimeOperationAction
	operationState      RuntimeOperationState
	operationStage      RuntimeOperationStage
	lastError           string
	lastErrorCode       string
	operationStartedAt  time.Time
	operationFinishedAt time.Time
	updatedAt           time.Time
	logTail             []string
	cancelOperation     context.CancelFunc
}

type runtimeDetection struct {
	state        RuntimeDetectionState
	present      bool
	source       string
	binaryPath   string
	errorCode    string
	errorMessage string
}

type binaryCandidate struct {
	path   string
	source string
}

func NewRuntimeManager(opts RuntimeManagerOptions) *RuntimeManager {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	installScriptURL := strings.TrimSpace(opts.InstallScriptURL)
	if installScriptURL == "" {
		installScriptURL = strings.TrimSpace(os.Getenv(installScriptURLOverrideEnv))
	}
	if installScriptURL == "" {
		installScriptURL = defaultInstallScriptURL
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultInstallerDownloadTimeout}
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}

	return &RuntimeManager{
		log:               logger,
		stateDir:          stateDir,
		installScriptURL:  installScriptURL,
		installScriptBody: append([]byte(nil), opts.InstallScriptContent...),
		httpClient:        httpClient,
		now:               now,
		operationState:    RuntimeOperationStateIdle,
		updatedAt:         now(),
	}
}

func (m *RuntimeManager) Status(ctx context.Context) RuntimeStatus {
	if m == nil {
		installScriptURL := strings.TrimSpace(os.Getenv(installScriptURLOverrideEnv))
		if installScriptURL == "" {
			installScriptURL = defaultInstallScriptURL
		}
		return RuntimeStatus{
			ActiveRuntime: RuntimeTargetStatus{
				DetectionState: RuntimeDetectionMissing,
				Source:         "none",
			},
			ManagedRuntime: RuntimeTargetStatus{
				DetectionState: RuntimeDetectionMissing,
				Source:         "managed",
			},
			ManagedPrefix:      "",
			InstallerScriptURL: installScriptURL,
			Operation:          RuntimeOperationStatus{State: RuntimeOperationStateIdle},
			UpdatedAtUnixMs:    time.Now().UnixMilli(),
		}
	}
	active := detectRuntime(ctx, m.stateDir)
	managed := detectManagedRuntime(ctx, m.stateDir)
	snapshot := m.snapshot()
	return RuntimeStatus{
		ActiveRuntime:      runtimeTargetStatusFromDetection(active),
		ManagedRuntime:     runtimeTargetStatusFromDetection(managed),
		ManagedPrefix:      managedRuntimePrefix(m.stateDir),
		InstallerScriptURL: m.installScriptURL,
		Operation: RuntimeOperationStatus{
			Action:           snapshot.operationAction,
			State:            snapshot.operationState,
			Stage:            snapshot.operationStage,
			LastError:        snapshot.lastError,
			LastErrorCode:    snapshot.lastErrorCode,
			StartedAtUnixMs:  snapshot.operationStartedAt.UnixMilli(),
			FinishedAtUnixMs: snapshot.operationFinishedAt.UnixMilli(),
			LogTail:          append([]string(nil), snapshot.logTail...),
		},
		UpdatedAtUnixMs: snapshot.updatedAt.UnixMilli(),
	}
}

func (m *RuntimeManager) StartInstall(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	opCtx, started := m.startOperation(RuntimeOperationActionInstall)
	if !started {
		return m.Status(ctx)
	}

	go m.runInstall(opCtx)
	return m.Status(ctx)
}

func (m *RuntimeManager) StartUninstall(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	opCtx, started := m.startOperation(RuntimeOperationActionUninstall)
	if !started {
		return m.Status(ctx)
	}

	go m.runUninstall(opCtx)
	return m.Status(ctx)
}

func (m *RuntimeManager) CancelOperation(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	m.mu.Lock()
	cancel := m.cancelOperation
	running := m.operationState == RuntimeOperationStateRunning
	m.mu.Unlock()
	if running && cancel != nil {
		cancel()
	}
	return m.Status(ctx)
}

func (m *RuntimeManager) startOperation(action RuntimeOperationAction) (context.Context, bool) {
	opCtx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.operationState == RuntimeOperationStateRunning {
		cancel()
		return nil, false
	}
	startedAt := m.now()
	m.operationAction = action
	m.operationState = RuntimeOperationStateRunning
	m.operationStage = RuntimeOperationStagePreparing
	m.lastError = ""
	m.lastErrorCode = ""
	m.logTail = nil
	m.operationStartedAt = startedAt
	m.operationFinishedAt = time.Time{}
	m.updatedAt = startedAt
	m.cancelOperation = cancel
	return opCtx, true
}

func (m *RuntimeManager) runInstall(ctx context.Context) {
	errCode := ""
	errMessage := ""
	cancelled := false

	jobID := m.now().UTC().Format("20060102-150405.000000000")
	stagePrefix := filepath.Join(runtimeStagingRoot(m.stateDir), sanitizePathSegment(jobID))
	managedPrefix := managedRuntimePrefix(m.stateDir)

	m.appendLog("Preparing managed code-server install.")
	m.appendLog("Installer URL: " + m.installScriptURL)
	m.appendLog("Managed prefix: " + managedPrefix)

	if err := m.prepareInstallPaths(stagePrefix); err != nil {
		errCode = "prepare_failed"
		errMessage = err.Error()
		m.finishOperation(errCode, errMessage, false)
		return
	}

	scriptPath, err := m.ensureInstallScript(ctx)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			cancelled = true
		} else {
			errCode = "installer_download_failed"
			errMessage = err.Error()
		}
		m.finishOperation(errCode, errMessage, cancelled)
		return
	}

	m.setStage(RuntimeOperationStageInstalling)
	if err := m.runOfficialInstaller(ctx, scriptPath, stagePrefix); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			cancelled = true
		} else {
			errCode = "installer_failed"
			errMessage = err.Error()
		}
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, cancelled)
		return
	}

	m.setStage(RuntimeOperationStageValidating)
	stagedBinary := filepath.Join(stagePrefix, "bin", codeServerBinaryName())
	if err := probeRuntimeBinary(ctx, stagedBinary); err != nil {
		errCode = "validation_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, false)
		return
	}

	m.setStage(RuntimeOperationStageFinalizing)
	if err := promoteManagedRuntime(stagePrefix, managedPrefix); err != nil {
		errCode = "finalize_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, false)
		return
	}
	if err := repairManagedRuntimeLinks(managedPrefix); err != nil {
		errCode = "finalize_failed"
		errMessage = err.Error()
		m.finishOperation(errCode, errMessage, false)
		return
	}
	managedDetection := detectManagedRuntime(ctx, m.stateDir)
	if managedDetection.state != RuntimeDetectionReady {
		errCode = "finalize_failed"
		errMessage = runtimeDetectionError(managedDetection)
		m.finishOperation(errCode, errMessage, false)
		return
	}

	m.appendLog("Managed runtime is ready.")
	m.finishOperation("", "", false)
}

func (m *RuntimeManager) runUninstall(ctx context.Context) {
	managedPrefix := managedRuntimePrefix(m.stateDir)
	managedBinary := filepath.Join(managedPrefix, "bin", codeServerBinaryName())
	backupPrefix := managedPrefix + ".bak"

	m.appendLog("Preparing managed code-server uninstall.")
	m.appendLog("Managed prefix: " + managedPrefix)

	m.setStage(RuntimeOperationStageRemoving)
	if err := removeIfExists(backupPrefix); err != nil {
		m.finishOperation("remove_failed", err.Error(), false)
		return
	}
	if err := removeIfExists(managedPrefix); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			m.finishOperation("", "", true)
			return
		}
		m.finishOperation("remove_failed", err.Error(), false)
		return
	}
	if ctx.Err() != nil {
		m.finishOperation("", "", true)
		return
	}

	m.setStage(RuntimeOperationStageValidating)
	if _, err := os.Lstat(managedBinary); err == nil {
		m.finishOperation("validation_failed", fmt.Sprintf("managed runtime still exists at %s", managedBinary), false)
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		m.finishOperation("validation_failed", err.Error(), false)
		return
	}

	m.setStage(RuntimeOperationStageFinalizing)
	m.appendLog("Managed runtime has been removed.")
	m.finishOperation("", "", false)
}

func (m *RuntimeManager) prepareInstallPaths(stagePrefix string) error {
	m.setStage(RuntimeOperationStagePreparing)
	paths := []string{
		runtimeRoot(m.stateDir),
		runtimeCacheRoot(m.stateDir),
		runtimeInstallerCacheDir(m.stateDir),
		runtimeStagingRoot(m.stateDir),
	}
	for _, dir := range paths {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	_ = os.RemoveAll(stagePrefix)
	return os.MkdirAll(stagePrefix, 0o700)
}

func (m *RuntimeManager) ensureInstallScript(ctx context.Context) (string, error) {
	cacheDir := runtimeInstallerCacheDir(m.stateDir)
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}
	scriptPath := filepath.Join(cacheDir, "install.sh")

	m.setStage(RuntimeOperationStageDownloading)
	var content []byte
	if len(m.installScriptBody) > 0 {
		content = append([]byte(nil), m.installScriptBody...)
	} else {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.installScriptURL, nil)
		if err != nil {
			return "", err
		}
		resp, err := m.httpClient.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("failed to download official installer: HTTP %d", resp.StatusCode)
		}
		content, err = io.ReadAll(resp.Body)
		if err != nil {
			return "", err
		}
	}
	if len(content) == 0 {
		return "", errors.New("official installer download returned empty content")
	}
	tmpPath := scriptPath + ".tmp"
	if err := os.WriteFile(tmpPath, content, 0o700); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, scriptPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}
	return scriptPath, nil
}

func (m *RuntimeManager) runOfficialInstaller(ctx context.Context, scriptPath string, prefix string) error {
	cmd := exec.CommandContext(ctx, "/bin/sh", scriptPath, "--method=standalone", "--prefix", prefix)
	cmd.Env = append(os.Environ(),
		"XDG_CACHE_HOME="+runtimeCacheRoot(m.stateDir),
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go m.captureInstallOutput(&wg, stdout)
	go m.captureInstallOutput(&wg, stderr)

	waitErr := cmd.Wait()
	wg.Wait()
	if waitErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return waitErr
	}
	return nil
}

func (m *RuntimeManager) captureInstallOutput(wg *sync.WaitGroup, r io.Reader) {
	defer wg.Done()
	reader := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	reader.Buffer(buf, 512*1024)
	for reader.Scan() {
		m.appendLog(reader.Text())
	}
	if err := reader.Err(); err != nil {
		m.appendLog("stream error: " + err.Error())
	}
}

func (m *RuntimeManager) setStage(stage RuntimeOperationStage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.operationStage == stage {
		return
	}
	m.operationStage = stage
	m.updatedAt = m.now()
}

func (m *RuntimeManager) appendLog(line string) {
	text := strings.TrimSpace(strings.ReplaceAll(line, "\r", ""))
	if text == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.logTail = append(m.logTail, text)
	if len(m.logTail) > runtimeLogTailLimit {
		m.logTail = append([]string(nil), m.logTail[len(m.logTail)-runtimeLogTailLimit:]...)
	}
	m.updatedAt = m.now()
}

func (m *RuntimeManager) finishOperation(errCode string, errMessage string, cancelled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cancelled {
		m.operationState = RuntimeOperationStateCancelled
		m.lastError = ""
		m.lastErrorCode = ""
	} else if errCode != "" || errMessage != "" {
		m.operationState = RuntimeOperationStateFailed
		m.lastErrorCode = strings.TrimSpace(errCode)
		m.lastError = strings.TrimSpace(errMessage)
	} else {
		m.operationState = RuntimeOperationStateSucceeded
		m.lastError = ""
		m.lastErrorCode = ""
	}
	m.operationStage = ""
	m.operationFinishedAt = m.now()
	m.updatedAt = m.operationFinishedAt
	m.cancelOperation = nil
}

type runtimeSnapshot struct {
	operationAction     RuntimeOperationAction
	operationState      RuntimeOperationState
	operationStage      RuntimeOperationStage
	lastError           string
	lastErrorCode       string
	operationStartedAt  time.Time
	operationFinishedAt time.Time
	updatedAt           time.Time
	logTail             []string
}

func (m *RuntimeManager) snapshot() runtimeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return runtimeSnapshot{
		operationAction:     m.operationAction,
		operationState:      m.operationState,
		operationStage:      m.operationStage,
		lastError:           m.lastError,
		lastErrorCode:       m.lastErrorCode,
		operationStartedAt:  m.operationStartedAt,
		operationFinishedAt: m.operationFinishedAt,
		updatedAt:           m.updatedAt,
		logTail:             append([]string(nil), m.logTail...),
	}
}

func runtimeTargetStatusFromDetection(d runtimeDetection) RuntimeTargetStatus {
	source := strings.TrimSpace(d.source)
	if source == "" {
		source = "none"
	}
	return RuntimeTargetStatus{
		DetectionState: d.state,
		Present:        d.present,
		Source:         source,
		BinaryPath:     d.binaryPath,
		ErrorCode:      d.errorCode,
		ErrorMessage:   d.errorMessage,
	}
}

func detectRuntime(ctx context.Context, stateDir string) runtimeDetection {
	overrideCandidates := explicitOverrideCandidates()
	if len(overrideCandidates) > 0 {
		return detectRuntimeFromCandidates(ctx, overrideCandidates)
	}

	var firstProblem *runtimeDetection
	managedDetection := detectManagedRuntime(ctx, stateDir)
	if managedDetection.state == RuntimeDetectionReady {
		return managedDetection
	}
	if managedDetection.state == RuntimeDetectionUnusable {
		copy := managedDetection
		firstProblem = &copy
	}

	systemCandidates := resolveSystemBinaryCandidates()
	if len(systemCandidates) == 0 {
		if firstProblem != nil {
			return *firstProblem
		}
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "none",
		}
	}
	systemDetection := detectRuntimeFromCandidates(ctx, systemCandidates)
	if systemDetection.state == RuntimeDetectionReady {
		return systemDetection
	}
	if firstProblem != nil {
		return *firstProblem
	}
	return systemDetection
}

func detectManagedRuntime(ctx context.Context, stateDir string) runtimeDetection {
	managedBinary := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	if _, err := os.Lstat(managedBinary); err != nil {
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "managed",
		}
	}
	return detectRuntimeCandidate(ctx, binaryCandidate{path: managedBinary, source: "managed"})
}

func detectRuntimeFromCandidates(ctx context.Context, candidates []binaryCandidate) runtimeDetection {
	if len(candidates) == 0 {
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "none",
		}
	}
	var firstProblem *runtimeDetection
	for _, candidate := range candidates {
		detection := detectRuntimeCandidate(ctx, candidate)
		if detection.state == RuntimeDetectionReady {
			return detection
		}
		if detection.state == RuntimeDetectionUnusable && firstProblem == nil {
			copy := detection
			firstProblem = &copy
		}
	}

	if firstProblem != nil {
		return *firstProblem
	}
	return runtimeDetection{
		state:  RuntimeDetectionMissing,
		source: firstCandidateSource(candidates),
	}
}

func detectRuntimeCandidate(ctx context.Context, candidate binaryCandidate) runtimeDetection {
	detection := runtimeDetection{
		source: strings.TrimSpace(candidate.source),
	}
	path := strings.TrimSpace(candidate.path)
	if path == "" {
		detection.state = RuntimeDetectionMissing
		if detection.source == "" {
			detection.source = "none"
		}
		return detection
	}
	detection.binaryPath = path

	if fi, err := os.Stat(path); err == nil && !fi.IsDir() {
		detection.present = true
	}

	if err := probeRuntimeBinary(ctx, path); err != nil {
		detection.state = RuntimeDetectionUnusable
		detection.errorCode = "binary_unusable"
		detection.errorMessage = fmt.Sprintf("%s is not usable: %v", path, err)
		return detection
	}
	detection.state = RuntimeDetectionReady
	detection.present = true
	return detection
}

func resolveSystemBinaryCandidates() []binaryCandidate {
	seen := make(map[string]struct{})
	out := make([]binaryCandidate, 0, 8)
	add := func(path string, source string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		abs := path
		if !filepath.IsAbs(abs) {
			if resolved, err := filepath.Abs(abs); err == nil {
				abs = resolved
			}
		}
		if _, ok := seen[abs]; ok {
			return
		}
		if fi, err := os.Stat(abs); err == nil && !fi.IsDir() && (fi.Mode()&0o111) != 0 {
			seen[abs] = struct{}{}
			out = append(out, binaryCandidate{path: abs, source: source})
		}
	}

	home, _ := os.UserHomeDir()
	if strings.TrimSpace(home) != "" {
		add(filepath.Join(home, ".local", "bin", codeServerBinaryName()), "system")
	}

	switch runtime.GOOS {
	case "darwin":
		add("/opt/homebrew/bin/"+codeServerBinaryName(), "system")
		add("/usr/local/bin/"+codeServerBinaryName(), "system")
		add("/usr/bin/"+codeServerBinaryName(), "system")
	default:
		add("/usr/local/bin/"+codeServerBinaryName(), "system")
		add("/usr/bin/"+codeServerBinaryName(), "system")
		add("/opt/code-server/bin/"+codeServerBinaryName(), "system")
	}

	if path, err := exec.LookPath(codeServerBinaryName()); err == nil {
		add(path, "system")
	}

	return out
}

func explicitOverrideCandidates() []binaryCandidate {
	seen := make(map[string]struct{})
	out := make([]binaryCandidate, 0, 3)
	for _, envKey := range []string{"REDEVEN_CODE_SERVER_BIN", "CODE_SERVER_BIN", "CODE_SERVER_PATH"} {
		path := strings.TrimSpace(os.Getenv(envKey))
		if path == "" {
			continue
		}
		abs := path
		if !filepath.IsAbs(abs) {
			if resolved, err := filepath.Abs(abs); err == nil {
				abs = resolved
			}
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		out = append(out, binaryCandidate{path: abs, source: "env_override"})
	}
	return out
}

func probeRuntimeBinary(ctx context.Context, binaryPath string) error {
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return errors.New("missing binary path")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	execPath, prefixArgs, err := resolveCodeServerExec(path)
	if err != nil {
		return err
	}
	args := append(prefixArgs, "--version")
	cmd := exec.CommandContext(probeCtx, execPath, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return probeCtx.Err()
		}
		msg := strings.TrimSpace(out.String())
		if msg == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, msg)
	}
	return nil
}

func removeIfExists(path string) error {
	target := strings.TrimSpace(path)
	if target == "" {
		return nil
	}
	if _, err := os.Lstat(target); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return os.RemoveAll(target)
}

func promoteManagedRuntime(stagePrefix string, managedPrefix string) error {
	parent := filepath.Dir(managedPrefix)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	backupPrefix := managedPrefix + ".bak"
	_ = os.RemoveAll(backupPrefix)
	if _, err := os.Stat(managedPrefix); err == nil {
		if err := os.Rename(managedPrefix, backupPrefix); err != nil {
			return err
		}
	}
	if err := os.Rename(stagePrefix, managedPrefix); err != nil {
		if _, statErr := os.Stat(backupPrefix); statErr == nil {
			_ = os.Rename(backupPrefix, managedPrefix)
		}
		return err
	}
	_ = os.RemoveAll(backupPrefix)
	return nil
}

func repairManagedRuntimeLinks(managedPrefix string) error {
	binDir := filepath.Join(managedPrefix, "bin")
	target, err := locateManagedRuntimeBinary(managedPrefix)
	if err != nil {
		return err
	}
	link := filepath.Join(binDir, codeServerBinaryName())
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		return err
	}
	_ = os.Remove(link)
	return os.Symlink(target, link)
}

func runtimeRoot(stateDir string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "apps", "code", "runtime")
}

func managedRuntimePrefix(stateDir string) string {
	return filepath.Join(runtimeRoot(stateDir), "managed")
}

func runtimeStagingRoot(stateDir string) string {
	return filepath.Join(runtimeRoot(stateDir), "staging")
}

func runtimeCacheRoot(stateDir string) string {
	return filepath.Join(runtimeRoot(stateDir), "cache")
}

func runtimeInstallerCacheDir(stateDir string) string {
	return filepath.Join(runtimeCacheRoot(stateDir), "installer")
}

func codeServerBinaryName() string {
	if runtime.GOOS == "windows" {
		return "code-server.exe"
	}
	return "code-server"
}

func sanitizePathSegment(value string) string {
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "._")
	if out == "" {
		return "install"
	}
	return out
}

func firstCandidateSource(candidates []binaryCandidate) string {
	for _, candidate := range candidates {
		source := strings.TrimSpace(candidate.source)
		if source != "" {
			return source
		}
	}
	return "none"
}

func runtimeDetectionError(detection runtimeDetection) string {
	if msg := strings.TrimSpace(detection.errorMessage); msg != "" {
		return msg
	}
	if path := strings.TrimSpace(detection.binaryPath); path != "" {
		return fmt.Sprintf("%s is not usable", path)
	}
	return "managed runtime validation failed"
}

func locateManagedRuntimeBinary(managedPrefix string) (string, error) {
	managedPrefix = strings.TrimSpace(managedPrefix)
	if managedPrefix == "" {
		return "", errors.New("missing managed runtime prefix")
	}

	linkPath := filepath.Join(managedPrefix, "bin", codeServerBinaryName())
	if target, err := os.Readlink(linkPath); err == nil {
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(linkPath), target)
		}
		target = filepath.Clean(target)
		if fi, statErr := os.Stat(target); statErr == nil && !fi.IsDir() {
			return target, nil
		}
	}

	matches, err := filepath.Glob(filepath.Join(managedPrefix, "lib", "code-server-*", "bin", codeServerBinaryName()))
	if err != nil {
		return "", err
	}
	sort.Strings(matches)
	for _, match := range matches {
		if fi, statErr := os.Stat(match); statErr == nil && !fi.IsDir() {
			return match, nil
		}
	}
	return "", fmt.Errorf("managed runtime binary not found under %s", managedPrefix)
}

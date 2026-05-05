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
	"strings"
	"sync"
	"time"
)

const (
	defaultInstallScriptURL         = "https://code-server.dev/install.sh"
	installScriptURLOverrideEnv     = "REDEVEN_CODE_SERVER_INSTALL_SCRIPT_URL"
	defaultInstallerDownloadTimeout = 2 * time.Minute
	defaultRuntimeProbeTimeout      = 5 * time.Second
	selectedRuntimeProbeTimeout     = 15 * time.Second
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
	RuntimeOperationActionInstall                       RuntimeOperationAction = "install"
	RuntimeOperationActionRemoveLocalEnvironmentVersion RuntimeOperationAction = "remove_local_environment_version"
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
	Version        string                `json:"version,omitempty"`
	ErrorCode      string                `json:"error_code,omitempty"`
	ErrorMessage   string                `json:"error_message,omitempty"`
}

type RuntimeInstalledVersionStatus struct {
	Version                    string                `json:"version"`
	BinaryPath                 string                `json:"binary_path,omitempty"`
	InstalledAtUnixMs          int64                 `json:"installed_at_unix_ms,omitempty"`
	SelectedByLocalEnvironment bool                  `json:"selected_by_local_environment,omitempty"`
	Removable                  bool                  `json:"removable,omitempty"`
	DetectionState             RuntimeDetectionState `json:"detection_state"`
	ErrorMessage               string                `json:"error_message,omitempty"`
}

type RuntimeOperationStatus struct {
	Action           RuntimeOperationAction `json:"action,omitempty"`
	State            RuntimeOperationState  `json:"state"`
	Stage            RuntimeOperationStage  `json:"stage,omitempty"`
	TargetVersion    string                 `json:"target_version,omitempty"`
	LastError        string                 `json:"last_error,omitempty"`
	LastErrorCode    string                 `json:"last_error_code,omitempty"`
	StartedAtUnixMs  int64                  `json:"started_at_unix_ms,omitempty"`
	FinishedAtUnixMs int64                  `json:"finished_at_unix_ms,omitempty"`
	LogTail          []string               `json:"log_tail,omitempty"`
}

type RuntimeStatus struct {
	ActiveRuntime         RuntimeTargetStatus             `json:"active_runtime"`
	ManagedRuntime        RuntimeTargetStatus             `json:"managed_runtime"`
	ManagedPrefix         string                          `json:"managed_prefix"`
	SharedRuntimeRoot     string                          `json:"shared_runtime_root"`
	ManagedRuntimeVersion string                          `json:"managed_runtime_version,omitempty"`
	ManagedRuntimeSource  string                          `json:"managed_runtime_source"`
	InstalledVersions     []RuntimeInstalledVersionStatus `json:"installed_versions,omitempty"`
	InstallerScriptURL    string                          `json:"installer_script_url"`
	Operation             RuntimeOperationStatus          `json:"operation"`
	UpdatedAtUnixMs       int64                           `json:"updated_at_unix_ms"`
}

type RuntimeManagerOptions struct {
	Logger               *slog.Logger
	StateDir             string
	StateRoot            string
	InstallScriptURL     string
	InstallScriptContent []byte
	HTTPClient           *http.Client
	Now                  func() time.Time
}

type RuntimeManager struct {
	log *slog.Logger

	stateDir          string
	stateRoot         string
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
	targetVersion       string
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
	version      string
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
		stateRoot:         strings.TrimSpace(opts.StateRoot),
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
			ManagedRuntimeSource: "none",
			ManagedPrefix:        "",
			SharedRuntimeRoot:    "",
			InstallerScriptURL:   installScriptURL,
			Operation:            RuntimeOperationStatus{State: RuntimeOperationStateIdle},
			UpdatedAtUnixMs:      time.Now().UnixMilli(),
		}
	}
	const maxConsistentStatusAttempts = 3
	type statusParts struct {
		active                runtimeDetection
		managed               runtimeDetection
		managedRuntimeSource  string
		managedRuntimeVersion string
		localEnvironmentState localEnvironmentRuntimeState
		installed             []RuntimeInstalledVersionStatus
		snapshot              runtimeSnapshot
	}

	buildStatus := func(parts statusParts) RuntimeStatus {
		return RuntimeStatus{
			ActiveRuntime:         runtimeTargetStatusFromDetection(parts.active),
			ManagedRuntime:        runtimeTargetStatusFromDetection(parts.managed),
			ManagedPrefix:         managedRuntimePrefix(m.stateDir),
			SharedRuntimeRoot:     sharedRuntimeRoot(m.stateRoot),
			ManagedRuntimeVersion: parts.managedRuntimeVersion,
			ManagedRuntimeSource:  parts.managedRuntimeSource,
			InstalledVersions:     parts.installed,
			InstallerScriptURL:    m.installScriptURL,
			Operation: RuntimeOperationStatus{
				Action:           parts.snapshot.operationAction,
				State:            parts.snapshot.operationState,
				Stage:            parts.snapshot.operationStage,
				TargetVersion:    parts.snapshot.targetVersion,
				LastError:        parts.snapshot.lastError,
				LastErrorCode:    parts.snapshot.lastErrorCode,
				StartedAtUnixMs:  parts.snapshot.operationStartedAt.UnixMilli(),
				FinishedAtUnixMs: parts.snapshot.operationFinishedAt.UnixMilli(),
				LogTail:          append([]string(nil), parts.snapshot.logTail...),
			},
			UpdatedAtUnixMs: parts.snapshot.updatedAt.UnixMilli(),
		}
	}

	last := statusParts{}
	for attempt := 0; attempt < maxConsistentStatusAttempts; attempt++ {
		snapshotBefore := m.snapshot()
		active, managed, managedRuntimeSource, managedRuntimeVersion, localEnvironmentState := runtimeStatusSnapshot(ctx, m.stateDir, m.stateRoot)
		installedVersions := installedVersionStatuses(ctx, m.stateRoot, localEnvironmentState, managedRuntimeVersion)
		snapshotAfter := m.snapshot()
		last = statusParts{
			active:                active,
			managed:               managed,
			managedRuntimeSource:  managedRuntimeSource,
			managedRuntimeVersion: managedRuntimeVersion,
			localEnvironmentState: localEnvironmentState,
			installed:             installedVersions,
			snapshot:              snapshotAfter,
		}
		if snapshotBefore.updatedAt.Equal(snapshotAfter.updatedAt) {
			return buildStatus(last)
		}
	}

	return buildStatus(last)
}

func (m *RuntimeManager) StartInstall(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	opCtx, started := m.startOperation(RuntimeOperationActionInstall, "")
	if !started {
		return m.Status(ctx)
	}

	go m.runInstall(opCtx)
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

func (m *RuntimeManager) SelectVersion(ctx context.Context, version string) (RuntimeStatus, error) {
	if m == nil {
		return RuntimeStatus{}, errors.New("runtime manager not ready")
	}
	version = strings.TrimSpace(version)
	if version == "" {
		return RuntimeStatus{}, errors.New("missing version")
	}
	if err := ensureSharedRuntimeDirs(m.stateRoot); err != nil {
		return RuntimeStatus{}, err
	}
	var selectedPath string
	err := withLocalEnvironmentRuntimeStateLock(m.stateRoot, func(state *localEnvironmentRuntimeState) error {
		record, ok := state.Versions[version]
		if !ok {
			return fmt.Errorf("managed version %s is not installed in the Local Environment inventory", version)
		}
		selectedPath = filepath.Join(sharedVersionRoot(m.stateRoot, version), strings.TrimSpace(record.BinaryRelPath))
		if err := probeRuntimeBinary(ctx, selectedPath); err != nil {
			return fmt.Errorf("managed version %s is not usable: %w", version, err)
		}
		if err := repairManagedRuntimeLink(m.stateDir, m.stateRoot, version); err != nil {
			return err
		}
		state.SelectedVersion = version
		state.UpdatedAtUnixMs = m.now().UnixMilli()
		return nil
	})
	if err != nil {
		return RuntimeStatus{}, err
	}
	return m.Status(ctx), nil
}

func (m *RuntimeManager) RemoveLocalEnvironmentVersion(ctx context.Context, version string) (RuntimeStatus, error) {
	if m == nil {
		return RuntimeStatus{}, errors.New("runtime manager not ready")
	}
	version = strings.TrimSpace(version)
	if version == "" {
		return RuntimeStatus{}, errors.New("missing version")
	}
	opCtx, started := m.startOperation(RuntimeOperationActionRemoveLocalEnvironmentVersion, version)
	if !started {
		return m.Status(ctx), nil
	}
	go m.runRemoveLocalEnvironmentVersion(opCtx, version)
	return m.Status(ctx), nil
}

func (m *RuntimeManager) startOperation(action RuntimeOperationAction, targetVersion string) (context.Context, bool) {
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
	m.targetVersion = strings.TrimSpace(targetVersion)
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
	stagePrefix := filepath.Join(sharedStagingRoot(m.stateRoot), sanitizePathSegment(jobID))
	linkPath := managedRuntimePrefix(m.stateDir)

	m.appendLog("Preparing code-server install for this Local Environment.")
	m.appendLog("Installer URL: " + m.installScriptURL)
	m.appendLog("Shared runtime root: " + sharedRuntimeRoot(m.stateRoot))
	m.appendLog("Current environment link: " + linkPath)

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
	version, err := probeRuntimeBinaryVersion(ctx, stagedBinary)
	if err != nil {
		errCode = "validation_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, false)
		return
	}
	version = strings.TrimSpace(version)
	if version == "" {
		errCode = "validation_failed"
		errMessage = "installed managed runtime did not report a version"
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, false)
		return
	}
	m.setTargetVersion(version)
	m.appendLog("Resolved managed version: " + version)

	m.setStage(RuntimeOperationStageFinalizing)
	err = withLocalEnvironmentRuntimeStateLock(m.stateRoot, func(state *localEnvironmentRuntimeState) error {
		if existing, ok := state.Versions[version]; ok {
			existingBinary := filepath.Join(sharedVersionRoot(m.stateRoot, version), strings.TrimSpace(existing.BinaryRelPath))
			if err := probeRuntimeBinary(ctx, existingBinary); err == nil {
				m.appendLog("Reusing existing Local Environment runtime version: " + version)
				state.SelectedVersion = version
				state.UpdatedAtUnixMs = m.now().UnixMilli()
				_ = os.RemoveAll(stagePrefix)
				return repairManagedRuntimeLink(m.stateDir, m.stateRoot, version)
			}
			delete(state.Versions, version)
		}
		versionRoot := sharedVersionRoot(m.stateRoot, version)
		if err := promoteManagedRuntime(stagePrefix, versionRoot); err != nil {
			return err
		}
		if err := repairRuntimeBinaryLink(versionRoot); err != nil {
			return err
		}
		state.Versions[version] = localEnvironmentRuntimeVersion{
			InstalledAtUnixMs: m.now().UnixMilli(),
			BinaryRelPath:     filepath.Join("bin", codeServerBinaryName()),
		}
		state.SelectedVersion = version
		state.UpdatedAtUnixMs = m.now().UnixMilli()
		return repairManagedRuntimeLink(m.stateDir, m.stateRoot, version)
	})
	if err != nil {
		errCode = "finalize_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishOperation(errCode, errMessage, false)
		return
	}
	managedDetection := detectSelectedManagedRuntime(ctx, m.stateDir, m.stateRoot)
	if managedDetection.state != RuntimeDetectionReady {
		errCode = "finalize_failed"
		errMessage = runtimeDetectionError(managedDetection)
		m.finishOperation(errCode, errMessage, false)
		return
	}

	m.appendLog("The Local Environment runtime is ready for the current environment.")
	m.finishOperation("", "", false)
}

func (m *RuntimeManager) runRemoveLocalEnvironmentVersion(ctx context.Context, version string) {
	m.appendLog("Preparing Local Environment runtime removal.")
	m.appendLog("Target version: " + version)
	m.appendLog("Shared runtime root: " + sharedRuntimeRoot(m.stateRoot))

	m.setStage(RuntimeOperationStageRemoving)
	err := withLocalEnvironmentRuntimeStateLock(m.stateRoot, func(state *localEnvironmentRuntimeState) error {
		if strings.TrimSpace(state.SelectedVersion) == version {
			return fmt.Errorf("version %s is selected by the current Local Environment", version)
		}
		if _, ok := state.Versions[version]; !ok {
			return fmt.Errorf("managed version %s is not installed in the Local Environment inventory", version)
		}
		if err := removeIfExists(sharedVersionRoot(m.stateRoot, version)); err != nil {
			return err
		}
		delete(state.Versions, version)
		return nil
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			m.finishOperation("", "", true)
			return
		}
		m.finishOperation("remove_failed", err.Error(), false)
		return
	}

	m.setStage(RuntimeOperationStageValidating)
	if _, err := os.Stat(sharedVersionRoot(m.stateRoot, version)); err == nil {
		m.finishOperation("validation_failed", fmt.Sprintf("managed version %s still exists under %s", version, sharedVersionRoot(m.stateRoot, version)), false)
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		m.finishOperation("validation_failed", err.Error(), false)
		return
	}

	m.setStage(RuntimeOperationStageFinalizing)
	m.appendLog("The Local Environment runtime version has been removed.")
	m.finishOperation("", "", false)
}

func (m *RuntimeManager) prepareInstallPaths(stagePrefix string) error {
	m.setStage(RuntimeOperationStagePreparing)
	if err := ensureSharedRuntimeDirs(m.stateRoot); err != nil {
		return err
	}
	if err := os.MkdirAll(runtimeRoot(m.stateDir), 0o700); err != nil {
		return err
	}
	_ = os.RemoveAll(stagePrefix)
	return os.MkdirAll(stagePrefix, 0o700)
}

func (m *RuntimeManager) ensureInstallScript(ctx context.Context) (string, error) {
	cacheDir := sharedDownloadsRoot(m.stateRoot)
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}
	scriptPath := sharedInstallerScriptPath(m.stateRoot)

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
		"XDG_CACHE_HOME="+sharedDownloadsRoot(m.stateRoot),
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

func (m *RuntimeManager) setTargetVersion(version string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.targetVersion = strings.TrimSpace(version)
	m.updatedAt = m.now()
}

type runtimeSnapshot struct {
	operationAction     RuntimeOperationAction
	operationState      RuntimeOperationState
	operationStage      RuntimeOperationStage
	targetVersion       string
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
		targetVersion:       m.targetVersion,
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
		Version:        d.version,
		ErrorCode:      d.errorCode,
		ErrorMessage:   d.errorMessage,
	}
}

func runtimeStatusSnapshot(ctx context.Context, stateDir string, stateRoot string) (runtimeDetection, runtimeDetection, string, string, localEnvironmentRuntimeState) {
	if ctx == nil {
		ctx = context.Background()
	}
	localEnvironmentState, _ := loadLocalEnvironmentRuntimeState(stateRoot)
	managedRuntimeVersion, managedRuntimeSource := resolveManagedRuntimeSelection(localEnvironmentState)
	managedDetection := detectManagedRuntime(ctx, stateDir, stateRoot, managedRuntimeVersion)
	activeDetection := detectRuntime(ctx, stateDir, stateRoot, managedRuntimeVersion)
	return activeDetection, managedDetection, managedRuntimeSource, managedRuntimeVersion, localEnvironmentState
}

func resolveManagedRuntimeSelection(localEnvironmentState localEnvironmentRuntimeState) (string, string) {
	selectedVersion := strings.TrimSpace(localEnvironmentState.SelectedVersion)
	if selectedVersion != "" {
		return selectedVersion, "managed"
	}
	return "", "none"
}

func detectRuntime(ctx context.Context, stateDir string, stateRoot string, selectedManagedVersion string) runtimeDetection {
	overrideCandidates := explicitOverrideCandidates()
	if len(overrideCandidates) > 0 {
		return detectRuntimeFromCandidates(ctx, overrideCandidates)
	}
	if strings.TrimSpace(selectedManagedVersion) != "" {
		return detectManagedRuntime(ctx, stateDir, stateRoot, selectedManagedVersion)
	}

	systemCandidates := resolveSystemBinaryCandidates()
	if len(systemCandidates) == 0 {
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "none",
		}
	}
	return detectRuntimeFromCandidates(ctx, systemCandidates)
}

func detectSelectedManagedRuntime(ctx context.Context, stateDir string, stateRoot string) runtimeDetection {
	localEnvironmentState, _ := loadLocalEnvironmentRuntimeState(stateRoot)
	version, _ := resolveManagedRuntimeSelection(localEnvironmentState)
	return detectManagedRuntime(ctx, stateDir, stateRoot, version)
}

func detectManagedRuntime(ctx context.Context, stateDir string, stateRoot string, version string) runtimeDetection {
	version = strings.TrimSpace(version)
	if version == "" {
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "managed",
		}
	}
	path := filepath.Join(sharedVersionRoot(stateRoot, version), "bin", codeServerBinaryName())
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return runtimeDetection{
				state:        RuntimeDetectionMissing,
				source:       "managed",
				binaryPath:   path,
				version:      version,
				errorCode:    "managed_version_missing",
				errorMessage: fmt.Sprintf("managed version %s is not installed in the Local Environment inventory", version),
			}
		}
	}
	detection := detectRuntimeCandidate(ctx, binaryCandidate{path: path, source: "managed"})
	detection.version = version
	if detection.state == RuntimeDetectionUnusable && strings.TrimSpace(detection.errorCode) == "" {
		detection.errorCode = "managed_version_unusable"
	}
	return detection
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

	version, err := probeRuntimeBinaryVersionWithTimeout(ctx, path, runtimeProbeTimeoutForSource(candidate.source))
	if err != nil {
		detection.state = RuntimeDetectionUnusable
		detection.errorCode = "binary_unusable"
		detection.errorMessage = fmt.Sprintf("%s is not usable: %v", path, err)
		return detection
	}
	detection.version = strings.TrimSpace(version)
	detection.state = RuntimeDetectionReady
	detection.present = true
	return detection
}

func installedVersionStatuses(ctx context.Context, stateRoot string, localEnvironmentState localEnvironmentRuntimeState, currentSelectionVersion string) []RuntimeInstalledVersionStatus {
	versions := sortedInstalledVersions(localEnvironmentState)
	out := make([]RuntimeInstalledVersionStatus, 0, len(versions))
	for _, version := range versions {
		record := localEnvironmentState.Versions[version]
		path := filepath.Join(sharedVersionRoot(stateRoot, version), strings.TrimSpace(record.BinaryRelPath))
		status := RuntimeInstalledVersionStatus{
			Version:                    version,
			BinaryPath:                 path,
			InstalledAtUnixMs:          record.InstalledAtUnixMs,
			SelectedByLocalEnvironment: strings.TrimSpace(currentSelectionVersion) == version,
			DetectionState:             RuntimeDetectionMissing,
		}
		if !status.SelectedByLocalEnvironment {
			status.Removable = true
		}
		detection := detectRuntimeCandidate(ctx, binaryCandidate{path: path, source: "managed"})
		status.DetectionState = detection.state
		status.ErrorMessage = detection.errorMessage
		if detection.binaryPath != "" {
			status.BinaryPath = detection.binaryPath
		}
		out = append(out, status)
	}
	return out
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
	_, err := probeRuntimeBinaryVersionWithTimeout(ctx, binaryPath, selectedRuntimeProbeTimeout)
	return err
}

func probeRuntimeBinaryVersion(ctx context.Context, binaryPath string) (string, error) {
	return probeRuntimeBinaryVersionWithTimeout(ctx, binaryPath, selectedRuntimeProbeTimeout)
}

func probeRuntimeBinaryVersionWithTimeout(ctx context.Context, binaryPath string, timeout time.Duration) (string, error) {
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "", errors.New("missing binary path")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if timeout <= 0 {
		timeout = defaultRuntimeProbeTimeout
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	execPath, prefixArgs, err := resolveCodeServerExec(path)
	if err != nil {
		return "", err
	}
	args := append(prefixArgs, "--version")
	cmd := exec.CommandContext(probeCtx, execPath, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		if probeCtx.Err() != nil {
			return "", probeCtx.Err()
		}
		msg := strings.TrimSpace(out.String())
		if msg == "" {
			return "", err
		}
		return "", fmt.Errorf("%w: %s", err, msg)
	}
	return strings.TrimSpace(strings.Split(strings.TrimSpace(out.String()), "\n")[0]), nil
}

func runtimeProbeTimeoutForSource(source string) time.Duration {
	switch strings.TrimSpace(source) {
	case "env_override", "managed":
		return selectedRuntimeProbeTimeout
	default:
		return defaultRuntimeProbeTimeout
	}
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

func runtimeRoot(stateDir string) string {
	return filepath.Join(strings.TrimSpace(stateDir), "apps", "code", "runtime")
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

func repairRuntimeBinaryLink(prefix string) error {
	binDir := filepath.Join(strings.TrimSpace(prefix), "bin")
	target, err := locateRuntimeBinary(prefix)
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

func locateRuntimeBinary(prefix string) (string, error) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return "", errors.New("missing runtime prefix")
	}
	matches, err := filepath.Glob(filepath.Join(prefix, "lib", "code-server-*", "bin", codeServerBinaryName()))
	if err != nil {
		return "", err
	}
	for _, match := range matches {
		if fi, statErr := os.Stat(match); statErr == nil && !fi.IsDir() {
			return match, nil
		}
	}
	return "", fmt.Errorf("runtime binary not found under %s", prefix)
}

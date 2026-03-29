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
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	SupportedVersion                = "4.108.2"
	defaultInstallScriptURLFmt      = "https://raw.githubusercontent.com/coder/code-server/v%s/install.sh"
	installScriptURLOverrideEnv     = "REDEVEN_CODE_SERVER_INSTALL_SCRIPT_URL"
	defaultInstallerDownloadTimeout = 2 * time.Minute
	runtimeLogTailLimit             = 80
)

type RuntimeDetectionState string

const (
	RuntimeDetectionReady        RuntimeDetectionState = "ready"
	RuntimeDetectionMissing      RuntimeDetectionState = "missing"
	RuntimeDetectionIncompatible RuntimeDetectionState = "incompatible"
)

type RuntimeInstallState string

const (
	RuntimeInstallIdle      RuntimeInstallState = "idle"
	RuntimeInstallRunning   RuntimeInstallState = "running"
	RuntimeInstallSucceeded RuntimeInstallState = "succeeded"
	RuntimeInstallFailed    RuntimeInstallState = "failed"
	RuntimeInstallCancelled RuntimeInstallState = "cancelled"
)

type RuntimeInstallStage string

const (
	RuntimeInstallStagePreparing   RuntimeInstallStage = "preparing"
	RuntimeInstallStageDownloading RuntimeInstallStage = "downloading"
	RuntimeInstallStageInstalling  RuntimeInstallStage = "installing"
	RuntimeInstallStageValidating  RuntimeInstallStage = "validating"
	RuntimeInstallStageFinalizing  RuntimeInstallStage = "finalizing"
)

type RuntimeStatus struct {
	SupportedVersion        string                `json:"supported_version"`
	DetectionState          RuntimeDetectionState `json:"detection_state"`
	InstallState            RuntimeInstallState   `json:"install_state"`
	InstallStage            RuntimeInstallStage   `json:"install_stage,omitempty"`
	Managed                 bool                  `json:"managed"`
	Source                  string                `json:"source"`
	BinaryPath              string                `json:"binary_path,omitempty"`
	InstalledVersion        string                `json:"installed_version,omitempty"`
	ManagedPrefix           string                `json:"managed_prefix"`
	InstallerScriptURL      string                `json:"installer_script_url"`
	LastError               string                `json:"last_error,omitempty"`
	LastErrorCode           string                `json:"last_error_code,omitempty"`
	InstallStartedAtUnixMs  int64                 `json:"install_started_at_unix_ms,omitempty"`
	InstallFinishedAtUnixMs int64                 `json:"install_finished_at_unix_ms,omitempty"`
	UpdatedAtUnixMs         int64                 `json:"updated_at_unix_ms"`
	LogTail                 []string              `json:"log_tail,omitempty"`
}

type RuntimeManagerOptions struct {
	Logger               *slog.Logger
	StateDir             string
	SupportedVersion     string
	InstallScriptURL     string
	InstallScriptContent []byte
	HTTPClient           *http.Client
	Now                  func() time.Time
}

type RuntimeManager struct {
	log *slog.Logger

	stateDir          string
	supportedVersion  string
	installScriptURL  string
	installScriptBody []byte
	httpClient        *http.Client
	now               func() time.Time

	mu                sync.Mutex
	installState      RuntimeInstallState
	installStage      RuntimeInstallStage
	lastError         string
	lastErrorCode     string
	installStartedAt  time.Time
	installFinishedAt time.Time
	updatedAt         time.Time
	logTail           []string
	cancelInstall     context.CancelFunc
}

type runtimeDetection struct {
	state            RuntimeDetectionState
	managed          bool
	source           string
	binaryPath       string
	installedVersion string
	errorCode        string
	errorMessage     string
}

type binaryCandidate struct {
	path   string
	source string
}

var codeServerVersionPattern = regexp.MustCompile(`\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?`)

func NewRuntimeManager(opts RuntimeManagerOptions) *RuntimeManager {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	stateDir := strings.TrimSpace(opts.StateDir)
	supportedVersion := strings.TrimSpace(opts.SupportedVersion)
	if supportedVersion == "" {
		supportedVersion = SupportedVersion
	}
	installScriptURL := strings.TrimSpace(opts.InstallScriptURL)
	if installScriptURL == "" {
		installScriptURL = strings.TrimSpace(os.Getenv(installScriptURLOverrideEnv))
	}
	if installScriptURL == "" {
		installScriptURL = fmt.Sprintf(defaultInstallScriptURLFmt, supportedVersion)
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
		supportedVersion:  supportedVersion,
		installScriptURL:  installScriptURL,
		installScriptBody: append([]byte(nil), opts.InstallScriptContent...),
		httpClient:        httpClient,
		now:               now,
		installState:      RuntimeInstallIdle,
		updatedAt:         now(),
	}
}

func (m *RuntimeManager) Status(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{
			SupportedVersion: SupportedVersion,
			DetectionState:   RuntimeDetectionMissing,
			InstallState:     RuntimeInstallIdle,
			Source:           "none",
			ManagedPrefix:    "",
			UpdatedAtUnixMs:  time.Now().UnixMilli(),
		}
	}
	detection := detectRuntime(ctx, m.stateDir, m.supportedVersion)
	snapshot := m.snapshot()
	lastError := strings.TrimSpace(snapshot.lastError)
	lastErrorCode := strings.TrimSpace(snapshot.lastErrorCode)
	if lastError == "" && detection.errorMessage != "" {
		lastError = detection.errorMessage
	}
	if lastErrorCode == "" && detection.errorCode != "" {
		lastErrorCode = detection.errorCode
	}
	return RuntimeStatus{
		SupportedVersion:        m.supportedVersion,
		DetectionState:          detection.state,
		InstallState:            snapshot.installState,
		InstallStage:            snapshot.installStage,
		Managed:                 detection.managed,
		Source:                  detection.source,
		BinaryPath:              detection.binaryPath,
		InstalledVersion:        detection.installedVersion,
		ManagedPrefix:           managedRuntimePrefix(m.stateDir),
		InstallerScriptURL:      m.installScriptURL,
		LastError:               lastError,
		LastErrorCode:           lastErrorCode,
		InstallStartedAtUnixMs:  snapshot.installStartedAt.UnixMilli(),
		InstallFinishedAtUnixMs: snapshot.installFinishedAt.UnixMilli(),
		UpdatedAtUnixMs:         snapshot.updatedAt.UnixMilli(),
		LogTail:                 append([]string(nil), snapshot.logTail...),
	}
}

func (m *RuntimeManager) StartInstall(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	if ctx == nil {
		ctx = context.Background()
	}

	installCtx, cancel := context.WithCancel(context.Background())

	m.mu.Lock()
	if m.installState == RuntimeInstallRunning {
		m.mu.Unlock()
		cancel()
		return m.Status(ctx)
	}
	m.installState = RuntimeInstallRunning
	m.installStage = RuntimeInstallStagePreparing
	m.lastError = ""
	m.lastErrorCode = ""
	m.logTail = nil
	m.installStartedAt = m.now()
	m.installFinishedAt = time.Time{}
	m.updatedAt = m.installStartedAt
	m.cancelInstall = cancel
	m.mu.Unlock()

	go m.runInstall(installCtx)
	return m.Status(ctx)
}

func (m *RuntimeManager) CancelInstall(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{}
	}
	m.mu.Lock()
	cancel := m.cancelInstall
	running := m.installState == RuntimeInstallRunning
	m.mu.Unlock()
	if running && cancel != nil {
		cancel()
	}
	return m.Status(ctx)
}

func (m *RuntimeManager) runInstall(ctx context.Context) {
	errCode := ""
	errMessage := ""
	cancelled := false

	jobID := m.now().UTC().Format("20060102-150405.000000000")
	stagePrefix := filepath.Join(runtimeStagingRoot(m.stateDir), sanitizePathSegment(jobID))
	managedPrefix := managedRuntimePrefix(m.stateDir)

	if err := m.prepareInstallPaths(stagePrefix); err != nil {
		errCode = "prepare_failed"
		errMessage = err.Error()
		m.finishInstall(errCode, errMessage, false)
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
		m.finishInstall(errCode, errMessage, cancelled)
		return
	}

	m.setStage(RuntimeInstallStageInstalling)
	if err := m.runOfficialInstaller(ctx, scriptPath, stagePrefix); err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			cancelled = true
		} else {
			errCode = "installer_failed"
			errMessage = err.Error()
		}
		_ = os.RemoveAll(stagePrefix)
		m.finishInstall(errCode, errMessage, cancelled)
		return
	}

	m.setStage(RuntimeInstallStageValidating)
	version, err := detectBinaryVersion(ctx, filepath.Join(stagePrefix, "bin", codeServerBinaryName()))
	if err != nil {
		errCode = "validation_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishInstall(errCode, errMessage, false)
		return
	}
	if version != m.supportedVersion {
		errCode = "unsupported_version"
		errMessage = fmt.Sprintf("installed version %s does not match supported version %s", version, m.supportedVersion)
		_ = os.RemoveAll(stagePrefix)
		m.finishInstall(errCode, errMessage, false)
		return
	}

	m.setStage(RuntimeInstallStageFinalizing)
	if err := promoteManagedRuntime(stagePrefix, managedPrefix); err != nil {
		errCode = "finalize_failed"
		errMessage = err.Error()
		_ = os.RemoveAll(stagePrefix)
		m.finishInstall(errCode, errMessage, false)
		return
	}
	if err := repairManagedRuntimeLinks(managedPrefix, m.supportedVersion); err != nil {
		errCode = "finalize_failed"
		errMessage = err.Error()
		m.finishInstall(errCode, errMessage, false)
		return
	}

	m.finishInstall("", "", false)
}

func (m *RuntimeManager) prepareInstallPaths(stagePrefix string) error {
	m.setStage(RuntimeInstallStagePreparing)
	paths := []string{
		runtimeRoot(m.stateDir),
		runtimeCacheRoot(m.stateDir),
		runtimeInstallerCacheDir(m.stateDir, m.supportedVersion),
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
	cacheDir := runtimeInstallerCacheDir(m.stateDir, m.supportedVersion)
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		return "", err
	}
	scriptPath := filepath.Join(cacheDir, "install.sh")
	if fi, err := os.Stat(scriptPath); err == nil && !fi.IsDir() {
		return scriptPath, nil
	}

	m.setStage(RuntimeInstallStageDownloading)
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
	cmd := exec.CommandContext(ctx, "/bin/sh", scriptPath, "--method=standalone", "--prefix", prefix, "--version", m.supportedVersion)
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

func (m *RuntimeManager) setStage(stage RuntimeInstallStage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.installStage == stage {
		return
	}
	m.installStage = stage
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

func (m *RuntimeManager) finishInstall(errCode string, errMessage string, cancelled bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cancelled {
		m.installState = RuntimeInstallCancelled
		m.lastError = ""
		m.lastErrorCode = ""
	} else if errCode != "" || errMessage != "" {
		m.installState = RuntimeInstallFailed
		m.lastErrorCode = strings.TrimSpace(errCode)
		m.lastError = strings.TrimSpace(errMessage)
	} else {
		m.installState = RuntimeInstallSucceeded
		m.lastError = ""
		m.lastErrorCode = ""
	}
	m.installStage = ""
	m.installFinishedAt = m.now()
	m.updatedAt = m.installFinishedAt
	m.cancelInstall = nil
}

type runtimeSnapshot struct {
	installState      RuntimeInstallState
	installStage      RuntimeInstallStage
	lastError         string
	lastErrorCode     string
	installStartedAt  time.Time
	installFinishedAt time.Time
	updatedAt         time.Time
	logTail           []string
}

func (m *RuntimeManager) snapshot() runtimeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return runtimeSnapshot{
		installState:      m.installState,
		installStage:      m.installStage,
		lastError:         m.lastError,
		lastErrorCode:     m.lastErrorCode,
		installStartedAt:  m.installStartedAt,
		installFinishedAt: m.installFinishedAt,
		updatedAt:         m.updatedAt,
		logTail:           append([]string(nil), m.logTail...),
	}
}

func detectRuntime(ctx context.Context, stateDir string, supportedVersion string) runtimeDetection {
	overrideCandidates := explicitOverrideCandidates()
	if len(overrideCandidates) > 0 {
		return detectRuntimeFromCandidates(ctx, overrideCandidates, supportedVersion)
	}

	var firstProblem *runtimeDetection
	managedBinary := filepath.Join(managedRuntimePrefix(stateDir), "bin", codeServerBinaryName())
	if _, err := os.Lstat(managedBinary); err == nil {
		version, err := detectBinaryVersion(ctx, managedBinary)
		if err == nil && version == supportedVersion {
			return runtimeDetection{
				state:            RuntimeDetectionReady,
				managed:          true,
				source:           "managed",
				binaryPath:       managedBinary,
				installedVersion: version,
			}
		}
		if err != nil {
			firstProblem = &runtimeDetection{
				state:        RuntimeDetectionIncompatible,
				managed:      true,
				source:       "managed",
				binaryPath:   managedBinary,
				errorCode:    "binary_unusable",
				errorMessage: fmt.Sprintf("%s is not usable: %v", managedBinary, err),
			}
		} else if version != supportedVersion {
			firstProblem = &runtimeDetection{
				state:            RuntimeDetectionIncompatible,
				managed:          true,
				source:           "managed",
				binaryPath:       managedBinary,
				installedVersion: version,
				errorCode:        "unsupported_version",
				errorMessage:     fmt.Sprintf("detected code-server %s but Redeven supports %s", version, supportedVersion),
			}
		}
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
	systemDetection := detectRuntimeFromCandidates(ctx, systemCandidates, supportedVersion)
	if systemDetection.state == RuntimeDetectionReady {
		return systemDetection
	}
	if firstProblem != nil {
		return *firstProblem
	}
	return systemDetection
}

func detectRuntimeFromCandidates(ctx context.Context, candidates []binaryCandidate, supportedVersion string) runtimeDetection {
	if len(candidates) == 0 {
		return runtimeDetection{
			state:  RuntimeDetectionMissing,
			source: "none",
		}
	}
	var firstProblem *runtimeDetection
	for _, candidate := range candidates {
		version, err := detectBinaryVersion(ctx, candidate.path)
		if err != nil {
			if firstProblem == nil {
				firstProblem = &runtimeDetection{
					state:        RuntimeDetectionIncompatible,
					managed:      candidate.source == "managed",
					source:       candidate.source,
					binaryPath:   candidate.path,
					errorCode:    "binary_unusable",
					errorMessage: fmt.Sprintf("%s is not usable: %v", candidate.path, err),
				}
			}
			continue
		}
		if version != supportedVersion {
			if firstProblem == nil {
				firstProblem = &runtimeDetection{
					state:            RuntimeDetectionIncompatible,
					managed:          candidate.source == "managed",
					source:           candidate.source,
					binaryPath:       candidate.path,
					installedVersion: version,
					errorCode:        "unsupported_version",
					errorMessage:     fmt.Sprintf("detected code-server %s but Redeven supports %s", version, supportedVersion),
				}
			}
			continue
		}
		return runtimeDetection{
			state:            RuntimeDetectionReady,
			managed:          candidate.source == "managed",
			source:           candidate.source,
			binaryPath:       candidate.path,
			installedVersion: version,
		}
	}

	if firstProblem != nil {
		return *firstProblem
	}
	return runtimeDetection{
		state:  RuntimeDetectionMissing,
		source: "none",
	}
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

func detectBinaryVersion(ctx context.Context, binaryPath string) (string, error) {
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "", errors.New("missing binary path")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	versionCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	execPath, prefixArgs, err := resolveCodeServerExec(path)
	if err != nil {
		return "", err
	}
	args := append(prefixArgs, "--version")
	cmd := exec.CommandContext(versionCtx, execPath, args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		if versionCtx.Err() != nil {
			return "", versionCtx.Err()
		}
		msg := strings.TrimSpace(out.String())
		if msg == "" {
			return "", err
		}
		return "", fmt.Errorf("%w: %s", err, msg)
	}
	match := codeServerVersionPattern.FindString(out.String())
	if match == "" {
		return "", fmt.Errorf("code-server version output missing semver: %s", strings.TrimSpace(out.String()))
	}
	return match, nil
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

func repairManagedRuntimeLinks(managedPrefix string, supportedVersion string) error {
	binDir := filepath.Join(managedPrefix, "bin")
	target := filepath.Join(managedPrefix, "lib", "code-server-"+strings.TrimSpace(supportedVersion), "bin", codeServerBinaryName())
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

func runtimeInstallerCacheDir(stateDir string, supportedVersion string) string {
	version := strings.TrimSpace(supportedVersion)
	if version == "" {
		version = SupportedVersion
	}
	return filepath.Join(runtimeCacheRoot(stateDir), "installer", version)
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

package managedwebservice

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type hostScriptDriver struct {
	manager   *Manager
	processMu sync.Mutex
	processes map[string]hostProcess
}

type hostProcess struct {
	cmd         *exec.Cmd
	identity    string
	pid         int
	fingerprint string
	done        <-chan struct{}
}

func (d *hostScriptDriver) Install(ctx context.Context, service *pfregistry.ManagedService, _ catalogPayload, progress operationProgress) (string, string, error) {
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return "", "", err
	}
	if spec.Kind != DeploymentHost || spec.Host == nil {
		return "", "", serviceError("TEMPLATE_SNAPSHOT_INVALID", "The service does not contain a host template snapshot.", 409, false, nil)
	}
	root := d.instanceRoot(service)
	installRoot := filepath.Join(root, "install")
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0o700); err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(d.dataRoot(service), 0o700); err != nil {
		return "", "", err
	}
	executable := ""
	if spec.Host.NPM != nil {
		identity := ReleaseIdentity{}
		executable, identity, err = d.installNPMRuntime(ctx, service, *spec.Host.NPM, progress)
		if err != nil {
			return "", "", err
		}
		releaseJSON, releaseDigest, encodeErr := canonicalReleaseIdentity(identity)
		if encodeErr != nil {
			return "", "", encodeErr
		}
		service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256 = releaseJSON, releaseDigest
	} else if spec.Host.RuntimeBundle != "" {
		if spec.Host.RuntimeBundle != deepSeekRuntimeBundleID || d.manager.nativeRuntime == nil {
			return "", "", serviceError("TEMPLATE_RUNTIME_BUNDLE_INVALID", "The saved host runtime bundle is not available in this Redeven release.", 409, false, nil)
		}
		artifact, ok := auditedNativeArtifact(currentPlatformKey())
		if !ok {
			return "", "", serviceError("PLATFORM_UNSUPPORTED", "This Redeven release does not include a host runtime for the Environment platform.", 409, false, nil)
		}
		if err := validateNativeArtifact(artifact, d.manager.nativeRuntime.client, defaultNodePackageOrigin); err != nil {
			return "", "", err
		}
		executable, err = d.manager.nativeRuntime.installRuntimeBundle(ctx, service, artifact, installRoot, progress)
		if err != nil {
			return "", "", err
		}
	} else if spec.Host.Artifact != nil {
		artifact := nativeArtifact{DownloadURL: spec.Host.Artifact.DownloadURL, SizeBytes: spec.Host.Artifact.SizeBytes, SHA256: spec.Host.Artifact.SHA256, ExecutableRelPath: spec.Host.Artifact.ExecutableRelPath}
		if err := validateCustomHostArtifact(artifact); err != nil {
			return "", "", err
		}
		_ = os.RemoveAll(installRoot)
		staging := filepath.Join(d.manager.stateDir, ".staging", service.ServiceID)
		_ = os.RemoveAll(staging)
		if err := os.MkdirAll(staging, 0o700); err != nil {
			return "", "", err
		}
		defer os.RemoveAll(staging)
		archive := filepath.Join(staging, "package.tar.gz")
		if err := downloadNativeArchive(ctx, d.manager.downloads.packageHTTPClient(), artifact, archive, progress); err != nil {
			return "", "", err
		}
		progress("verifying", 3)
		if err := verifyNativeArchive(archive, artifact); err != nil {
			return "", "", err
		}
		extracted := filepath.Join(staging, "root")
		if err := extractManagedArchive(archive, extracted); err != nil {
			return "", "", serviceError("ARCHIVE_INVALID", "The custom host package could not be safely extracted.", 400, false, err)
		}
		if err := os.Rename(extracted, installRoot); err != nil {
			return "", "", err
		}
		executable = filepath.Join(installRoot, filepath.FromSlash(artifact.ExecutableRelPath))
	}
	progress("installing", 4)
	if strings.TrimSpace(spec.Host.InstallScript) != "" {
		if err := d.runOneShot(ctx, service, spec.Host.InstallScript, executable, "install"); err != nil {
			return "", "", serviceError("INSTALL_SCRIPT_FAILED", "The custom host install script failed.", 502, true, err)
		}
	}
	return "", executable, nil
}

func validateCustomHostArtifact(artifact nativeArtifact) error {
	parsed, err := url.Parse(strings.TrimSpace(artifact.DownloadURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return serviceError("PACKAGE_SOURCE_REJECTED", "Custom host packages must use an absolute public HTTPS URL without credentials.", 400, false, err)
	}
	if artifact.SizeBytes <= 0 || artifact.SizeBytes > maxNativeArchiveBytes || !dockerDigestPattern.MatchString("sha256:"+strings.ToLower(strings.TrimSpace(artifact.SHA256))) {
		return serviceError("PACKAGE_IDENTITY_INVALID", "Custom host package size or SHA-256 is invalid.", 400, false, nil)
	}
	rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(artifact.ExecutableRelPath)))
	if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return serviceError("PACKAGE_IDENTITY_INVALID", "Custom host package executable path is invalid.", 400, false, nil)
	}
	return nil
}

func (d *hostScriptDriver) Start(ctx context.Context, service *pfregistry.ManagedService) (string, error) {
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return "", err
	}
	d.processMu.Lock()
	if current, ok := d.processes[service.ServiceID]; ok && managedProcessRunning(current.pid) {
		d.processMu.Unlock()
		if service.RuntimeIdentity != "" && service.RuntimeIdentity != current.identity {
			return "", serviceError("RUNTIME_IDENTITY_MISMATCH", "The custom host process identity does not match the saved instance.", 409, false, nil)
		}
		return current.identity, nil
	}
	d.processMu.Unlock()
	if recovered, ok, recoverErr := d.recoverPersistedProcess(service); recoverErr != nil {
		return "", recoverErr
	} else if ok {
		d.processMu.Lock()
		d.processes[service.ServiceID] = recovered
		d.processMu.Unlock()
		return recovered.identity, nil
	}
	if err := d.prepareRuntimeDirectories(service); err != nil {
		return "", err
	}
	logFile, err := os.OpenFile(d.logPath(service), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", serviceError("HOST_LOG_PREPARE_FAILED", "Redeven could not prepare the managed Host service log.", 500, true, err)
	}
	// The service process must outlive the short-lived install/start operation
	// context. Lifecycle cancellation is handled through the exact process-group
	// identity stored below.
	cmd := exec.Command("/bin/sh", "-eu", "-c", spec.Host.StartScript)
	cmd.Dir = service.WorkspacePath
	cmd.Env, err = d.serviceEnvironment(service, service.ArtifactReference)
	if err != nil {
		_ = logFile.Close()
		return "", err
	}
	cmd.Stdout, cmd.Stderr = logFile, logFile
	configureManagedProcess(cmd)
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return "", serviceError("START_FAILED", "The custom host service could not be started.", 502, true, err)
	}
	fingerprint, processGroup, _, err := waitManagedProcessDetails(cmd.Process.Pid, 500*time.Millisecond)
	if err != nil || processGroup != cmd.Process.Pid {
		_ = terminateManagedProcess(cmd)
		_ = logFile.Close()
		return "", serviceError("HOST_PROCESS_IDENTITY_UNAVAILABLE", "Redeven could not record the managed Host process identity.", 500, true, err)
	}
	nonce, err := randomID("proc")
	if err != nil {
		_ = terminateManagedProcess(cmd)
		_ = logFile.Close()
		return "", err
	}
	identity := "host:v2:" + service.ServiceID + ":" + nonce + ":" + strconv.Itoa(cmd.Process.Pid) + ":" + fingerprint
	done := make(chan struct{})
	d.processMu.Lock()
	d.processes[service.ServiceID] = hostProcess{cmd: cmd, identity: identity, pid: cmd.Process.Pid, fingerprint: fingerprint, done: done}
	d.processMu.Unlock()
	go func() {
		_ = cmd.Wait()
		_ = logFile.Close()
		d.processMu.Lock()
		if current, ok := d.processes[service.ServiceID]; ok && current.identity == identity {
			delete(d.processes, service.ServiceID)
		}
		d.processMu.Unlock()
		close(done)
	}()
	return identity, nil
}

func (d *hostScriptDriver) Stop(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil {
		return nil
	}
	d.processMu.Lock()
	current, ok := d.processes[service.ServiceID]
	d.processMu.Unlock()
	recoveredLegacy := false
	if !ok {
		var err error
		current, ok, err = d.recoverPersistedProcess(service)
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		recoveredLegacy = isLegacyHostIdentity(service.RuntimeIdentity)
		d.processMu.Lock()
		d.processes[service.ServiceID] = current
		d.processMu.Unlock()
	}
	if service.RuntimeIdentity != "" && current.identity != service.RuntimeIdentity {
		parsed := parseHostIdentity(service.RuntimeIdentity)
		if !recoveredLegacy || parsed.serviceID != service.ServiceID {
			return serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not stop a custom host process whose identity changed.", 409, false, nil)
		}
	}
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return err
	}
	var stopScriptErr error
	if strings.TrimSpace(spec.Host.StopScript) != "" {
		stopCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := d.runOneShot(stopCtx, service, spec.Host.StopScript, service.ArtifactReference, "stop")
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			stopScriptErr = serviceError("STOP_SCRIPT_FAILED", "The custom host stop script failed.", 502, true, err)
		}
	}
	if err := terminateHostProcess(current); err != nil {
		return serviceError("STOP_FAILED", "The custom host service could not be stopped.", 502, true, err)
	}
	if waitHostProcess(ctx, current, 8*time.Second) {
		return stopScriptErr
	}
	if err := killHostProcess(current); err != nil {
		return serviceError("STOP_FAILED", "The custom host service could not be killed after its stop timeout.", 502, true, err)
	}
	if waitHostProcess(ctx, current, 2*time.Second) {
		return stopScriptErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return serviceError("STOP_FAILED", "The custom host service did not exit after it was killed.", 502, true, nil)
}

func (d *hostScriptDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool, progress operationProgress) error {
	progress("stopping", 2)
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	progress("uninstalling", 5)
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return err
	}
	if strings.TrimSpace(spec.Host.UninstallScript) != "" {
		if err := d.runOneShot(context.Background(), service, spec.Host.UninstallScript, service.ArtifactReference, "uninstall"); err != nil {
			return serviceError("UNINSTALL_SCRIPT_FAILED", "The custom host uninstall script failed.", 502, true, err)
		}
	}
	root := d.instanceRoot(service)
	installRoot, logRoot := filepath.Join(root, "install"), filepath.Join(root, "logs")
	if d.legacyDeepSeekLayout(service) {
		installRoot = filepath.Join(d.manager.stateDir, DeepSeekHarnessProductID, "native")
		logRoot = filepath.Join(d.manager.stateDir, DeepSeekHarnessProductID, "logs")
	}
	if err := os.RemoveAll(installRoot); err != nil {
		return err
	}
	if err := os.RemoveAll(logRoot); err != nil {
		return err
	}
	if deleteData {
		if err := os.RemoveAll(d.dataRoot(service)); err != nil {
			return err
		}
	}
	if err := os.Remove(d.manager.serviceSecretPath(service.ServiceID)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (d *hostScriptDriver) CleanupPartial(ctx context.Context, service *pfregistry.ManagedService) error {
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(d.manager.stateDir, ".staging", service.ServiceID))
}

func (d *hostScriptDriver) Logs(_ context.Context, service *pfregistry.ManagedService, tail int) (*LogResult, error) {
	return tailRedactedFile(d.logPath(service), tail)
}

func (d *hostScriptDriver) runOneShot(ctx context.Context, service *pfregistry.ManagedService, script, executable, phase string) error {
	if err := d.prepareRuntimeDirectories(service); err != nil {
		return err
	}
	logFile, err := os.OpenFile(d.logPath(service), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return serviceError("HOST_LOG_PREPARE_FAILED", "Redeven could not prepare the managed Host service log.", 500, true, err)
	}
	defer logFile.Close()
	cmd := exec.CommandContext(ctx, "/bin/sh", "-eu", "-c", script)
	cmd.Dir = service.WorkspacePath
	cmd.Env, err = d.serviceEnvironment(service, executable)
	if err != nil {
		return err
	}
	cmd.Env = append(cmd.Env, "REDEVEN_SERVICE_PHASE="+phase)
	cmd.Stdout, cmd.Stderr = logFile, logFile
	return cmd.Run()
}

func (d *hostScriptDriver) serviceEnvironment(service *pfregistry.ManagedService, executable string) ([]string, error) {
	spec, _, err := effectiveSpecFromService(service)
	if err != nil {
		return nil, err
	}
	parameters, err := d.manager.serviceParameters(service)
	if err != nil {
		return nil, err
	}
	root := d.instanceRoot(service)
	base := map[string]string{
		"REDEVEN_SERVICE_ID":         service.ServiceID,
		"REDEVEN_SERVICE_HOST":       "127.0.0.1",
		"REDEVEN_SERVICE_PORT":       strconv.Itoa(service.RuntimePort),
		"REDEVEN_WORKSPACE":          service.WorkspacePath,
		"REDEVEN_SERVICE_DATA_DIR":   d.dataRoot(service),
		"REDEVEN_INSTALL_DIR":        filepath.Join(root, "install"),
		"REDEVEN_INSTALL_EXECUTABLE": executable,
	}
	environment := map[string]string{}
	for _, item := range os.Environ() {
		name, value, ok := strings.Cut(item, "=")
		if ok {
			environment[name] = value
		}
	}
	for name, value := range base {
		environment[name] = value
	}
	if spec.Host != nil {
		names := make([]string, 0, len(spec.Host.Environment))
		for name := range spec.Host.Environment {
			names = append(names, name)
		}
		slices.Sort(names)
		for _, name := range names {
			value := spec.Host.Environment[name]
			for variable, replacement := range base {
				value = strings.ReplaceAll(value, "${"+variable+"}", replacement)
			}
			environment[name] = value
		}
	}
	authTokenParameter := ""
	if spec.Host != nil && spec.Host.NPM != nil {
		authTokenParameter = strings.TrimSpace(spec.Host.NPM.AuthTokenParameter)
		delete(environment, authTokenParameter)
	}
	for name, value := range parameters {
		if name == authTokenParameter {
			continue
		}
		environment[name] = value
	}
	names := make([]string, 0, len(environment))
	for name := range environment {
		names = append(names, name)
	}
	slices.Sort(names)
	env := make([]string, 0, len(names))
	for _, name := range names {
		env = append(env, name+"="+environment[name])
	}
	return env, nil
}

func (d *hostScriptDriver) instanceRoot(service *pfregistry.ManagedService) string {
	return filepath.Join(d.manager.stateDir, "instances", service.ServiceID)
}

func (d *hostScriptDriver) dataRoot(service *pfregistry.ManagedService) string {
	if service != nil && service.TemplateSource == "builtin" && service.TemplateID == DeepSeekHarnessHostTemplateID {
		return filepath.Join(d.manager.stateDir, DeepSeekHarnessProductID, "data")
	}
	return filepath.Join(d.manager.stateDir, "families", service.ServiceFamilyID, "data")
}

func (d *hostScriptDriver) legacyDeepSeekLayout(service *pfregistry.ManagedService) bool {
	if d == nil || d.manager == nil || service == nil || service.TemplateSource != "builtin" || service.TemplateID != DeepSeekHarnessHostTemplateID {
		return false
	}
	release, err := decodeReleaseIdentity(service.ReleaseIdentityJSON, service.ReleaseIdentitySHA256)
	if err != nil || release.Kind != "npm" || release.Source != "@deepseek-ai/dsh" || release.Version == "" || release.Version != service.Version || release.Trust != "redeven_reviewed_legacy" || release.Integrity == "" || release.ArtifactReference != service.ArtifactReference {
		return false
	}
	root := filepath.Join(d.manager.stateDir, DeepSeekHarnessProductID, "native")
	executable := filepath.Clean(strings.TrimSpace(service.ArtifactReference))
	rel, err := filepath.Rel(root, executable)
	return err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (d *hostScriptDriver) logPath(service *pfregistry.ManagedService) string {
	if d.legacyDeepSeekLayout(service) {
		return filepath.Join(d.manager.stateDir, DeepSeekHarnessProductID, "logs", "harness.log")
	}
	return filepath.Join(d.instanceRoot(service), "logs", "service.log")
}

func (d *hostScriptDriver) prepareRuntimeDirectories(service *pfregistry.ManagedService) error {
	for _, path := range []string{filepath.Dir(d.logPath(service)), d.dataRoot(service)} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			return serviceError("HOST_RUNTIME_PREPARE_FAILED", "Redeven could not prepare the managed Host runtime directories.", 500, true, err)
		}
	}
	return nil
}

type parsedHostIdentity struct {
	pid         int
	fingerprint string
	serviceID   string
	version     string
}

func parseHostIdentity(identity string) parsedHostIdentity {
	parts := strings.Split(strings.TrimSpace(identity), ":")
	if len(parts) == 6 && parts[0] == "host" && parts[1] == "v2" {
		pid, _ := strconv.Atoi(parts[4])
		return parsedHostIdentity{pid: pid, fingerprint: parts[5], serviceID: parts[2], version: "v2"}
	}
	if len(parts) == 4 && (parts[0] == "host" || parts[0] == "native") {
		pid, _ := strconv.Atoi(parts[3])
		return parsedHostIdentity{pid: pid, serviceID: parts[1], version: parts[0]}
	}
	return parsedHostIdentity{}
}

func isLegacyHostIdentity(identity string) bool {
	parsed := parseHostIdentity(identity)
	return parsed.version == "native" || parsed.version == "host"
}

func (d *hostScriptDriver) recoverPersistedProcess(service *pfregistry.ManagedService) (hostProcess, bool, error) {
	parsed := parseHostIdentity(service.RuntimeIdentity)
	if parsed.pid <= 0 || !managedProcessRunning(parsed.pid) {
		return hostProcess{}, false, nil
	}
	if parsed.serviceID != service.ServiceID {
		return hostProcess{}, false, serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The saved Host process belongs to another managed service.", 409, false, nil)
	}
	fingerprint, processGroup, command, err := managedProcessDetails(parsed.pid)
	if err != nil || processGroup != parsed.pid {
		return hostProcess{}, false, serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The saved Host process could not be verified after Runtime restart.", 409, false, err)
	}
	identity := strings.TrimSpace(service.RuntimeIdentity)
	if parsed.version == "v2" {
		if parsed.fingerprint == "" || parsed.fingerprint != fingerprint {
			return hostProcess{}, false, serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "The saved Host process start identity no longer matches.", 409, false, nil)
		}
	} else {
		if !d.legacyDeepSeekLayout(service) || !legacyDeepSeekProcessCommandMatches(service, command) {
			return hostProcess{}, false, serviceError("HOST_PROCESS_IDENTITY_MISMATCH", "Redeven will not adopt an unverified Host process from an earlier Runtime.", 409, false, nil)
		}
		nonce, nonceErr := randomID("proc")
		if nonceErr != nil {
			return hostProcess{}, false, nonceErr
		}
		identity = fmt.Sprintf("host:v2:%s:%s:%d:%s", service.ServiceID, nonce, parsed.pid, fingerprint)
	}
	return hostProcess{identity: identity, pid: parsed.pid, fingerprint: fingerprint}, true, nil
}

func legacyDeepSeekProcessCommandMatches(service *pfregistry.ManagedService, command string) bool {
	artifact, ok := auditedNativeArtifact(currentPlatformKey())
	if !ok || !regularExecutable(service.ArtifactReference) {
		return false
	}
	installRoot := filepath.Dir(filepath.Dir(filepath.Clean(service.ArtifactReference)))
	nodePath := filepath.Join(installRoot, filepath.FromSlash(artifact.NodeRelPath))
	entrypoint := filepath.Join(installRoot, "app", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	if !regularExecutable(nodePath) || !regularFile(entrypoint) {
		return false
	}
	prefix := nodePath + " " + entrypoint + " "
	if !strings.HasPrefix(strings.TrimSpace(command), prefix) {
		return false
	}
	fields := strings.Fields(strings.TrimPrefix(strings.TrimSpace(command), prefix))
	return slices.Contains(fields, "web") &&
		hostCommandArgumentMatches(fields, "--host", "127.0.0.1") &&
		hostCommandArgumentMatches(fields, "--port", strconv.Itoa(service.RuntimePort))
}

func hostCommandArgumentMatches(fields []string, name, value string) bool {
	for index := 0; index+1 < len(fields); index++ {
		if fields[index] == name && fields[index+1] == value {
			return true
		}
	}
	return false
}

func terminateHostProcess(process hostProcess) error {
	if process.cmd != nil {
		return terminateManagedProcess(process.cmd)
	}
	return terminateManagedProcessPID(process.pid)
}

func killHostProcess(process hostProcess) error {
	if process.cmd != nil {
		return killManagedProcess(process.cmd)
	}
	return killManagedProcessPID(process.pid)
}

func waitHostProcess(ctx context.Context, process hostProcess, timeout time.Duration) bool {
	if process.done != nil {
		select {
		case <-process.done:
			return true
		case <-ctx.Done():
			return false
		case <-time.After(timeout):
			return false
		}
	}
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		if !managedProcessRunning(process.pid) {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-deadline.C:
			return false
		case <-ticker.C:
		}
	}
}

func waitManagedProcessDetails(pid int, timeout time.Duration) (string, int, string, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		fingerprint, processGroup, command, err := managedProcessDetails(pid)
		if err == nil {
			return fingerprint, processGroup, command, nil
		}
		lastErr = err
		if time.Now().After(deadline) || !managedProcessAlive(pid) {
			return "", 0, "", lastErr
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func hostPIDFromIdentity(identity string) int {
	return parseHostIdentity(identity).pid
}

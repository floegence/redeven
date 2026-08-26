package managedwebservice

import (
	"context"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

type hostScriptDriver struct {
	manager   *Manager
	processMu sync.Mutex
	processes map[string]nativeProcess
}

func (d *hostScriptDriver) Install(ctx context.Context, service *pfregistry.ManagedService, _ catalogPayload, progress func(string, int64)) (string, string, error) {
	spec, err := templateSpecFromService(service)
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
	if spec.Host.RuntimeBundle != "" {
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
		progress("downloading", 2)
		if err := downloadNativeArchive(ctx, d.manager.downloads.packageHTTPClient(), artifact, archive); err != nil {
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
	spec, err := templateSpecFromService(service)
	if err != nil {
		return "", err
	}
	d.processMu.Lock()
	if current, ok := d.processes[service.ServiceID]; ok && current.cmd.ProcessState == nil {
		d.processMu.Unlock()
		if service.RuntimeIdentity != "" && service.RuntimeIdentity != current.identity {
			return "", serviceError("RUNTIME_IDENTITY_MISMATCH", "The custom host process identity does not match the saved instance.", 409, false, nil)
		}
		return current.identity, nil
	}
	d.processMu.Unlock()
	if pid := hostPIDFromIdentity(service.RuntimeIdentity); pid > 0 && managedProcessAlive(pid) {
		return "", serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not adopt a custom host process from another Runtime generation.", 409, false, nil)
	}
	logFile, err := os.OpenFile(filepath.Join(d.instanceRoot(service), "logs", "service.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
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
	nonce, err := randomID("proc")
	if err != nil {
		_ = terminateManagedProcess(cmd)
		_ = logFile.Close()
		return "", err
	}
	identity := "host:" + service.ServiceID + ":" + nonce + ":" + strconv.Itoa(cmd.Process.Pid)
	done := make(chan struct{})
	d.processMu.Lock()
	d.processes[service.ServiceID] = nativeProcess{cmd: cmd, identity: identity, done: done}
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
	if !ok {
		if pid := hostPIDFromIdentity(service.RuntimeIdentity); pid > 0 && managedProcessAlive(pid) {
			return serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not stop a custom host process it did not create in this Runtime generation.", 409, false, nil)
		}
		return nil
	}
	if current.identity != service.RuntimeIdentity {
		return serviceError("RUNTIME_IDENTITY_MISMATCH", "Redeven will not stop a custom host process whose identity changed.", 409, false, nil)
	}
	spec, err := templateSpecFromService(service)
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
	if err := terminateManagedProcess(current.cmd); err != nil {
		return serviceError("STOP_FAILED", "The custom host service could not be stopped.", 502, true, err)
	}
	select {
	case <-current.done:
		return stopScriptErr
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(8 * time.Second):
		if err := killManagedProcess(current.cmd); err != nil {
			return serviceError("STOP_FAILED", "The custom host service could not be killed after its stop timeout.", 502, true, err)
		}
	}
	select {
	case <-current.done:
		return stopScriptErr
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(2 * time.Second):
		return serviceError("STOP_FAILED", "The custom host service did not exit after it was killed.", 502, true, nil)
	}
}

func (d *hostScriptDriver) Uninstall(ctx context.Context, service *pfregistry.ManagedService, deleteData bool) error {
	if err := d.Stop(ctx, service); err != nil {
		return err
	}
	spec, err := templateSpecFromService(service)
	if err != nil {
		return err
	}
	if strings.TrimSpace(spec.Host.UninstallScript) != "" {
		if err := d.runOneShot(ctx, service, spec.Host.UninstallScript, service.ArtifactReference, "uninstall"); err != nil {
			return serviceError("UNINSTALL_SCRIPT_FAILED", "The custom host uninstall script failed.", 502, true, err)
		}
	}
	root := d.instanceRoot(service)
	if err := os.RemoveAll(filepath.Join(root, "install")); err != nil {
		return err
	}
	if err := os.RemoveAll(filepath.Join(root, "logs")); err != nil {
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
	return tailRedactedFile(filepath.Join(d.instanceRoot(service), "logs", "service.log"), tail)
}

func (d *hostScriptDriver) runOneShot(ctx context.Context, service *pfregistry.ManagedService, script, executable, phase string) error {
	logFile, err := os.OpenFile(filepath.Join(d.instanceRoot(service), "logs", "service.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
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
	parameters, err := d.manager.serviceParameters(service)
	if err != nil {
		return nil, err
	}
	root := d.instanceRoot(service)
	env := append(os.Environ(),
		"REDEVEN_SERVICE_ID="+service.ServiceID,
		"REDEVEN_SERVICE_HOST=127.0.0.1",
		"REDEVEN_SERVICE_PORT="+strconv.Itoa(service.RuntimePort),
		"REDEVEN_WORKSPACE="+service.WorkspacePath,
		"REDEVEN_SERVICE_DATA_DIR="+d.dataRoot(service),
		"REDEVEN_INSTALL_DIR="+filepath.Join(root, "install"),
		"REDEVEN_INSTALL_EXECUTABLE="+executable,
	)
	for name, value := range parameters {
		env = append(env, name+"="+value)
	}
	return env, nil
}

func (d *hostScriptDriver) instanceRoot(service *pfregistry.ManagedService) string {
	return filepath.Join(d.manager.stateDir, "instances", service.ServiceID)
}

func (d *hostScriptDriver) dataRoot(service *pfregistry.ManagedService) string {
	return filepath.Join(d.manager.stateDir, "families", service.ServiceFamilyID, "data")
}

func hostPIDFromIdentity(identity string) int {
	parts := strings.Split(strings.TrimSpace(identity), ":")
	if len(parts) != 4 || parts[0] != "host" {
		return 0
	}
	value, _ := strconv.Atoi(parts[3])
	return value
}

package managedwebservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const hostOpenResultLimit = 16 * 1024
const hostPrivateOutputLimit = 8 * 1024 * 1024

// A launch record contains observed resources and opening metadata, never an
// executable template snapshot. Current templates remain the only script source.
type hostRunState struct {
	SchemaVersion      int             `json:"schema_version"`
	RuntimeIdentity    string          `json:"runtime_identity"`
	RuntimeSpecSHA256  string          `json:"runtime_spec_sha256"`
	Endpoint           WebEndpointSpec `json:"endpoint"`
	OutputMode         string          `json:"output_mode"`
	AfterStartComplete bool            `json:"after_start_complete"`
	OpenErrorCode      string          `json:"open_error_code,omitempty"`
	OpenErrorMessage   string          `json:"open_error_message,omitempty"`
}

func (d *hostScriptDriver) runDirectory(service *pfregistry.ManagedService) string {
	identity := parseHostIdentity(service.RuntimeIdentity)
	if identity.nonce == "" {
		return ""
	}
	return filepath.Join(d.instanceRoot(service), "runs", identity.nonce)
}

func privateDirectory(path string) error {
	if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("service launch directory is not private")
	}
	return nil
}

func writePrivateJSON(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(raw); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (d *hostScriptDriver) writeRunState(service *pfregistry.ManagedService, state hostRunState) error {
	root := d.runDirectory(service)
	if root == "" {
		return errors.New("Host launch identity is invalid")
	}
	return writePrivateJSON(filepath.Join(root, "run.json"), state)
}

func (d *hostScriptDriver) readRunState(service *pfregistry.ManagedService) (hostRunState, error) {
	var state hostRunState
	root := d.runDirectory(service)
	if root == "" {
		return state, os.ErrNotExist
	}
	path := filepath.Join(root, "run.json")
	info, err := os.Lstat(path)
	if err != nil {
		return state, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 64*1024 {
		return state, errors.New("Host launch record is invalid")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return state, err
	}
	if err := decodeStrictJSON(raw, &state); err != nil {
		return state, err
	}
	if state.SchemaVersion != 1 || state.RuntimeIdentity != service.RuntimeIdentity || state.RuntimeSpecSHA256 != service.RuntimeSpecSHA256 || (state.OutputMode != "" && state.OutputMode != "discard" && state.OutputMode != "private_file") || (state.Endpoint.Scheme != "http" && state.Endpoint.Scheme != "https") || state.Endpoint.StartupTimeout < 0 || state.Endpoint.StartupTimeout > 600 {
		return state, errors.New("Host launch record identity changed")
	}
	return state, nil
}

type boundedHookResult struct {
	bytes.Buffer
	exceeded bool
}

func (b *boundedHookResult) Write(p []byte) (int, error) {
	n := len(p)
	remaining := hostOpenResultLimit + 1 - b.Len()
	if n > remaining {
		b.exceeded = true
		p = p[:remaining]
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

// Short-lived hook pipes belong to the hook only. The application never inherits
// them and hook cancellation never targets the service process group.
func (d *hostScriptDriver) runPrivateHook(ctx context.Context, service *pfregistry.ManagedService, script, phase string, timeout time.Duration, returnURL bool) (string, error) {
	if _, err := d.manager.prepareWorkspace(service.WorkspacePath, workspaceVerifyExisting); err != nil {
		return "", err
	}
	hookCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// The hook's temporary lifeline exits with its process group if the Runtime
	// is forcibly terminated. It exists only for this bounded hook invocation.
	lifelineRead, lifelineWrite, err := os.Pipe()
	if err != nil {
		return "", err
	}
	defer lifelineRead.Close()
	defer lifelineWrite.Close()
	cmd := exec.CommandContext(hookCtx, "/bin/sh", "-eu", "-c", `hook_group=$$
( IFS= read -r stop <&3 || :; kill -KILL "-$hook_group" 2>/dev/null || : ) &
watcher=$!
exec 3<&-
trap 'kill "$watcher" 2>/dev/null || :; wait "$watcher" 2>/dev/null || :' EXIT
/bin/sh -eu -c "$1"`, "managed-opening-hook", script)
	cmd.ExtraFiles = []*os.File{lifelineRead}
	cmd.Dir = service.WorkspacePath
	cmd.Env, err = d.serviceEnvironment(ctx, service, service.ArtifactReference)
	if err != nil {
		return "", err
	}
	cmd.Env = append(cmd.Env, "REDEVEN_SERVICE_PHASE="+phase)
	configureManagedProcess(cmd)
	cmd.Cancel = func() error { return killManagedProcess(cmd) }
	cmd.WaitDelay = 250 * time.Millisecond
	var output boundedHookResult
	cmd.Stdout, cmd.Stderr = io.Discard, io.Discard
	if returnURL {
		cmd.Stdout = &output
	}
	started := time.Now()
	runErr := cmd.Run()
	if d.manager.log != nil {
		exitCode := -1
		if cmd.ProcessState != nil {
			exitCode = cmd.ProcessState.ExitCode()
		}
		d.manager.log.Debug("managed service opening hook", "phase", phase, "duration_ms", time.Since(started).Milliseconds(), "exit_code", exitCode)
	}
	if err := runErr; err != nil {
		_ = killManagedProcess(cmd)
		code := "HOST_OPEN_HOOK_FAILED"
		if phase == "after_start" {
			code = "HOST_AFTER_START_HOOK_FAILED"
		}
		return "", serviceError(code, "The service is running, but its opening hook could not finish. Retry opening the service.", 409, true, nil)
	}
	if !returnURL {
		return "", nil
	}
	value := strings.TrimSuffix(strings.TrimSuffix(output.String(), "\n"), "\r")
	if output.exceeded || len(value) > hostOpenResultLimit || value == "" || strings.ContainsAny(value, "\r\n") {
		return "", serviceError("HOST_OPEN_TARGET_INVALID", "The opening hook must return one URL within its result limit.", 409, true, nil)
	}
	return value, nil
}

func (d *hostScriptDriver) prepareOpening(ctx context.Context, service *pfregistry.ManagedService, spec TemplateSpec) (result string, resultErr error) {
	state, err := d.readRunState(service)
	if err != nil {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service launch information is unavailable.", 409, true, nil)
	}
	defer func() {
		state.OpenErrorCode, state.OpenErrorMessage = "", ""
		if resultErr != nil {
			state.OpenErrorCode, state.OpenErrorMessage, _, _ = ErrorDetails(resultErr)
		}
		if err := d.writeRunState(service, state); err != nil && resultErr == nil {
			resultErr = serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening result could not be saved.", 500, true, nil)
		}
	}()
	if !state.AfterStartComplete {
		if spec.Host.AfterStartScript != "" {
			timeout := time.Duration(state.Endpoint.StartupTimeout) * time.Second
			if timeout <= 0 {
				timeout = 45 * time.Second
			}
			if _, err := d.runPrivateHook(ctx, service, spec.Host.AfterStartScript, "after_start", timeout, false); err != nil {
				return "", err
			}
		}
		state.AfterStartComplete = true
	}
	appPath := state.Endpoint.Path
	if appPath == "" {
		appPath = "/"
	}
	if spec.Host.OpenScript != "" {
		target, err := d.runPrivateHook(ctx, service, spec.Host.OpenScript, "open", 10*time.Second, true)
		if err != nil {
			return "", err
		}
		appPath, err = parseHostOpenURL(target, state.Endpoint, service.RuntimePort)
		if err != nil {
			return "", err
		}
	}
	if _, ok, err := d.recoverPersistedProcess(service); err != nil || !ok {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service process changed while preparing its opening information.", 409, true, nil)
	}
	if err := d.writeOpenSession(service, service.RuntimeIdentity, appPath); err != nil {
		return "", serviceError("HOST_OPEN_TARGET_UNAVAILABLE", "The service opening information could not be saved.", 500, true, nil)
	}
	if state.OutputMode == "private_file" {
		_ = truncatePrivateOutput(filepath.Join(d.runDirectory(service), "output"), 0)
	}
	return appPath, nil
}

func truncatePrivateOutput(path string, minimum int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return errors.New("service output is not a private regular file")
	}
	if info.Size() <= minimum {
		return nil
	}
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, actual) {
		return errors.New("service output identity changed")
	}
	return file.Truncate(0)
}

// Persist launch ownership in the existing transaction journal as well as the
// service row before release, so interrupted updates can observe that same PID.
func (d *hostScriptDriver) persistLaunch(ctx context.Context, service *pfregistry.ManagedService, identity string) error {
	current, err := d.manager.registry.GetManagedService(ctx, service.ServiceID)
	if err != nil {
		return err
	}
	if current == nil {
		return pfregistry.ErrManagedServiceNotFound
	}
	patch := pfregistry.ManagedServicePatch{RuntimeIdentity: &identity, RuntimeSpecSHA256: &service.RuntimeSpecSHA256}
	manifest := strings.TrimSpace(current.RuntimeManifestJSON)
	if manifest != "" && manifest != "{}" {
		journal, err := decodeContainerUpdateJournal(manifest)
		if err != nil {
			return serviceError("UPDATE_JOURNAL_INVALID", "The service launch transaction cannot be verified.", 409, false, nil)
		}
		switch service.RuntimeSpecSHA256 {
		case journal.Target.RuntimeSpecSHA256:
			journal.Target.RuntimeIdentity = identity
		case journal.Old.RuntimeSpecSHA256:
			journal.Old.RuntimeIdentity = identity
		default:
			return serviceError("UPDATE_JOURNAL_INVALID", "The launch does not match the current service transaction.", 409, false, nil)
		}
		raw, err := json.Marshal(journal)
		if err != nil {
			return err
		}
		manifest = string(raw)
		patch.RuntimeManifestJSON = &manifest
	}
	return d.manager.registry.UpdateManagedServiceIfRuntimeMatches(ctx, service.ServiceID, current.RuntimeIdentity, current.RuntimeSpecSHA256, patch)
}

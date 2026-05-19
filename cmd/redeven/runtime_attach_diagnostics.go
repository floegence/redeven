package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

func loadDesktopRuntimeStatus(stateRoot string, probeTimeout time.Duration) (runtimemanagement.RuntimeAttachStatus, error) {
	layout, err := config.LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		return runtimemanagement.RuntimeAttachStatus{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	status, err := runtimemanagement.LoadStatus(ctx, layout.RuntimeControlSocketPath, probeTimeout)
	metadata, _ := readAgentLockMetadata(layout.LockPath)
	if err != nil {
		return diagnoseRuntimeAttachFailure(layout.LockPath, layout.RuntimeControlSocketPath, metadata, err), nil
	}
	status.Diagnostics.LockPath = layout.LockPath
	status.Diagnostics.ControlSocketPath = layout.RuntimeControlSocketPath
	status.Diagnostics.SocketReachable = true
	if metadata != nil && metadata.InstanceID != "" && status.Identity.InstanceID != "" && metadata.InstanceID != status.Identity.InstanceID {
		status.State = runtimemanagement.AttachStateGenerationConflict
		status.Message = desktopRuntimeAttachMessage(status.State)
		status.Diagnostics.LockPID = metadata.PID
		status.Diagnostics.LockInstanceID = metadata.InstanceID
		status.Diagnostics.PIDAlive = processAlive(metadata.PID)
		status.Diagnostics.FailureCode = "runtime_identity_mismatch"
	}
	return status, nil
}

func waitForDesktopRuntimeStatus(socketPath string, timeout time.Duration, pollInterval time.Duration, probeTimeout time.Duration) (runtimemanagement.RuntimeAttachStatus, error) {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
		status, err := runtimemanagement.LoadStatus(ctx, socketPath, probeTimeout)
		cancel()
		if err == nil {
			return status, nil
		}
		lastErr = err
		if time.Now().After(deadline) {
			return runtimemanagement.RuntimeAttachStatus{}, lastErr
		}
		time.Sleep(pollInterval)
	}
}

func diagnoseRuntimeAttachFailure(lockPath string, socketPath string, metadata *agentLockMetadata, loadErr error) runtimemanagement.RuntimeAttachStatus {
	lockPID := 0
	lockInstanceID := ""
	pidAlive := false
	if metadata != nil {
		lockPID = metadata.PID
		lockInstanceID = metadata.InstanceID
		pidAlive = processAlive(metadata.PID)
	}

	state := runtimemanagement.AttachStateNotRunning
	failureCode := "runtime_not_running"
	message := desktopRuntimeAttachMessage(state)
	if metadata != nil && lockPID > 0 && pidAlive {
		state = runtimemanagement.AttachStateLiveProcessWithoutSocket
		failureCode = "management_socket_unreachable"
		message = desktopRuntimeAttachMessage(state)
	} else if metadata != nil && lockPID > 0 && !pidAlive {
		state = runtimemanagement.AttachStateStaleLock
		failureCode = "lock_pid_not_alive"
		message = desktopRuntimeAttachMessage(state)
	} else if fileExists(lockPath) {
		state = runtimemanagement.AttachStateStaleLock
		failureCode = "lock_without_runtime_metadata"
		message = desktopRuntimeAttachMessage(state)
	}
	if loadErr != nil && strings.TrimSpace(loadErr.Error()) != "" && failureCode == "" {
		failureCode = "management_status_unavailable"
	}

	return runtimemanagement.RuntimeAttachStatus{
		State: state,
		Identity: runtimeIdentityFromLockMetadata(metadata, runtimemanagement.RuntimeInstanceIdentity{
			PID:        lockPID,
			InstanceID: lockInstanceID,
		}),
		Message: message,
		Diagnostics: runtimemanagement.RuntimeAttachDiagnostics{
			LockPath:          lockPath,
			ControlSocketPath: socketPath,
			LockPID:           lockPID,
			LockInstanceID:    lockInstanceID,
			PIDAlive:          pidAlive,
			SocketReachable:   false,
			FailureCode:       failureCode,
		},
	}
}

func runtimeIdentityFromLockMetadata(metadata *agentLockMetadata, base runtimemanagement.RuntimeInstanceIdentity) runtimemanagement.RuntimeInstanceIdentity {
	if metadata == nil {
		return base
	}
	identity := runtimemanagement.RuntimeInstanceIdentity{
		InstanceID:      strings.TrimSpace(metadata.InstanceID),
		StateRoot:       strings.TrimSpace(metadata.StateRoot),
		StateDir:        strings.TrimSpace(metadata.StateDir),
		PID:             metadata.PID,
		StartedAtUnixMS: metadata.StartedAtUnixMS,
		RuntimeVersion:  strings.TrimSpace(metadata.RuntimeVersion),
		RuntimeCommit:   strings.TrimSpace(metadata.RuntimeCommit),
		BinaryPath:      strings.TrimSpace(metadata.BinaryPath),
		DesktopManaged:  metadata.DesktopManaged,
		DesktopOwnerID:  strings.TrimSpace(metadata.DesktopOwnerID),
	}
	if identity.InstanceID == "" {
		identity.InstanceID = base.InstanceID
	}
	if identity.PID <= 0 {
		identity.PID = base.PID
	}
	return identity
}

func desktopRuntimeAttachMessage(state runtimemanagement.AttachState) string {
	switch state {
	case runtimemanagement.AttachStateReady:
		return "Runtime is ready."
	case runtimemanagement.AttachStateStarting:
		return "Runtime is starting."
	case runtimemanagement.AttachStateUnhealthy:
		return "Runtime management socket is reachable but the runtime is unhealthy."
	case runtimemanagement.AttachStateLiveProcessWithoutSocket:
		return "A Redeven runtime process is alive, but its management socket is not reachable."
	case runtimemanagement.AttachStateGenerationConflict:
		return "Runtime lock metadata and management socket report different runtime instances."
	case runtimemanagement.AttachStateStaleLock:
		return "Runtime lock metadata is present but no live runtime is reachable."
	case runtimemanagement.AttachStateNotRunning:
		return "Runtime daemon is not running."
	default:
		return "Runtime is blocked."
	}
}

func desktopLaunchDiagnosticsFromAttach(status runtimemanagement.RuntimeAttachStatus) *desktopLaunchDiagnostics {
	return &desktopLaunchDiagnostics{
		LockPath:                 status.Diagnostics.LockPath,
		StateDir:                 filepath.Dir(filepath.Clean(strings.TrimSpace(status.Diagnostics.LockPath))),
		RuntimeControlSocketPath: status.Diagnostics.ControlSocketPath,
		AttachState:              string(status.State),
		FailureCode:              status.Diagnostics.FailureCode,
		LockPID:                  status.Diagnostics.LockPID,
		PIDAlive:                 status.Diagnostics.PIDAlive,
		SocketReachable:          status.Diagnostics.SocketReachable,
	}
}

func fileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil || !errors.Is(err, os.ErrNotExist)
}

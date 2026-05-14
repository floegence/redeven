package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const (
	desktopLockConflictAttachTimeout = 3 * time.Second
	desktopLockConflictPollInterval  = 100 * time.Millisecond
	desktopRuntimeProbeTimeout       = 300 * time.Millisecond
)

func desktopLaunchReportEnabled(mode runMode, desktopManaged bool, reportPath string) bool {
	return mode == runModeDesktop && desktopManaged && strings.TrimSpace(reportPath) != ""
}

func writeDesktopBlockedLaunchReport(
	reportPath string,
	code string,
	message string,
	stateLayout config.StateLayout,
) error {
	return writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:  desktopLaunchStatusBlocked,
		Code:    code,
		Message: message,
		Diagnostics: &desktopLaunchDiagnostics{
			StateDir:   stateLayout.StateDir,
			ConfigPath: stateLayout.ConfigPath,
			Command:    "redeven run",
		},
	})
}

func writeDesktopReadyLaunchReport(reportPath string, startup runtimeStartupReport, status desktopLaunchStatus) error {
	return writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:                 status,
		LocalUIURL:             startup.LocalUIURL,
		LocalUIURLs:            append([]string(nil), startup.LocalUIURLs...),
		RuntimeControl:         startup.RuntimeControl,
		PasswordRequired:       startup.PasswordRequired,
		EffectiveRunMode:       startup.EffectiveRunMode,
		RemoteEnabled:          startup.RemoteEnabled,
		DesktopManaged:         startup.DesktopManaged,
		DesktopOwnerID:         startup.DesktopOwnerID,
		ControlplaneBaseURL:    startup.ControlplaneBaseURL,
		ControlplaneProviderID: startup.ControlplaneProviderID,
		EnvPublicID:            startup.EnvPublicID,
		StateDir:               startup.StateDir,
		DiagnosticsEnabled:     startup.DiagnosticsEnabled,
		PID:                    startup.PID,
		RuntimeService:         startup.RuntimeService,
	})
}

type runtimeStartupReport struct {
	LocalUIURL             string
	LocalUIURLs            []string
	RuntimeControl         *runtimeControlEndpoint
	PasswordRequired       bool
	EffectiveRunMode       string
	RemoteEnabled          bool
	DesktopManaged         bool
	DesktopOwnerID         string
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvPublicID            string
	StateDir               string
	DiagnosticsEnabled     bool
	PID                    int
	RuntimeService         runtimeservice.Snapshot
}

func buildRuntimeStartupReport(state *localuiruntime.Snapshot) runtimeStartupReport {
	return runtimeStartupReport{
		LocalUIURL:  state.LocalUIURL,
		LocalUIURLs: append([]string(nil), state.LocalUIURLs...),
		RuntimeControl: func() *runtimeControlEndpoint {
			if state.RuntimeControl == nil {
				return nil
			}
			return &runtimeControlEndpoint{
				ProtocolVersion: state.RuntimeControl.ProtocolVersion,
				BaseURL:         state.RuntimeControl.BaseURL,
				Token:           state.RuntimeControl.Token,
				DesktopOwnerID:  state.RuntimeControl.DesktopOwnerID,
				ExpiresAtUnixMS: state.RuntimeControl.ExpiresAtUnixMS,
			}
		}(),
		PasswordRequired:       state.PasswordRequired,
		EffectiveRunMode:       state.EffectiveRunMode,
		RemoteEnabled:          state.RemoteEnabled,
		DesktopManaged:         state.DesktopManaged,
		DesktopOwnerID:         state.DesktopOwnerID,
		ControlplaneBaseURL:    state.ControlplaneBaseURL,
		ControlplaneProviderID: state.ControlplaneProviderID,
		EnvPublicID:            state.EnvPublicID,
		StateDir:               state.StateDir,
		DiagnosticsEnabled:     state.DiagnosticsEnabled,
		PID:                    state.PID,
		RuntimeService:         state.RuntimeService,
	}
}

func normalizeLaunchRuntimeServiceSnapshot(snapshot runtimeservice.Snapshot, desktopManaged bool, effectiveRunMode string, remoteEnabled bool) runtimeservice.Snapshot {
	return runtimeservice.NormalizeSnapshotForEndpoint(snapshot, desktopManaged, effectiveRunMode, remoteEnabled)
}

func handleDesktopLockConflict(reportPath string, lockPath string, configPath string) (handled bool, exitCode int, err error) {
	runtimeStatePath := localuiruntime.RuntimeStatePath(configPath)
	state, loadErr := localuiruntime.WaitForAttachable(
		runtimeStatePath,
		desktopLockConflictAttachTimeout,
		desktopLockConflictPollInterval,
		desktopRuntimeProbeTimeout,
	)
	if loadErr != nil {
		return false, 0, loadErr
	}
	if state != nil {
		if err := writeDesktopReadyLaunchReport(reportPath, buildRuntimeStartupReport(state), desktopLaunchStatusAttached); err != nil {
			return false, 0, err
		}
		return true, 0, nil
	}

	metadata, err := readAgentLockMetadata(lockPath)
	if err != nil {
		metadata = nil
	}
	stateDir := filepath.Dir(filepath.Clean(configPath))
	if err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:    desktopLaunchStatusBlocked,
		Code:      desktopLaunchCodeStateDirLocked,
		Message:   "Another Redeven runtime instance is already using this state directory.",
		LockOwner: lockOwnerFromMetadata(metadata),
		Diagnostics: &desktopLaunchDiagnostics{
			LockPath:         lockPath,
			StateDir:         stateDir,
			RuntimeStatePath: runtimeStatePath,
		},
	}); err != nil {
		return false, 0, fmt.Errorf("write blocked desktop launch report: %w", err)
	}
	return true, 1, nil
}

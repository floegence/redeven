package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimemanagement"
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
			StateDir:                 stateLayout.StateDir,
			ConfigPath:               stateLayout.ConfigPath,
			RuntimeControlSocketPath: stateLayout.RuntimeControlSocketPath,
			Command:                  "redeven run",
		},
	})
}

func writeDesktopReadyLaunchReport(reportPath string, startup runtimeStartupReport, status desktopLaunchStatus) error {
	return writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:                   status,
		LocalUIURL:               startup.LocalUIURL,
		LocalUIURLs:              append([]string(nil), startup.LocalUIURLs...),
		LocalUIBridgeURL:         startup.LocalUIBridgeURL,
		RuntimeControl:           startup.RuntimeControl,
		PasswordRequired:         startup.PasswordRequired,
		Exposure:                 startup.Exposure,
		EffectiveRunMode:         startup.EffectiveRunMode,
		RemoteEnabled:            startup.RemoteEnabled,
		DesktopManaged:           startup.DesktopManaged,
		DesktopOwnerID:           startup.DesktopOwnerID,
		ProviderOrigin:           startup.ProviderOrigin,
		ControlplaneBaseURL:      startup.ControlplaneBaseURL,
		ControlplaneProviderID:   startup.ControlplaneProviderID,
		EnvPublicID:              startup.EnvPublicID,
		StateDir:                 startup.StateDir,
		RuntimeControlSocketPath: startup.RuntimeControlSocketPath,
		DiagnosticsEnabled:       startup.DiagnosticsEnabled,
		PID:                      startup.PID,
		StartedAtUnixMS:          startup.StartedAtUnixMS,
		RuntimeService:           startup.RuntimeService,
	})
}

type runtimeStartupReport struct {
	LocalUIURL               string
	LocalUIURLs              []string
	LocalUIBridgeURL         string
	RuntimeControl           *runtimeControlEndpoint
	PasswordRequired         bool
	Exposure                 runtimemanagement.LocalUIExposure
	EffectiveRunMode         string
	RemoteEnabled            bool
	DesktopManaged           bool
	DesktopOwnerID           string
	ProviderOrigin           string
	ControlplaneBaseURL      string
	ControlplaneProviderID   string
	EnvPublicID              string
	StateDir                 string
	RuntimeControlSocketPath string
	DiagnosticsEnabled       bool
	PID                      int
	StartedAtUnixMS          int64
	RuntimeService           runtimeservice.Snapshot
}

func buildRuntimeStartupReport(status runtimemanagement.RuntimeAttachStatus) runtimeStartupReport {
	endpoint := status.Endpoint
	if endpoint == nil {
		endpoint = &runtimemanagement.RuntimeAttachEndpoint{}
	}
	return runtimeStartupReport{
		LocalUIURL:       endpoint.LocalUIURL,
		LocalUIURLs:      append([]string(nil), endpoint.LocalUIURLs...),
		LocalUIBridgeURL: endpoint.LocalUIBridgeURL,
		RuntimeControl: func() *runtimeControlEndpoint {
			if endpoint.RuntimeControl == nil {
				return nil
			}
			return &runtimeControlEndpoint{
				ProtocolVersion: endpoint.RuntimeControl.ProtocolVersion,
				BaseURL:         endpoint.RuntimeControl.BaseURL,
				Token:           endpoint.RuntimeControl.Token,
				DesktopOwnerID:  endpoint.RuntimeControl.DesktopOwnerID,
				ExpiresAtUnixMS: endpoint.RuntimeControl.ExpiresAtUnixMS,
			}
		}(),
		PasswordRequired:         endpoint.PasswordRequired,
		Exposure:                 endpoint.Exposure,
		EffectiveRunMode:         status.RuntimeService.EffectiveRunMode,
		RemoteEnabled:            status.RuntimeService.RemoteEnabled,
		DesktopManaged:           status.Identity.DesktopManaged,
		DesktopOwnerID:           status.Identity.DesktopOwnerID,
		ProviderOrigin:           status.RuntimeService.Bindings.ProviderLink.ProviderOrigin,
		ControlplaneBaseURL:      status.RuntimeService.Bindings.ProviderLink.AccessPointOrigin,
		ControlplaneProviderID:   status.RuntimeService.Bindings.ProviderLink.ProviderID,
		EnvPublicID:              status.RuntimeService.Bindings.ProviderLink.EnvPublicID,
		StateDir:                 status.Identity.StateDir,
		RuntimeControlSocketPath: status.Diagnostics.ControlSocketPath,
		PID:                      status.Identity.PID,
		StartedAtUnixMS:          status.Identity.StartedAtUnixMS,
		RuntimeService:           status.RuntimeService,
	}
}

func normalizeLaunchRuntimeServiceSnapshot(snapshot runtimeservice.Snapshot, desktopManaged bool, effectiveRunMode string, remoteEnabled bool) runtimeservice.Snapshot {
	return runtimeservice.NormalizeSnapshotForEndpoint(snapshot, desktopManaged, effectiveRunMode, remoteEnabled)
}

func handleDesktopLockConflict(reportPath string, lockPath string, configPath string) (handled bool, exitCode int, err error) {
	socketPath := config.RuntimeControlSocketPathFromConfigPath(configPath)
	status, loadErr := waitForDesktopRuntimeStatus(socketPath, desktopLockConflictAttachTimeout, desktopLockConflictPollInterval, desktopRuntimeProbeTimeout)
	if loadErr == nil && status.State == runtimemanagement.AttachStateReady && status.Endpoint != nil {
		if err := writeDesktopReadyLaunchReport(reportPath, buildRuntimeStartupReport(status), desktopLaunchStatusAttached); err != nil {
			return false, 0, err
		}
		return true, 0, nil
	}

	metadata, _ := readAgentLockMetadata(lockPath)
	diagnostics := diagnoseRuntimeAttachFailure(lockPath, socketPath, metadata, loadErr)
	if diagnostics.State == runtimemanagement.AttachStateStaleLock {
		if err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
			Status:      desktopLaunchStatusBlocked,
			Code:        string(runtimemanagement.AttachStateStaleLock),
			Message:     "Runtime lock metadata is present but the recorded runtime process is not alive.",
			LockOwner:   lockOwnerFromMetadata(metadata),
			Diagnostics: desktopLaunchDiagnosticsFromAttach(diagnostics),
		}); err != nil {
			return false, 0, err
		}
		return true, 1, nil
	}

	stateDir := filepath.Dir(filepath.Clean(configPath))
	if err := writeDesktopLaunchReport(reportPath, desktopLaunchReport{
		Status:    desktopLaunchStatusBlocked,
		Code:      string(diagnostics.State),
		Message:   desktopRuntimeAttachMessage(diagnostics.State),
		LockOwner: lockOwnerFromMetadata(metadata),
		Diagnostics: &desktopLaunchDiagnostics{
			LockPath:                 lockPath,
			StateDir:                 stateDir,
			RuntimeControlSocketPath: socketPath,
			AttachState:              string(diagnostics.State),
			FailureCode:              diagnostics.Diagnostics.FailureCode,
			LockPID:                  diagnostics.Diagnostics.LockPID,
			PIDAlive:                 diagnostics.Diagnostics.PIDAlive,
			SocketReachable:          diagnostics.Diagnostics.SocketReachable,
		},
	}); err != nil {
		return false, 0, fmt.Errorf("write blocked desktop launch report: %w", err)
	}
	return true, 1, nil
}

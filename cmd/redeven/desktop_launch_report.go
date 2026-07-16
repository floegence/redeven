package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

type desktopLaunchStatus string

const (
	desktopLaunchStatusReady    desktopLaunchStatus = "ready"
	desktopLaunchStatusAttached desktopLaunchStatus = "attached"
	desktopLaunchStatusBlocked  desktopLaunchStatus = "blocked"
)

const (
	desktopLaunchCodeStateDirLocked = "state_dir_locked"
	desktopLaunchCodeStartupInvalid = "startup_invalid"
	desktopLaunchCodeStartupFailed  = "startup_failed"
)

type desktopLaunchLockOwner struct {
	PID                      int    `json:"pid,omitempty"`
	Mode                     string `json:"mode,omitempty"`
	InstanceID               string `json:"instance_id,omitempty"`
	StartedAtUnixMS          int64  `json:"started_at_unix_ms,omitempty"`
	RuntimeVersion           string `json:"runtime_version,omitempty"`
	RuntimeCommit            string `json:"runtime_commit,omitempty"`
	BinaryPath               string `json:"binary_path,omitempty"`
	DesktopManaged           bool   `json:"desktop_managed"`
	DesktopOwnerID           string `json:"desktop_owner_id,omitempty"`
	LocalUIEnabled           bool   `json:"local_ui_enabled"`
	ConfigPath               string `json:"config_path,omitempty"`
	StateRoot                string `json:"state_root,omitempty"`
	StateDir                 string `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string `json:"runtime_control_socket_path,omitempty"`
}

type desktopLaunchDiagnostics struct {
	LockPath                 string `json:"lock_path,omitempty"`
	StateDir                 string `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string `json:"runtime_control_socket_path,omitempty"`
	ConfigPath               string `json:"config_path,omitempty"`
	Command                  string `json:"command,omitempty"`
	AttachState              string `json:"attach_state,omitempty"`
	FailureCode              string `json:"failure_code,omitempty"`
	LockPID                  int    `json:"lock_pid,omitempty"`
	PIDAlive                 bool   `json:"pid_alive,omitempty"`
	SocketReachable          bool   `json:"socket_reachable,omitempty"`
}

type desktopLaunchReport struct {
	Status  desktopLaunchStatus `json:"status,omitempty"`
	Code    string              `json:"code,omitempty"`
	Message string              `json:"message,omitempty"`

	LocalUIURL               string                            `json:"local_ui_url,omitempty"`
	LocalUIURLs              []string                          `json:"local_ui_urls,omitempty"`
	RuntimeControl           *runtimeControlEndpoint           `json:"runtime_control,omitempty"`
	PasswordRequired         bool                              `json:"password_required"`
	Exposure                 runtimemanagement.LocalUIExposure `json:"exposure"`
	EffectiveRunMode         string                            `json:"effective_run_mode,omitempty"`
	RemoteEnabled            bool                              `json:"remote_enabled"`
	DesktopManaged           bool                              `json:"desktop_managed"`
	DesktopOwnerID           string                            `json:"desktop_owner_id,omitempty"`
	ProviderOrigin           string                            `json:"provider_origin,omitempty"`
	ControlplaneBaseURL      string                            `json:"controlplane_base_url,omitempty"`
	ControlplaneProviderID   string                            `json:"controlplane_provider_id,omitempty"`
	EnvPublicID              string                            `json:"env_public_id,omitempty"`
	StateDir                 string                            `json:"state_dir,omitempty"`
	RuntimeControlSocketPath string                            `json:"runtime_control_socket_path,omitempty"`
	DiagnosticsEnabled       bool                              `json:"diagnostics_enabled"`
	PID                      int                               `json:"pid,omitempty"`
	StartedAtUnixMS          int64                             `json:"started_at_unix_ms,omitempty"`
	RuntimeService           runtimeservice.Snapshot           `json:"runtime_service"`

	LockOwner   *desktopLaunchLockOwner   `json:"lock_owner,omitempty"`
	Diagnostics *desktopLaunchDiagnostics `json:"diagnostics,omitempty"`
}

type runtimeControlEndpoint struct {
	ProtocolVersion string `json:"protocol_version"`
	BaseURL         string `json:"base_url"`
	Token           string `json:"token"`
	DesktopOwnerID  string `json:"desktop_owner_id"`
	ExpiresAtUnixMS int64  `json:"expires_at_unix_ms,omitempty"`
}

func writeDesktopLaunchReport(path string, report desktopLaunchReport) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil
	}

	report.Status = desktopLaunchStatus(strings.TrimSpace(string(report.Status)))
	report.Code = strings.TrimSpace(report.Code)
	report.Message = strings.TrimSpace(report.Message)

	switch report.Status {
	case desktopLaunchStatusReady, desktopLaunchStatusAttached:
		if err := report.Exposure.Validate(); err != nil {
			return err
		}
		if report.PasswordRequired != report.Exposure.PasswordRequired {
			return errors.New("password_required does not match exposure")
		}
		report.LocalUIURL = strings.TrimSpace(report.LocalUIURL)
		if report.LocalUIURL == "" {
			return errors.New("missing local_ui_url")
		}
		report.LocalUIURLs = compactStrings(report.LocalUIURLs)
		if len(report.LocalUIURLs) == 0 {
			report.LocalUIURLs = []string{report.LocalUIURL}
		}
		report.EffectiveRunMode = strings.TrimSpace(report.EffectiveRunMode)
		report.DesktopOwnerID = strings.TrimSpace(report.DesktopOwnerID)
		report.ProviderOrigin = strings.TrimSpace(report.ProviderOrigin)
		report.ControlplaneBaseURL = strings.TrimSpace(report.ControlplaneBaseURL)
		report.ControlplaneProviderID = strings.TrimSpace(report.ControlplaneProviderID)
		report.EnvPublicID = strings.TrimSpace(report.EnvPublicID)
		report.RuntimeService = normalizeLaunchRuntimeServiceSnapshot(
			report.RuntimeService,
			report.DesktopManaged,
			report.EffectiveRunMode,
			report.RemoteEnabled,
		)
	case desktopLaunchStatusBlocked:
		if report.Code == "" {
			return errors.New("missing blocked code")
		}
		if report.Message == "" {
			return errors.New("missing blocked message")
		}
	default:
		return errors.New("invalid desktop launch status")
	}

	dir := filepath.Dir(cleanPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')

	tmpPath := cleanPath + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, cleanPath)
}

func compactStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func firstNonEmptyString(values []string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

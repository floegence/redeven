package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type desktopLaunchStatus string

const (
	desktopLaunchStatusReady    desktopLaunchStatus = "ready"
	desktopLaunchStatusAttached desktopLaunchStatus = "attached"
	desktopLaunchStatusBlocked  desktopLaunchStatus = "blocked"
)

const (
	desktopLaunchCodeStateDirLocked = "state_dir_locked"
)

type desktopLaunchLockOwner struct {
	PID              int    `json:"pid,omitempty"`
	Mode             string `json:"mode,omitempty"`
	ScopeKey         string `json:"scope_key,omitempty"`
	DesktopManaged   bool   `json:"desktop_managed"`
	LocalUIEnabled   bool   `json:"local_ui_enabled"`
	ConfigPath       string `json:"config_path,omitempty"`
	StateDir         string `json:"state_dir,omitempty"`
	RuntimeStatePath string `json:"runtime_state_path,omitempty"`
}

type desktopLaunchDiagnostics struct {
	LockPath         string `json:"lock_path,omitempty"`
	StateDir         string `json:"state_dir,omitempty"`
	RuntimeStatePath string `json:"runtime_state_path,omitempty"`
}

type desktopLaunchReport struct {
	Status  desktopLaunchStatus `json:"status,omitempty"`
	Code    string              `json:"code,omitempty"`
	Message string              `json:"message,omitempty"`

	LocalUIURL         string   `json:"local_ui_url,omitempty"`
	LocalUIURLs        []string `json:"local_ui_urls,omitempty"`
	PasswordRequired   bool     `json:"password_required"`
	EffectiveRunMode   string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled      bool     `json:"remote_enabled"`
	DesktopManaged     bool     `json:"desktop_managed"`
	StateDir           string   `json:"state_dir,omitempty"`
	DiagnosticsEnabled bool     `json:"diagnostics_enabled"`
	PID                int      `json:"pid,omitempty"`

	LockOwner   *desktopLaunchLockOwner   `json:"lock_owner,omitempty"`
	Diagnostics *desktopLaunchDiagnostics `json:"diagnostics,omitempty"`
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
		report.LocalUIURL = strings.TrimSpace(report.LocalUIURL)
		if report.LocalUIURL == "" {
			return errors.New("missing local_ui_url")
		}
		report.LocalUIURLs = compactStrings(report.LocalUIURLs)
		if len(report.LocalUIURLs) == 0 {
			report.LocalUIURLs = []string{report.LocalUIURL}
		}
		report.EffectiveRunMode = strings.TrimSpace(report.EffectiveRunMode)
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

package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type startupReport struct {
	LocalUIURL       string   `json:"local_ui_url,omitempty"`
	LocalUIURLs      []string `json:"local_ui_urls,omitempty"`
	EffectiveRunMode string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled    bool     `json:"remote_enabled"`
	DesktopManaged   bool     `json:"desktop_managed"`
}

func writeStartupReport(path string, report startupReport) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil
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

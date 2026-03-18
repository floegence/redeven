package localui

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type runtimeState struct {
	LocalUIURL       string   `json:"local_ui_url,omitempty"`
	LocalUIURLs      []string `json:"local_ui_urls,omitempty"`
	EffectiveRunMode string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled    bool     `json:"remote_enabled"`
	DesktopManaged   bool     `json:"desktop_managed"`
	PID              int      `json:"pid,omitempty"`
}

func localRuntimeStatePath(configPath string) string {
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		return filepath.Join("runtime", "local-ui.json")
	}
	return filepath.Join(filepath.Dir(configPath), "runtime", "local-ui.json")
}

func writeRuntimeState(path string, state runtimeState) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil
	}

	state.LocalUIURL = strings.TrimSpace(state.LocalUIURL)
	state.LocalUIURLs = compactRuntimeStrings(state.LocalUIURLs)
	if state.LocalUIURL == "" {
		state.LocalUIURL = firstNonEmptyString(state.LocalUIURLs)
	}
	if state.LocalUIURL == "" {
		return errors.New("missing local_ui_url")
	}
	if len(state.LocalUIURLs) == 0 {
		state.LocalUIURLs = []string{state.LocalUIURL}
	}
	state.EffectiveRunMode = strings.TrimSpace(state.EffectiveRunMode)

	dir := filepath.Dir(cleanPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	body, err := json.MarshalIndent(state, "", "  ")
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

func removeRuntimeState(path string) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil
	}
	if err := os.Remove(cleanPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	runtimeDir := filepath.Dir(cleanPath)
	if err := os.Remove(runtimeDir); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func compactRuntimeStrings(values []string) []string {
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

package localui

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type runtimeState struct {
	LocalUIURL         string   `json:"local_ui_url,omitempty"`
	LocalUIURLs        []string `json:"local_ui_urls,omitempty"`
	EffectiveRunMode   string   `json:"effective_run_mode,omitempty"`
	RemoteEnabled      bool     `json:"remote_enabled"`
	DesktopManaged     bool     `json:"desktop_managed"`
	StateDir           string   `json:"state_dir,omitempty"`
	DiagnosticsEnabled bool     `json:"diagnostics_enabled"`
	PID                int      `json:"pid,omitempty"`
}

type RuntimeStateSnapshot struct {
	LocalUIURL         string
	LocalUIURLs        []string
	EffectiveRunMode   string
	RemoteEnabled      bool
	DesktopManaged     bool
	StateDir           string
	DiagnosticsEnabled bool
	PID                int
}

func RuntimeStatePath(configPath string) string {
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		return filepath.Join("runtime", "local-ui.json")
	}
	return filepath.Join(filepath.Dir(configPath), "runtime", "local-ui.json")
}

func localRuntimeStatePath(configPath string) string {
	return RuntimeStatePath(configPath)
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

func parseRuntimeState(raw []byte) (*RuntimeStateSnapshot, error) {
	var state runtimeState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	state.LocalUIURL = strings.TrimSpace(state.LocalUIURL)
	state.LocalUIURLs = compactRuntimeStrings(state.LocalUIURLs)
	if state.LocalUIURL == "" {
		state.LocalUIURL = firstNonEmptyString(state.LocalUIURLs)
	}
	if state.LocalUIURL == "" {
		return nil, errors.New("missing local_ui_url")
	}
	if len(state.LocalUIURLs) == 0 {
		state.LocalUIURLs = []string{state.LocalUIURL}
	}
	return &RuntimeStateSnapshot{
		LocalUIURL:         state.LocalUIURL,
		LocalUIURLs:        append([]string(nil), state.LocalUIURLs...),
		EffectiveRunMode:   strings.TrimSpace(state.EffectiveRunMode),
		RemoteEnabled:      state.RemoteEnabled,
		DesktopManaged:     state.DesktopManaged,
		StateDir:           strings.TrimSpace(state.StateDir),
		DiagnosticsEnabled: state.DiagnosticsEnabled,
		PID:                state.PID,
	}, nil
}

func loadRuntimeState(path string) (*RuntimeStateSnapshot, error) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil, nil
	}
	body, err := os.ReadFile(cleanPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	snapshot, err := parseRuntimeState(body)
	if err != nil {
		return nil, nil
	}
	return snapshot, nil
}

func probeRuntimeURL(rawURL string, timeout time.Duration) bool {
	baseURL := strings.TrimSpace(rawURL)
	if baseURL == "" {
		return false
	}
	parsedURL, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	host := strings.TrimSpace(parsedURL.Hostname())
	if host == "" {
		return false
	}
	ip := net.ParseIP(host)
	if ip != nil {
		if !ip.IsLoopback() {
			return false
		}
	} else if !strings.EqualFold(host, "localhost") {
		return false
	}

	probeURL, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	probeURL.Path = "/_redeven_proxy/env/"
	probeURL.RawQuery = ""
	probeURL.Fragment = ""

	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(probeURL.String())
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

func LoadAttachableRuntimeState(path string, timeout time.Duration) (*RuntimeStateSnapshot, error) {
	snapshot, err := loadRuntimeState(path)
	if err != nil || snapshot == nil {
		return snapshot, err
	}
	for _, candidateURL := range append([]string{snapshot.LocalUIURL}, snapshot.LocalUIURLs...) {
		candidateURL = strings.TrimSpace(candidateURL)
		if candidateURL == "" {
			continue
		}
		if probeRuntimeURL(candidateURL, timeout) {
			snapshot.LocalUIURL = candidateURL
			snapshot.LocalUIURLs = compactRuntimeStrings(append([]string{candidateURL}, snapshot.LocalUIURLs...))
			return snapshot, nil
		}
	}
	return nil, nil
}

func WaitForAttachableRuntimeState(path string, timeout time.Duration, pollInterval time.Duration, probeTimeout time.Duration) (*RuntimeStateSnapshot, error) {
	if timeout <= 0 {
		return LoadAttachableRuntimeState(path, probeTimeout)
	}
	if pollInterval <= 0 {
		pollInterval = 100 * time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	for {
		snapshot, err := LoadAttachableRuntimeState(path, probeTimeout)
		if err != nil || snapshot != nil {
			return snapshot, err
		}
		if time.Now().After(deadline) {
			return nil, nil
		}
		time.Sleep(pollInterval)
	}
}

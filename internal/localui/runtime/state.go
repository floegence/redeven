package localuiruntime

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

	"github.com/floegence/redeven/internal/runtimeservice"
)

type State struct {
	LocalUIURL             string                  `json:"local_ui_url,omitempty"`
	LocalUIURLs            []string                `json:"local_ui_urls,omitempty"`
	PasswordRequired       bool                    `json:"password_required"`
	EffectiveRunMode       string                  `json:"effective_run_mode,omitempty"`
	RemoteEnabled          bool                    `json:"remote_enabled"`
	DesktopManaged         bool                    `json:"desktop_managed"`
	ControlplaneBaseURL    string                  `json:"controlplane_base_url,omitempty"`
	ControlplaneProviderID string                  `json:"controlplane_provider_id,omitempty"`
	EnvPublicID            string                  `json:"env_public_id,omitempty"`
	StateDir               string                  `json:"state_dir,omitempty"`
	DiagnosticsEnabled     bool                    `json:"diagnostics_enabled"`
	PID                    int                     `json:"pid,omitempty"`
	RuntimeService         runtimeservice.Snapshot `json:"runtime_service"`
}

type Snapshot struct {
	LocalUIURL             string
	LocalUIURLs            []string
	PasswordRequired       bool
	EffectiveRunMode       string
	RemoteEnabled          bool
	DesktopManaged         bool
	ControlplaneBaseURL    string
	ControlplaneProviderID string
	EnvPublicID            string
	StateDir               string
	DiagnosticsEnabled     bool
	PID                    int
	RuntimeService         runtimeservice.Snapshot
}

func RuntimeStatePath(configPath string) string {
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		return filepath.Join("runtime", "local-ui.json")
	}
	return filepath.Join(filepath.Dir(configPath), "runtime", "local-ui.json")
}

func WriteState(path string, state State) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return nil
	}

	state.LocalUIURL = strings.TrimSpace(state.LocalUIURL)
	state.LocalUIURLs = compactStrings(state.LocalUIURLs)
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
	state.ControlplaneBaseURL = strings.TrimSpace(state.ControlplaneBaseURL)
	state.ControlplaneProviderID = strings.TrimSpace(state.ControlplaneProviderID)
	state.EnvPublicID = strings.TrimSpace(state.EnvPublicID)
	state.RuntimeService = normalizeRuntimeServiceSnapshot(state.RuntimeService, state.DesktopManaged, state.EffectiveRunMode, state.RemoteEnabled)

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

func RemoveState(path string) error {
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

func parseState(raw []byte) (*Snapshot, error) {
	var state State
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	state.LocalUIURL = strings.TrimSpace(state.LocalUIURL)
	state.LocalUIURLs = compactStrings(state.LocalUIURLs)
	if state.LocalUIURL == "" {
		state.LocalUIURL = firstNonEmptyString(state.LocalUIURLs)
	}
	if state.LocalUIURL == "" {
		return nil, errors.New("missing local_ui_url")
	}
	if len(state.LocalUIURLs) == 0 {
		state.LocalUIURLs = []string{state.LocalUIURL}
	}
	state.RuntimeService = normalizeRuntimeServiceSnapshot(state.RuntimeService, state.DesktopManaged, state.EffectiveRunMode, state.RemoteEnabled)
	return &Snapshot{
		LocalUIURL:             state.LocalUIURL,
		LocalUIURLs:            append([]string(nil), state.LocalUIURLs...),
		PasswordRequired:       state.PasswordRequired,
		EffectiveRunMode:       strings.TrimSpace(state.EffectiveRunMode),
		RemoteEnabled:          state.RemoteEnabled,
		DesktopManaged:         state.DesktopManaged,
		ControlplaneBaseURL:    strings.TrimSpace(state.ControlplaneBaseURL),
		ControlplaneProviderID: strings.TrimSpace(state.ControlplaneProviderID),
		EnvPublicID:            strings.TrimSpace(state.EnvPublicID),
		StateDir:               strings.TrimSpace(state.StateDir),
		DiagnosticsEnabled:     state.DiagnosticsEnabled,
		PID:                    state.PID,
		RuntimeService:         state.RuntimeService,
	}, nil
}

func Load(path string) (*Snapshot, error) {
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
	snapshot, err := parseState(body)
	if err != nil {
		return nil, nil
	}
	return snapshot, nil
}

type localRuntimeHealthEnvelope struct {
	Data *localRuntimeHealthPayload `json:"data"`
}

type localRuntimeHealthPayload struct {
	Status           *string                  `json:"status"`
	PasswordRequired *bool                    `json:"password_required"`
	RuntimeService   *runtimeservice.Snapshot `json:"runtime_service"`
}

func probeURL(rawURL string, timeout time.Duration) (*localRuntimeHealthPayload, bool) {
	baseURL := strings.TrimSpace(rawURL)
	if baseURL == "" {
		return nil, false
	}
	parsedURL, err := url.Parse(baseURL)
	if err != nil {
		return nil, false
	}
	host := strings.TrimSpace(parsedURL.Hostname())
	if host == "" {
		return nil, false
	}
	ip := net.ParseIP(host)
	if ip != nil {
		if !ip.IsLoopback() {
			return nil, false
		}
	} else if !strings.EqualFold(host, "localhost") {
		return nil, false
	}

	probeURL, err := url.Parse(baseURL)
	if err != nil {
		return nil, false
	}
	probeURL.Path = "/api/local/runtime/health"
	probeURL.RawQuery = ""
	probeURL.Fragment = ""

	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(probeURL.String())
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}

	var envelope localRuntimeHealthEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, false
	}
	if envelope.Data == nil || envelope.Data.PasswordRequired == nil || envelope.Data.Status == nil {
		return nil, false
	}
	if !strings.EqualFold(strings.TrimSpace(*envelope.Data.Status), "online") {
		return nil, false
	}
	return envelope.Data, true
}

func LoadAttachable(path string, timeout time.Duration) (*Snapshot, error) {
	snapshot, err := Load(path)
	if err != nil || snapshot == nil {
		return snapshot, err
	}
	for _, candidateURL := range append([]string{snapshot.LocalUIURL}, snapshot.LocalUIURLs...) {
		candidateURL = strings.TrimSpace(candidateURL)
		if candidateURL == "" {
			continue
		}
		status, ok := probeURL(candidateURL, timeout)
		if ok {
			snapshot.LocalUIURL = candidateURL
			snapshot.LocalUIURLs = compactStrings(append([]string{candidateURL}, snapshot.LocalUIURLs...))
			snapshot.PasswordRequired = status.PasswordRequired != nil && *status.PasswordRequired
			if status.RuntimeService != nil {
				snapshot.RuntimeService = runtimeservice.NormalizeSnapshot(*status.RuntimeService)
			}
			return snapshot, nil
		}
	}
	return nil, nil
}

func normalizeRuntimeServiceSnapshot(snapshot runtimeservice.Snapshot, desktopManaged bool, effectiveRunMode string, remoteEnabled bool) runtimeservice.Snapshot {
	return runtimeservice.NormalizeSnapshotForEndpoint(snapshot, desktopManaged, effectiveRunMode, remoteEnabled)
}

func WaitForAttachable(path string, timeout time.Duration, pollInterval time.Duration, probeTimeout time.Duration) (*Snapshot, error) {
	if timeout <= 0 {
		return LoadAttachable(path, probeTimeout)
	}
	if pollInterval <= 0 {
		pollInterval = 100 * time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	for {
		snapshot, err := LoadAttachable(path, probeTimeout)
		if err != nil || snapshot != nil {
			return snapshot, err
		}
		if time.Now().After(deadline) {
			return nil, nil
		}
		time.Sleep(pollInterval)
	}
}

func (s *Snapshot) BindAddress() (string, error) {
	if s == nil {
		return "", errors.New("nil runtime snapshot")
	}
	parsedURL, err := url.Parse(strings.TrimSpace(s.LocalUIURL))
	if err != nil {
		return "", err
	}
	host := strings.TrimSpace(parsedURL.Hostname())
	port := strings.TrimSpace(parsedURL.Port())
	if host == "" || port == "" {
		return "", errors.New("missing local ui host or port")
	}
	return net.JoinHostPort(host, port), nil
}

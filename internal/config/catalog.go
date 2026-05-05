package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type environmentCatalogProviderBinding struct {
	ProviderOrigin         string `json:"provider_origin"`
	ProviderID             string `json:"provider_id"`
	EnvPublicID            string `json:"env_public_id"`
	RemoteWebSupported     bool   `json:"remote_web_supported"`
	RemoteDesktopSupported bool   `json:"remote_desktop_supported"`
}

type environmentCatalogFile struct {
	SchemaVersion int    `json:"schema_version"`
	RecordKind    string `json:"record_kind"`
	ID            string `json:"id"`
	Label         string `json:"label"`
	Pinned        bool   `json:"pinned"`
	CreatedAtMS   int64  `json:"created_at_ms"`
	UpdatedAtMS   int64  `json:"updated_at_ms"`
	LastUsedAtMS  int64  `json:"last_used_at_ms"`
	PreferredOpen string `json:"preferred_open_route,omitempty"`
	LocalHosting  struct {
		StateDir string `json:"state_dir"`
		Owner    string `json:"owner"`
		Access   struct {
			LocalUIBind               string `json:"local_ui_bind"`
			LocalUIPasswordConfigured bool   `json:"local_ui_password_configured"`
		} `json:"access"`
	} `json:"local_hosting"`
	CurrentProviderBinding *environmentCatalogProviderBinding `json:"current_provider_binding,omitempty"`
}

type catalogEnvironmentBinding struct {
	ProviderOrigin string
	ProviderID     string
	EnvPublicID    string
}

func catalogRootForLayout(layout StateLayout) (string, error) {
	root := strings.TrimSpace(layout.StateRoot)
	if root == "" {
		var err error
		root, err = ResolveStateRoot("")
		if err != nil {
			return "", err
		}
	}
	return filepath.Join(root, "catalog"), nil
}

func localEnvironmentCatalogPath(catalogRoot string) string {
	return filepath.Join(catalogRoot, "local-environment.json")
}

func readLocalEnvironmentCatalogRecord(path string) (*environmentCatalogFile, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var file environmentCatalogFile
	if err := json.Unmarshal(body, &file); err != nil {
		return nil, err
	}
	if strings.TrimSpace(file.RecordKind) != "local_environment" {
		return nil, nil
	}
	return &file, nil
}

func defaultCatalogEnvironmentLabel(layout StateLayout) string {
	_ = layout
	return "Local Environment"
}

func bindingForConfig(cfg *Config) (*catalogEnvironmentBinding, error) {
	if cfg == nil {
		return nil, nil
	}
	baseURL := strings.TrimSpace(cfg.ControlplaneBaseURL)
	envID := strings.TrimSpace(cfg.EnvironmentID)
	if baseURL == "" || envID == "" {
		return nil, nil
	}
	normalizedBaseURL, err := normalizeControlplaneBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	providerID := strings.TrimSpace(cfg.ControlplaneProviderID)
	if providerID == "" {
		return nil, nil
	}
	return &catalogEnvironmentBinding{
		ProviderOrigin: normalizedBaseURL,
		ProviderID:     providerID,
		EnvPublicID:    envID,
	}, nil
}

func WriteEnvironmentCatalogRecord(layout StateLayout, cfg *Config, localUIBind string, passwordConfigured bool) error {
	catalogRoot, err := catalogRootForLayout(layout)
	if err != nil {
		return err
	}
	recordPath := localEnvironmentCatalogPath(catalogRoot)
	existingRecord, err := readLocalEnvironmentCatalogRecord(recordPath)
	if err != nil {
		return err
	}

	binding, err := bindingForConfig(cfg)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()

	record := environmentCatalogFile{
		SchemaVersion: 1,
		RecordKind:    "local_environment",
		ID:            DefaultLocalEnvironmentID,
		Label:         defaultCatalogEnvironmentLabel(layout),
		Pinned:        false,
		CreatedAtMS:   now,
		UpdatedAtMS:   now,
		LastUsedAtMS:  0,
		PreferredOpen: "auto",
	}
	if existingRecord != nil {
		record.Label = strings.TrimSpace(existingRecord.Label)
		if record.Label == "" {
			record.Label = defaultCatalogEnvironmentLabel(layout)
		}
		record.Pinned = existingRecord.Pinned
		if existingRecord.CreatedAtMS > 0 {
			record.CreatedAtMS = existingRecord.CreatedAtMS
		}
		record.LastUsedAtMS = existingRecord.LastUsedAtMS
		if route := strings.TrimSpace(existingRecord.PreferredOpen); route == "local_host" || route == "remote_desktop" || route == "auto" {
			record.PreferredOpen = route
		}
	}

	if binding != nil {
		record.CurrentProviderBinding = &environmentCatalogProviderBinding{
			ProviderOrigin:         binding.ProviderOrigin,
			ProviderID:             binding.ProviderID,
			EnvPublicID:            binding.EnvPublicID,
			RemoteWebSupported:     true,
			RemoteDesktopSupported: true,
		}
	}

	record.LocalHosting.StateDir = strings.TrimSpace(layout.StateDir)
	record.LocalHosting.Owner = "agent"
	record.LocalHosting.Access.LocalUIBind = strings.TrimSpace(localUIBind)
	record.LocalHosting.Access.LocalUIPasswordConfigured = passwordConfigured

	if err := os.MkdirAll(catalogRoot, 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')

	tmpPath := recordPath + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, recordPath)
}

package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type environmentCatalogIdentity struct {
	Kind           string `json:"kind"`
	LocalName      string `json:"local_name,omitempty"`
	ProviderOrigin string `json:"provider_origin,omitempty"`
	ProviderID     string `json:"provider_id,omitempty"`
	EnvPublicID    string `json:"env_public_id,omitempty"`
}

type environmentCatalogScope struct {
	Kind           string `json:"kind"`
	Name           string `json:"name,omitempty"`
	ProviderOrigin string `json:"provider_origin,omitempty"`
	ProviderKey    string `json:"provider_key,omitempty"`
	EnvPublicID    string `json:"env_public_id,omitempty"`
}

type environmentCatalogFile struct {
	SchemaVersion int                        `json:"schema_version"`
	RecordKind    string                     `json:"record_kind"`
	ID            string                     `json:"id"`
	Label         string                     `json:"label"`
	Pinned        bool                       `json:"pinned"`
	CreatedAtMS   int64                      `json:"created_at_ms"`
	UpdatedAtMS   int64                      `json:"updated_at_ms"`
	LastUsedAtMS  int64                      `json:"last_used_at_ms"`
	PreferredOpen string                     `json:"preferred_open_route,omitempty"`
	Identity      environmentCatalogIdentity `json:"identity"`
	LocalHosting  struct {
		Scope environmentCatalogScope `json:"scope"`
		// ScopeKey and StateDir are kept explicit so Desktop does not have to
		// reconstruct host ownership or custom config-path layouts heuristically.
		ScopeKey string `json:"scope_key"`
		StateDir string `json:"state_dir"`
		Owner    string `json:"owner"`
		Access   struct {
			LocalUIBind               string `json:"local_ui_bind"`
			LocalUIPasswordConfigured bool   `json:"local_ui_password_configured"`
		} `json:"access"`
	} `json:"local_hosting"`
	ProviderBinding *struct {
		ProviderOrigin         string `json:"provider_origin"`
		ProviderID             string `json:"provider_id"`
		EnvPublicID            string `json:"env_public_id"`
		RemoteWebSupported     bool   `json:"remote_web_supported"`
		RemoteDesktopSupported bool   `json:"remote_desktop_supported"`
	} `json:"provider_binding,omitempty"`
}

type environmentCatalogRecordRef struct {
	Path string
	File environmentCatalogFile
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

func readCatalogEnvironmentRecords(environmentsDir string) ([]environmentCatalogRecordRef, error) {
	entries, err := os.ReadDir(environmentsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	records := make([]environmentCatalogRecordRef, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(environmentsDir, entry.Name())
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var file environmentCatalogFile
		if err := json.Unmarshal(body, &file); err != nil {
			continue
		}
		if strings.TrimSpace(file.RecordKind) != "environment" || strings.TrimSpace(file.ID) == "" {
			continue
		}
		records = append(records, environmentCatalogRecordRef{Path: path, File: file})
	}

	sort.Slice(records, func(i, j int) bool {
		return records[i].File.ID < records[j].File.ID
	})
	return records, nil
}

func catalogDefaultEnvironmentID(layout StateLayout) string {
	_ = layout
	return "local"
}

func defaultCatalogEnvironmentLabel(layout StateLayout, binding *catalogEnvironmentBinding) string {
	if binding != nil && strings.TrimSpace(binding.EnvPublicID) != "" {
		return strings.TrimSpace(binding.EnvPublicID)
	}
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
	providerKey, err := controlPlaneProviderKey(normalizedBaseURL)
	if err != nil {
		return nil, err
	}
	providerID := strings.TrimSpace(cfg.ControlplaneProviderID)
	if providerID == "" {
		providerID = providerKey
	}
	return &catalogEnvironmentBinding{
		ProviderOrigin: normalizedBaseURL,
		ProviderID:     providerID,
		EnvPublicID:    envID,
	}, nil
}

func chooseCatalogEnvironmentID(layout StateLayout, binding *catalogEnvironmentBinding, existing []environmentCatalogRecordRef) string {
	_ = binding
	_ = existing
	return catalogDefaultEnvironmentID(layout)
}

func findCatalogEnvironmentRecord(records []environmentCatalogRecordRef, id string) *environmentCatalogRecordRef {
	cleanID := strings.TrimSpace(id)
	if cleanID == "" {
		return nil
	}
	for i := range records {
		if strings.TrimSpace(records[i].File.ID) == cleanID {
			return &records[i]
		}
	}
	return nil
}

func catalogScopeForLayout(layout StateLayout, binding *catalogEnvironmentBinding) environmentCatalogScope {
	_ = layout
	scope := environmentCatalogScope{Kind: string(ScopeKindLocalEnvironment), Name: DefaultLocalEnvironmentScopeName}
	if binding != nil {
		scope.ProviderOrigin = binding.ProviderOrigin
		scope.ProviderKey = binding.ProviderID
		scope.EnvPublicID = binding.EnvPublicID
	}
	return scope
}

func WriteEnvironmentCatalogRecord(layout StateLayout, cfg *Config, localUIBind string, passwordConfigured bool) error {
	catalogRoot, err := catalogRootForLayout(layout)
	if err != nil {
		return err
	}
	environmentsDir := filepath.Join(catalogRoot, "environments")
	existing, err := readCatalogEnvironmentRecords(environmentsDir)
	if err != nil {
		return err
	}

	binding, err := bindingForConfig(cfg)
	if err != nil {
		return err
	}
	recordID := chooseCatalogEnvironmentID(layout, binding, existing)
	existingRecord := findCatalogEnvironmentRecord(existing, recordID)
	now := time.Now().UnixMilli()

	record := environmentCatalogFile{
		SchemaVersion: 1,
		RecordKind:    "environment",
		ID:            recordID,
		Label:         defaultCatalogEnvironmentLabel(layout, binding),
		Pinned:        false,
		CreatedAtMS:   now,
		UpdatedAtMS:   now,
		LastUsedAtMS:  0,
		PreferredOpen: "auto",
	}
	if existingRecord != nil {
		record.Label = strings.TrimSpace(existingRecord.File.Label)
		if record.Label == "" {
			record.Label = defaultCatalogEnvironmentLabel(layout, binding)
		}
		record.Pinned = existingRecord.File.Pinned
		if existingRecord.File.CreatedAtMS > 0 {
			record.CreatedAtMS = existingRecord.File.CreatedAtMS
		}
		record.LastUsedAtMS = existingRecord.File.LastUsedAtMS
		if route := strings.TrimSpace(existingRecord.File.PreferredOpen); route == "local_host" || route == "remote_desktop" || route == "auto" {
			record.PreferredOpen = route
		}
	}

	if binding != nil {
		record.Identity = environmentCatalogIdentity{
			Kind:           "provider",
			ProviderOrigin: binding.ProviderOrigin,
			ProviderID:     binding.ProviderID,
			EnvPublicID:    binding.EnvPublicID,
		}
		record.ProviderBinding = &struct {
			ProviderOrigin         string `json:"provider_origin"`
			ProviderID             string `json:"provider_id"`
			EnvPublicID            string `json:"env_public_id"`
			RemoteWebSupported     bool   `json:"remote_web_supported"`
			RemoteDesktopSupported bool   `json:"remote_desktop_supported"`
		}{
			ProviderOrigin:         binding.ProviderOrigin,
			ProviderID:             binding.ProviderID,
			EnvPublicID:            binding.EnvPublicID,
			RemoteWebSupported:     true,
			RemoteDesktopSupported: true,
		}
	} else {
		record.Identity = environmentCatalogIdentity{
			Kind:      "local_environment",
			LocalName: DefaultLocalEnvironmentScopeName,
		}
	}

	record.LocalHosting.Scope = catalogScopeForLayout(layout, binding)
	record.LocalHosting.ScopeKey = strings.TrimSpace(layout.ScopeKey)
	record.LocalHosting.StateDir = strings.TrimSpace(layout.StateDir)
	record.LocalHosting.Owner = "agent"
	record.LocalHosting.Access.LocalUIBind = strings.TrimSpace(localUIBind)
	record.LocalHosting.Access.LocalUIPasswordConfigured = passwordConfigured

	if err := os.MkdirAll(environmentsDir, 0o700); err != nil {
		return err
	}
	body, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')

	recordPath := filepath.Join(environmentsDir, sanitizeStateScopeID(recordID)+".json")
	tmpPath := recordPath + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, recordPath)
}

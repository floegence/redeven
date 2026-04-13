package config

import (
	"encoding/json"
	"fmt"
	"net/url"
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
	switch layout.Scope.Kind {
	case ScopeKindControlPlane:
		baseURL := strings.TrimSpace(layout.Scope.ControlplaneBaseURL)
		if baseURL == "" {
			baseURL = controlplaneBaseURLFromLayout(layout)
		}
		return fmt.Sprintf(
			"cp:%s:env:%s",
			url.QueryEscape(strings.TrimSpace(baseURL)),
			url.QueryEscape(strings.TrimSpace(layout.Scope.EnvironmentID)),
		)
	case ScopeKindNamed:
		return fmt.Sprintf("named:%s", url.QueryEscape(strings.TrimSpace(layout.Scope.Name)))
	default:
		name := strings.TrimSpace(layout.Scope.Name)
		if name == "" {
			name = DefaultLocalScopeName
		}
		return fmt.Sprintf("local:%s", url.QueryEscape(name))
	}
}

func controlplaneBaseURLFromLayout(layout StateLayout) string {
	if strings.TrimSpace(layout.Scope.ControlplaneBaseURL) != "" {
		return strings.TrimSpace(layout.Scope.ControlplaneBaseURL)
	}
	if layout.Scope.Kind == ScopeKindControlPlane {
		return fmt.Sprintf("https://%s", strings.TrimSpace(layout.Scope.ProviderKey))
	}
	return ""
}

func defaultCatalogEnvironmentLabel(layout StateLayout, binding *catalogEnvironmentBinding) string {
	if binding != nil && strings.TrimSpace(binding.EnvPublicID) != "" {
		return strings.TrimSpace(binding.EnvPublicID)
	}
	switch layout.Scope.Kind {
	case ScopeKindNamed:
		return titleizeScopeName(layout.Scope.Name, "Named Environment")
	default:
		name := strings.TrimSpace(layout.Scope.Name)
		if name == "" || name == DefaultLocalScopeName {
			return "Local Environment"
		}
		return titleizeScopeName(name, "Local Environment")
	}
}

func titleizeScopeName(name string, fallback string) string {
	clean := strings.TrimSpace(name)
	if clean == "" {
		return fallback
	}
	segments := strings.FieldsFunc(clean, func(r rune) bool {
		return r == '-' || r == '_' || r == '.'
	})
	if len(segments) == 0 {
		return fallback
	}
	out := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		out = append(out, strings.ToUpper(segment[:1])+segment[1:])
	}
	if len(out) == 0 {
		return fallback
	}
	return strings.Join(out, " ")
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
	return &catalogEnvironmentBinding{
		ProviderOrigin: normalizedBaseURL,
		ProviderID:     providerKey,
		EnvPublicID:    envID,
	}, nil
}

func chooseCatalogEnvironmentID(layout StateLayout, binding *catalogEnvironmentBinding, existing []environmentCatalogRecordRef) string {
	for _, record := range existing {
		if strings.TrimSpace(record.File.LocalHosting.ScopeKey) == strings.TrimSpace(layout.ScopeKey) {
			return strings.TrimSpace(record.File.ID)
		}
	}
	if binding != nil {
		for _, record := range existing {
			provider := record.File.ProviderBinding
			if provider == nil {
				continue
			}
			if strings.TrimSpace(provider.ProviderOrigin) == binding.ProviderOrigin && strings.TrimSpace(provider.EnvPublicID) == binding.EnvPublicID {
				return strings.TrimSpace(record.File.ID)
			}
		}
	}
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
	switch layout.Scope.Kind {
	case ScopeKindControlPlane:
		providerOrigin := strings.TrimSpace(layout.Scope.ControlplaneBaseURL)
		if providerOrigin == "" && binding != nil {
			providerOrigin = binding.ProviderOrigin
		}
		providerKey := strings.TrimSpace(layout.Scope.ProviderKey)
		if providerKey == "" && binding != nil {
			providerKey = binding.ProviderID
		}
		envPublicID := strings.TrimSpace(layout.Scope.EnvironmentID)
		if envPublicID == "" && binding != nil {
			envPublicID = binding.EnvPublicID
		}
		return environmentCatalogScope{
			Kind:           string(ScopeKindControlPlane),
			ProviderOrigin: providerOrigin,
			ProviderKey:    providerKey,
			EnvPublicID:    envPublicID,
		}
	case ScopeKindNamed:
		return environmentCatalogScope{Kind: string(ScopeKindNamed), Name: strings.TrimSpace(layout.Scope.Name)}
	default:
		name := strings.TrimSpace(layout.Scope.Name)
		if name == "" {
			name = DefaultLocalScopeName
		}
		return environmentCatalogScope{Kind: string(ScopeKindLocal), Name: name}
	}
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
		localName := strings.TrimSpace(layout.Scope.Name)
		if localName == "" {
			localName = DefaultLocalScopeName
		}
		record.Identity = environmentCatalogIdentity{
			Kind:      "provisional_local",
			LocalName: localName,
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

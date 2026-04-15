package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ScopeMetadata struct {
	SchemaVersion               int    `json:"schema_version"`
	ScopeKey                    string `json:"scope_key"`
	ScopeKind                   string `json:"scope_kind"`
	BoundControlplaneBaseURL    string `json:"bound_controlplane_base_url,omitempty"`
	BoundControlplaneProviderID string `json:"bound_controlplane_provider_id,omitempty"`
	BoundEnvironmentID          string `json:"bound_environment_id,omitempty"`
	UpdatedAtUnixMS             int64  `json:"updated_at_unix_ms"`
}

func WriteScopeMetadata(
	layout StateLayout,
	boundControlplaneBaseURL string,
	boundControlplaneProviderID string,
	boundEnvironmentID string,
) error {
	if strings.TrimSpace(layout.ScopeMetadataPath) == "" || strings.TrimSpace(layout.ScopeKey) == "" {
		return nil
	}

	metadata := ScopeMetadata{
		SchemaVersion:               1,
		ScopeKey:                    strings.TrimSpace(layout.ScopeKey),
		ScopeKind:                   strings.TrimSpace(string(layout.Scope.Kind)),
		BoundControlplaneBaseURL:    strings.TrimSpace(boundControlplaneBaseURL),
		BoundControlplaneProviderID: strings.TrimSpace(boundControlplaneProviderID),
		BoundEnvironmentID:          strings.TrimSpace(boundEnvironmentID),
		UpdatedAtUnixMS:             time.Now().UnixMilli(),
	}

	dir := filepath.Dir(layout.ScopeMetadataPath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	body, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')

	tmpPath := layout.ScopeMetadataPath + ".tmp"
	if err := os.WriteFile(tmpPath, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, layout.ScopeMetadataPath)
}

func WriteScopeMetadataForConfig(layout StateLayout, cfg *Config) error {
	if cfg == nil {
		return errors.New("nil config")
	}
	return WriteScopeMetadata(layout, cfg.ControlplaneBaseURL, cfg.ControlplaneProviderID, cfg.EnvironmentID)
}

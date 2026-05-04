package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func readCatalogEnvironmentFile(t *testing.T, path string) environmentCatalogFile {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}
	var file environmentCatalogFile
	if err := json.Unmarshal(body, &file); err != nil {
		t.Fatalf("json.Unmarshal(%q) error = %v", path, err)
	}
	return file
}

func TestWriteEnvironmentCatalogRecordWritesLocalEnvironmentProviderBinding(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	cfg := &Config{
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "redeven_portal",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_demo",
		BindingGeneration:        1,
	}
	if err := WriteEnvironmentCatalogRecord(layout, cfg, "localhost:23998", true); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "environments", sanitizeStateScopeID("local")+".json")
	record := readCatalogEnvironmentFile(t, recordPath)
	if record.ID != "local" {
		t.Fatalf("ID = %q", record.ID)
	}
	if record.Identity.Kind != "provider" {
		t.Fatalf("Identity.Kind = %q", record.Identity.Kind)
	}
	if record.Identity.ProviderOrigin != "https://dev.redeven.test" {
		t.Fatalf("Identity.ProviderOrigin = %q", record.Identity.ProviderOrigin)
	}
	if record.LocalHosting.Scope.Kind != string(ScopeKindLocalEnvironment) {
		t.Fatalf("LocalHosting.Scope.Kind = %q", record.LocalHosting.Scope.Kind)
	}
	if record.LocalHosting.Scope.Name != DefaultLocalEnvironmentScopeName {
		t.Fatalf("LocalHosting.Scope.Name = %q", record.LocalHosting.Scope.Name)
	}
	if record.LocalHosting.ScopeKey != "local_environment" {
		t.Fatalf("LocalHosting.ScopeKey = %q", record.LocalHosting.ScopeKey)
	}
	if record.LocalHosting.Owner != "agent" {
		t.Fatalf("LocalHosting.Owner = %q", record.LocalHosting.Owner)
	}
	if record.LocalHosting.Access.LocalUIBind != "localhost:23998" {
		t.Fatalf("LocalHosting.Access.LocalUIBind = %q", record.LocalHosting.Access.LocalUIBind)
	}
	if !record.LocalHosting.Access.LocalUIPasswordConfigured {
		t.Fatalf("LocalHosting.Access.LocalUIPasswordConfigured = false, want true")
	}
	if record.ProviderBinding == nil {
		t.Fatalf("ProviderBinding = nil")
	}
	if record.ProviderBinding.ProviderID != "redeven_portal" {
		t.Fatalf("ProviderBinding.ProviderID = %q", record.ProviderBinding.ProviderID)
	}
	if record.ProviderBinding.EnvPublicID != "env_demo" {
		t.Fatalf("ProviderBinding.EnvPublicID = %q", record.ProviderBinding.EnvPublicID)
	}
}

func TestWriteEnvironmentCatalogRecordFallsBackToProviderKeyWhenCanonicalProviderIDIsUnavailable(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	cfg := &Config{
		ControlplaneBaseURL:      "https://dev.redeven.test",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_demo",
		BindingGeneration:        1,
	}
	if err := WriteEnvironmentCatalogRecord(layout, cfg, "localhost:23998", true); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "environments", sanitizeStateScopeID("local")+".json")
	record := readCatalogEnvironmentFile(t, recordPath)
	if record.ProviderBinding == nil {
		t.Fatalf("ProviderBinding = nil")
	}
	if record.ProviderBinding.ProviderID != "https__dev.redeven.test" {
		t.Fatalf("ProviderBinding.ProviderID = %q", record.ProviderBinding.ProviderID)
	}
}

func TestWriteEnvironmentCatalogRecordReusesExistingLocalEnvironmentRecordProperties(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "environments", sanitizeStateScopeID("local")+".json")
	if err := os.MkdirAll(filepath.Dir(recordPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	seed := environmentCatalogFile{
		SchemaVersion: 1,
		RecordKind:    "environment",
		ID:            "local",
		Label:         "Existing Local Environment",
		Pinned:        true,
		CreatedAtMS:   123,
		UpdatedAtMS:   456,
		LastUsedAtMS:  789,
		PreferredOpen: "remote_desktop",
		Identity: environmentCatalogIdentity{
			Kind:           "provider",
			ProviderOrigin: "https://dev.redeven.test",
			ProviderID:     "https__dev.redeven.test",
			EnvPublicID:    "env_demo",
		},
		ProviderBinding: &struct {
			ProviderOrigin         string `json:"provider_origin"`
			ProviderID             string `json:"provider_id"`
			EnvPublicID            string `json:"env_public_id"`
			RemoteWebSupported     bool   `json:"remote_web_supported"`
			RemoteDesktopSupported bool   `json:"remote_desktop_supported"`
		}{
			ProviderOrigin:         "https://dev.redeven.test",
			ProviderID:             "https__dev.redeven.test",
			EnvPublicID:            "env_demo",
			RemoteWebSupported:     true,
			RemoteDesktopSupported: true,
		},
	}
	body, err := json.MarshalIndent(seed, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent() error = %v", err)
	}
	body = append(body, '\n')
	if err := os.WriteFile(recordPath, body, 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg := &Config{
		ControlplaneBaseURL:      "https://dev.redeven.test",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_demo",
		BindingGeneration:        1,
	}
	if err := WriteEnvironmentCatalogRecord(layout, cfg, "127.0.0.1:24000", false); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	record := readCatalogEnvironmentFile(t, recordPath)
	if record.ID != "local" {
		t.Fatalf("ID = %q", record.ID)
	}
	if record.Label != "Existing Local Environment" {
		t.Fatalf("Label = %q", record.Label)
	}
	if !record.Pinned {
		t.Fatalf("Pinned = false, want true")
	}
	if record.CreatedAtMS != 123 {
		t.Fatalf("CreatedAtMS = %d", record.CreatedAtMS)
	}
	if record.LastUsedAtMS != 789 {
		t.Fatalf("LastUsedAtMS = %d", record.LastUsedAtMS)
	}
	if record.PreferredOpen != "remote_desktop" {
		t.Fatalf("PreferredOpen = %q", record.PreferredOpen)
	}
	if record.LocalHosting.ScopeKey != layout.ScopeKey {
		t.Fatalf("LocalHosting.ScopeKey = %q, want %q", record.LocalHosting.ScopeKey, layout.ScopeKey)
	}
	if record.LocalHosting.Access.LocalUIBind != "127.0.0.1:24000" {
		t.Fatalf("LocalHosting.Access.LocalUIBind = %q", record.LocalHosting.Access.LocalUIBind)
	}
}

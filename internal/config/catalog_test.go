package config

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReadEnvironmentCatalogAccessPreservesProtocolChoice(t *testing.T) {
	layout, err := LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if access, err := ReadEnvironmentCatalogAccess(layout); err != nil || access != nil {
		t.Fatalf("fresh catalog = %#v, %v", access, err)
	}
	for _, protocol := range []string{"http", "https"} {
		if err := WriteEnvironmentCatalogRecord(layout, &Config{}, &EnvironmentCatalogAccess{
			LocalUIBind: "127.0.0.1:0", LocalUIProtocol: protocol, LocalUIPasswordConfigured: true,
		}); err != nil {
			t.Fatal(err)
		}
		access, err := ReadEnvironmentCatalogAccess(layout)
		if err != nil || access == nil || access.LocalUIProtocol != protocol || access.LocalUIBind != "127.0.0.1:0" || !access.LocalUIPasswordConfigured {
			t.Fatalf("saved access = %#v, %v", access, err)
		}
	}
	path := filepath.Join(layout.StateRoot, "catalog", "local-environment.json")
	legacy := []byte(`{"schema_version":1,"record_kind":"local_environment","local_hosting":{"access":{"local_ui_bind":"localhost:23998","local_ui_password_configured":true}}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	access, err := ReadEnvironmentCatalogAccess(layout)
	if err != nil || access == nil || access.LocalUIProtocol != LocalUIProtocolHTTP {
		t.Fatalf("missing protocol must default to HTTP: %#v, %v", access, err)
	}
	if access.LocalUIBind != "localhost:23998" || !access.LocalUIPasswordConfigured {
		t.Fatalf("protocol default changed saved address or password protection: %#v", access)
	}
	if err := WriteEnvironmentCatalogRecord(layout, &Config{}, &EnvironmentCatalogAccess{LocalUIProtocol: ""}); err == nil {
		t.Fatal("persisted an empty protocol instead of an explicit choice")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, legacy) {
		t.Fatal("reading the protocol default modified the catalog")
	}
	invalid := bytes.Replace(legacy, []byte(`"local_ui_bind"`), []byte(`"local_ui_protocol":"ftp","local_ui_bind"`), 1)
	if err := os.WriteFile(path, invalid, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadEnvironmentCatalogAccess(layout); err == nil {
		t.Fatal("accepted an unknown protocol")
	}
}

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
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_demo",
		BindingGeneration:        1,
	}
	if err := WriteEnvironmentCatalogRecord(layout, cfg, &EnvironmentCatalogAccess{
		LocalUIProtocol:           LocalUIProtocolHTTPS,
		LocalUIBind:               "localhost:23998",
		LocalUIPasswordConfigured: true,
	}); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "local-environment.json")
	record := readCatalogEnvironmentFile(t, recordPath)
	if record.RecordKind != "local_environment" {
		t.Fatalf("RecordKind = %q", record.RecordKind)
	}
	if record.ID != "local" {
		t.Fatalf("ID = %q", record.ID)
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
	if record.CurrentProviderBinding == nil {
		t.Fatalf("CurrentProviderBinding = nil")
	}
	if record.CurrentProviderBinding.ProviderOrigin != "https://redeven.test" {
		t.Fatalf("CurrentProviderBinding.ProviderOrigin = %q", record.CurrentProviderBinding.ProviderOrigin)
	}
	if record.CurrentProviderBinding.AccessPointOrigin != "https://dev.redeven.test" {
		t.Fatalf("CurrentProviderBinding.AccessPointOrigin = %q", record.CurrentProviderBinding.AccessPointOrigin)
	}
	if record.CurrentProviderBinding.ProviderID != "example_control_plane" {
		t.Fatalf("CurrentProviderBinding.ProviderID = %q", record.CurrentProviderBinding.ProviderID)
	}
	if record.CurrentProviderBinding.EnvPublicID != "env_demo" {
		t.Fatalf("CurrentProviderBinding.EnvPublicID = %q", record.CurrentProviderBinding.EnvPublicID)
	}
	if _, err := os.Stat(filepath.Join(stateRoot, "catalog", "environments")); !os.IsNotExist(err) {
		t.Fatalf("unexpected extra catalog directory, err=%v", err)
	}
}

func TestWriteEnvironmentCatalogRecordKeepsLocalIdentityWithoutProviderID(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	cfg := &Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_demo",
		BindingGeneration:        1,
	}
	if err := WriteEnvironmentCatalogRecord(layout, cfg, &EnvironmentCatalogAccess{
		LocalUIProtocol:           LocalUIProtocolHTTPS,
		LocalUIBind:               "localhost:23998",
		LocalUIPasswordConfigured: true,
	}); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "local-environment.json")
	record := readCatalogEnvironmentFile(t, recordPath)
	if record.RecordKind != "local_environment" {
		t.Fatalf("RecordKind = %q", record.RecordKind)
	}
	if record.CurrentProviderBinding != nil {
		t.Fatalf("CurrentProviderBinding = %#v, want nil", record.CurrentProviderBinding)
	}
}

func TestWriteEnvironmentCatalogRecordPersistsTLSNetworkAccess(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	if err := WriteEnvironmentCatalogRecord(layout, &Config{}, &EnvironmentCatalogAccess{
		LocalUIProtocol:           LocalUIProtocolHTTPS,
		LocalUIBind:               "0.0.0.0:24000",
		LocalUIPasswordConfigured: true,
	}); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "local-environment.json")
	record := readCatalogEnvironmentFile(t, recordPath)
	if record.LocalHosting.Access.LocalUIBind != "0.0.0.0:24000" || !record.LocalHosting.Access.LocalUIPasswordConfigured {
		t.Fatalf("LocalHosting.Access = %#v", record.LocalHosting.Access)
	}

	if err := WriteEnvironmentCatalogRecord(layout, &Config{}, &EnvironmentCatalogAccess{
		LocalUIBind: "localhost:24000", LocalUIProtocol: LocalUIProtocolHTTP,
	}); err != nil {
		t.Fatalf("WriteEnvironmentCatalogRecord(loopback) error = %v", err)
	}
	record = readCatalogEnvironmentFile(t, recordPath)
	if record.LocalHosting.Access.LocalUIBind != "localhost:24000" || record.LocalHosting.Access.LocalUIPasswordConfigured {
		t.Fatalf("LocalHosting.Access = %#v", record.LocalHosting.Access)
	}
}

func TestRemoteOnlyCatalogUpdatePreservesAccessConfiguration(t *testing.T) {
	layout, err := LocalEnvironmentStateLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := EnvironmentCatalogAccess{LocalUIBind: "0.0.0.0:23998", LocalUIProtocol: LocalUIProtocolHTTPS, LocalUIPasswordConfigured: true}
	if err := WriteEnvironmentCatalogRecord(layout, &Config{}, &want); err != nil {
		t.Fatal(err)
	}
	if err := WriteEnvironmentCatalogRecord(layout, &Config{}, nil); err != nil {
		t.Fatal(err)
	}
	got, err := ReadEnvironmentCatalogAccess(layout)
	if err != nil || got == nil || *got != want {
		t.Fatalf("remote-only update changed access: got=%+v, err=%v", got, err)
	}
}

func TestWriteEnvironmentCatalogRecordReusesExistingLocalEnvironmentRecordProperties(t *testing.T) {
	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}

	recordPath := filepath.Join(stateRoot, "catalog", "local-environment.json")
	if err := os.MkdirAll(filepath.Dir(recordPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	seed := environmentCatalogFile{
		SchemaVersion: 1,
		RecordKind:    "local_environment",
		ID:            "local",
		Label:         "Existing Local Environment",
		Pinned:        true,
		CreatedAtMS:   123,
		UpdatedAtMS:   456,
		LastUsedAtMS:  789,
		PreferredOpen: "remote_desktop",
		CurrentProviderBinding: &environmentCatalogProviderBinding{
			ProviderOrigin:         "https://redeven.test",
			ProviderID:             "redeven",
			EnvPublicID:            "env_demo",
			AccessPointOrigin:      "https://dev.redeven.test",
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
	if err := WriteEnvironmentCatalogRecord(layout, cfg, &EnvironmentCatalogAccess{
		LocalUIBind: "127.0.0.1:24000", LocalUIProtocol: LocalUIProtocolHTTPS,
	}); err != nil {
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
	if record.LocalHosting.Access.LocalUIBind != "127.0.0.1:24000" {
		t.Fatalf("LocalHosting.Access.LocalUIBind = %q", record.LocalHosting.Access.LocalUIBind)
	}
}

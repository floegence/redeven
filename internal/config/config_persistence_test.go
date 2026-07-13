package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRuntimeDirectSecretStore struct {
	values      map[string]string
	setErr      error
	getErr      error
	retainErr   error
	verifyValue string
}

func (s *fakeRuntimeDirectSecretStore) GetRuntimeDirectPSK(channelID string) (string, bool, error) {
	if s.getErr != nil {
		return "", false, s.getErr
	}
	if s.verifyValue != "" {
		return s.verifyValue, true, nil
	}
	value, ok := s.values[channelID]
	return value, ok, nil
}

func (s *fakeRuntimeDirectSecretStore) SetRuntimeDirectPSK(channelID string, psk string) error {
	if s.setErr != nil {
		return s.setErr
	}
	if s.values == nil {
		s.values = make(map[string]string)
	}
	s.values[channelID] = psk
	return nil
}

func (s *fakeRuntimeDirectSecretStore) RetainRuntimeDirectPSK(channelID string) error {
	if s.retainErr != nil {
		return s.retainErr
	}
	if channelID == "" {
		s.values = make(map[string]string)
		return nil
	}
	value := s.values[channelID]
	s.values = map[string]string{channelID: value}
	return nil
}

func TestLoadMigratesLegacyDirectPSKAndRestartsFromSecrets(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	legacy := legacyConfigWithDirectPSK("channel-1", "legacy-psk")
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	store := &fakeRuntimeDirectSecretStore{values: make(map[string]string)}
	persistence := testConfigPersistence(store, writeConfigAtomic)

	cfg, err := loadConfig(path, persistence)
	if err != nil {
		t.Fatalf("loadConfig() error = %v", err)
	}
	if cfg.Direct == nil || cfg.Direct.E2eePskB64u != "legacy-psk" {
		t.Fatalf("migrated config direct = %#v", cfg.Direct)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if strings.Contains(string(body), "legacy-psk") || strings.Contains(string(body), "e2ee_psk_b64u") {
		t.Fatalf("config.json still contains direct PSK: %s", body)
	}
	if !strings.Contains(string(body), `"e2ee_psk_set": true`) {
		t.Fatalf("config.json missing psk status: %s", body)
	}

	restarted, err := loadConfig(path, persistence)
	if err != nil {
		t.Fatalf("restart loadConfig() error = %v", err)
	}
	if restarted.Direct == nil || restarted.Direct.E2eePskB64u != "legacy-psk" {
		t.Fatalf("restarted direct = %#v", restarted.Direct)
	}
}

func TestLoadLegacyDirectPSKMigrationFailuresPreserveConfig(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		configure func(*fakeRuntimeDirectSecretStore, *configPersistence)
		wantError string
	}{
		{
			name: "secret store write",
			configure: func(store *fakeRuntimeDirectSecretStore, _ *configPersistence) {
				store.setErr = errors.New("write denied")
			},
			wantError: "migrate direct psk to secrets store",
		},
		{
			name: "verification mismatch",
			configure: func(store *fakeRuntimeDirectSecretStore, _ *configPersistence) {
				store.verifyValue = "different-psk"
			},
			wantError: "stored value mismatch",
		},
		{
			name: "config rewrite",
			configure: func(_ *fakeRuntimeDirectSecretStore, persistence *configPersistence) {
				persistence.writeConfig = func(string, *Config) error { return errors.New("rename denied") }
			},
			wantError: "rewrite config after direct psk migration",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "config.json")
			legacy := legacyConfigWithDirectPSK("channel-1", "legacy-psk")
			if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
				t.Fatalf("WriteFile() error = %v", err)
			}
			store := &fakeRuntimeDirectSecretStore{values: make(map[string]string)}
			persistence := testConfigPersistence(store, writeConfigAtomic)
			testCase.configure(store, &persistence)

			_, err := loadConfig(path, persistence)
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("loadConfig() error = %v, want %q", err, testCase.wantError)
			}
			body, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatalf("ReadFile() error = %v", readErr)
			}
			if string(body) != legacy {
				t.Fatalf("legacy config changed after failed migration:\n%s", body)
			}
		})
	}
}

func TestSaveCredentialRewriteFailureKeepsPreviousRestartPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	store := &fakeRuntimeDirectSecretStore{values: map[string]string{"channel-old": "psk-old"}}
	persistence := testConfigPersistence(store, writeConfigAtomic)
	oldConfig, err := loadConfigFromJSON(legacyConfigWithDirectStatus("channel-old"))
	if err != nil {
		t.Fatalf("loadConfigFromJSON() error = %v", err)
	}
	oldConfig.Direct.E2eePskB64u = "psk-old"
	oldConfig.directPSKSet = true
	if err := persistence.writeConfig(path, oldConfig); err != nil {
		t.Fatalf("write old config error = %v", err)
	}
	oldBody, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	next := *oldConfig
	direct := *oldConfig.Direct
	direct.ChannelId = "channel-new"
	direct.E2eePskB64u = "psk-new"
	next.Direct = &direct
	failing := persistence
	failing.writeConfig = func(string, *Config) error { return errors.New("rename denied") }
	if err := saveConfig(path, &next, failing); err == nil || !strings.Contains(err.Error(), "rename denied") {
		t.Fatalf("saveConfig() error = %v", err)
	}
	afterBody, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(afterBody) != string(oldBody) {
		t.Fatalf("config changed after failed credential rewrite:\n%s", afterBody)
	}
	restarted, err := loadConfig(path, persistence)
	if err != nil {
		t.Fatalf("loadConfig() after failed save error = %v", err)
	}
	if restarted.Direct == nil || restarted.Direct.ChannelId != "channel-old" || restarted.Direct.E2eePskB64u != "psk-old" {
		t.Fatalf("restart did not retain old credentials: %#v", restarted.Direct)
	}
}

func TestSaveCredentialCommitPrunesSupersededAndDisconnectedPSKs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	store := &fakeRuntimeDirectSecretStore{values: map[string]string{"channel-old": "psk-old"}}
	persistence := testConfigPersistence(store, writeConfigAtomic)
	cfg, err := loadConfigFromJSON(legacyConfigWithDirectStatus("channel-new"))
	if err != nil {
		t.Fatalf("loadConfigFromJSON() error = %v", err)
	}
	cfg.Direct.E2eePskB64u = "psk-new"
	if err := saveConfig(path, cfg, persistence); err != nil {
		t.Fatalf("saveConfig(new credentials) error = %v", err)
	}
	if len(store.values) != 1 || store.values["channel-new"] != "psk-new" {
		t.Fatalf("direct PSKs after commit = %#v", store.values)
	}

	cfg.Direct = nil
	if err := saveConfig(path, cfg, persistence); err != nil {
		t.Fatalf("saveConfig(disconnect) error = %v", err)
	}
	if len(store.values) != 0 {
		t.Fatalf("direct PSKs after disconnect = %#v", store.values)
	}
}

func testConfigPersistence(store runtimeDirectSecretStore, writer func(string, *Config) error) configPersistence {
	return configPersistence{
		readFile:    os.ReadFile,
		writeConfig: writer,
		newSecretStore: func(string) runtimeDirectSecretStore {
			return store
		},
	}
}

func loadConfigFromJSON(raw string) (*Config, error) {
	path := filepath.Join(os.TempDir(), "unused-config.json")
	return decodeConfigForTest(path, raw)
}

func decodeConfigForTest(_ string, raw string) (*Config, error) {
	var cfg Config
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func legacyConfigWithDirectPSK(channelID string, psk string) string {
	return `{
  "provider_origin": "https://redeven.test",
  "controlplane_base_url": "https://dev.redeven.test",
  "environment_id": "env-1",
  "local_environment_public_id": "local-1",
  "binding_generation": 1,
  "agent_instance_id": "agent-1",
  "direct": {
    "ws_url": "wss://dev.redeven.test/control/ws",
    "channel_id": "` + channelID + `",
    "e2ee_psk_b64u": "` + psk + `",
    "channel_init_expire_at_unix_s": 4102444800,
    "default_suite": 1
  }
}
`
}

func legacyConfigWithDirectStatus(channelID string) string {
	return `{
  "provider_origin": "https://redeven.test",
  "controlplane_base_url": "https://dev.redeven.test",
  "environment_id": "env-1",
  "local_environment_public_id": "local-1",
  "binding_generation": 1,
  "agent_instance_id": "agent-1",
  "direct": {
    "ws_url": "wss://dev.redeven.test/control/ws",
    "channel_id": "` + channelID + `",
    "channel_init_expire_at_unix_s": 4102444800,
    "default_suite": 1,
    "e2ee_psk_set": true
  }
}
`
}

package config

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const directArtifactFixture = `{"v":2,"profile":"flowersec/2","session":{"channel_id":"channel-1","init_expire_at_unix_s":4102444800,"idle_timeout_seconds":60,"establish_timeout_seconds":30,"rekey_prepare_timeout_seconds":10,"rekey_completion_timeout_seconds":30,"max_inbound_streams":64,"e2ee_psk_b64u":"AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA","allowed_suites":[1,2],"default_suite":1,"selected_features":0,"contract_hash_b64u":"ioBJP5DPhg471caMR-huV5I9RlNKY2Pr9fs2GkP8CmA"},"path":{"kind":"direct","rendezvous_group_id":"group-1","listener_audience":"listener-1","routing_token":"routing-token","candidates":[{"id":"w1","carrier":"websocket","url":"wss://example.com/flowersec/v2/direct","wire_profile":"flowersec-direct/2"}]},"scoped":[],"correlation":{"v":2,"tags":[]}}`

func TestSaveAndLoadPreserveOpaqueDirectArtifactAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	wantArtifact := json.RawMessage(directArtifactFixture)
	cfg := configWithDirectArtifact(wantArtifact, false)

	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.Direct == nil {
		t.Fatal("Load() direct = nil")
	}
	if !jsonEqual(restarted.Direct.ArtifactJSON, wantArtifact) {
		t.Fatalf("Load() artifact = %s, want %s", restarted.Direct.ArtifactJSON, wantArtifact)
	}
	if restarted.Direct.ExpiresAtUnixS != 4102444800 {
		t.Fatalf("Load() expires_at_unix_s = %d, want 4102444800", restarted.Direct.ExpiresAtUnixS)
	}
	if restarted.Direct.Spent {
		t.Fatal("Load() spent = true, want false")
	}
	assertDirectEnvelopeFields(t, path)
}

func TestSaveAndLoadPreserveDirectArtifactSpentState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := configWithDirectArtifact(json.RawMessage(directArtifactFixture), false)
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	cfg.Direct.Spent = true
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save(spent) error = %v", err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.Direct == nil || !restarted.Direct.Spent {
		t.Fatalf("Load() direct = %#v, want spent artifact", restarted.Direct)
	}
}

func TestSaveAndLoadPreserveControlArtifactDigestAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	artifact, err := NormalizeControlArtifactJSON(json.RawMessage(directArtifactFixture))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(artifact)
	cfg := configWithDirectArtifact(nil, false)
	cfg.Direct = nil
	cfg.ControlArtifactPool = NewControlArtifactPool(1)
	cfg.ControlArtifactPool.LogicalBindingID = "redeven:user-1:local-1"
	cfg.ControlArtifactPool.RecoveryState = ControlArtifactRecoveryReady
	cfg.ControlArtifactPool.Entries = append(cfg.ControlArtifactPool.Entries, ControlArtifactEntry{
		Sequence:       1,
		ArtifactJSON:   artifact,
		ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
		ChannelID:      "channel-1",
		ExpiresAtUnixS: 4102444800,
	})

	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.ControlArtifactPool == nil || len(restarted.ControlArtifactPool.Entries) != 1 {
		t.Fatalf("Load() control artifact pool = %#v", restarted.ControlArtifactPool)
	}
	entry := restarted.ControlArtifactPool.Entries[0]
	if !bytes.Equal(entry.ArtifactJSON, artifact) || entry.ArtifactDigest != base64.RawURLEncoding.EncodeToString(digest[:]) {
		t.Fatalf("Load() control artifact entry = %#v", entry)
	}
}

func TestSaveArtifactWriteFailurePreservesPreviousRestartArtifact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	oldArtifact := json.RawMessage(directArtifactFixture)
	oldConfig := configWithDirectArtifact(oldArtifact, false)
	if err := Save(path, oldConfig); err != nil {
		t.Fatalf("Save(old) error = %v", err)
	}
	oldBody, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(old) error = %v", err)
	}

	next := *oldConfig
	nextDirect := *oldConfig.Direct
	nextDirect.ArtifactJSON = json.RawMessage(strings.Replace(directArtifactFixture, "channel-1", "channel-2", 1))
	nextDirect.ExpiresAtUnixS = 4102444900
	next.Direct = &nextDirect
	persistence := defaultConfigPersistence()
	persistence.writeConfig = func(string, *Config) error { return errors.New("rename denied") }
	if err := saveConfig(path, &next, persistence); err == nil || !strings.Contains(err.Error(), "rename denied") {
		t.Fatalf("saveConfig() error = %v, want rename failure", err)
	}
	afterBody, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(after) error = %v", err)
	}
	if !bytes.Equal(afterBody, oldBody) {
		t.Fatalf("config changed after failed artifact write:\n%s", afterBody)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() after failed save error = %v", err)
	}
	if restarted.Direct == nil || !jsonEqual(restarted.Direct.ArtifactJSON, oldArtifact) {
		t.Fatalf("restart did not retain old artifact: %#v", restarted.Direct)
	}
}

func configWithDirectArtifact(artifact json.RawMessage, spent bool) *Config {
	return &Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		EnvironmentID:            "env-1",
		LocalEnvironmentPublicID: "local-1",
		BindingGeneration:        1,
		AgentInstanceID:          "agent-1",
		Direct: &DirectConnectInfo{
			ArtifactJSON:   append(json.RawMessage(nil), artifact...),
			ExpiresAtUnixS: 4102444800,
			Spent:          spent,
		},
	}
}

func assertDirectEnvelopeFields(t *testing.T, path string) {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(body, &document); err != nil {
		t.Fatalf("Unmarshal(config) error = %v", err)
	}
	var direct map[string]json.RawMessage
	if err := json.Unmarshal(document["direct"], &direct); err != nil {
		t.Fatalf("Unmarshal(direct) error = %v", err)
	}
	for _, field := range []string{"ws_url", "channel_id", "e2ee_psk_b64u", "e2ee_psk_set", "channel_init_expire_at_unix_s", "default_suite"} {
		if _, ok := direct[field]; ok {
			t.Fatalf("legacy direct field %q persisted in envelope: %s", field, document["direct"])
		}
	}
	for _, field := range []string{"artifact_json", "expires_at_unix_s", "spent"} {
		if _, ok := direct[field]; !ok {
			t.Fatalf("direct envelope missing %q: %s", field, document["direct"])
		}
	}
}

func jsonEqual(left, right []byte) bool {
	var leftValue any
	var rightValue any
	return json.Unmarshal(left, &leftValue) == nil &&
		json.Unmarshal(right, &rightValue) == nil &&
		bytes.Equal(mustCanonicalJSON(leftValue), mustCanonicalJSON(rightValue))
}

func mustCanonicalJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
}

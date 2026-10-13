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

const directArtifactFixture = `{"correlation":{"tags":[],"v":3},"path":{"candidates":[{"carrier":"websocket","id":"issuer-ws","tls":{"mode":"ca"},"url":"wss://issuer.example/flowersec/v3/direct","wire_profile":"flowersec-direct/3"}],"kind":"direct","listener_audience":"issuer-audience","rendezvous_group_id":"issuer-group","routing_token":"QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI"},"profile":"flowersec/3","scoped":[],"session":{"allowed_suites":[1,2],"channel_id":"issuer-shared","contract_hash_b64u":"81XXUykAE_J_K1LvRqkr_B7H3CCCcSRF7E7CIbmfwCU","default_suite":1,"e2ee_psk_b64u":"QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI","establish_timeout_seconds":30,"idle_timeout_seconds":60,"init_expire_at_unix_s":2000000000,"max_inbound_streams":32,"rekey_completion_timeout_seconds":30,"rekey_prepare_timeout_seconds":10,"selected_features":0},"v":3}`

func TestSaveAndLoadPreserveOpaquePoolArtifactAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	wantArtifact := json.RawMessage(directArtifactFixture)
	cfg := configWithPoolArtifact(wantArtifact, false)

	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.ControlArtifactPool == nil {
		t.Fatal("Load() direct = nil")
	}
	if !jsonEqual(restarted.ControlArtifactPool.Entries[0].ArtifactJSON, wantArtifact) {
		t.Fatalf("Load() artifact = %s, want %s", restarted.ControlArtifactPool.Entries[0].ArtifactJSON, wantArtifact)
	}
	if restarted.ControlArtifactPool.Entries[0].ExpiresAtUnixS != 4102444800 {
		t.Fatalf("Load() expires_at_unix_s = %d, want 4102444800", restarted.ControlArtifactPool.Entries[0].ExpiresAtUnixS)
	}
	if restarted.ControlArtifactPool.Entries[0].Spent {
		t.Fatal("Load() spent = true, want false")
	}
	assertDirectEnvelopeFields(t, path)
}

func TestSaveAndLoadPreservePoolArtifactSpentState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	cfg := configWithPoolArtifact(json.RawMessage(directArtifactFixture), false)
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	cfg.ControlArtifactPool.Entries[0].Spent = true
	cfg.ControlArtifactPool.Entries[0].ArtifactJSON = nil
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save(spent) error = %v", err)
	}
	restarted, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if restarted.ControlArtifactPool == nil || !restarted.ControlArtifactPool.Entries[0].Spent {
		t.Fatalf("Load() direct = %#v, want spent artifact", restarted.ControlArtifactPool.Entries[0])
	}
}

func TestSaveAndLoadPreserveControlArtifactDigestAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	artifact, err := NormalizeControlArtifactJSON(json.RawMessage(directArtifactFixture))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(artifact)
	cfg := configWithPoolArtifact(nil, false)

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
	if !jsonEqual(entry.ArtifactJSON, artifact) || entry.ArtifactDigest != base64.RawURLEncoding.EncodeToString(digest[:]) {
		t.Fatalf("Load() control artifact entry = %#v", entry)
	}
}

func TestSaveArtifactWriteFailurePreservesPreviousRestartArtifact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	oldArtifact := json.RawMessage(directArtifactFixture)
	oldConfig := configWithPoolArtifact(oldArtifact, false)
	if err := Save(path, oldConfig); err != nil {
		t.Fatalf("Save(old) error = %v", err)
	}
	oldBody, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(old) error = %v", err)
	}

	next := *oldConfig
	nextPool := *oldConfig.ControlArtifactPool
	nextPool.Entries = append([]ControlArtifactEntry(nil), nextPool.Entries...)
	nextDirect := nextPool.Entries[0]
	nextDirect.ArtifactJSON = json.RawMessage(strings.Replace(directArtifactFixture, "channel-1", "channel-2", 1))
	nextDirect.ExpiresAtUnixS = 4102444900
	nextPool.Entries[0] = nextDirect
	next.ControlArtifactPool = &nextPool
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
	if restarted.ControlArtifactPool == nil || !jsonEqual(restarted.ControlArtifactPool.Entries[0].ArtifactJSON, oldArtifact) {
		t.Fatalf("restart did not retain old artifact: %#v", restarted.ControlArtifactPool.Entries[0])
	}
}

func configWithPoolArtifact(artifact json.RawMessage, spent bool) *Config {
	association := testCloudAssociation()
	association.RuntimePublicID = "local-1"
	association.Binding.RuntimePublicID = "local-1"
	association.Binding.EnvPublicID = "env-1"
	association.Binding.Generation = 1
	pool := NewControlArtifactPool(1)
	pool.LogicalBindingID = "runtime-cloud-v5:binding"
	pool.RecoveryState = ControlArtifactRecoveryReady
	digest := sha256.Sum256(artifact)
	if spent {
		artifact = nil
	}
	pool.Entries = []ControlArtifactEntry{{Sequence: 1, ArtifactJSON: artifact, ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]), ChannelID: "channel-1", ExpiresAtUnixS: 4102444800, Spent: spent}}
	association.Binding.IdentityExpiresAtUnixMS = 4102444800000
	return &Config{CloudOrigin: association.CloudOrigin, AccessPointOrigin: association.RegionOrigin, CloudID: association.CloudID, EnvironmentID: "env-1", LocalEnvironmentPublicID: "local-1", BindingGeneration: 1, AgentInstanceID: "agent-1", CloudAssociation: association, CloudRoute: &CloudRoute{Kind: CloudRouteDirect, Revision: 1}, ControlArtifactPool: pool}
}

func assertDirectEnvelopeFields(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if json.Unmarshal(raw, &document) != nil {
		t.Fatal("invalid JSON")
	}
	if _, exists := document["direct"]; exists {
		t.Fatal("retired direct envelope persisted")
	}
	if len(document["control_artifact_pool"]) == 0 {
		t.Fatal("missing opaque reserve")
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

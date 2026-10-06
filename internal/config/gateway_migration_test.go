package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func legacyGatewayJSON(t *testing.T) []byte {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{
		"local_environment_public_id": "runtime", "environment_id": "env", "binding_generation": 4,
		"gateway_cloud": map[string]any{
			"protocol_version": 1, "cloud_origin": "https://cloud.example", "region_origin": "https://region.example",
			"namespace_public_id": "namespace", "gateway_public_id": "gateway", "runtime_public_id": "runtime", "request_public_id": "old-request",
			"private_key_b64u": base64.RawURLEncoding.EncodeToString(key), "gateway_url": "https://retired.internal",
			"client_certificate_pem": "retired-certificate", "enrollment_token": "retired-secret",
			"binding": gc.Binding{PublicID: "binding", NamespacePublicID: "namespace", GatewayPublicID: "gateway", RuntimePublicID: "runtime", EnvPublicID: "env", Region: "sg", Generation: 4, State: "active"},
		},
		"gateway_cloud_migration": map[string]string{"gateway_url": "https://other-retired.internal"},
		"direct":                  map[string]any{"artifact_json": map[string]string{"credential": "retired-artifact"}},
		"control_artifact_pool":   map[string]any{"entries": []any{map[string]any{"artifact_json": "retired-pool"}}},
		"custom_setting":          "retained",
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestLegacyGatewayMigrationRetainsOnlyBindingEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, legacyGatewayJSON(t), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Gateway != nil || cfg.GatewayPublication != nil || cfg.Direct != nil || cfg.ControlArtifactPool != nil || !cfg.GatewayRejoinRequired {
		t.Fatal("legacy route remains executable")
	}
	evidence := cfg.GatewayMigrationEvidence
	if evidence == nil || evidence.Binding.EnvPublicID != "env" || evidence.Binding.Generation != 4 {
		t.Fatal("original environment ownership evidence lost")
	}
	if _, err := evidence.Identity(); err != nil {
		t.Fatal(err)
	}
	if cfg.ValidateRemoteStrict() == nil {
		t.Fatal("old configuration authorized direct control")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, retired := range []string{"gateway_cloud", "gateway_url", "certificate_pem", "enrollment_token", "retired-"} {
		if strings.Contains(string(raw), retired) {
			t.Fatalf("migration retained %s", retired)
		}
	}
	if !strings.Contains(string(raw), "custom_setting") {
		t.Fatal("unrelated configuration lost")
	}
	again, err := Load(path)
	if err != nil || again.GatewayMigrationEvidence.Binding.EnvPublicID != "env" {
		t.Fatal("migration is not restart safe", err)
	}
}

func TestLegacyGatewayMigrationWriteFailurePreventsStartup(t *testing.T) {
	persistence := configPersistence{readFile: func(string) ([]byte, error) { return legacyGatewayJSON(t), nil }, writeConfig: func(string, *Config) error { return errors.New("disk unavailable") }}
	if cfg, err := loadConfig("config.json", persistence); err == nil || cfg != nil {
		t.Fatal("started before retiring the executable legacy configuration")
	}
}

func TestRetiringGatewayPublicationNeverLeavesControlCredentials(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal(legacyGatewayJSON(t), &cfg); err != nil {
		t.Fatal(err)
	}
	evidence := cfg.GatewayMigrationEvidence.Clone()
	cfg.GatewayPublication = &gatewaycloud.RuntimeConfig{CloudOrigin: evidence.CloudOrigin, RegionOrigin: evidence.RegionOrigin, NamespacePublicID: evidence.NamespacePublicID, GatewayPublicID: evidence.GatewayPublicID, RuntimePublicID: evidence.RuntimePublicID, RequestPublicID: evidence.RequestPublicID, PrivateKeyB64u: evidence.PrivateKeyB64u, Binding: evidence.Binding}
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	cfg.Gateway = gatewayfixture.Enroll(t, store, evidence.RuntimePublicID)
	cfg.GatewayPublication.ProtocolVersion = gc.ProtocolVersion
	cfg.GatewayPublication.MemberID, cfg.GatewayPublication.MemberVersion = cfg.Gateway.MemberID, cfg.Gateway.MemberVersion
	cfg.GatewayPublication.RequestPublicID = gc.CandidateID(evidence.GatewayPublicID, cfg.Gateway.MemberID)
	cfg.GatewayPublication.Binding.MemberID, cfg.GatewayPublication.Binding.MemberVersion = cfg.Gateway.MemberID, cfg.Gateway.MemberVersion
	cfg.Direct, cfg.ControlArtifactPool = &DirectConnectInfo{}, NewControlArtifactPool(4)
	if err := cfg.RetireGatewayPublication(); err != nil {
		t.Fatal(err)
	}
	if cfg.GatewayPublication != nil || cfg.ControlArtifactPool != nil || cfg.Direct != nil || cfg.GatewayMigrationEvidence.Binding.EnvPublicID != "env" {
		t.Fatal("leave did not fence publication")
	}
}

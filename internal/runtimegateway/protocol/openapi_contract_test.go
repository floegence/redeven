package protocol

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestGatewayOpenAPIContractExposesAccessOnlySurface(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	raw, err := os.ReadFile(filepath.Join(root, "spec", "openapi", "gateway-v3.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Paths map[string]map[string]any `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"/gateway/v3/pairing/challenge",
		"/gateway/v3/pairing/complete",
		"/gateway/v3/catalog",
		"/gateway/v3/open-session",
		"/gateway/v3/close-session",
		"/gateway/v3/access/{token}/{path}",
		"/gateway/v3/access/{token}/_tunnel",
		"/gateway/v3/env-profiles/upsert",
		"/gateway/v3/env-profiles/check",
		"/gateway/v3/env-profiles/delete",
	}
	if len(document.Paths) != len(want) {
		t.Fatalf("Gateway OpenAPI path count = %d, want %d", len(document.Paths), len(want))
	}
	for _, path := range want {
		if _, ok := document.Paths[path]; !ok {
			t.Fatalf("Gateway OpenAPI contract is missing access path %q", path)
		}
	}
	for path := range document.Paths {
		if !strings.HasPrefix(path, "/gateway/v3/") {
			t.Fatalf("Gateway OpenAPI exposes an obsolete wire path %q", path)
		}
		if strings.Contains(path, "runtime") || strings.Contains(path, "lifecycle") {
			t.Fatalf("Gateway OpenAPI contract exposes Runtime lifecycle path %q", path)
		}
	}
}

func TestGatewayOpenAPIContractAccessModesAndArtifacts(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "spec", "openapi", "gateway-v3.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Info struct {
			Version string `yaml:"version"`
		} `yaml:"info"`
		Components struct {
			Schemas map[string]struct {
				Enum       []string       `yaml:"enum"`
				Required   []string       `yaml:"required"`
				Properties map[string]any `yaml:"properties"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Info.Version != Version {
		t.Fatal("OpenAPI and Go protocol versions differ")
	}
	modes := doc.Components.Schemas["AccessMode"].Enum
	if strings.Join(modes, ",") != "direct_url,gateway_proxy" {
		t.Fatalf("access modes: %v", modes)
	}
	for schema, required := range map[string][]string{
		"EnvProfileCheckRequest":       {"protocol_version", "target_url", "client_nonce"},
		"RuntimeAccessIdentityProof":   {"version", "challenge", "public_key", "signature"},
		"EnvironmentProfile":           {"access_mode"},
		"GatewayProxyConnectArtifact":  {"kind", "url", "gateway_session_id", "expires_at_unix_ms", "artifact_nonce", "proof"},
		"DesktopBridgeConnectArtifact": {"url", "gateway_session_id", "bridge_session_id", "route_id"},
		"CloseSessionRequest":          {"protocol_version", "gateway_session_id"},
	} {
		value, ok := doc.Components.Schemas[schema]
		if !ok {
			t.Fatalf("missing %s", schema)
		}
		for _, key := range required {
			found := false
			for _, field := range value.Required {
				found = found || field == key
			}
			if !found || value.Properties[key] == nil {
				t.Fatalf("%s does not require %s", schema, key)
			}
		}
	}
	capabilities := strings.Join(doc.Components.Schemas["GatewayCapability"].Enum, ",")
	for _, capability := range []string{"env_catalog", "env_direct_open", "env_proxy_open", "env_profile_write"} {
		if !strings.Contains(capabilities, capability) {
			t.Fatalf("missing capability %s", capability)
		}
	}
	if strings.Contains(capabilities, "env_open_session") {
		t.Fatal("obsolete ambiguous opening capability")
	}
}

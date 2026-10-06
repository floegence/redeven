package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestGatewayManagementCanRestartWithoutAuthorizingControl(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := &gatewaycloud.RuntimeConfig{ProtocolVersion: gc.ProtocolVersion, LocalConsentAtUnixMS: 1, CloudOrigin: "https://cloud.example", RegionOrigin: "https://sg.cloud.example", GatewayPublicID: "gateway", NamespacePublicID: "namespace", RuntimePublicID: "runtime", RequestPublicID: "request", PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), Binding: &gc.Binding{PublicID: "binding", EnvPublicID: "env", Region: "sg", GatewayPublicID: "gateway", NamespacePublicID: "namespace", RuntimePublicID: "runtime", Generation: 2, State: "active"}}
	cfg := &Config{GatewayCloud: path, ProviderOrigin: path.CloudOrigin, ControlplaneBaseURL: path.RegionOrigin, ControlplaneProviderID: "redeven", EnvironmentID: "env", LocalEnvironmentPublicID: "runtime", AgentInstanceID: "instance", BindingGeneration: 2}
	for _, revoked := range []bool{false, true} {
		path.Revoked = revoked
		if err := cfg.ValidateGatewayManagement(); err != nil {
			t.Fatal("a configured path cannot start its authenticated recovery observer", err)
		}
		if cfg.ValidateRemoteStrict() == nil {
			t.Fatal("missing credentials or revoked access authorized the control channel")
		}
	}
	for _, mutate := range []func(*Config){
		func(c *Config) { c.ProviderOrigin = "https://other.example" },
		func(c *Config) { c.ControlplaneBaseURL = "https://other-region.example" },
		func(c *Config) { c.EnvironmentID = "another-env" },
		func(c *Config) { c.LocalEnvironmentPublicID = "another-runtime" },
		func(c *Config) { c.BindingGeneration++ },
		func(c *Config) { c.ControlplaneProviderID = "another-provider" },
	} {
		changed := *cfg
		mutate(&changed)
		if changed.ValidateGatewayManagement() == nil {
			t.Fatal("inconsistent configuration entered recovery")
		}
	}
}

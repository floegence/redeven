package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestRuntimeGatewayCloudStatusDoesNotConfuseApprovalWithControlRegistration(t *testing.T) {
	a := &Agent{remoteEnabled: true, cfg: &config.Config{GatewayCloud: &gatewaycloud.RuntimeConfig{
		ProtocolVersion: gc.ProtocolVersion, CloudOrigin: "https://cloud.example", NamespacePublicID: "ns", GatewayPublicID: "gateway", PrivateKeyB64u: "secret",
	}}}
	if a.gatewayCloudAccessSnapshot().State != "pending" {
		t.Fatal("unapproved access must be pending")
	}
	a.cfg.GatewayCloud.Binding = &gc.Binding{State: "active"}
	if a.gatewayCloudAccessSnapshot().State != "connecting" {
		t.Fatal("approval does not establish control readiness")
	}
	a.controlRegistered = true
	if a.gatewayCloudAccessSnapshot().State != "connected" {
		t.Fatal("control registration should be observable")
	}
	a.cfg.GatewayCloud.Revoked = true
	status := a.gatewayCloudAccessSnapshot()
	if status.State != "revoked" {
		t.Fatal("revocation must take precedence over stale control registration")
	}
	raw, err := json.Marshal(status)
	if err != nil || strings.Contains(string(raw), "secret") {
		t.Fatal("presentation leaked private identity")
	}
}

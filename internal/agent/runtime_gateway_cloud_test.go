package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestRuntimeGatewayPublicationStatusDoesNotConfuseApprovalWithControlRegistration(t *testing.T) {
	a := &Agent{remoteEnabled: true, cfg: &config.Config{GatewayPublication: &gatewaycloud.RuntimeConfig{
		ProtocolVersion: gc.ProtocolVersion, CloudOrigin: "https://cloud.example", NamespacePublicID: "ns", GatewayPublicID: "gateway", PrivateKeyB64u: "secret",
	}}}
	if a.gatewayPublicationSnapshot().State != "pending" {
		t.Fatal("unapproved access must be pending")
	}
	a.cfg.GatewayPublication.Binding = &gc.Binding{State: "active"}
	if a.gatewayPublicationSnapshot().State != "connecting" {
		t.Fatal("approval does not establish control readiness")
	}
	a.controlRegistered = true
	if a.gatewayPublicationSnapshot().State != "connected" {
		t.Fatal("control registration should be observable")
	}
	a.cfg.GatewayPublication.Revoked = true
	status := a.gatewayPublicationSnapshot()
	if status.State != "revoked" {
		t.Fatal("revocation must take precedence over stale control registration")
	}
	raw, err := json.Marshal(status)
	if err != nil || strings.Contains(string(raw), "secret") {
		t.Fatal("presentation leaked private identity")
	}
}

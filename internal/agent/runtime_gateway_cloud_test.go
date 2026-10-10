package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayManagedCloudSnapshotPreservesApprovedBindingWithoutCredentials(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	route, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	route.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "env", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	cfg := &config.Config{Gateways: []*gatewaymembership.RuntimeConfig{member}, GatewayPublication: route, CloudOrigin: route.CloudOrigin, CloudID: "redeven", AccessPointOrigin: route.RegionOrigin, EnvironmentID: "env", LocalEnvironmentPublicID: "runtime", AgentInstanceID: "instance", BindingGeneration: 1}
	a := &Agent{cfg: cfg, remoteEnabled: true, controlChannelEnabled: true}
	for _, revoked := range []bool{false, true} {
		route.Revoked = revoked
		snapshot := a.RuntimeServiceSnapshot()
		if snapshot.Capabilities.CloudLink.Supported || snapshot.Capabilities.CloudLink.ReasonCode != "gateway_managed" {
			t.Fatal("direct Cloud management must remain unavailable")
		}
		if snapshot.Bindings.CloudLink.State != runtimeservice.CloudLinkStateLinked || snapshot.Bindings.CloudLink.EnvPublicID != "env" || snapshot.Bindings.CloudLink.ConnectionState != "authorization_required" {
			t.Fatalf("approved binding must remain visible during recovery: %+v", snapshot.Bindings.CloudLink)
		}
		if cfg.ValidateRemoteStrict() == nil {
			t.Fatal("display identity must not authorize the control channel")
		}
	}
	cfg.EnvironmentID = "changed"
	if binding := a.RuntimeServiceSnapshot().Bindings.CloudLink; binding.State == runtimeservice.CloudLinkStateLinked || binding.EnvPublicID != "" {
		t.Fatal("conflicting binding cannot be claimed for display")
	}
}

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

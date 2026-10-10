package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

// This opt-in fixture uses the production Cloud exchange. Desktop acceptance
// starts its own Runtime from the result; no renderer binding is fabricated.
func TestCloudCardAcceptanceFixture(t *testing.T) {
	output := os.Getenv("REDEVEN_CLOUD_CARD_ACCEPTANCE_DIR")
	if output == "" {
		t.Skip("real Desktop acceptance owns the fixture directory")
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/rcpp/v4/runtime-link/resolve" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"protocol_version": "rcpp-v4", "cloud_id": "example_control_plane", "cloud_origin": "https://redeven.test",
				"env_public_id": "env_desktop_card", "access_point_id": "dev", "access_point_origin": "https://dev.redeven.test",
				"expires_at_unix_ms": time.Now().Add(time.Minute).UnixMilli(),
			})
			return
		}
		writeCloudRuntimeLinkResponse(t, w, r, "desktop-card", "wss://127.0.0.1:1/flowersec/v3/direct")
	}))
	defer server.Close()
	serverURL, _ := url.Parse(server.URL)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		local := request.Clone(request.Context())
		local.Host = request.URL.Host
		local.URL.Scheme, local.URL.Host = serverURL.Scheme, serverURL.Host
		return server.Client().Transport.RoundTrip(local)
	})}
	a := newCloudLinkTestAgent(t, filepath.Join(t.TempDir(), "config.json"), nil)
	response, err := a.ConnectCloud(t.Context(), CloudLinkRequest{CloudOrigin: "https://redeven.test", CloudID: "example_control_plane", EnvPublicID: "env_desktop_card", RuntimeLinkTicket: "ticket-123", runtimeLinkHTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	if response.Binding.State != runtimeservice.CloudLinkStateLinked {
		t.Fatal("Cloud exchange did not persist its binding")
	}
	if err := os.MkdirAll(output, 0700); err != nil {
		t.Fatal(err)
	}
	if err := config.Save(filepath.Join(output, "cloud-config.json"), a.remoteConfigSnapshot()); err != nil {
		t.Fatal(err)
	}
}

func TestCloudBindingSurvivesUpgradeFromImplicitGatewayPublication(t *testing.T) {
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeCloudRuntimeLinkResponse(t, w, r, "paired-cloud")
	})
	defer server.Close()
	configPath := filepath.Join(t.TempDir(), "config.json")
	a := newCloudLinkTestAgent(t, configPath, nil)
	linked, err := a.ConnectCloud(t.Context(), CloudLinkRequest{CloudOrigin: server.URL, CloudID: "example_control_plane", EnvPublicID: "env_demo", RuntimeLinkTicket: "ticket-123", runtimeLinkHTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, linked.Binding.LocalEnvironmentPublicID)
	cfg := a.remoteConfigSnapshot()
	cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
	cfg.GatewayCloudMemberID, cfg.GatewayEnvironmentChoice = member.MemberID, "preserve"
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal(raw, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["gateway_membership_schema_version"] = json.RawMessage("2")
	raw, _ = json.Marshal(legacy)
	if err := os.WriteFile(configPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	upgraded, err := config.Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	restarted := &Agent{cfg: upgraded, remoteEnabled: true, controlChannelEnabled: true}
	snapshot := restarted.RuntimeServiceSnapshot()
	if snapshot.Bindings.CloudLink.State != runtimeservice.CloudLinkStateLinked || snapshot.Bindings.CloudLink.EnvPublicID != linked.Binding.EnvPublicID || !snapshot.Capabilities.CloudLink.Supported {
		t.Fatalf("direct Cloud binding disappeared after paired Gateway upgrade: %+v", snapshot.Bindings.CloudLink)
	}
	if len(snapshot.GatewayMemberships) != 1 || snapshot.GatewayMemberships[0].CloudPublication {
		t.Fatal("pairing must not select Cloud publication")
	}
}

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

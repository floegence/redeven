package agent

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimecloud"
	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
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
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeCloudRuntimeLinkResponse(t, w, r, "desktop-card", "wss://127.0.0.1:1/flowersec/v3/direct")
	})
	defer server.Close()
	serverURL, _ := url.Parse(server.URL)
	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	transport.TLSClientConfig.ServerName = serverURL.Hostname()
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, network, serverURL.Host)
	}
	client := &http.Client{Transport: transport}
	defer transport.CloseIdleConnections()

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
	cfg := a.remoteConfigSnapshot()
	// The native codeapp uses the normal Region domain relationship. The
	// controlled exchange server remains reachable only inside this fixture.
	cfg.AccessPointOrigin = "https://dev.redeven.test"
	cfg.CloudAssociation.RegionOrigin = cfg.AccessPointOrigin
	if err := config.Save(filepath.Join(output, "cloud-config.json"), cfg); err != nil {
		t.Fatal(err)
	}
}

func TestCloudSnapshotSeparatesApprovalConnectionAndRoute(t *testing.T) {
	for _, route := range []config.CloudRouteKind{config.CloudRouteDirect, config.CloudRouteGateway} {
		t.Run(string(route), func(t *testing.T) {
			a := routeAgentFixture(t)
			a.cfg.CloudOrigin, a.cfg.CloudID, a.cfg.AccessPointOrigin, a.cfg.EnvironmentID, a.cfg.BindingGeneration = "https://cloud.example", "redeven", "https://region.example", "env", 7
			a.cfg.CloudRoute.Kind = route
			if route == config.CloudRouteGateway {
				a.cfg.CloudRoute.MemberID = "offline-member"
			}
			a.remoteEnabled = true
			a.controlChannelEnabled = true
			snapshot := a.RuntimeServiceSnapshot()
			status := snapshot.Bindings.CloudLink.Cloud
			if !snapshot.Capabilities.CloudLink.Supported || snapshot.Bindings.CloudLink.EnvPublicID != "env" || status == nil || status.ApprovalState != rc.ApprovalApproved || status.ConnectionState == "connected" {
				t.Fatal("approval was confused with connection readiness")
			}
			a.controlRegistered = true
			a.controlRPC = &providerDisconnectFakeRPC{}
			status = a.RuntimeServiceSnapshot().Bindings.CloudLink.Cloud
			if status.ConnectionState != "connected" {
				t.Fatalf("registered control was hidden: %+v", status)
			}
			a.cfg.CloudAssociation.ApprovalState = rc.ApprovalRevoked
			status = a.RuntimeServiceSnapshot().Bindings.CloudLink.Cloud
			if status.ApprovalState != rc.ApprovalRevoked || status.ConnectionState == "connected" {
				t.Fatal("stale registration hid revocation")
			}
			raw, err := json.Marshal(a.RuntimeServiceSnapshot())
			if err != nil || strings.Contains(string(raw), a.cfg.CloudAssociation.PrivateKeyB64u) {
				t.Fatal("snapshot leaked machine identity")
			}
		})
	}
}

func TestGatewayPairingKeepsCloudManagementAndDirectRoute(t *testing.T) {
	a := routeAgentFixture(t)
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	a.cfg.Gateways = []*gatewaymembership.RuntimeConfig{gatewayfixture.Enroll(t, store, "runtime")}
	snapshot := a.RuntimeServiceSnapshot()
	if !snapshot.Capabilities.CloudLink.Supported || len(snapshot.GatewayMemberships) != 1 || snapshot.Bindings.CloudLink.Cloud.Route.Kind != "direct" {
		t.Fatal("pairing implicitly selected or managed Cloud access")
	}
}

func TestNamespaceEnrollmentFailureIsReturnedWithoutReplacingOriginalOperation(t *testing.T) {
	a := routeAgentFixture(t)
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	a.cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
	a.cfg.CloudAssociation.EnrollmentSubmitted = false
	a.cfg.CloudAssociation.EnrollmentOperationID = strings.Repeat("A", 43)
	a.cfg.CloudAssociation.DeliveryRequestID = strings.Repeat("A", 43)
	a.cfg.CloudAssociation.EnrollmentAuthorization = &rc.EnrollmentAuthorization{GatewayPublicID: "gateway", MemberID: member.MemberID, MemberVersion: member.MemberVersion, Delegation: json.RawMessage(`{}`)}
	attempts := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/challenges") {
			var request rc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil {
				t.Error("invalid challenge")
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.ChallengeResponse{Proof: rc.Proof{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: "https://" + r.Host, NamespacePublicID: request.NamespacePublicID, RuntimePublicID: request.RuntimePublicID, Purpose: request.Purpose, ChallengeID: "challenge", NonceB64u: strings.Repeat("A", 43), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}})
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/enroll") {
			t.Error("unexpected recovery path")
		}
		attempts++
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"SERVICE_UNAVAILABLE","message":"Retry later"}}`))
	}))
	defer server.Close()
	a.cfg.CloudAssociation.CloudOrigin = server.URL
	if err := config.Save(a.configPath, a.cfg); err != nil {
		t.Fatal(err)
	}
	client, err := runtimecloud.NewClient(server.URL, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	for range 2 {
		result, err := a.recoverRuntimeCloud(t.Context(), a.remoteConfigSnapshot(), client)
		if err == nil || result != nil {
			t.Fatalf("failed enrollment swallowed: %v", err)
		}
	}
	if attempts != 2 || a.cfg.CloudAssociation.EnrollmentOperationID != strings.Repeat("A", 43) || a.cfg.CloudAssociation.EnrollmentSubmitted {
		t.Fatal("retry changed original enrollment")
	}
}

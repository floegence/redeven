package gatewaycloud

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

type denialCloudTransport func(*http.Request) (*http.Response, error)

func (f denialCloudTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGatewayDeliversDenialBeforeAllowAndWaitsForCloudReadback(t *testing.T) {
	store, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	set := func(permission gp.CloudPermission) {
		t.Helper()
		if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: member.MemberID, ExpectedMemberVersion: 1, CloudPermission: permission}); err != nil {
			t.Fatal(err)
		}
	}
	set(gp.CloudAllow)
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	t.Cleanup(connections.Close)
	gateway, err := NewGateway(t.TempDir(), stable, store, connections, budget, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gateway.egress.Close() })
	remote := gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "cloud_gateway", GatewayID: stable.ID, NamespacePublicID: "namespace", State: "active", IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}, AdmissionDestinations: []string{"cloud.example:443", "region.example:443"}, Members: []gc.EgressMember{{MemberID: member.MemberID, MemberVersion: 1, RuntimePublicID: "runtime", RequestPublicID: gc.CandidateID("cloud_gateway", member.MemberID), State: "published", Generation: 1, Destinations: []string{"cloud.example:443", "region.example:443", "tunnel.example:443"}}}}
	denied, failReadback := false, true
	var observations []bool
	client, err := NewClient("https://cloud.example", denialCloudTransport(func(r *http.Request) (*http.Response, error) {
		var data any
		switch {
		case strings.HasSuffix(r.URL.Path, "/challenges"):
			var request gc.ChallengeRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				return nil, err
			}
			data = gc.ChallengeResponse{Proof: gc.Proof{ProtocolVersion: gc.ProtocolVersion, CloudOrigin: "https://cloud.example", Purpose: request.Purpose, GatewayPublicID: request.GatewayPublicID, ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}
		case strings.HasSuffix(r.URL.Path, "/gateway-status"):
			if denied && failReadback {
				return nil, errors.New("readback unavailable")
			}
			data = remote
		case strings.HasSuffix(r.URL.Path, "/directory"):
			var signed gc.SignedRequest
			var request gc.DirectorySync
			if err := json.NewDecoder(r.Body).Decode(&signed); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(signed.Payload, &request); err != nil {
				return nil, err
			}
			if len(request.Members) != 1 {
				t.Fatal("unexpected member snapshot")
			}
			allowed := request.Members[0].CloudAllowed(request.Policy)
			observations = append(observations, allowed)
			if !allowed && !denied {
				denied = true
				// Portal omits policy-denied unpublished members until the allow
				// observation arrives. Closure delivery uses the fixed signed relay.
				remote.ManagementMembers, remote.Members = nil, nil
			}
			if allowed && denied {
				remote.ManagementMembers = []gc.EgressMember{{MemberID: member.MemberID, MemberVersion: 1, RuntimePublicID: "runtime", RequestPublicID: gc.CandidateID("cloud_gateway", member.MemberID), State: "unpublished", Generation: 2, Destinations: []string{"cloud.example:443"}}}
			}
			remote.Gateway.DirectoryRevision = request.Revision
			data = remote.Gateway
		default:
			return nil, errors.New("unexpected Cloud request: " + r.URL.Path)
		}
		body, err := json.Marshal(gc.Response[any]{Success: true, Data: data})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body))}, err
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	gateway.client = client
	gateway.config = GatewayConfig{SchemaVersion: 2, CloudOrigin: "https://cloud.example", GatewayPublicID: "cloud_gateway", NamespacePublicID: "namespace", PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(stable.PrivateKey), KeyRotatedAtUnixMS: time.Now().UnixMilli()}
	store.SetCommitHandler(func(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
		gateway.Apply(records, policy)
		if denied && !records[0].Member.CloudRevocationPending && gateway.MemberContext(records[0]).State == "published" {
			t.Error("denial receipt restored a stale published projection")
		}
	})
	set(gp.CloudDeny)
	set(gp.CloudAllow)
	if err := gateway.sync(t.Context()); err == nil {
		t.Fatal("missing readback did not fail sync")
	}
	records, policy, _ := store.Snapshot()
	if !records[0].Member.CloudRevocationPending || gatewaymembership.EffectiveCloudAllowed(records[0], policy) {
		t.Fatal("lost readback released the local fence")
	}
	failReadback = false
	if err := gateway.sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	records, _, _ = store.Snapshot()
	if records[0].Member.CloudRevocationPending {
		t.Fatal("confirmed denial remains pending")
	}
	block, _ := pem.Decode([]byte(records[0].ClientCertificatePEM))
	if block == nil {
		t.Fatal("missing member certificate")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	connect := httptest.NewRequest(http.MethodConnect, "https://tunnel.example:443", nil)
	connect.Host = "tunnel.example:443"
	connect.URL = &url.URL{Host: connect.Host}
	connect.TLS = &tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}, VerifiedChains: [][]*x509.Certificate{{leaf}}}
	deniedResponse := httptest.NewRecorder()
	gateway.egress.ServeHTTP(deniedResponse, connect)
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("old Tunnel grant survived denial: %d", deniedResponse.Code)
	}

	if err := gateway.sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if len(observations) != 3 || observations[0] || observations[1] || !observations[2] {
		t.Fatalf("denial/allow delivery order: %v", observations)
	}
	if err := gateway.sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if gateway.MemberContext(records[0]).State != "unpublished" {
		t.Fatal("allow implicitly republished the member")
	}
}

func TestGatewayNeverSendsUnpersistedHookRevision(t *testing.T) {
	_, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	hooks, err := gatewaymembership.NewPolicyHooks(gatewaymembership.HookConfig{})
	if err != nil {
		t.Fatal(err)
	}
	memberPath := filepath.Join(t.TempDir(), "members.json")
	store, err := gatewaymembership.NewStore(memberPath, stable, "https://gateway.internal:7443", "127.0.0.1:7443", hooks)
	if err != nil {
		t.Fatal(err)
	}
	member := gatewayfixture.Enroll(t, store, "runtime")
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: member.MemberID, ExpectedMemberVersion: 1, CloudPermission: gp.CloudAllow}); err != nil {
		t.Fatal(err)
	}
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	t.Cleanup(connections.Close)
	gateway, err := NewGateway(t.TempDir(), stable, store, connections, budget, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gateway.egress.Close() })
	remote := gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "cloud_gateway", GatewayID: stable.ID, NamespacePublicID: "namespace", State: "active", IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}}
	directories := 0
	client, err := NewClient("https://cloud.example", denialCloudTransport(func(r *http.Request) (*http.Response, error) {
		var data any
		switch {
		case strings.HasSuffix(r.URL.Path, "/challenges"):
			var request gc.ChallengeRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				return nil, err
			}
			data = gc.ChallengeResponse{Proof: gc.Proof{ProtocolVersion: gc.ProtocolVersion, CloudOrigin: "https://cloud.example", Purpose: request.Purpose, GatewayPublicID: request.GatewayPublicID, ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}
		case strings.HasSuffix(r.URL.Path, "/gateway-status"):
			data = remote
		case strings.HasSuffix(r.URL.Path, "/directory"):
			directories++
			var signed gc.SignedRequest
			var request gc.DirectorySync
			if err := json.NewDecoder(r.Body).Decode(&signed); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(signed.Payload, &request); err != nil {
				return nil, err
			}
			remote.Gateway.DirectoryRevision, remote.Gateway.Policy = request.Revision, request.Policy
			data = remote.Gateway
		default:
			return nil, errors.New("unexpected request")
		}
		body, err := json.Marshal(gc.Response[any]{Success: true, Data: data})
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body))}, err
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	gateway.client = client
	gateway.config = GatewayConfig{SchemaVersion: 2, CloudOrigin: "https://cloud.example", GatewayPublicID: "cloud_gateway", NamespacePublicID: "namespace", PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(stable.PrivateKey), KeyRotatedAtUnixMS: time.Now().UnixMilli()}
	store.SetCommitHandler(gateway.Apply)
	// A directory at the state-file path makes atomic rename fail independently
	// of host permissions while Cloud's separate state file remains writable.
	if err := os.Rename(memberPath, memberPath+".saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(memberPath, 0700); err != nil {
		t.Fatal(err)
	}
	if err := store.RefreshHooks(gatewaymembership.HookConfig{}); err == nil {
		t.Fatal("expected storage failure")
	}
	if err := gateway.sync(t.Context()); err == nil {
		t.Fatal("unpersisted snapshot reached Cloud")
	}
	if directories != 0 {
		t.Fatal("directory sent an unpersisted policy revision")
	}
	if err := os.Remove(memberPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(memberPath+".saved", memberPath); err != nil {
		t.Fatal(err)
	}
	if err := gateway.sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if directories != 1 {
		t.Fatal("recovered storage did not deliver the denial")
	}
	reopened, err := gatewaymembership.NewStore(memberPath, stable, "", "", hooks)
	if err != nil {
		t.Fatal(err)
	}
	_, policy, _ := reopened.Snapshot()
	if policy.Revision < remote.Gateway.Policy.Revision {
		t.Fatal("restart rolled back a Cloud policy version")
	}
}

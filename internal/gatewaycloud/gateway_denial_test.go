package gatewaycloud

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
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

func TestGatewayLocalDenialAndAllowDoNotWaitForCloudReadback(t *testing.T) {
	store, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	t.Cleanup(connections.Close)
	gateway, err := NewGateway(t.TempDir(), stable, store, connections, budget, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		gateway.mu.Lock()
		if gateway.admissionTimer != nil {
			gateway.admissionTimer.Stop()
		}
		gateway.mu.Unlock()
		_ = gateway.egress.Close()
	})
	gateway.config = GatewayConfig{SchemaVersion: gatewayConfigVersion, CloudOrigin: "https://cloud.example", GatewayPublicID: "cloud_gateway", NamespacePublicID: "namespace"}
	gateway.status = &gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "cloud_gateway", GatewayID: stable.ID, NamespacePublicID: "namespace", State: "active", IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}, AdmissionDestinations: []string{"cloud.example:443"}}
	store.SetCommitHandler(gateway.Apply)
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	for _, permission := range []gp.CloudPermission{gp.CloudAllow, gp.CloudDeny, gp.CloudAllow} {
		if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: member.MemberID, ExpectedMemberVersion: 1, CloudPermission: permission}); err != nil {
			t.Fatal(err)
		}
		records, _, _ := store.Snapshot()
		if gateway.MemberContext(records[0]).Allowed != (permission == gp.CloudAllow) {
			t.Fatal("local egress depends on a Cloud acknowledgement")
		}
	}
	if gateway.status.Gateway.State != "active" {
		t.Fatal("local denial changed Cloud management authorization")
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
	gateway.status = &remote
	gateway.config = GatewayConfig{SchemaVersion: gatewayConfigVersion, CloudOrigin: "https://cloud.example", GatewayPublicID: "cloud_gateway", NamespacePublicID: "namespace", PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(stable.PrivateKey), KeyRotatedAtUnixMS: time.Now().UnixMilli()}
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

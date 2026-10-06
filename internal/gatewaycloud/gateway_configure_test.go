package gatewaycloud

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayConfigureRecoversLostResponseAndRequiresRevocation(t *testing.T) {
	// Isolate the Go process-wide fallback trust store; production TLS stays intact.
	if os.Getenv("REDEVEN_CONFIGURE_TEST_CHILD") != "1" {
		cmd := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^TestGatewayConfigureRecoversLostResponseAndRequiresRevocation$", "-test.v")
		cmd.Env = append(os.Environ(), "REDEVEN_CONFIGURE_TEST_CHILD=1", "GODEBUG=x509usefallbackroots=1")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("configure subprocess: %v\n%s", err, out)
		}
		return
	}
	store, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	var mu sync.Mutex
	keys := map[string]string{}
	first := true
	state := "active"
	var origin string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/console/v1/gateway-cloud/v2/challenges":
			var request gc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil {
				t.Error("invalid challenge request")
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.ChallengeResponse]{Success: true, Data: gc.ChallengeResponse{Proof: gc.Proof{ProtocolVersion: gc.ProtocolVersion, CloudOrigin: origin, Purpose: request.Purpose, GatewayPublicID: request.GatewayPublicID, ChallengeID: "challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}})
		case "/api/console/v1/gateway-cloud/v2/register":
			var signed gc.SignedRequest
			var request gc.GatewayRegistration
			if json.NewDecoder(r.Body).Decode(&signed) != nil || json.Unmarshal(signed.Payload, &request) != nil || gc.VerifyGatewayMachineIdentity(signed.Proof, request) != nil || signed.Proof.Verify(request.PublicKeyB64u, signed.Payload, time.Now()) != nil {
				t.Error("invalid registration proof")
				w.WriteHeader(403)
				return
			}
			id := keys[request.PublicKeyB64u]
			if id == "" {
				id = "cloud_" + fmt.Sprintf("%x", sha256.Sum256([]byte(request.PublicKeyB64u)))[:16]
				keys[request.PublicKeyB64u] = id
			}
			if first {
				first = false
				_, _ = w.Write([]byte("{"))
				return
			}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.Gateway]{Success: true, Data: gc.Gateway{GatewayID: stable.ID, PublicID: id, State: "pending"}})
		case "/api/console/v1/gateway-cloud/v2/gateway-status":
			var signed gc.SignedRequest
			if json.NewDecoder(r.Body).Decode(&signed) != nil {
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.GatewayStatus]{Success: true, Data: gc.GatewayStatus{Gateway: gc.Gateway{GatewayID: stable.ID, PublicID: signed.Proof.GatewayPublicID, State: state, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	origin = server.URL
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	x509.SetFallbackRoots(roots)
	root := t.TempDir()
	open := func() *Gateway {
		budget := gatewayflow.New(32, 1024)
		connections := gatewaymembership.NewConnections(budget)
		t.Cleanup(connections.Close)
		gateway, err := NewGateway(root, stable, store, connections, budget, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = gateway.egress.Close(); gateway.client.Close() })
		return gateway
	}
	firstProcess := open()
	if _, err := firstProcess.Configure(t.Context(), origin, "test", false); err == nil {
		t.Fatal("lost response appeared successful")
	}
	pendingKey := firstProcess.config.PrivateKeyB64u
	if pendingKey == "" || firstProcess.config.GatewayPublicID != "" {
		t.Fatal("pending identity was not persisted before registration")
	}
	restarted := open()
	registered, err := restarted.Configure(t.Context(), origin, "test", false)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.config.PrivateKeyB64u != pendingKey {
		t.Fatal("response retry rotated identity")
	}
	repeated, err := restarted.Configure(t.Context(), origin, "test", false)
	if err != nil || repeated.PublicID != registered.PublicID {
		t.Fatal("ordinary configure did not reuse registration")
	}
	if _, err := restarted.Configure(t.Context(), origin, "test", true); err == nil {
		t.Fatal("active association reauthorized without revocation")
	}
	mu.Lock()
	state = "revoked"
	mu.Unlock()
	replacement, err := restarted.Configure(t.Context(), origin, "test", true)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.PublicID == registered.PublicID || restarted.config.PrivateKeyB64u == pendingKey || replacement.GatewayID != stable.ID {
		t.Fatal("reauthorization did not replace Cloud authority while preserving machine identity")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(keys) != 2 {
		t.Fatal("retry manufactured an extra registration")
	}
}

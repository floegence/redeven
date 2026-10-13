package gatewaycloud

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestGatewayManagementReusesHTTPSWithFreshMachineProofs(t *testing.T) {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	var origin string
	var connections, challenges atomic.Int64
	consumed := map[string]bool{}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/challenges") {
			var request gc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil || request.Purpose != gc.PurposeGatewayStatus || request.RuntimePublicID != "" {
				t.Error("unexpected challenge scope")
				w.WriteHeader(400)
				return
			}
			proof := gc.Proof{ProtocolVersion: gc.ProtocolVersion, Purpose: request.Purpose, CloudOrigin: origin, GatewayPublicID: request.GatewayPublicID, ChallengeID: fmt.Sprint(challenges.Add(1)), ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.ChallengeResponse]{Success: true, Data: gc.ChallengeResponse{Proof: proof}})
			return
		}
		var signed gc.SignedRequest
		if json.NewDecoder(r.Body).Decode(&signed) != nil || signed.Proof.Verify(public, signed.Payload, time.Now()) != nil || consumed[signed.Proof.ChallengeID] {
			t.Error("invalid or reused machine proof")
			w.WriteHeader(401)
			return
		}
		consumed[signed.Proof.ChallengeID] = true
		_ = json.NewEncoder(w).Encode(gc.Response[gc.GatewayStatus]{Success: true, Data: gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway"}}})
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	server.StartTLS()
	defer server.Close()
	origin = server.URL
	client, err := NewClient(origin, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	for range 2 {
		status, err := client.GatewayStatus(t.Context(), Identity{PrivateKey: key, GatewayPublicID: "gateway", NamespacePublicID: "namespace"})
		if err != nil || status.Gateway.PublicID != "gateway" {
			t.Fatal("management request failed", err)
		}
	}
	if connections.Load() != 1 || challenges.Load() != 2 {
		t.Fatalf("connections=%d challenges=%d", connections.Load(), challenges.Load())
	}
}

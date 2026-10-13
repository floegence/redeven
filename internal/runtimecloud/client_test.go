package runtimecloud

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"
)

func TestRuntimeRecoveryReusesTransportWithFreshProofs(t *testing.T) {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	var origin string
	var connections, challenges atomic.Int64
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/challenges"):
			var request rc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil {
				t.Error("invalid challenge request")
				return
			}
			n := challenges.Add(1)
			proof := rc.Proof{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: origin, NamespacePublicID: request.NamespacePublicID, RuntimePublicID: request.RuntimePublicID, BindingPublicID: request.BindingPublicID, Purpose: request.Purpose, ChallengeID: base64.RawURLEncoding.EncodeToString([]byte{byte(n)}), NonceB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.ChallengeResponse{Proof: proof}})
		case strings.HasSuffix(r.URL.Path, "/recover"):
			var signed rc.SignedRequest
			if json.NewDecoder(r.Body).Decode(&signed) != nil {
				t.Error("invalid signed recovery")
				return
			}
			if signed.Proof.Verify(base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey)), signed.Payload, time.Now()) != nil {
				t.Error("independent machine proof failed")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.RecoverResponse{ProtocolVersion: rc.ProtocolVersion, State: rc.ApprovalPending, ReasonCode: rc.ReasonAwaitingApproval, RetryAfterMS: 30000, Closures: []rc.Closure{}}})
		default:
			t.Error("unexpected lifecycle path")
			w.WriteHeader(404)
		}
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
	operation, _ := NewOperationID()
	for range 2 {
		result, err := client.Recover(t.Context(), "namespace", "runtime", "", key, rc.RecoverRequest{RuntimePublicID: "runtime", DeliveryRequestID: operation})
		if err != nil || result.State != rc.ApprovalPending {
			t.Fatalf("pending recovery: %v", err)
		}
	}
	if connections.Load() != 1 || challenges.Load() != 2 {
		t.Fatalf("connections=%d, fresh proofs=%d", connections.Load(), challenges.Load())
	}
}

func TestRuntimeCloudProtocolErrorsAndRedirectsAreTerminal(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
	}{
		{"unknown_field", `{"success":true,"data":{},"unexpected":true}`, 200},
		{"trailing_document", `{"success":true,"data":{}}{}`, 200},
		{"identity_denied", `{"success":false,"error":{"code":"RUNTIME_CLOUD_PROOF_INVALID","message":"Denied"}}`, 401},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			client, _ := NewClient(server.URL, server.Client().Transport)
			defer client.Close()
			_, err := call[rc.ChallengeRequest, rc.ChallengeResponse](client, t.Context(), "challenges", rc.ChallengeRequest{})
			if err == nil || !Terminal(err) {
				t.Fatalf("invalid contract retried: %v", err)
			}
		})
	}
	var reached atomic.Bool
	target := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Store(true) }))
	defer target.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, server.Client().Transport)
	defer client.Close()
	_, err := call[rc.ChallengeRequest, rc.ChallengeResponse](client, context.Background(), "challenges", rc.ChallengeRequest{})
	if err == nil || reached.Load() {
		t.Fatal("machine proof followed a redirect")
	}
}

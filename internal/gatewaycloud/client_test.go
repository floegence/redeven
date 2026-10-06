package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestJoinResumesAfterBindingWasPersisted(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var origin string
	var joined bool
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/console/v1/gateway-cloud/v1/challenges":
			var request gc.ChallengeRequest
			if json.NewDecoder(r.Body).Decode(&request) != nil || request.BindingPublicID != "" || request.Purpose != gc.PurposeRuntimeJoin {
				t.Error("join requested a binding-scoped challenge")
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(gc.Response[gc.ChallengeResponse]{Success: true, Data: gc.ChallengeResponse{Proof: gc.Proof{ProtocolVersion: gc.ProtocolVersion, CloudOrigin: origin, Purpose: request.Purpose, GatewayPublicID: request.GatewayPublicID, RuntimePublicID: request.RuntimePublicID, ChallengeID: "resume-challenge", ChallengeB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}})
		case "/api/console/v1/gateway-cloud/v1/join":
			var signed gc.SignedRequest
			if json.NewDecoder(r.Body).Decode(&signed) != nil || signed.Proof.BindingPublicID != "" || signed.Proof.BindingGeneration != 0 || signed.Proof.NamespacePublicID != "namespace" {
				t.Error("join carried partially saved binding claims")
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if err := signed.Proof.Verify(base64.RawURLEncoding.EncodeToString(public), signed.Payload, time.Now()); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusForbidden)
				return
			}
			joined = true
			_ = json.NewEncoder(w).Encode(gc.Response[gc.Candidate]{Success: true, Data: gc.Candidate{RequestPublicID: "request", State: "published"}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	origin = server.URL
	client, err := NewClient(origin, server.Client().Transport)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	identity := Identity{PrivateKey: private, NamespacePublicID: "namespace", GatewayPublicID: "gateway", RuntimePublicID: "runtime", BindingPublicID: "binding", BindingGeneration: 7}
	result, err := client.Join(context.Background(), identity, gc.RuntimeJoin{RequestPublicID: "request", LocalConsent: true})
	if err != nil || !joined || result.State != "published" {
		t.Fatalf("resume did not complete: %v", err)
	}
	if identity.BindingPublicID != "binding" || identity.BindingGeneration != 7 {
		t.Fatal("join modified the recovery identity")
	}
}

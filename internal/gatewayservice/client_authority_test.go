package gatewayservice

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestClientAuthorityRequiresCurrentPrivateHostProof(t *testing.T) {
	token := strings.Repeat("h", 43)
	server, err := New(Options{StateRoot: t.TempDir(), HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := security.GenerateKeyPair()
	code, err := server.trust.IssueAccessCode()
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := server.trust.PairingChallenge(gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: "nonce", ClientPublicKey: keys.PublicKeyPEM, BindingAudience: "https://gateway.example", AccessCode: code.AccessCode}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))
	complete := gp.PairingCompleteRequest{ProtocolVersion: gp.Version, ClientNonce: "nonce", GatewayNonce: challenge.GatewayNonce, GatewayID: challenge.GatewayID, BindingAudience: "https://gateway.example", ClientKeyID: id}
	proof, _ := security.CanonicalJSON(map[string]any{"protocol_version": gp.Version, "client_nonce": complete.ClientNonce, "gateway_nonce": complete.GatewayNonce, "gateway_id": complete.GatewayID, "binding_audience": complete.BindingAudience, "client_key_id": id})
	complete.Proof, _ = security.SignPayload(keys.PrivateKeyPEM, proof)
	if _, err := server.trust.CompletePairing(complete, false); err != nil {
		t.Fatal(err)
	}
	serial := 0
	request := func(route string, body any, host bool, remote string) *http.Request {
		serial++
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "http://gateway.example"+route, strings.NewReader(string(raw)))
		req.RemoteAddr = remote
		nonce := fmt.Sprintf("request-%d", serial)
		timestamp := time.Now().UnixMilli()
		digest, _ := security.CanonicalJSONDigestFromBytes(raw)
		payload, _ := security.CanonicalJSON(map[string]any{"binding_audience": complete.BindingAudience, "body_digest": digest, "gateway_id": complete.GatewayID, "method": "POST", "nonce": nonce, "protocol_version": gp.Version, "route": route, "timestamp_unix_ms": timestamp})
		signature, _ := security.SignPayload(keys.PrivateKeyPEM, payload)
		req.Header.Set("X-Redeven-Gateway-ID", complete.GatewayID)
		req.Header.Set("X-Redeven-Gateway-Binding-Audience", complete.BindingAudience)
		req.Header.Set("X-Redeven-Client-Key-ID", id)
		req.Header.Set("X-Redeven-Client-Nonce", nonce)
		req.Header.Set("X-Redeven-Request-TS", strconv.FormatInt(timestamp, 10))
		req.Header.Set("X-Redeven-Request-Signature", signature)
		req.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
		req.Header.Set("X-Redeven-Gateway-Managed-Bridge-Token", "forged")
		if host {
			req.Header.Set(HostAdminHeader, token)
		}
		return req
	}
	for _, route := range []string{"/gateway/v5/clients/access-codes", "/gateway/v5/clients/list", "/gateway/v5/clients/revoke", "/gateway/v5/invitations", "/gateway/v5/endpoints", "/gateway/v5/members/remove", "/gateway/v5/policy", "/gateway/v5/cloud/configure", "/gateway/v5/cloud/status"} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request(route, map[string]any{"protocol_version": gp.Version}, false, "127.0.0.1:1234"))
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s: %d %s", route, response.Code, response.Body.String())
		}
	}
	forged := httptest.NewRecorder()
	server.Handler().ServeHTTP(forged, request("/gateway/v5/catalog", map[string]any{"protocol_version": gp.Version, "permissions": gp.GatewayPermissions{Access: true, ManageMembers: true, ConfigureCloud: true}}, false, "127.0.0.1:1234"))
	if forged.Code != http.StatusBadRequest {
		t.Fatal("client supplied permissions accepted")
	}
	public := httptest.NewRecorder()
	server.Handler().ServeHTTP(public, request("/gateway/v5/clients/access-codes", gp.ClientAccessCodeRequest{ProtocolVersion: gp.Version}, true, "192.0.2.2:1234"))
	if public.Code != http.StatusForbidden {
		t.Fatal("host credential accepted on nonlocal request")
	}
	host := request("/gateway/v5/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, true, "127.0.0.1:1234")
	response := httptest.NewRecorder()
	verified, ok := server.authenticated(response, host, &gp.CatalogRequest{})
	if !ok || verified.ClientKeyID != id || !verified.Permissions.ManageMembers {
		t.Fatal("signed host identity was replaced or not verified", response.Body.String())
	}
	host = request("/gateway/v5/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, true, "127.0.0.1:1234")
	host.Header.Set("X-Redeven-Request-Signature", "invalid")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, host)
	if response.Code != http.StatusUnauthorized {
		t.Fatal("host proof bypassed invalid client signature")
	}
	consumer := httptest.NewRecorder()
	server.Handler().ServeHTTP(consumer, request("/gateway/v5/clients/list", gp.ClientListRequest{ProtocolVersion: gp.Version}, false, "127.0.0.1:1234"))
	if consumer.Code != http.StatusForbidden {
		t.Fatal("host proof persisted as client management grant")
	}
}

func TestStaticPairingPermissionsAreRejected(t *testing.T) {
	server, err := New(Options{StateRoot: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{"challenge", "complete"} {
		req := httptest.NewRequest(http.MethodPost, "http://gateway/gateway/v5/pairing/"+route, strings.NewReader(`{"protocol_version":"redeven-gateway-v5","pairing_code":"old","permissions":{"access":true,"manage_members":true}}`))
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, req)
		if response.Code != http.StatusBadRequest {
			t.Fatal("retired authorization accepted", route, response.Code)
		}
	}
}

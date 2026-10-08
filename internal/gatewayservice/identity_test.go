package gatewayservice

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

func TestGatewayAddressProofUsesPersistentMachineKey(t *testing.T) {
	token := strings.Repeat("a", 43)
	root := t.TempDir()
	server, err := New(Options{StateRoot: root, HostAdminToken: token})
	if err != nil {
		t.Fatal(err)
	}
	metadata, _, err := server.trust.GatewayMetadata("")
	if err != nil {
		t.Fatal(err)
	}
	client, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := server.trust.PairingChallenge(gp.PairingChallengeRequest{ProtocolVersion: gp.Version, ClientNonce: "identity-test-client-nonce", ClientPublicKey: client.PublicKeyPEM, BindingAudience: "https://first.example"})
	if err != nil {
		t.Fatal(err)
	}
	public := challenge.GatewayPublicKey
	for _, endpoint := range []string{"https://first.example", "https://second.example"} {
		server, err = New(Options{StateRoot: root, HostAdminToken: token, MemberURL: endpoint})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, endpoint+"/gateway/v5/identity", strings.NewReader(`{"protocol_version":"redeven-gateway-v5","nonce":"caller-challenge-with-entropy"}`))
		request.RemoteAddr = "127.0.0.1:12345"
		request.Header.Set(HostAdminHeader, token)
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatal(response.Code, response.Body.String())
		}
		var result struct {
			Data gp.IdentityResponse `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		proof := result.Data
		signature := proof.Signature
		proof.Signature = ""
		payload, err := security.CanonicalJSON(proof)
		if err != nil {
			t.Fatal(err)
		}
		if proof.GatewayID != metadata.GatewayID || proof.Nonce != "caller-challenge-with-entropy" || !security.VerifySignature(public, payload, signature) {
			t.Fatal("new address did not prove the persistent machine identity")
		}
	}
}

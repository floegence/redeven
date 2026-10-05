package localui

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/runtimeidentity"
)

func TestRuntimeAccessIdentityDoesNotUnlockOrExposeCredentials(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "runtime-secret"})
	s := newTestServer(t, gate)
	s.a = newRuntimeHealthTestAgent(t, s.configPath, gate)
	challenge := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	req := httptest.NewRequest(http.MethodGet, "http://localhost:23998/api/local/runtime/health", nil)
	req.Header.Set("X-Redeven-Runtime-Identity-Challenge", challenge)
	response := httptest.NewRecorder()
	s.networkHandler().ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" || len(response.Result().Cookies()) != 0 {
		t.Fatal("identity proof cached or granted a session")
	}
	var result struct {
		Data struct {
			Identity         runtimeidentity.AccessIdentityProof `json:"access_identity"`
			PasswordRequired bool                                `json:"password_required"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	key, _ := base64.RawURLEncoding.DecodeString(result.Data.Identity.PublicKey)
	signature, _ := base64.RawURLEncoding.DecodeString(result.Data.Identity.Signature)
	if !ed25519.Verify(key, []byte("redeven-runtime-access-v1\n"+challenge), signature) {
		t.Fatal("Runtime health did not prove its state identity")
	}
	if !result.Data.PasswordRequired || s.hasLocalAccess(req) {
		t.Fatal("identity proof changed Runtime authentication")
	}
	s.localUIBridgeToken = "identity-test-private-bridge"
	req.Header.Set(localDesktopBridgeTokenHeader, s.localUIBridgeToken)
	bridge := httptest.NewRecorder()
	s.HandlerForDesktopBridge().ServeHTTP(bridge, req)
	if bridge.Code != http.StatusOK {
		t.Fatal(bridge.Body.String())
	}
	var privateResult struct {
		Data struct {
			Identity runtimeidentity.AccessIdentityProof `json:"access_identity"`
		} `json:"data"`
	}
	if err := json.Unmarshal(bridge.Body.Bytes(), &privateResult); err != nil || privateResult.Data.Identity != result.Data.Identity {
		t.Fatal("public and private routes disagree on Runtime identity")
	}
	req.Header.Set("X-Redeven-Runtime-Identity-Challenge", "bad")
	invalid := httptest.NewRecorder()
	s.networkHandler().ServeHTTP(invalid, req)
	if invalid.Code != http.StatusBadRequest {
		t.Fatal("accepted malformed challenge")
	}
}

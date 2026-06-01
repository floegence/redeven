package localui

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
)

func TestServerRuntimeGatewayRequiresPairingForCatalog(t *testing.T) {
	s := newRuntimeGatewayTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewBufferString(`{"protocol_version":"redeven-runtime-gateway-v1"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
	}
	if strings.Contains(strings.ToLower(res.Body.String()), "token") || strings.Contains(strings.ToLower(res.Body.String()), "proof") {
		t.Fatalf("catalog unauthorized response leaked credential-shaped detail: %s", res.Body.String())
	}
}

func TestServerRuntimeGatewayCatalogAndOpenSessionAfterPairing(t *testing.T) {
	s := newRuntimeGatewayTestServer(t)
	material := pairRuntimeGatewayTestClient(t, s, "http://127.0.0.1:24000/")

	catalogBody := []byte(`{"protocol_version":"redeven-runtime-gateway-v1"}`)
	catalogReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewReader(catalogBody))
	signRuntimeGatewayTestRequest(t, catalogReq, material, catalogBody)
	catalogRes := httptest.NewRecorder()
	s.handler().ServeHTTP(catalogRes, catalogReq)

	if catalogRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("catalog status = %d, want %d; body=%s", catalogRes.Result().StatusCode, http.StatusOK, catalogRes.Body.String())
	}
	var catalogEnvelope struct {
		OK   bool                     `json:"ok"`
		Data protocol.CatalogResponse `json:"data"`
	}
	if err := json.Unmarshal(catalogRes.Body.Bytes(), &catalogEnvelope); err != nil {
		t.Fatalf("catalog json.Unmarshal() error = %v", err)
	}
	if !catalogEnvelope.OK || len(catalogEnvelope.Data.Environments) != 1 {
		t.Fatalf("catalog envelope = %#v", catalogEnvelope)
	}
	if catalogEnvelope.Data.Gateway.GatewayID != material.gatewayID || catalogEnvelope.Data.Gateway.GatewayPublicKeyFingerprint == "" {
		t.Fatalf("catalog gateway metadata = %#v, material = %#v", catalogEnvelope.Data.Gateway, material)
	}
	env := catalogEnvelope.Data.Environments[0]
	if env.GatewayEnvID != LocalEnvPublicID || env.State != protocol.EnvironmentStateAvailable {
		t.Fatalf("catalog env = %#v", env)
	}

	openBody := []byte(`{"protocol_version":"redeven-runtime-gateway-v1","gateway_env_id":"env_local","requested_capability":"env_app","client_nonce":"client-nonce"}`)
	openReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(openBody))
	signRuntimeGatewayTestRequest(t, openReq, material, openBody)
	openRes := httptest.NewRecorder()
	s.handler().ServeHTTP(openRes, openReq)

	if openRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("open-session status = %d, want %d; body=%s", openRes.Result().StatusCode, http.StatusOK, openRes.Body.String())
	}
	var openEnvelope struct {
		OK   bool                         `json:"ok"`
		Data protocol.OpenSessionResponse `json:"data"`
	}
	if err := json.Unmarshal(openRes.Body.Bytes(), &openEnvelope); err != nil {
		t.Fatalf("open json.Unmarshal() error = %v", err)
	}
	if !openEnvelope.OK || openEnvelope.Data.ConnectArtifact.Kind != protocol.ConnectArtifactKindLocalDirect {
		t.Fatalf("open envelope = %#v", openEnvelope)
	}
	if !strings.Contains(openEnvelope.Data.ConnectArtifact.URL, "/_redeven_proxy/env/") {
		t.Fatalf("artifact URL = %q, want Env App entry", openEnvelope.Data.ConnectArtifact.URL)
	}
	if parsed, err := url.Parse(openEnvelope.Data.ConnectArtifact.URL); err != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		t.Fatalf("artifact URL must not carry query or fragment secrets: url=%q err=%v", openEnvelope.Data.ConnectArtifact.URL, err)
	}
	if !verifyRuntimeGatewayArtifact(t, material, openEnvelope.Data, "client-nonce") {
		t.Fatalf("artifact proof did not verify")
	}
}

func TestServerRuntimeGatewayPairingRequiresLocalAccessForURLTransport(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newRuntimeGatewayTestServerWithAccessGate(t, gate)
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/challenge", bytes.NewBufferString(`{
		"protocol_version":"redeven-runtime-gateway-v1",
		"client_nonce":"client-nonce",
		"client_public_key":`+strconv.Quote(keys.PublicKeyPEM)+`,
		"binding_audience":"http://127.0.0.1:24000/"
	}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusLocked {
		t.Fatalf("pairing status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusLocked, res.Body.String())
	}
	if strings.Contains(strings.ToLower(res.Body.String()), "token") || strings.Contains(strings.ToLower(res.Body.String()), "proof") {
		t.Fatalf("pairing locked response leaked credential-shaped detail: %s", res.Body.String())
	}
}

func TestServerRuntimeGatewayDirectArtifactDoesNotCarryLocalAccessResumeToken(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newRuntimeGatewayTestServerWithAccessGate(t, gate)
	unlock, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}
	material := pairRuntimeGatewayTestClient(t, s, "http://127.0.0.1:24000/", unlock.ResumeToken)

	openBody := []byte(`{"protocol_version":"redeven-runtime-gateway-v1","gateway_env_id":"env_local","requested_capability":"env_app","client_nonce":"client-nonce"}`)
	openReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(openBody))
	signRuntimeGatewayTestRequest(t, openReq, material, openBody)
	openRes := httptest.NewRecorder()
	s.handler().ServeHTTP(openRes, openReq)

	if openRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("open-session status = %d, want %d; body=%s", openRes.Result().StatusCode, http.StatusOK, openRes.Body.String())
	}
	var openEnvelope struct {
		OK   bool                         `json:"ok"`
		Data protocol.OpenSessionResponse `json:"data"`
	}
	if err := json.Unmarshal(openRes.Body.Bytes(), &openEnvelope); err != nil {
		t.Fatalf("open json.Unmarshal() error = %v", err)
	}
	parsed, err := url.Parse(openEnvelope.Data.ConnectArtifact.URL)
	if err != nil {
		t.Fatalf("artifact URL parse error = %v", err)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(openEnvelope.Data.ConnectArtifact.URL, unlock.ResumeToken) {
		t.Fatalf("artifact URL carried local access secret: %q", openEnvelope.Data.ConnectArtifact.URL)
	}
}

func TestServerRuntimeGatewayOpenSessionUsesDesktopBridgeArtifactForBridgeTransport(t *testing.T) {
	s := newRuntimeGatewayTestServer(t)
	material := pairRuntimeGatewayTestClient(t, s, "ssh://bastion:22/opt/redeven")

	openBody := []byte(`{"protocol_version":"redeven-runtime-gateway-v1","gateway_env_id":"env_local","requested_capability":"env_app","client_nonce":"client-nonce","bridge_session_id":"ssh:ssh%3A%2F%2Fbastion%3A22%2Fopt%2Fredeven","route_id":"env_app:gw_demo"}`)
	openReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(openBody))
	openReq.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
	signRuntimeGatewayTestRequest(t, openReq, material, openBody)
	openRes := httptest.NewRecorder()
	s.handler().ServeHTTP(openRes, openReq)

	if openRes.Result().StatusCode != http.StatusOK {
		t.Fatalf("open-session status = %d, want %d; body=%s", openRes.Result().StatusCode, http.StatusOK, openRes.Body.String())
	}
	var openEnvelope struct {
		OK   bool                         `json:"ok"`
		Data protocol.OpenSessionResponse `json:"data"`
	}
	if err := json.Unmarshal(openRes.Body.Bytes(), &openEnvelope); err != nil {
		t.Fatalf("open json.Unmarshal() error = %v", err)
	}
	artifact := openEnvelope.Data.ConnectArtifact
	if !openEnvelope.OK || artifact.Kind != protocol.ConnectArtifactKindDesktopBridge {
		t.Fatalf("open envelope = %#v", openEnvelope)
	}
	if artifact.URL != "" || artifact.BridgeSessionID != "ssh:ssh%3A%2F%2Fbastion%3A22%2Fopt%2Fredeven" || artifact.RouteID != "env_app:gw_demo" {
		t.Fatalf("artifact = %#v", artifact)
	}
	if !verifyRuntimeGatewayArtifact(t, material, openEnvelope.Data, "client-nonce") {
		t.Fatalf("artifact proof did not verify")
	}
}

func TestServerRuntimeGatewayRejectsNonceReplay(t *testing.T) {
	s := newRuntimeGatewayTestServer(t)
	material := pairRuntimeGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	body := []byte(`{"protocol_version":"redeven-runtime-gateway-v1"}`)

	for attempt := 0; attempt < 2; attempt++ {
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewReader(body))
		signRuntimeGatewayTestRequestWithNonce(t, req, material, body, "fixed-nonce")
		res := httptest.NewRecorder()
		s.handler().ServeHTTP(res, req)
		if attempt == 0 && res.Result().StatusCode != http.StatusOK {
			t.Fatalf("first catalog status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
		}
		if attempt == 1 && res.Result().StatusCode != http.StatusUnauthorized {
			t.Fatalf("replayed catalog status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
		}
	}
}

type runtimeGatewayTestMaterial struct {
	gatewayID        string
	bindingAudience  string
	clientKeyID      string
	clientPublicKey  string
	clientPrivateKey string
	gatewayPublicKey string
}

func newRuntimeGatewayTestServer(t *testing.T) *Server {
	t.Helper()
	return newRuntimeGatewayTestServerWithAccessGate(t, nil)
}

func newRuntimeGatewayTestServerWithAccessGate(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	s := newTestServer(t, gate)
	s.runtimeGatewayTrust = gatewaytrust.NewStore("")
	s.runtimeGatewayAuth = nil
	return s
}

func pairRuntimeGatewayTestClient(t *testing.T, s *Server, audience string, resumeTokens ...string) runtimeGatewayTestMaterial {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce"
	challenge := runtimeGatewayPairingChallengeViaHTTP(t, s, protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: audience,
	}, resumeTokens...)
	clientPublicKey := strings.TrimSpace(keys.PublicKeyPEM)
	clientKeyID := security.ClientKeyID(clientPublicKey)
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience": audience,
		"client_key_id":    clientKeyID,
		"client_nonce":     clientNonce,
		"gateway_id":       challenge.GatewayID,
		"gateway_nonce":    challenge.GatewayNonce,
		"protocol_version": protocol.Version,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	complete := protocol.PairingCompleteRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		GatewayNonce:    challenge.GatewayNonce,
		GatewayID:       challenge.GatewayID,
		BindingAudience: audience,
		ClientKeyID:     clientKeyID,
		Proof:           proof,
	}
	runtimeGatewayPairingCompleteViaHTTP(t, s, complete, resumeTokens...)
	return runtimeGatewayTestMaterial{
		gatewayID:        challenge.GatewayID,
		bindingAudience:  audience,
		clientKeyID:      clientKeyID,
		clientPublicKey:  keys.PublicKeyPEM,
		clientPrivateKey: keys.PrivateKeyPEM,
		gatewayPublicKey: challenge.GatewayPublicKey,
	}
}

func runtimeGatewayPairingChallengeViaHTTP(t *testing.T, s *Server, req protocol.PairingChallengeRequest, resumeTokens ...string) protocol.PairingChallengeResponse {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	httpReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/challenge", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	if len(resumeTokens) > 0 && strings.TrimSpace(resumeTokens[0]) != "" {
		httpReq.Header.Set(localAccessResumeHeader, strings.TrimSpace(resumeTokens[0]))
	}
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, httpReq)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("pairing challenge status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		OK   bool                              `json:"ok"`
		Data protocol.PairingChallengeResponse `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("pairing challenge json.Unmarshal() error = %v", err)
	}
	if !envelope.OK || strings.TrimSpace(envelope.Data.GatewayID) == "" {
		t.Fatalf("pairing challenge envelope = %#v", envelope)
	}
	return envelope.Data
}

func runtimeGatewayPairingCompleteViaHTTP(t *testing.T, s *Server, req protocol.PairingCompleteRequest, resumeTokens ...string) protocol.PairingCompleteResponse {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	httpReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/complete", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	if len(resumeTokens) > 0 && strings.TrimSpace(resumeTokens[0]) != "" {
		httpReq.Header.Set(localAccessResumeHeader, strings.TrimSpace(resumeTokens[0]))
	}
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, httpReq)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("pairing complete status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		OK   bool                             `json:"ok"`
		Data protocol.PairingCompleteResponse `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("pairing complete json.Unmarshal() error = %v", err)
	}
	if !envelope.OK || strings.TrimSpace(envelope.Data.ClientKeyID) == "" {
		t.Fatalf("pairing complete envelope = %#v", envelope)
	}
	return envelope.Data
}

func signRuntimeGatewayTestRequest(t *testing.T, r *http.Request, material runtimeGatewayTestMaterial, body []byte) {
	t.Helper()
	signRuntimeGatewayTestRequestWithNonce(t, r, material, body, randomRuntimeGatewayNonce(t))
}

func signRuntimeGatewayTestRequestWithNonce(t *testing.T, r *http.Request, material runtimeGatewayTestMaterial, body []byte, nonce string) {
	t.Helper()
	digest, err := security.CanonicalJSONDigestFromBytes(body)
	if err != nil {
		t.Fatalf("CanonicalJSONDigestFromBytes() error = %v", err)
	}
	ts := time.Now().UnixMilli()
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  material.bindingAudience,
		"body_digest":       digest,
		"gateway_id":        material.gatewayID,
		"method":            r.Method,
		"nonce":             nonce,
		"protocol_version":  protocol.Version,
		"route":             r.URL.Path,
		"timestamp_unix_ms": ts,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	signature, err := security.SignPayload(material.clientPrivateKey, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Redeven-Gateway-Binding-Audience", material.bindingAudience)
	r.Header.Set("X-Redeven-Gateway-ID", material.gatewayID)
	r.Header.Set("X-Redeven-Client-Key-ID", material.clientKeyID)
	r.Header.Set("X-Redeven-Client-Nonce", nonce)
	r.Header.Set("X-Redeven-Request-TS", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Redeven-Request-Signature", signature)
}

func randomRuntimeGatewayNonce(t *testing.T) string {
	t.Helper()
	var raw [18]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:])
}

func verifyRuntimeGatewayArtifact(t *testing.T, material runtimeGatewayTestMaterial, resp protocol.OpenSessionResponse, clientNonce string) bool {
	t.Helper()
	payload, err := security.CanonicalJSON(map[string]any{
		"artifact_kind":        string(resp.ConnectArtifact.Kind),
		"artifact_nonce":       resp.ConnectArtifact.ArtifactNonce,
		"artifact_url":         strings.TrimSpace(resp.ConnectArtifact.URL),
		"binding_audience":     material.bindingAudience,
		"bridge_session_id":    strings.TrimSpace(resp.ConnectArtifact.BridgeSessionID),
		"client_nonce":         clientNonce,
		"expires_at_unix_ms":   resp.ConnectArtifact.ExpiresAtUnixMS,
		"gateway_env_id":       resp.GatewayEnvID,
		"gateway_id":           material.gatewayID,
		"gateway_session_id":   resp.GatewaySessionID,
		"protocol_version":     protocol.Version,
		"requested_capability": string(protocol.RequestedCapabilityEnvApp),
		"route_id":             strings.TrimSpace(resp.ConnectArtifact.RouteID),
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	return security.VerifySignature(material.gatewayPublicKey, payload, resp.ConnectArtifact.Proof)
}

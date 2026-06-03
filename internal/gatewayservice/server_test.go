package gatewayservice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

type gatewayTestMaterial struct {
	gatewayID        string
	bindingAudience  string
	clientKeyID      string
	clientPrivateKey string
	gatewayPublicKey string
}

const gatewayTestManagedBridgeToken = "managed-bridge-test-token"

func TestGatewayServiceRequiresPairingForCatalog(t *testing.T) {
	s := newGatewayTestServer(t, false)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewBufferString(`{"protocol_version":"redeven-gateway-v1"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
	}
	assertNoCredentialWords(t, res.Body.String())
}

func TestGatewayServiceRejectsOldRuntimeGatewayProtocol(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	body := []byte(`{"protocol_version":"redeven-runtime-gateway-v1"}`)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()

	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusBadRequest, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "protocol_version") {
		t.Fatalf("body = %s, want protocol_version guidance", res.Body.String())
	}
}

func TestGatewayServiceCatalogDoesNotExposeDefaultHostEnv(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")

	catalog := gatewayCatalogViaHTTP(t, s, material)

	if len(catalog.Environments) != 0 {
		t.Fatalf("catalog environments = %#v, want empty", catalog.Environments)
	}
	if catalog.Gateway.GatewayID != material.gatewayID || catalog.Gateway.GatewayPublicKeyFingerprint == "" {
		t.Fatalf("catalog gateway metadata = %#v, material = %#v", catalog.Gateway, material)
	}
}

func TestGatewayServiceProfileWriteCapabilityRequiresExplicitEnablement(t *testing.T) {
	s := newGatewayTestServerWithOptions(t, Options{
		StateRoot:   t.TempDir(),
		PairingCode: "pair-demo",
	})
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")

	catalog := gatewayCatalogViaHTTP(t, s, material)
	for _, capability := range catalog.Gateway.Capabilities {
		if capability == protocol.GatewayCapabilityEnvProfileWrite {
			t.Fatalf("catalog capabilities = %#v, want no env_profile_write by default", catalog.Gateway.Capabilities)
		}
	}

	body, err := json.Marshal(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_url",
			DisplayName:  "URL Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind: protocol.EnvProfileAccessRouteKindURL,
				URL:  "https://target.example/",
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("profile write status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusForbidden, res.Body.String())
	}
}

func TestGatewayServiceURLPairingRequiresPairingCode(t *testing.T) {
	s := newGatewayTestServer(t, false)
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	body, err := json.Marshal(protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     "pair-client-nonce",
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: "http://127.0.0.1:24000/",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/challenge", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusLocked {
		t.Fatalf("pairing challenge status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusLocked, res.Body.String())
	}
}

func TestGatewayServiceProfileWriteRequiresAuthorizedPairingClient(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClientWithoutProfileWrite(t, s, "http://127.0.0.1:24000/")

	body, err := json.Marshal(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_url",
			DisplayName:  "URL Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind: protocol.EnvProfileAccessRouteKindURL,
				URL:  "https://target.example/",
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("profile write status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusForbidden, res.Body.String())
	}
}

func TestGatewayServiceURLTransportCannotClaimProfileWritePairing(t *testing.T) {
	s := newGatewayTestServer(t, false)
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce"
	audience := "http://127.0.0.1:24000/"
	challenge := gatewayPairingChallengeViaHTTP(t, s, protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: audience,
		PairingCode:     "pair-demo",
	}, false)
	clientKeyID := security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  audience,
		"client_capability": string(protocol.GatewayCapabilityEnvProfileWrite),
		"client_key_id":     clientKeyID,
		"client_nonce":      clientNonce,
		"gateway_id":        challenge.GatewayID,
		"gateway_nonce":     challenge.GatewayNonce,
		"protocol_version":  protocol.Version,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	body, err := json.Marshal(protocol.PairingCompleteRequest{
		ProtocolVersion:  protocol.Version,
		ClientNonce:      clientNonce,
		GatewayNonce:     challenge.GatewayNonce,
		GatewayID:        challenge.GatewayID,
		BindingAudience:  audience,
		ClientKeyID:      clientKeyID,
		ClientCapability: string(protocol.GatewayCapabilityEnvProfileWrite),
		Proof:            proof,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/complete", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("pairing complete status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
	}
}

func TestGatewayServiceManagedModeRejectsSpoofedBridgeProfileWritePairing(t *testing.T) {
	s := newGatewayTestServer(t, true)
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce"
	audience := "ssh://bastion:22/opt/redeven"
	challenge := gatewayPairingChallengeViaHTTP(t, s, protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: audience,
		PairingCode:     "pair-demo",
	}, true)
	clientKeyID := security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))
	payload, err := security.CanonicalJSON(map[string]any{
		"binding_audience":  audience,
		"client_capability": string(protocol.GatewayCapabilityEnvProfileWrite),
		"client_key_id":     clientKeyID,
		"client_nonce":      clientNonce,
		"gateway_id":        challenge.GatewayID,
		"gateway_nonce":     challenge.GatewayNonce,
		"protocol_version":  protocol.Version,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	body, err := json.Marshal(protocol.PairingCompleteRequest{
		ProtocolVersion:  protocol.Version,
		ClientNonce:      clientNonce,
		GatewayNonce:     challenge.GatewayNonce,
		GatewayID:        challenge.GatewayID,
		BindingAudience:  audience,
		ClientKeyID:      clientKeyID,
		ClientCapability: string(protocol.GatewayCapabilityEnvProfileWrite),
		Proof:            proof,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/complete", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("spoofed pairing complete status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
	}
}

func TestGatewayServiceURLServerRejectsSpoofedBridgeProfileWrite(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")

	body, err := json.Marshal(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_url",
			DisplayName:  "URL Env",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind: protocol.EnvProfileAccessRouteKindURL,
				URL:  "https://target.example/",
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
	req.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusForbidden {
		t.Fatalf("profile write status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusForbidden, res.Body.String())
	}
}

func TestGatewayServiceRejectsDefaultHostEnvOpenSession(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	body := []byte(`{"protocol_version":"redeven-gateway-v1","gateway_env_id":"env_local","requested_capability":"env_app","client_nonce":"client-nonce"}`)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()

	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusNotFound, res.Body.String())
	}
	for _, cookie := range res.Result().Cookies() {
		if cookie.Name == envSessionCookieName {
			t.Fatalf("open-session(env_local) set gateway profile session cookie: %#v", cookie)
		}
	}
}

func TestGatewayServiceDirectArtifactDoesNotCarryPairingSecrets(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	openResp, _ := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce")

	parsed, err := url.Parse(openResp.ConnectArtifact.URL)
	if err != nil {
		t.Fatalf("artifact URL parse error = %v", err)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(openResp.ConnectArtifact.URL, material.clientPrivateKey) {
		t.Fatalf("artifact URL carried credential-shaped data: %q", openResp.ConnectArtifact.URL)
	}
	if !verifyGatewayArtifact(t, material, openResp, "client-nonce") {
		t.Fatalf("artifact proof did not verify")
	}
}

func TestGatewayServiceBridgeArtifactRequiresServerTransportMode(t *testing.T) {
	urlService := newGatewayTestServer(t, false)
	urlMaterial := pairGatewayTestClient(t, urlService, "ssh://bastion:22/opt/redeven")
	seedGatewayProfile(t, urlService, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	urlResp := openGatewayEnvWithBridgeFieldsViaHTTP(t, urlService, urlMaterial, "env_url", true)
	if urlResp.ConnectArtifact.Kind != protocol.ConnectArtifactKindLocalDirect {
		t.Fatalf("header-forced URL transport artifact = %#v, want local direct", urlResp.ConnectArtifact)
	}

	bridgeService := newGatewayTestServer(t, true)
	bridgeMaterial := pairGatewayTestManagementClient(t, bridgeService, "ssh://bastion:22/opt/redeven")
	upsertGatewayProfileViaHTTP(t, bridgeService, bridgeMaterial, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})
	bridgeResp := openGatewayEnvWithBridgeFieldsViaHTTP(t, bridgeService, bridgeMaterial, "env_url", true)
	if bridgeResp.ConnectArtifact.Kind != protocol.ConnectArtifactKindDesktopBridge {
		t.Fatalf("bridge transport artifact = %#v, want desktop bridge", bridgeResp.ConnectArtifact)
	}
	if bridgeResp.ConnectArtifact.URL != "" ||
		bridgeResp.ConnectArtifact.BridgeSessionID != "ssh:ssh%3A%2F%2Fbastion%3A22%2Fopt%2Fredeven" ||
		bridgeResp.ConnectArtifact.RouteID != "env_app:gw_demo" {
		t.Fatalf("bridge artifact = %#v", bridgeResp.ConnectArtifact)
	}
	if !verifyGatewayArtifact(t, bridgeMaterial, bridgeResp, "client-nonce") {
		t.Fatalf("bridge artifact proof did not verify")
	}
}

func TestGatewayServiceProfileCatalogOpenAndDeleteRevokesProxySession(t *testing.T) {
	s := newGatewayTestServer(t, true)
	audience := "ssh://bastion:22/opt/redeven"
	managementMaterial := pairGatewayTestManagementClient(t, s, audience)
	accessMaterial := pairGatewayTestClient(t, s, audience)

	upsertResp := upsertGatewayProfileViaHTTP(t, s, managementMaterial, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind:        protocol.EnvProfileAccessRouteKindURL,
			URL:         "https://target.example/",
			OriginLabel: "Target",
		},
	})
	if upsertResp.Environment.Profile == nil || !upsertResp.Environment.Profile.Managed {
		t.Fatalf("upsert profile marker = %#v", upsertResp.Environment.Profile)
	}
	if upsertResp.Environment.ProfileAccessRoute == nil || upsertResp.Environment.ProfileAccessRoute.URL != "https://target.example/" {
		t.Fatalf("catalog access route = %#v", upsertResp.Environment.ProfileAccessRoute)
	}

	managementCatalog := gatewayManagementCatalogViaHTTP(t, s, managementMaterial)
	if len(managementCatalog.Environments) != 1 || managementCatalog.Environments[0].ProfileAccessRoute == nil {
		t.Fatalf("management catalog environments = %#v, want editable route", managementCatalog.Environments)
	}

	catalog := gatewayCatalogViaHTTP(t, s, accessMaterial)
	if len(catalog.Environments) != 1 || catalog.Environments[0].GatewayEnvID != "env_url" {
		t.Fatalf("catalog environments = %#v", catalog.Environments)
	}
	env := catalog.Environments[0]
	if env.Profile == nil || !env.Profile.Managed || env.Profile.AccessRouteKind != protocol.EnvProfileAccessRouteKindURL {
		t.Fatalf("catalog env profile marker = %#v", env.Profile)
	}
	if env.ProfileAccessRoute != nil {
		t.Fatalf("access catalog leaked editable route = %#v", env.ProfileAccessRoute)
	}

	_, cookies := openGatewayEnvViaHTTP(t, s, accessMaterial, "env_url", "client-nonce")
	proxyReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/api/local/runtime/health", nil)
	for _, cookie := range cookies {
		proxyReq.AddCookie(cookie)
	}
	proxyRes := httptest.NewRecorder()
	s.Handler().ServeHTTP(proxyRes, proxyReq)
	if proxyRes.Result().StatusCode != http.StatusOK || !strings.Contains(proxyRes.Body.String(), `"proxied":true`) {
		t.Fatalf("proxy status = %d body=%s", proxyRes.Result().StatusCode, proxyRes.Body.String())
	}

	deleteResp := deleteGatewayProfileViaHTTP(t, s, managementMaterial, "env_url")
	if !deleteResp.Deleted {
		t.Fatalf("delete response = %#v", deleteResp)
	}
	staleProxyReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/api/local/runtime/health", nil)
	for _, cookie := range cookies {
		staleProxyReq.AddCookie(cookie)
	}
	staleProxyRes := httptest.NewRecorder()
	s.Handler().ServeHTTP(staleProxyRes, staleProxyReq)
	if staleProxyRes.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("stale proxy status = %d, want %d; body=%s", staleProxyRes.Result().StatusCode, http.StatusUnauthorized, staleProxyRes.Body.String())
	}
	for _, cookie := range staleProxyRes.Result().Cookies() {
		if cookie.Name == envSessionCookieName && cookie.MaxAge >= 0 {
			t.Fatalf("stale proxy did not clear profile session cookie: %#v", cookie)
		}
	}
}

func TestGatewayServiceProfileUpsertRevokesExistingProxySession(t *testing.T) {
	s := newGatewayTestServer(t, true)
	audience := "ssh://bastion:22/opt/redeven"
	managementMaterial := pairGatewayTestManagementClient(t, s, audience)
	accessMaterial := pairGatewayTestClient(t, s, audience)

	upsertGatewayProfileViaHTTP(t, s, managementMaterial, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})
	_, cookies := openGatewayEnvViaHTTP(t, s, accessMaterial, "env_url", "client-nonce")

	upsertGatewayProfileViaHTTP(t, s, managementMaterial, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env Updated",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://updated.example/",
		},
	})

	staleProxyReq := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000/api/local/runtime/health", nil)
	for _, cookie := range cookies {
		staleProxyReq.AddCookie(cookie)
	}
	staleProxyRes := httptest.NewRecorder()
	s.Handler().ServeHTTP(staleProxyRes, staleProxyReq)
	if staleProxyRes.Result().StatusCode != http.StatusUnauthorized {
		t.Fatalf("stale proxy after upsert status = %d, want %d; body=%s", staleProxyRes.Result().StatusCode, http.StatusUnauthorized, staleProxyRes.Body.String())
	}
}

func TestGatewayServiceRejectsUnsafeURLProfileTargets(t *testing.T) {
	s := newGatewayTestServerWithOptions(t, Options{
		StateRoot:              t.TempDir(),
		DesktopBridgeTransport: true,
		ProfileWriteEnabled:    true,
		PairingCode:            "pair-demo",
		ManagedBridgeToken:     gatewayTestManagedBridgeToken,
	})
	material := pairGatewayTestManagementClient(t, s, "ssh://bastion:22/opt/redeven")

	body, err := json.Marshal(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{
			GatewayEnvID: "env_loopback",
			DisplayName:  "Loopback",
			AccessRoute: protocol.EnvProfileAccessRoute{
				Kind: protocol.EnvProfileAccessRouteKindURL,
				URL:  "http://127.0.0.1:24000/",
			},
		},
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
	setManagedBridgeHeaders(req)
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("unsafe URL profile status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusBadRequest, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "not allowed") {
		t.Fatalf("unsafe URL profile body = %s, want policy guidance", res.Body.String())
	}
}

func TestGatewayServiceRejectsNonceReplay(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	body := []byte(`{"protocol_version":"redeven-gateway-v1"}`)

	for attempt := 0; attempt < 2; attempt++ {
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewReader(body))
		signGatewayTestRequestWithNonce(t, req, material, body, "fixed-nonce")
		res := httptest.NewRecorder()
		s.Handler().ServeHTTP(res, req)
		if attempt == 0 && res.Result().StatusCode != http.StatusOK {
			t.Fatalf("first catalog status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
		}
		if attempt == 1 && res.Result().StatusCode != http.StatusUnauthorized {
			t.Fatalf("replayed catalog status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusUnauthorized, res.Body.String())
		}
	}
}

func newGatewayTestServer(t *testing.T, desktopBridgeTransport bool) *Server {
	t.Helper()
	s := newGatewayTestServerWithOptions(t, Options{
		StateRoot:                  t.TempDir(),
		DesktopBridgeTransport:     desktopBridgeTransport,
		AllowPrivateProfileTargets: true,
		ProfileWriteEnabled:        true,
		PairingCode:                "pair-demo",
		ManagedBridgeToken:         gatewayTestManagedBridgeToken,
	})
	s.proxyTransport = localTestProxyTransport()
	return s
}

func newGatewayTestServerWithOptions(t *testing.T, options Options) *Server {
	t.Helper()
	s, err := New(options)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	return s
}

func localTestProxyTransport() http.RoundTripper {
	return roundTripFunc(func(req *http.Request) (*http.Response, error) {
		w := httptest.NewRecorder()
		if req.URL.Path != "/api/local/runtime/health" {
			http.NotFound(w, req)
		} else {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"proxied":true}`)
		}
		return w.Result(), nil
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return fn(r)
}

func pairGatewayTestClient(t *testing.T, s *Server, audience string) gatewayTestMaterial {
	t.Helper()
	return pairGatewayTestClientWithOptions(t, s, audience, false, false)
}

func pairGatewayTestClientWithoutProfileWrite(t *testing.T, s *Server, audience string) gatewayTestMaterial {
	t.Helper()
	return pairGatewayTestClientWithOptions(t, s, audience, false, false)
}

func pairGatewayTestManagementClient(t *testing.T, s *Server, audience string) gatewayTestMaterial {
	t.Helper()
	return pairGatewayTestClientWithOptions(t, s, audience, true, true)
}

func pairGatewayTestClientWithOptions(t *testing.T, s *Server, audience string, profileWrite bool, bridgeTransport bool) gatewayTestMaterial {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	clientNonce := "pair-client-nonce"
	challenge := gatewayPairingChallengeViaHTTP(t, s, protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     clientNonce,
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: audience,
		PairingCode:     "pair-demo",
	}, bridgeTransport)
	clientPublicKey := strings.TrimSpace(keys.PublicKeyPEM)
	clientKeyID := security.ClientKeyID(clientPublicKey)
	payloadFields := map[string]any{
		"binding_audience": audience,
		"client_key_id":    clientKeyID,
		"client_nonce":     clientNonce,
		"gateway_id":       challenge.GatewayID,
		"gateway_nonce":    challenge.GatewayNonce,
		"protocol_version": protocol.Version,
	}
	if profileWrite {
		payloadFields["client_capability"] = string(protocol.GatewayCapabilityEnvProfileWrite)
	}
	payload, err := security.CanonicalJSON(payloadFields)
	if err != nil {
		t.Fatalf("CanonicalJSON() error = %v", err)
	}
	proof, err := security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatalf("SignPayload() error = %v", err)
	}
	clientCapability := ""
	if profileWrite {
		clientCapability = string(protocol.GatewayCapabilityEnvProfileWrite)
	}
	gatewayPairingCompleteViaHTTP(t, s, protocol.PairingCompleteRequest{
		ProtocolVersion:  protocol.Version,
		ClientNonce:      clientNonce,
		GatewayNonce:     challenge.GatewayNonce,
		GatewayID:        challenge.GatewayID,
		BindingAudience:  audience,
		ClientKeyID:      clientKeyID,
		ClientCapability: clientCapability,
		Proof:            proof,
	}, bridgeTransport)
	return gatewayTestMaterial{
		gatewayID:        challenge.GatewayID,
		bindingAudience:  audience,
		clientKeyID:      clientKeyID,
		clientPrivateKey: keys.PrivateKeyPEM,
		gatewayPublicKey: challenge.GatewayPublicKey,
	}
}

func gatewayPairingChallengeViaHTTP(t *testing.T, s *Server, req protocol.PairingChallengeRequest, bridgeTransport bool) protocol.PairingChallengeResponse {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	httpReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/challenge", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	if bridgeTransport {
		setManagedBridgeHeaders(httpReq)
	}
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, httpReq)
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

func gatewayPairingCompleteViaHTTP(t *testing.T, s *Server, req protocol.PairingCompleteRequest, bridgeTransport bool) protocol.PairingCompleteResponse {
	t.Helper()
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	httpReq := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/complete", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	if bridgeTransport {
		setManagedBridgeHeaders(httpReq)
	}
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, httpReq)
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

func gatewayCatalogViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial) protocol.CatalogResponse {
	t.Helper()
	return gatewayCatalogViaHTTPWithTransport(t, s, material, false)
}

func gatewayManagementCatalogViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial) protocol.CatalogResponse {
	t.Helper()
	return gatewayCatalogViaHTTPWithTransport(t, s, material, true)
}

func gatewayCatalogViaHTTPWithTransport(t *testing.T, s *Server, material gatewayTestMaterial, bridgeTransport bool) protocol.CatalogResponse {
	t.Helper()
	body := []byte(`{"protocol_version":"redeven-gateway-v1"}`)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/catalog", bytes.NewReader(body))
	if bridgeTransport {
		setManagedBridgeHeaders(req)
	}
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("catalog status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		OK   bool                     `json:"ok"`
		Data protocol.CatalogResponse `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("catalog json.Unmarshal() error = %v", err)
	}
	if !envelope.OK {
		t.Fatalf("catalog envelope = %#v", envelope)
	}
	return envelope.Data
}

func upsertGatewayProfileViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial, profile protocol.EnvProfileInput) protocol.EnvProfileUpsertResponse {
	t.Helper()
	return upsertGatewayProfileViaHTTPWithTransport(t, s, material, profile, true)
}

func upsertGatewayProfileViaHTTPWithTransport(t *testing.T, s *Server, material gatewayTestMaterial, profile protocol.EnvProfileInput, bridgeTransport bool) protocol.EnvProfileUpsertResponse {
	t.Helper()
	body, err := json.Marshal(protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile:         profile,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
	if bridgeTransport {
		setManagedBridgeHeaders(req)
	}
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("upsert profile status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		OK   bool                              `json:"ok"`
		Data protocol.EnvProfileUpsertResponse `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("upsert profile json.Unmarshal() error = %v", err)
	}
	if !envelope.OK {
		t.Fatalf("upsert profile envelope = %#v", envelope)
	}
	return envelope.Data
}

func deleteGatewayProfileViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string) protocol.EnvProfileDeleteResponse {
	t.Helper()
	return deleteGatewayProfileViaHTTPWithTransport(t, s, material, gatewayEnvID, true)
}

func deleteGatewayProfileViaHTTPWithTransport(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string, bridgeTransport bool) protocol.EnvProfileDeleteResponse {
	t.Helper()
	body, err := json.Marshal(protocol.EnvProfileDeleteRequest{
		ProtocolVersion: protocol.Version,
		GatewayEnvID:    gatewayEnvID,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/delete", bytes.NewReader(body))
	if bridgeTransport {
		setManagedBridgeHeaders(req)
	}
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("delete profile status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	var envelope struct {
		OK   bool                              `json:"ok"`
		Data protocol.EnvProfileDeleteResponse `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("delete profile json.Unmarshal() error = %v", err)
	}
	if !envelope.OK {
		t.Fatalf("delete profile envelope = %#v", envelope)
	}
	return envelope.Data
}

func seedGatewayProfile(t *testing.T, s *Server, profile protocol.EnvProfileInput) protocol.Environment {
	t.Helper()
	env, err := s.profileStore().Upsert(context.Background(), protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile:         profile,
	})
	if err != nil {
		t.Fatalf("seed profile error = %v", err)
	}
	return env
}

func openGatewayEnvViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string, clientNonce string) (protocol.OpenSessionResponse, []*http.Cookie) {
	t.Helper()
	body, err := json.Marshal(protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        gatewayEnvID,
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         clientNonce,
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("open session status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	return decodeOpenSessionEnvelope(t, res.Body.Bytes()), res.Result().Cookies()
}

func openGatewayEnvWithBridgeFieldsViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string, spoofBridgeHeader bool) protocol.OpenSessionResponse {
	t.Helper()
	body, err := json.Marshal(protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        gatewayEnvID,
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         "client-nonce",
		BridgeSessionID:     "ssh:ssh%3A%2F%2Fbastion%3A22%2Fopt%2Fredeven",
		RouteID:             "env_app:gw_demo",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(body))
	if spoofBridgeHeader {
		setManagedBridgeHeaders(req)
	}
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)
	if res.Result().StatusCode != http.StatusOK {
		t.Fatalf("open session status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusOK, res.Body.String())
	}
	return decodeOpenSessionEnvelope(t, res.Body.Bytes())
}

func setManagedBridgeHeaders(r *http.Request) {
	r.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
	r.Header.Set("X-Redeven-Gateway-Managed-Bridge-Token", gatewayTestManagedBridgeToken)
}

func decodeOpenSessionEnvelope(t *testing.T, body []byte) protocol.OpenSessionResponse {
	t.Helper()
	var envelope struct {
		OK   bool                         `json:"ok"`
		Data protocol.OpenSessionResponse `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("open session json.Unmarshal() error = %v", err)
	}
	if !envelope.OK {
		t.Fatalf("open session envelope = %#v", envelope)
	}
	return envelope.Data
}

func signGatewayTestRequest(t *testing.T, r *http.Request, material gatewayTestMaterial, body []byte) {
	t.Helper()
	signGatewayTestRequestWithNonce(t, r, material, body, randomGatewayNonce(t))
}

func signGatewayTestRequestWithNonce(t *testing.T, r *http.Request, material gatewayTestMaterial, body []byte, nonce string) {
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

func randomGatewayNonce(t *testing.T) string {
	t.Helper()
	var raw [18]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:])
}

func verifyGatewayArtifact(t *testing.T, material gatewayTestMaterial, resp protocol.OpenSessionResponse, clientNonce string) bool {
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

func assertNoCredentialWords(t *testing.T, body string) {
	t.Helper()
	lower := strings.ToLower(body)
	for _, needle := range []string{"token", "proof", "password", "secret", "private_key", "signature"} {
		if strings.Contains(lower, needle) {
			t.Fatalf("response leaked credential-shaped detail %q: %s", needle, body)
		}
	}
}

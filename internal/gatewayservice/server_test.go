package gatewayservice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	gatewaytrust "github.com/floegence/redeven/internal/runtimegateway/trust"
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

func TestGatewayServiceRejectsUnknownPairingClientCapability(t *testing.T) {
	s := newGatewayTestServer(t, false)
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair() error = %v", err)
	}
	audience := "http://127.0.0.1:24000/"
	challenge := gatewayPairingChallengeViaHTTP(t, s, protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version,
		ClientNonce:     "pair-client-nonce",
		ClientPublicKey: strings.TrimSpace(keys.PublicKeyPEM),
		BindingAudience: audience,
		PairingCode:     "pair-demo",
	}, false)
	body, err := json.Marshal(protocol.PairingCompleteRequest{
		ProtocolVersion:  protocol.Version,
		ClientNonce:      "pair-client-nonce",
		GatewayNonce:     challenge.GatewayNonce,
		GatewayID:        challenge.GatewayID,
		BindingAudience:  audience,
		ClientKeyID:      security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM)),
		ClientCapability: "files",
		Proof:            "unused",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/pairing/complete", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode != http.StatusBadRequest {
		t.Fatalf("pairing complete status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusBadRequest, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "client_capability") {
		t.Fatalf("body = %s, want client_capability guidance", res.Body.String())
	}
}

func TestGatewayServiceRejectsSchemaInvalidProfileRoutes(t *testing.T) {
	s := newGatewayTestServer(t, true)
	material := pairGatewayTestManagementClient(t, s, "ssh://bastion:22/opt/redeven")

	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{
			name: "url route with ssh field",
			body: `{"protocol_version":"redeven-gateway-v1","profile":{"display_name":"URL Env","access_route":{"kind":"url","url":"https://target.example/","ssh_destination":"devbox"}}}`,
			want: "access_route",
		},
		{
			name: "ssh secret",
			body: `{"protocol_version":"redeven-gateway-v1","profile":{"display_name":"SSH Env","access_route":{"kind":"ssh_host","ssh_destination":"devbox","auth_mode":"key_agent"},"ssh_secret":{"mode":"replace","password":"secret"}}}`,
			want: "ssh_secret",
		},
		{
			name: "ssh password auth",
			body: `{"protocol_version":"redeven-gateway-v1","profile":{"display_name":"SSH Env","access_route":{"kind":"ssh_host","ssh_destination":"devbox","auth_mode":"password"}}}`,
			want: "password auth",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte(tc.body)
			req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/env-profiles/upsert", bytes.NewReader(body))
			setManagedBridgeHeaders(req)
			signGatewayTestRequest(t, req, material, body)
			res := httptest.NewRecorder()
			s.Handler().ServeHTTP(res, req)

			if res.Result().StatusCode != http.StatusBadRequest {
				t.Fatalf("profile upsert status = %d, want %d; body=%s", res.Result().StatusCode, http.StatusBadRequest, res.Body.String())
			}
			if !strings.Contains(res.Body.String(), tc.want) {
				t.Fatalf("body = %s, want %q guidance", res.Body.String(), tc.want)
			}
		})
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
	if got := res.Result().Header.Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("open-session(env_local) set cookies: %#v", got)
	}
}

func TestGatewayServiceControlListenerDoesNotServeProfileProxyPaths(t *testing.T) {
	s := newGatewayTestServer(t, false)
	for _, path := range []string{
		"/_redeven_proxy/env/",
		"/_redeven_direct/env/",
		"/api/local/runtime/health",
	} {
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:24000"+path, nil)
		res := httptest.NewRecorder()

		s.Handler().ServeHTTP(res, req)

		if res.Result().StatusCode != http.StatusNotFound {
			t.Fatalf("%s status = %d, want %d; body=%s", path, res.Result().StatusCode, http.StatusNotFound, res.Body.String())
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

	openResp := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce")

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

func TestGatewayServiceProfileCatalogOpenAndDeleteRevokesProfileSession(t *testing.T) {
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

	openResp := openGatewayEnvViaHTTP(t, s, accessMaterial, "env_url", "client-nonce")
	proxyStatus, proxyBody, _ := getProfileArtifactURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	if proxyStatus != http.StatusOK || !strings.Contains(proxyBody, `"proxied":true`) {
		t.Fatalf("proxy status = %d body=%s", proxyStatus, proxyBody)
	}

	deleteResp := deleteGatewayProfileViaHTTP(t, s, managementMaterial, "env_url")
	if !deleteResp.Deleted {
		t.Fatalf("delete response = %#v", deleteResp)
	}
	if err := getProfileArtifactURLError(openResp.ConnectArtifact.URL, "/api/local/runtime/health"); err == nil {
		t.Fatal("stale profile session URL remained reachable after delete")
	}
}

func TestGatewayServiceProfileUpsertRevokesExistingProfileSession(t *testing.T) {
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
	openResp := openGatewayEnvViaHTTP(t, s, accessMaterial, "env_url", "client-nonce")

	upsertGatewayProfileViaHTTP(t, s, managementMaterial, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env Updated",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://updated.example/",
		},
	})

	if err := getProfileArtifactURLError(openResp.ConnectArtifact.URL, "/api/local/runtime/health"); err == nil {
		t.Fatal("stale profile session URL remained reachable after upsert")
	}
}

func TestGatewayServiceProfileSessionRequiresArtifactPathSecret(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	upstreamHits := 0
	s.proxyTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamHits++
		w := httptest.NewRecorder()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
		return w.Result(), nil
	})
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	openResult := openGatewayEnvViaHTTPWithControlBase(t, s, material, "env_url", "client-nonce")
	openResp := openResult.Response
	parsed, err := url.Parse(openResp.ConnectArtifact.URL)
	if err != nil {
		t.Fatalf("artifact URL parse error = %v", err)
	}
	controlURL, err := url.Parse(openResult.ControlBaseURL)
	if err != nil {
		t.Fatalf("control URL parse error = %v", err)
	}
	if !strings.HasPrefix(parsed.Path, "/_redeven_profile/") {
		t.Fatalf("artifact URL path = %q, want profile access path", parsed.Path)
	}
	if parsed.Scheme != controlURL.Scheme || parsed.Host == controlURL.Host {
		t.Fatalf("artifact URL origin = %s://%s, want different port from control origin %s://%s", parsed.Scheme, parsed.Host, controlURL.Scheme, controlURL.Host)
	}

	status, body, _ := getProfileArtifactAbsoluteURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", map[string]string{
		"Referer": "http://" + parsed.Host + "/without-profile-access/",
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("direct path status = %d, want %d; body=%s", status, http.StatusUnauthorized, body)
	}
	if upstreamHits != 0 {
		t.Fatalf("direct path reached upstream %d time(s)", upstreamHits)
	}

	status, body, _ = getProfileArtifactURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	if status != http.StatusOK || !strings.Contains(body, `"ok":true`) {
		t.Fatalf("artifact path status = %d body=%s", status, body)
	}
	status, body, _ = getProfileArtifactAbsoluteURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", map[string]string{
		"Referer":        openResp.ConnectArtifact.URL,
		"Sec-Fetch-Site": "same-origin",
	})
	if status != http.StatusOK || !strings.Contains(body, `"ok":true`) {
		t.Fatalf("same-origin absolute path status = %d body=%s", status, body)
	}
}

func TestGatewayServiceProfileSessionKeepsBrowserAndTargetCookiesIsolated(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	upstreamCookies := []string{}
	upstreamAuthorization := []string{}
	s.proxyTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamCookies = append(upstreamCookies, req.Header.Get("Cookie"))
		upstreamAuthorization = append(upstreamAuthorization, req.Header.Get("Authorization"))
		w := httptest.NewRecorder()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "target_session=jar-value; Path=/; HttpOnly")
		w.Header().Set("Service-Worker-Allowed", "/")
		_, _ = io.WriteString(w, `{"ok":true}`)
		return w.Result(), nil
	})
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	openResp := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce")
	status, body, headers := getProfileArtifactURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", map[string]string{
		"Cookie":        "browser_cookie=must-not-forward",
		"Authorization": "Bearer browser-token",
	})
	if status != http.StatusOK {
		t.Fatalf("first proxy status = %d body=%s", status, body)
	}
	if got := upstreamCookies[0]; got != "" {
		t.Fatalf("first upstream cookie = %q, want no browser cookie", got)
	}
	if got := upstreamAuthorization[0]; got != "" {
		t.Fatalf("first upstream authorization = %q, want stripped", got)
	}
	if got := headers.Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("browser received target Set-Cookie: %#v", got)
	}
	if got := headers.Get("Service-Worker-Allowed"); got != "" {
		t.Fatalf("browser received Service-Worker-Allowed = %q, want stripped", got)
	}
	if !headerValuesContain(headers.Values("Content-Security-Policy"), "worker-src 'none'") {
		t.Fatalf("Content-Security-Policy values = %#v, want worker-src block", headers.Values("Content-Security-Policy"))
	}

	status, body, _ = getProfileArtifactURL(t, openResp.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	if status != http.StatusOK {
		t.Fatalf("second proxy status = %d body=%s", status, body)
	}
	if len(upstreamCookies) != 2 || upstreamCookies[1] != "target_session=jar-value" {
		t.Fatalf("second upstream cookies = %#v, want server-side jar cookie only", upstreamCookies)
	}
}

func TestGatewayServiceProfileSessionExpiresWithSignedArtifact(t *testing.T) {
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

	openResp := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce")
	session := onlyProfileSession(t, s)
	if session.ExpiresAtUnixMS != openResp.ConnectArtifact.ExpiresAtUnixMS {
		t.Fatalf("profile session expiry = %d, want signed artifact expiry %d", session.ExpiresAtUnixMS, openResp.ConnectArtifact.ExpiresAtUnixMS)
	}

	s.profileSessionsMu.Lock()
	session.ExpiresAtUnixMS = time.Now().Add(-time.Second).UnixMilli()
	s.profileSessionsMu.Unlock()
	s.sweepExpired()

	if err := getProfileArtifactURLError(openResp.ConnectArtifact.URL, "/api/local/runtime/health"); err == nil {
		t.Fatal("expired profile session URL remained reachable after sweep")
	}
}

func TestGatewayServiceMainServerCloseClosesProfileSessions(t *testing.T) {
	s := newGatewayTestServer(t, false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv, _, err := s.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})
	openResp := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce")
	if got := profileSessionCount(s); got != 1 {
		t.Fatalf("profile session count = %d, want 1", got)
	}

	if err := srv.Close(); err != nil {
		t.Fatalf("server Close() error = %v", err)
	}
	waitForProfileSessionCount(t, s, 0)
	if err := getProfileArtifactURLError(openResp.ConnectArtifact.URL, "/api/local/runtime/health"); err == nil {
		t.Fatal("profile session URL remained reachable after main server Close")
	}
}

func TestGatewayServiceProfileSessionCookieJarsArePerOpenSession(t *testing.T) {
	s := newGatewayTestServer(t, false)
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	upstreamCookies := []string{}
	s.proxyTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamCookies = append(upstreamCookies, req.Header.Get("Cookie"))
		w := httptest.NewRecorder()
		w.Header().Set("Content-Type", "application/json")
		if req.Header.Get("Cookie") == "" {
			w.Header().Set("Set-Cookie", "target_session=jar-value; Path=/; HttpOnly")
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
		return w.Result(), nil
	})
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	first := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce-1")
	second := openGatewayEnvViaHTTP(t, s, material, "env_url", "client-nonce-2")
	if first.ConnectArtifact.URL == second.ConnectArtifact.URL {
		t.Fatalf("two open-session artifacts reused the same URL: %q", first.ConnectArtifact.URL)
	}
	getProfileArtifactURL(t, first.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	getProfileArtifactURL(t, first.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	getProfileArtifactURL(t, second.ConnectArtifact.URL, "/api/local/runtime/health", nil)
	if len(upstreamCookies) != 3 {
		t.Fatalf("upstream cookies = %#v", upstreamCookies)
	}
	if upstreamCookies[0] != "" || upstreamCookies[1] != "target_session=jar-value" || upstreamCookies[2] != "" {
		t.Fatalf("upstream cookies = %#v, want per-session jar isolation", upstreamCookies)
	}
}

func TestGatewayServiceBridgeOpenSessionDoesNotCreateProfileListener(t *testing.T) {
	s := newGatewayTestServer(t, true)
	material := pairGatewayTestManagementClient(t, s, "ssh://bastion:22/opt/redeven")
	upsertGatewayProfileViaHTTP(t, s, material, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})

	resp := openGatewayEnvWithBridgeFieldsViaHTTP(t, s, material, "env_url", true)

	if resp.ConnectArtifact.Kind != protocol.ConnectArtifactKindDesktopBridge {
		t.Fatalf("artifact = %#v, want desktop bridge", resp.ConnectArtifact)
	}
	if resp.ConnectArtifact.URL != "" {
		t.Fatalf("bridge artifact URL = %q, want empty", resp.ConnectArtifact.URL)
	}
	if got := profileSessionCount(s); got != 0 {
		t.Fatalf("profile session count = %d, want 0", got)
	}
}

func TestGatewayServiceProfileSessionSigningFailureClosesListener(t *testing.T) {
	stateRoot := t.TempDir()
	s := newGatewayTestServerWithOptions(t, Options{
		StateRoot:                  stateRoot,
		AllowPrivateProfileTargets: true,
		ProfileWriteEnabled:        true,
		PairingCode:                "pair-demo",
		ManagedBridgeToken:         gatewayTestManagedBridgeToken,
	})
	material := pairGatewayTestClient(t, s, "http://127.0.0.1:24000/")
	seedGatewayProfile(t, s, protocol.EnvProfileInput{
		GatewayEnvID: "env_url",
		DisplayName:  "URL Env",
		AccessRoute: protocol.EnvProfileAccessRoute{
			Kind: protocol.EnvProfileAccessRouteKindURL,
			URL:  "https://target.example/",
		},
	})
	s.trust = gatewayTrustStoreWithInvalidPrivateKey(t, stateRoot)
	s.auth = nil

	body, err := json.Marshal(protocol.OpenSessionRequest{
		ProtocolVersion:     protocol.Version,
		GatewayEnvID:        "env_url",
		RequestedCapability: protocol.RequestedCapabilityEnvApp,
		ClientNonce:         "client-nonce",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:24000/gateway/v1/open-session", bytes.NewReader(body))
	signGatewayTestRequest(t, req, material, body)
	res := httptest.NewRecorder()

	s.Handler().ServeHTTP(res, req)

	if res.Result().StatusCode == http.StatusOK {
		t.Fatalf("open session status = %d, want failure; body=%s", res.Result().StatusCode, res.Body.String())
	}
	if got := profileSessionCount(s); got != 0 {
		t.Fatalf("profile session count = %d, want 0", got)
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
	t.Cleanup(s.closeAllProfileSessions)
	return s
}

func profileSessionCount(s *Server) int {
	if s == nil {
		return 0
	}
	s.profileSessionsMu.Lock()
	defer s.profileSessionsMu.Unlock()
	return len(s.profileSessions)
}

func onlyProfileSession(t *testing.T, s *Server) *profileSession {
	t.Helper()
	s.profileSessionsMu.Lock()
	defer s.profileSessionsMu.Unlock()
	if len(s.profileSessions) != 1 {
		t.Fatalf("profile session count = %d, want 1", len(s.profileSessions))
	}
	for _, session := range s.profileSessions {
		if session == nil {
			t.Fatal("profile session is nil")
		}
		return session
	}
	t.Fatal("profile session is missing")
	return nil
}

func waitForProfileSessionCount(t *testing.T, s *Server, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		if got := profileSessionCount(s); got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("profile session count = %d, want %d", profileSessionCount(s), want)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func gatewayTrustStoreWithInvalidPrivateKey(t *testing.T, stateRoot string) *gatewaytrust.Store {
	t.Helper()
	path := filepath.Join(stateRoot, "gateway-trust.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", path, err)
	}
	var state map[string]any
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("trust state json.Unmarshal() error = %v", err)
	}
	gateway, ok := state["gateway"].(map[string]any)
	if !ok {
		t.Fatalf("trust state gateway = %#v", state["gateway"])
	}
	gateway["private_key"] = "not a private key"
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("trust state json.Marshal() error = %v", err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", path, err)
	}
	return gatewaytrust.NewStore(path)
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
	resp, err := fn(r)
	if resp != nil && resp.Request == nil {
		resp.Request = r
	}
	return resp, err
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

type openGatewayEnvHTTPResult struct {
	Response       protocol.OpenSessionResponse
	ControlBaseURL string
}

func openGatewayEnvViaHTTP(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string, clientNonce string) protocol.OpenSessionResponse {
	t.Helper()
	return openGatewayEnvViaHTTPWithControlBase(t, s, material, gatewayEnvID, clientNonce).Response
}

func openGatewayEnvViaHTTPWithControlBase(t *testing.T, s *Server, material gatewayTestMaterial, gatewayEnvID string, clientNonce string) openGatewayEnvHTTPResult {
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
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen() error = %v", err)
	}
	server := &http.Server{Handler: s.Handler()}
	serverDone := make(chan struct{})
	go func() {
		_ = server.Serve(listener)
		close(serverDone)
	}()
	t.Cleanup(func() {
		_ = server.Close()
		<-serverDone
	})
	baseURL := "http://" + listener.Addr().String() + "/"
	req, err := http.NewRequest(http.MethodPost, baseURL+"gateway/v1/open-session", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	signGatewayTestRequest(t, req, material, body)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open session request error = %v", err)
	}
	defer res.Body.Close()
	resBody, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("open session response read error = %v", err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("open session status = %d, want %d; body=%s", res.StatusCode, http.StatusOK, string(resBody))
	}
	if got := res.Header.Values("Set-Cookie"); len(got) != 0 {
		t.Fatalf("open session set cookies: %#v", got)
	}
	return openGatewayEnvHTTPResult{
		Response:       decodeOpenSessionEnvelope(t, resBody),
		ControlBaseURL: baseURL,
	}
}

func getProfileArtifactURL(t *testing.T, rawURL string, path string, headers map[string]string) (int, string, http.Header) {
	t.Helper()
	return getProfileArtifactURLWithMode(t, rawURL, path, headers, true)
}

func getProfileArtifactAbsoluteURL(t *testing.T, rawURL string, path string, headers map[string]string) (int, string, http.Header) {
	t.Helper()
	return getProfileArtifactURLWithMode(t, rawURL, path, headers, false)
}

func getProfileArtifactURLWithMode(t *testing.T, rawURL string, path string, headers map[string]string, preserveArtifactPath bool) (int, string, http.Header) {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("artifact URL parse error = %v", err)
	}
	if preserveArtifactPath {
		basePath := strings.TrimRight(parsed.Path, "/")
		cleanPath := strings.TrimSpace(path)
		switch {
		case cleanPath == "", cleanPath == "/":
			parsed.Path = basePath + "/"
		case strings.HasPrefix(cleanPath, "/"):
			parsed.Path = basePath + cleanPath
		default:
			parsed.Path = basePath + "/" + cleanPath
		}
	} else {
		parsed.Path = path
	}
	parsed.RawQuery = ""
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	var resp *http.Response
	for attempt := 0; attempt < 10; attempt++ {
		resp, err = http.DefaultClient.Do(req)
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("artifact GET error = %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("artifact body read error = %v", err)
	}
	return resp.StatusCode, string(body), resp.Header.Clone()
}

func getProfileArtifactURLError(rawURL string, path string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	parsed.Path = path
	parsed.RawQuery = ""
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 200 * time.Millisecond}
	resp, err := client.Do(req)
	if resp != nil {
		_ = resp.Body.Close()
	}
	return err
}

func headerValuesContain(values []string, want string) bool {
	for _, value := range values {
		if strings.Contains(value, want) {
			return true
		}
	}
	return false
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

package gatewayservice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/envprofiles"
	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
	"github.com/gorilla/websocket"
)

type accessTestClient struct {
	gatewayID, keyID, privateKey, audience string
}

type accessTestFixture struct {
	server       *Server
	http         *httptest.Server
	client       accessTestClient
	managedToken string
}

func newAccessTestFixture(t *testing.T, target http.Handler) *accessTestFixture {
	t.Helper()
	upstream := httptest.NewServer(target)
	s, err := New(Options{StateRoot: t.TempDir(), ProfileWriteEnabled: true, PairingCode: "test-code"})
	if err != nil {
		t.Fatal(err)
	}
	// The fixture substitutes only the dial destination. Production DNS policy
	// is tested independently and never needs a loopback exemption.
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", strings.TrimPrefix(upstream.URL, "http://"))
	}}
	s.proxyTransport = transport
	gateway := httptest.NewServer(s.Handler())
	t.Cleanup(func() {
		s.closeAllProfileSessions()
		transport.CloseIdleConnections()
		gateway.CloseClientConnections()
		gateway.Close()
		upstream.CloseClientConnections()
		upstream.Close()
	})
	f := &accessTestFixture{server: s, http: gateway}
	f.client = f.pair(t, true)
	f.post(t, f.client, "/gateway/v3/env-profiles/upsert", protocol.EnvProfileUpsertRequest{
		ProtocolVersion: protocol.Version,
		Profile:         protocol.EnvProfileInput{GatewayEnvID: "env_test", DisplayName: "Test Runtime", AccessRoute: protocol.EnvProfileAccessRoute{Kind: protocol.EnvProfileAccessRouteKindURL, URL: "http://runtime.example/"}},
	}, http.StatusOK, nil)
	return f
}

func (f *accessTestFixture) pair(t *testing.T, write bool) accessTestClient {
	t.Helper()
	keys, err := security.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	nonce, _ := randomB64u(24)
	audience := f.http.URL + "/"
	var challenge protocol.PairingChallengeResponse
	f.post(t, accessTestClient{}, "/gateway/v3/pairing/challenge", protocol.PairingChallengeRequest{
		ProtocolVersion: protocol.Version, ClientNonce: nonce, ClientPublicKey: keys.PublicKeyPEM,
		BindingAudience: audience, PairingCode: "test-code",
	}, http.StatusOK, &challenge)
	req := protocol.PairingCompleteRequest{ProtocolVersion: protocol.Version, ClientNonce: nonce, GatewayNonce: challenge.GatewayNonce,
		GatewayID: challenge.GatewayID, BindingAudience: audience, ClientKeyID: security.ClientKeyID(strings.TrimSpace(keys.PublicKeyPEM))}
	fields := map[string]any{"protocol_version": protocol.Version, "client_nonce": nonce, "gateway_nonce": req.GatewayNonce,
		"gateway_id": req.GatewayID, "binding_audience": audience, "client_key_id": req.ClientKeyID}
	if write {
		req.ClientCapability = "env_profile_write"
		fields["client_capability"] = req.ClientCapability
	}
	payload, _ := security.CanonicalJSON(fields)
	req.Proof, err = security.SignPayload(keys.PrivateKeyPEM, payload)
	if err != nil {
		t.Fatal(err)
	}
	f.post(t, accessTestClient{}, "/gateway/v3/pairing/complete", req, http.StatusOK, nil)
	return accessTestClient{req.GatewayID, req.ClientKeyID, keys.PrivateKeyPEM, audience}
}

func (f *accessTestFixture) post(t *testing.T, client accessTestClient, path string, body any, status int, out any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodPost, f.http.URL+path, bytes.NewReader(raw))
	if f.managedToken != "" {
		req.Header.Set("X-Redeven-Gateway-Transport", "desktop_bridge")
		req.Header.Set("X-Redeven-Gateway-Managed-Bridge-Token", f.managedToken)
	}
	if client.keyID != "" {
		nonce, _ := randomB64u(24)
		ts := time.Now().UnixMilli()
		digest, _ := security.CanonicalJSONDigestFromBytes(raw)
		payload, _ := security.CanonicalJSON(map[string]any{"protocol_version": protocol.Version, "method": http.MethodPost, "route": path,
			"body_digest": digest, "gateway_id": client.gatewayID, "binding_audience": client.audience, "nonce": nonce, "timestamp_unix_ms": ts})
		signature, _ := security.SignPayload(client.privateKey, payload)
		req.Header.Set("X-Redeven-Gateway-ID", client.gatewayID)
		req.Header.Set("X-Redeven-Gateway-Binding-Audience", client.audience)
		req.Header.Set("X-Redeven-Client-Key-ID", client.keyID)
		req.Header.Set("X-Redeven-Client-Nonce", nonce)
		req.Header.Set("X-Redeven-Request-TS", strconv.FormatInt(ts, 10))
		req.Header.Set("X-Redeven-Request-Signature", signature)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		t.Fatalf("%s status = %d, want %d; %s", path, resp.StatusCode, status, data)
	}
	if out != nil {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(envelope.Data, out); err != nil {
			t.Fatal(err)
		}
	}
}

func (f *accessTestFixture) open(t *testing.T, mode protocol.AccessMode) protocol.OpenSessionResponse {
	t.Helper()
	var result protocol.OpenSessionResponse
	f.post(t, f.client, "/gateway/v3/open-session", protocol.OpenSessionRequest{
		ProtocolVersion: protocol.Version, GatewayEnvID: "env_test", RequestedCapability: protocol.RequestedCapabilityEnvApp, ClientNonce: "open-nonce", AccessMode: mode,
	}, http.StatusOK, &result)
	return result
}

func accessTestRead(t *testing.T, client *http.Client, address string, status int) (*http.Response, []byte) {
	t.Helper()
	resp, err := client.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		t.Fatalf("access status = %d, want %d; %s", resp.StatusCode, status, body)
	}
	return resp, body
}

func TestAccessModesAndIndependentProfilePermission(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	var catalog protocol.CatalogResponse
	f.post(t, f.client, "/gateway/v3/catalog", protocol.CatalogRequest{ProtocolVersion: protocol.Version}, http.StatusOK, &catalog)
	for _, capability := range []protocol.GatewayCapability{protocol.GatewayCapabilityEnvCatalog, protocol.GatewayCapabilityEnvDirectOpen, protocol.GatewayCapabilityEnvProxyOpen, protocol.GatewayCapabilityEnvProfileWrite} {
		found := false
		for _, item := range catalog.Gateway.Capabilities {
			found = found || item == capability
		}
		if !found {
			t.Fatalf("missing capability %q", capability)
		}
	}
	direct := f.open(t, protocol.AccessModeDirectURL)
	if direct.ConnectArtifact.Kind != protocol.ConnectArtifactKindLocalDirect || direct.ConnectArtifact.URL != "http://runtime.example/" {
		t.Fatal("direct mode changed its URL access contract")
	}
	proxy := f.open(t, protocol.AccessModeGatewayProxy)
	if proxy.ConnectArtifact.Kind != protocol.ConnectArtifactKindGatewayProxy || proxy.ConnectArtifact.GatewaySessionID != proxy.GatewaySessionID || !strings.HasPrefix(proxy.ConnectArtifact.URL, f.http.URL+"/gateway/v3/access/") {
		t.Fatal("proxy artifact is not bound to the fixed Gateway endpoint and session")
	}
	accessTestRead(t, http.DefaultClient, proxy.ConnectArtifact.URL, http.StatusUnauthorized)
	reader := f.pair(t, false)
	f.post(t, reader, "/gateway/v3/env-profiles/delete", protocol.EnvProfileDeleteRequest{ProtocolVersion: protocol.Version, GatewayEnvID: "env_test"}, http.StatusForbidden, nil)
	f.post(t, reader, "/gateway/v3/close-session", protocol.CloseSessionRequest{ProtocolVersion: protocol.Version, GatewaySessionID: proxy.GatewaySessionID}, http.StatusOK, nil)
	if f.server.profileSessionByToken(strings.Trim(strings.TrimPrefix(proxy.ConnectArtifact.URL, f.http.URL+"/gateway/v3/access/"), "/")) == nil {
		t.Fatal("another paired client revoked the owner's session")
	}
}

func TestAccessCookieIsolationLoginLogoutAndRedirects(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			http.SetCookie(w, &http.Cookie{Name: "runtime_login", Value: "secret", Path: "/", HttpOnly: true})
		case "/logout":
			http.SetCookie(w, &http.Cookie{Name: "runtime_login", Value: "", Path: "/", MaxAge: -1})
		case "/redirect":
			http.Redirect(w, r, "/cookie?ref=1", http.StatusFound)
		case "/outside":
			http.Redirect(w, r, "http://169.254.169.254/", http.StatusFound)
		default:
			fmt.Fprint(w, r.Header.Get("Cookie"))
		}
	}))
	a, b := f.open(t, protocol.AccessModeGatewayProxy), f.open(t, protocol.AccessModeGatewayProxy)
	resp, _ := accessTestRead(t, http.DefaultClient, a.ConnectArtifact.URL+"login", http.StatusOK)
	if resp.Header.Get("Set-Cookie") != "" {
		t.Fatal("Runtime Cookie exposed to access client")
	}
	_, cookie := accessTestRead(t, http.DefaultClient, a.ConnectArtifact.URL+"redirect", http.StatusOK)
	if string(cookie) != "runtime_login=secret" {
		t.Fatalf("login cookie = %q", cookie)
	}
	_, other := accessTestRead(t, http.DefaultClient, b.ConnectArtifact.URL+"cookie", http.StatusOK)
	if len(other) != 0 {
		t.Fatal("Cookie leaked between Gateway sessions")
	}
	accessTestRead(t, http.DefaultClient, a.ConnectArtifact.URL+"outside", http.StatusBadGateway)
	accessTestRead(t, http.DefaultClient, a.ConnectArtifact.URL+"logout", http.StatusOK)
	_, cookie = accessTestRead(t, http.DefaultClient, a.ConnectArtifact.URL+"cookie", http.StatusOK)
	if len(cookie) != 0 {
		t.Fatal("Runtime logout did not clear session Cookie")
	}
}

func TestAccessLargeBinaryAndHeaderBoundary(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Forwarded-Anything") != "" || r.Header.Get("X-Redeven-Desktop-Bridge-Token") != "" || r.Header.Get("Proxy-Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("internal or client cookie header reached Runtime")
		}
		if r.Header.Get("Authorization") != "Bearer runtime-login" {
			t.Error("Runtime authorization was removed")
		}
		if r.Header.Get("X-Redeven-Plugin-Session") != "runtime-session" {
			t.Error("Runtime business session authorization was removed")
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = io.Copy(w, r.Body)
	}))
	artifact := f.open(t, protocol.AccessModeGatewayProxy).ConnectArtifact
	data := bytes.Repeat([]byte{0, 255, 42, 13}, 1<<20)
	req, _ := http.NewRequest(http.MethodPost, artifact.URL+"api/local/large", bytes.NewReader(data))
	req.Header.Set("X-Redeven-Plugin-Session", "runtime-session")
	for key, value := range map[string]string{"X-Forwarded-Anything": "spoof", "X-Redeven-Desktop-Bridge-Token": "secret", "Proxy-Authorization": "secret", "Cookie": "other-session=secret", "Authorization": "Bearer runtime-login"} {
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	got, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(got, data) {
		t.Fatal("large binary response changed")
	}
}

func TestAccessWebSocketAndStreamingRevocation(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/ws" {
			conn, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			kind, data, err := conn.ReadMessage()
			if err == nil {
				_ = conn.WriteMessage(kind, data)
			}
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	wsURL := "ws" + strings.TrimPrefix(opened.ConnectArtifact.URL, "http") + "ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte{1, 0, 255}); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil || !bytes.Equal(data, []byte{1, 0, 255}) {
		t.Fatalf("WebSocket echo failed: %v", err)
	}
	resp, err := http.Get(opened.ConnectArtifact.URL + "events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	first := make([]byte, len("data: first\n\n"))
	if _, err := io.ReadFull(resp.Body, first); err != nil {
		t.Fatal(err)
	}
	f.post(t, f.client, "/gateway/v3/close-session", protocol.CloseSessionRequest{ProtocolVersion: protocol.Version, GatewaySessionID: opened.GatewaySessionID}, http.StatusOK, nil)
	done := make(chan struct{})
	go func() { _, _ = io.ReadAll(resp.Body); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("session close did not cancel the stream")
	}
	accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusUnauthorized)
	f.post(t, f.client, "/gateway/v3/close-session", protocol.CloseSessionRequest{ProtocolVersion: protocol.Version, GatewaySessionID: opened.GatewaySessionID}, http.StatusOK, nil)
}

func TestAccessExpiryDeletionShutdownAndUnavailable(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ready") }))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	f.server.profileSessionsMu.Lock()
	f.server.profileSessions[opened.GatewaySessionID].ExpiresAtUnixMS = time.Now().Add(-time.Second).UnixMilli()
	f.server.profileSessionsMu.Unlock()
	response, _ := accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusUnauthorized)
	if response.Header.Get("X-Redeven-Gateway-Error") != "SESSION_EXPIRED" {
		t.Fatal("expiry was not classified")
	}
	f.server.sweepExpired()
	opened = f.open(t, protocol.AccessModeGatewayProxy)
	f.server.proxyTransport = &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) { return nil, fmt.Errorf("secret dial detail") }}
	response, body := accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusBadGateway)
	if response.Header.Get("X-Redeven-Gateway-Error") != "TARGET_UNAVAILABLE" || strings.Contains(string(body), "secret") {
		t.Fatal("unavailable error was not sanitized")
	}
	f.post(t, f.client, "/gateway/v3/env-profiles/delete", protocol.EnvProfileDeleteRequest{ProtocolVersion: protocol.Version, GatewayEnvID: "env_test"}, http.StatusOK, nil)
	accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusUnauthorized)
	f.server.closeAllProfileSessions()
	if len(f.server.profileSessions) != 0 {
		t.Fatal("shutdown retained sessions")
	}
}

func TestProductionDialPolicyRejectsLoopbackDNSAndPrivateTargets(t *testing.T) {
	transport := gatewayProfileProxyTransport(envprofiles.URLTargetPolicy{}).(*http.Transport)
	defer transport.CloseIdleConnections()
	for _, address := range []string{"localhost:80", "127.0.0.1:80", "[::1]:80", "10.0.0.1:80", "169.254.169.254:80"} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		conn, err := transport.DialContext(ctx, "tcp", address)
		cancel()
		if conn != nil {
			conn.Close()
		}
		if err == nil {
			t.Fatalf("unsafe address accepted: %s", address)
		}
	}
}

func TestAccessPreservesEncodedPathsAndSafeRedirectFragments(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			w.Header().Set("Location", "/login?next=a%2Fb#section")
			w.WriteHeader(http.StatusFound)
		case "/credentials":
			w.Header().Set("Location", "http://user:password@runtime.example/login")
			w.WriteHeader(http.StatusFound)
		default:
			fmt.Fprint(w, r.URL.EscapedPath())
		}
	}))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	_, body := accessTestRead(t, client, opened.ConnectArtifact.URL+"files/a%2Fb%20c", http.StatusOK)
	if string(body) != "/files/a%2Fb%20c" {
		t.Fatalf("encoded path changed: %q", body)
	}
	response, _ := accessTestRead(t, client, opened.ConnectArtifact.URL+"redirect", http.StatusFound)
	if response.Header.Get("Location") != opened.ConnectArtifact.URL+"login?next=a%2Fb#section" {
		t.Fatal("redirect lost query or fragment")
	}
	accessTestRead(t, client, opened.ConnectArtifact.URL+"credentials", http.StatusBadGateway)
}

func TestSessionLeaseTimerAndServerShutdownRevokeAccess(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "ready") }))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	f.server.profileSessionsMu.Lock()
	lease := f.server.profileSessions[opened.GatewaySessionID]
	lease.ExpireTimer.Reset(10 * time.Millisecond)
	f.server.profileSessionsMu.Unlock()
	select {
	case <-lease.Context.Done():
	case <-time.After(time.Second):
		t.Fatal("lease timer did not revoke session")
	}
	accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusUnauthorized)
	opened = f.open(t, protocol.AccessModeGatewayProxy)
	f.server.profileSessionsMu.Lock()
	lease = f.server.profileSessions[opened.GatewaySessionID]
	f.server.profileSessionsMu.Unlock()
	ctx, cancel := context.WithCancel(t.Context())
	server, _, err := f.server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	defer server.Close()
	cancel()
	select {
	case <-lease.Context.Done():
	case <-time.After(time.Second):
		t.Fatal("Server.Start shutdown did not revoke existing session")
	}
	accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusUnauthorized)
}

func TestProductionDialPinsValidatedIPAndRejectsDNSRebinding(t *testing.T) {
	answer := "8.8.8.8"
	var dials []string
	dial := gatewayProfileDialer(envprofiles.URLTargetPolicy{}, func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP(answer)}}, nil
	}, func(_ context.Context, _ string, address string) (net.Conn, error) {
		dials = append(dials, address)
		a, b := net.Pipe()
		_ = b.Close()
		return a, nil
	})
	conn, err := dial(context.Background(), "tcp", "runtime.example:443")
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.Close()
	answer = "10.0.0.1"
	if _, err := dial(context.Background(), "tcp", "runtime.example:443"); err == nil {
		t.Fatal("rebinding to private network succeeded")
	}
	if len(dials) != 1 || dials[0] != "8.8.8.8:443" {
		t.Fatalf("dial did not pin the validated IP: %v", dials)
	}
}

func TestProxyRetainsTLSCertificateValidation(t *testing.T) {
	f := newAccessTestFixture(t, http.NotFoundHandler())
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "TLS bypassed") }))
	defer upstream.Close()
	f.server.proxyTransport = &http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(upstream.URL, "https://"))
	}}
	f.post(t, f.client, "/gateway/v3/env-profiles/upsert", protocol.EnvProfileUpsertRequest{ProtocolVersion: protocol.Version,
		Profile: protocol.EnvProfileInput{GatewayEnvID: "env_test", DisplayName: "TLS Runtime", AccessRoute: protocol.EnvProfileAccessRoute{Kind: protocol.EnvProfileAccessRouteKindURL, URL: "https://runtime.example/"}},
	}, http.StatusOK, nil)
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	_, body := accessTestRead(t, http.DefaultClient, opened.ConnectArtifact.URL, http.StatusBadGateway)
	if strings.Contains(string(body), "TLS bypassed") {
		t.Fatal("untrusted Runtime certificate accepted")
	}
}

func TestManagedBridgeUsesSameRevocableFixedAccessPath(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, "managed target") }))
	f.server.desktopBridgeTransport = true
	f.server.managedBridgeToken = "managed-test-token"
	f.managedToken = f.server.managedBridgeToken
	var opened protocol.OpenSessionResponse
	f.post(t, f.client, "/gateway/v3/open-session", protocol.OpenSessionRequest{ProtocolVersion: protocol.Version,
		GatewayEnvID: "env_test", RequestedCapability: protocol.RequestedCapabilityEnvApp, AccessMode: protocol.AccessModeGatewayProxy,
		ClientNonce: "bridge-open", BridgeSessionID: "bridge_one", RouteID: "env_app:" + f.client.gatewayID,
	}, http.StatusOK, &opened)
	if opened.ConnectArtifact.Kind != protocol.ConnectArtifactKindDesktopBridge || opened.ConnectArtifact.BridgeSessionID != "bridge_one" ||
		!strings.HasPrefix(opened.ConnectArtifact.URL, "/gateway/v3/access/") || opened.ConnectArtifact.GatewaySessionID != opened.GatewaySessionID {
		t.Fatal("managed bridge binding lost")
	}
	_, body := accessTestRead(t, http.DefaultClient, f.http.URL+opened.ConnectArtifact.URL, http.StatusOK)
	if string(body) != "managed target" {
		t.Fatal("bridge access path did not reach target")
	}
	f.post(t, f.client, "/gateway/v3/close-session", protocol.CloseSessionRequest{ProtocolVersion: protocol.Version, GatewaySessionID: opened.GatewaySessionID}, http.StatusOK, nil)
	accessTestRead(t, http.DefaultClient, f.http.URL+opened.ConnectArtifact.URL, http.StatusUnauthorized)
}

func TestTargetTunnelStreamsHTTPAndRevokesActiveConnection(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, r.Host+" "+r.URL.Path) }))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	address := "ws" + strings.TrimPrefix(opened.ConnectArtifact.URL, "http") + "_tunnel"
	client, _, err := websocket.DefaultDialer.Dial(address, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := client.WriteMessage(websocket.BinaryMessage, []byte("GET /api/local/health HTTP/1.1\r\nHost: runtime.example\r\nConnection: keep-alive\r\n\r\n")); err != nil {
		t.Fatal(err)
	}
	_, body, err := client.ReadMessage()
	if err != nil || !strings.Contains(string(body), "runtime.example /api/local/health") {
		t.Fatalf("target tunnel response missing: %v", err)
	}
	f.post(t, f.client, "/gateway/v3/close-session", protocol.CloseSessionRequest{ProtocolVersion: protocol.Version, GatewaySessionID: opened.GatewaySessionID}, http.StatusOK, nil)
	if _, _, err := client.ReadMessage(); !websocket.IsCloseError(err, 4001) {
		t.Fatalf("revocation close = %v", err)
	}
}

func TestTargetTunnelStreamsLargeWebSocketMessage(t *testing.T) {
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(r.ContentLength, 10))
		_, _ = io.Copy(w, r.Body)
	}))
	opened := f.open(t, protocol.AccessModeGatewayProxy)
	address := "ws" + strings.TrimPrefix(opened.ConnectArtifact.URL, "http") + "_tunnel"
	client, _, err := websocket.DefaultDialer.Dial(address, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetReadDeadline(time.Now().Add(3 * time.Second))
	body := bytes.Repeat([]byte{0x00, 0xff, 0x01, 0x7f}, 512*1024)
	header := fmt.Sprintf("POST /upload HTTP/1.1\r\nHost: runtime.example\r\nContent-Length: %d\r\n\r\n", len(body))
	if err := client.WriteMessage(websocket.BinaryMessage, append([]byte(header), body...)); err != nil {
		t.Fatal(err)
	}
	var response []byte
	for {
		_, chunk, err := client.ReadMessage()
		if err != nil {
			t.Fatalf("large tunnel request failed: %v", err)
		}
		response = append(response, chunk...)
		if offset := bytes.Index(response, []byte("\r\n\r\n")); offset >= 0 && len(response) >= offset+4+len(body) {
			if !bytes.Equal(response[offset+4:], body) {
				t.Fatal("large tunnel response changed binary content")
			}
			break
		}
	}
}

package localui

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v3"
	"github.com/floegence/flowersec/flowersec-go/v3/controlplane"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/accessrpc"
	fsrpc "github.com/floegence/redeven/internal/fs"
	"github.com/floegence/redeven/internal/monitor"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/terminal"
)

func TestServer_E2E_HTTPSLocalhostConnectsDirectSessionOverWSS(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on IPv4 loopback: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	bind, err := ParseBind(net.JoinHostPort("localhost", fmt.Sprint(port)))
	if err != nil {
		_ = listener.Close()
		t.Fatalf("ParseBind() error = %v", err)
	}

	s := newTestServer(t, nil)
	s.bind = bind
	s.a = newRuntimeHealthTestAgent(t, s.configPath)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := s.StartOnListeners(ctx, []net.Listener{listener}, nil); err != nil {
		_ = listener.Close()
		t.Fatalf("StartOnListeners() error = %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	trustRoots := x509.NewCertPool()
	trustRoots.AddCert(s.deviceCA.certificate)
	localhostURL := "https://" + net.JoinHostPort("localhost", fmt.Sprint(port))
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS13,
			RootCAs:    trustRoots,
			ServerName: "localhost",
		},
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp4", listener.Addr().String())
		},
	}}
	t.Cleanup(client.CloseIdleConnections)

	resp, err := client.Post(localhostURL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST HTTPS localhost connect_artifact error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("HTTPS localhost connect_artifact status = %d, want %d; body=%q", resp.StatusCode, http.StatusOK, body)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode HTTPS localhost connect artifact: %v", err)
	}
	var artifactWire struct {
		Path struct {
			Candidates []struct {
				URL string `json:"url"`
			} `json:"candidates"`
		} `json:"path"`
	}
	if err := json.Unmarshal(envelope.ConnectArtifact, &artifactWire); err != nil {
		t.Fatalf("decode HTTPS localhost artifact candidate: %v", err)
	}
	s.authorityMu.RLock()
	wantCandidate := "wss://" + s.directAuthorities[net.JoinHostPort("localhost", fmt.Sprint(port))] + flowersec.WebSocketDirectPath
	s.authorityMu.RUnlock()
	if len(artifactWire.Path.Candidates) != 1 || artifactWire.Path.Candidates[0].URL != wantCandidate {
		t.Fatalf("HTTPS localhost artifact candidates = %#v, want %q", artifactWire.Path.Candidates, wantCandidate)
	}

	connectCtx, connectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connectCancel()
	current := connectDesktopBridgeArtifact(t, connectCtx, s, envelope.ConnectArtifact, localhostURL)
	defer current.Close()

	var monitorResponse map[string]any
	if err := current.RPC().Call(connectCtx, monitor.TypeID_SYS_MONITOR, map[string]any{}, &monitorResponse); err != nil {
		t.Fatalf("monitor RPC through HTTPS/WSS localhost direct session error = %v", err)
	}
	var pathContext map[string]any
	if err := current.RPC().Call(connectCtx, fsrpc.TypeID_FS_GET_PATH_CONTEXT, map[string]any{}, &pathContext); err != nil {
		t.Fatalf("filesystem path context RPC through HTTPS/WSS localhost direct session error = %v", err)
	}
	homePath, _ := pathContext["home_path_abs"].(string)
	if homePath == "" {
		t.Fatalf("filesystem path context response is missing home_path_abs: %#v", pathContext)
	}
	var listResponse map[string]any
	if err := current.RPC().Call(connectCtx, fsrpc.TypeID_FS_LIST, map[string]any{"path": homePath}, &listResponse); err != nil {
		t.Fatalf("filesystem list RPC through HTTPS/WSS localhost direct session error = %v", err)
	}
	if _, ok := listResponse["entries"]; !ok {
		t.Fatalf("filesystem list response is missing entries: %#v", listResponse)
	}
}

func TestServer_E2E_PlaintextNetworkRejectsDirectArtifactWithoutInternalError(t *testing.T) {
	s := newTestServer(t, nil)
	bind, err := ParseBind("192.0.2.10:23998")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	s.bind = bind
	s.networkAuthorities = map[string]struct{}{"192.0.2.10:23998": {}}

	req := httptest.NewRequest(http.MethodPost, "http://192.0.2.10:23998/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	req.Host = "192.0.2.10:23998"
	req.Header.Set("Origin", "http://192.0.2.10:23998")
	res := httptest.NewRecorder()
	s.handler().ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("plaintext network connect_artifact status = %d, want %d", res.Code, http.StatusForbidden)
	}
}

func TestServer_E2E_DesktopBridgeMintsPrivateLoopbackArtifact(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)

	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()
	envelope := mintPrivateDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
	var wire struct {
		Version      int    `json:"v"`
		Profile      string `json:"profile"`
		Endpoint     string `json:"endpoint"`
		ArtifactB64U string `json:"artifact_b64u"`
	}
	if err := json.Unmarshal(envelope.ConnectArtifact, &wire); err != nil {
		t.Fatalf("decode private Desktop artifact: %v", err)
	}
	if wire.Version != 1 || wire.Profile != controlplane.PrivateLoopbackProfile {
		t.Fatalf("private Desktop artifact profile = %d %q", wire.Version, wire.Profile)
	}
	wantEndpoint := "ws://" + strings.TrimPrefix(strings.TrimRight(bridge.URL, "/"), "http://") + flowersec.WebSocketDirectPath
	if wire.Endpoint != wantEndpoint {
		t.Fatalf("private Desktop artifact endpoint = %q", wire.Endpoint)
	}
	if _, err := flowersec.ParseArtifact(envelope.ConnectArtifact); err == nil {
		t.Fatal("public Flowersec parser accepted private Desktop artifact")
	}
	nestedArtifact, err := base64.RawURLEncoding.DecodeString(wire.ArtifactB64U)
	if err != nil {
		t.Fatalf("decode nested Flowersec v3 artifact: %v", err)
	}
	if _, err := flowersec.ParseArtifact(nestedArtifact); err != nil {
		t.Fatalf("nested Flowersec v3 artifact is invalid: %v", err)
	}
}

func TestServer_E2E_DesktopBridgePluginAccessSurvivesAdmissionExpiry(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()

	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	envelope := mintDesktopBridgeArtifact(t, s, bridge.Client(), bridge.URL, "")
	current := connectDesktopBridgeArtifact(t, ctx, s, envelope.ConnectArtifact, bridge.URL)
	defer current.Close()
	assertDesktopBridgeSessionReady(t, ctx, current)
	assertPluginCatalogEventuallyStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusOK)

	s.pendingMu.Lock()
	_, stillPending := s.pending[envelope.ChannelID]
	s.pendingMu.Unlock()
	s.directMu.Lock()
	activeBinding, active := s.activePluginSession[envelope.ChannelID]
	s.directMu.Unlock()
	if stillPending {
		t.Fatal("accepted Desktop bridge artifact remained in pending admission state")
	}
	if !active || activeBinding.session == nil {
		t.Fatal("accepted Desktop bridge session has no independent active binding")
	}
	s.sweepExpiredAt(time.Now().Add(5 * time.Minute))

	if _, err := current.ProbeLiveness(ctx); err != nil {
		t.Fatalf("Desktop bridge transport closed with expired admission artifact: %v", err)
	}
	assertPluginCatalogStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusOK)
}

func TestServer_E2E_DesktopBridgeExpiredUnusedArtifactIsRejected(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()
	envelope := mintDesktopBridgeArtifact(t, s, bridge.Client(), bridge.URL, "")

	s.sweepExpiredAt(time.Now().Add(5 * time.Minute))
	s.pendingMu.Lock()
	_, pending := s.pending[envelope.ChannelID]
	s.pendingMu.Unlock()
	s.directMu.Lock()
	_, active := s.activePluginSession[envelope.ChannelID]
	_, access := s.pluginAccess["direct:"+envelope.ChannelID]
	s.directMu.Unlock()
	if pending || active || access {
		t.Fatalf("expired unused admission remained tracked: pending=%t active=%t access=%t", pending, active, access)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := connectDesktopBridgeArtifactResult(ctx, s, envelope.ConnectArtifact, bridge.URL); err == nil {
		t.Fatal("expired unused Desktop bridge artifact connected")
	}
	assertDirectStateEventuallyEmpty(t, s)
}

func TestServer_E2E_DesktopBridgePluginScopeRevokeRemovesActiveBinding(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()
	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	envelope := mintDesktopBridgeArtifact(t, s, bridge.Client(), bridge.URL, "")
	current := connectDesktopBridgeArtifact(t, ctx, s, envelope.ConnectArtifact, bridge.URL)
	defer current.Close()
	assertDesktopBridgeSessionReady(t, ctx, current)
	assertPluginCatalogEventuallyStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusOK)

	status, body := pluginRequestStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential,
		http.MethodPost, "/_redevplugin/api/plugins/session/revoke-scope", `{}`)
	if status != http.StatusOK {
		t.Fatalf("plugin session revoke status = %d, want 200; body=%q", status, body)
	}
	assertPluginCredentialEventuallyRejected(t, s, envelope.PluginSessionCredential)
	s.directMu.Lock()
	_, active := s.activePluginSession[envelope.ChannelID]
	s.directMu.Unlock()
	if active {
		t.Fatal("plugin session scope revoke left the Local UI active binding registered")
	}
	assertPluginCatalogStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusForbidden)
}

func TestServer_E2E_DesktopBridgeConsecutiveSessionsKeepTerminalRPCHandlers(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()
	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var previousCredential string
	for attempt := 1; attempt <= 2; attempt++ {
		envelope := mintDesktopBridgeArtifact(t, s, bridge.Client(), bridge.URL, "")
		if envelope.PluginSessionCredential == previousCredential {
			t.Fatal("consecutive Desktop sessions reused a plugin credential")
		}
		current := connectDesktopBridgeArtifact(t, ctx, s, envelope.ConnectArtifact, bridge.URL)
		assertDesktopBridgeSessionReady(t, ctx, current)
		assertPluginCatalogEventuallyStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusOK)
		var response struct {
			Sessions []json.RawMessage `json:"sessions"`
		}
		if err := current.RPC().Call(ctx, terminal.TypeID_TERMINAL_SESSION_LIST, &struct{}{}, &response); err != nil {
			t.Fatalf("terminal list RPC on Desktop bridge session %d error = %v", attempt, err)
		}
		var created struct {
			Session struct {
				ID string `json:"id"`
			} `json:"session"`
		}
		if err := current.RPC().Call(ctx, terminal.TypeID_TERMINAL_SESSION_CREATE, map[string]any{}, &created); err != nil {
			t.Fatalf("terminal create RPC on Desktop bridge session %d error = %v", attempt, err)
		}
		if strings.TrimSpace(created.Session.ID) == "" {
			t.Fatalf("terminal create RPC on Desktop bridge session %d returned no session ID", attempt)
		}
		response.Sessions = nil
		if err := current.RPC().Call(ctx, terminal.TypeID_TERMINAL_SESSION_LIST, &struct{}{}, &response); err != nil {
			t.Fatalf("terminal list RPC after create on Desktop bridge session %d error = %v", attempt, err)
		}
		createdVisible := false
		for _, encoded := range response.Sessions {
			var listed struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(encoded, &listed); err != nil {
				t.Fatalf("decode terminal list entry on Desktop bridge session %d error = %v", attempt, err)
			}
			createdVisible = createdVisible || listed.ID == created.Session.ID
		}
		if !createdVisible {
			t.Fatalf("terminal created on Desktop bridge session %d was not returned by the still-registered list handler", attempt)
		}
		_ = current.Close()
		assertDirectStateEventuallyEmpty(t, s)
		assertPluginCatalogStatus(t, bridge.Client(), bridge.URL, envelope.PluginSessionCredential, http.StatusForbidden)
		previousCredential = envelope.PluginSessionCredential
	}
}

func TestServer_E2E_DesktopBridgeWindowIsolationAndOneShotArtifacts(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()
	firstBridge := desktopBridgeEndpointForServer(t, s)
	defer firstBridge.Close()
	secondBridge := desktopBridgeEndpointForServer(t, s)
	defer secondBridge.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	firstArtifact := mintDesktopBridgeArtifact(t, s, firstBridge.Client(), firstBridge.URL, "")
	secondArtifact := mintDesktopBridgeArtifact(t, s, secondBridge.Client(), secondBridge.URL, "")
	if firstArtifact.ChannelID == secondArtifact.ChannelID {
		t.Fatalf("Desktop windows shared channel ID %q", firstArtifact.ChannelID)
	}
	firstSession := connectDesktopBridgeArtifact(t, ctx, s, firstArtifact.ConnectArtifact, firstBridge.URL)
	defer firstSession.Close()
	secondSession := connectDesktopBridgeArtifact(t, ctx, s, secondArtifact.ConnectArtifact, secondBridge.URL)
	defer secondSession.Close()
	assertDesktopBridgeSessionReady(t, ctx, firstSession)
	assertDesktopBridgeSessionReady(t, ctx, secondSession)
	assertPluginCatalogEventuallyStatus(t, firstBridge.Client(), firstBridge.URL, firstArtifact.PluginSessionCredential, http.StatusOK)
	assertPluginCatalogEventuallyStatus(t, secondBridge.Client(), secondBridge.URL, secondArtifact.PluginSessionCredential, http.StatusOK)
	if channelID, ok := s.a.ResolvePluginSessionCredential(firstArtifact.PluginSessionCredential); !ok || channelID != firstArtifact.ChannelID {
		t.Fatalf("first Desktop credential resolved to %q, want %q", channelID, firstArtifact.ChannelID)
	}
	if channelID, ok := s.a.ResolvePluginSessionCredential(secondArtifact.PluginSessionCredential); !ok || channelID != secondArtifact.ChannelID {
		t.Fatalf("second Desktop credential resolved to %q, want %q", channelID, secondArtifact.ChannelID)
	}

	crossArtifact := mintDesktopBridgeArtifact(t, s, firstBridge.Client(), firstBridge.URL, "")
	s.releaseAcceptedSession(crossArtifact.ChannelID)
	if _, err := connectDesktopBridgeArtifactResult(ctx, s, firstArtifact.ConnectArtifact, firstBridge.URL); err == nil {
		t.Fatal("consumed Desktop artifact connected a second time")
	}

	_ = firstSession.Close()
	_ = secondSession.Close()
	assertDirectStateEventuallyEmpty(t, s)
}

func TestServer_E2E_DesktopBridgeRestartRevokesOldState(t *testing.T) {
	oldServer := newDesktopBridgeTestServer(t, nil)
	oldBridge := desktopBridgeEndpointForServer(t, oldServer)
	oldArtifact := mintDesktopBridgeArtifact(t, oldServer, oldBridge.Client(), oldBridge.URL, "")
	oldBridge.Close()
	if err := oldServer.Close(); err != nil {
		t.Fatalf("old Server.Close() error = %v", err)
	}

	oldConnectCtx, oldConnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	_, oldConnectErr := connectDesktopBridgeArtifactResult(oldConnectCtx, oldServer, oldArtifact.ConnectArtifact, oldBridge.URL)
	oldConnectCancel()
	if oldConnectErr == nil {
		t.Fatal("artifact connected after its Local UI server closed")
	}
	assertDirectStateEventuallyEmpty(t, oldServer)

	newServer := newDesktopBridgeTestServer(t, nil)
	newBridge := desktopBridgeEndpointForServer(t, newServer)
	defer newBridge.Close()
	newArtifact := mintDesktopBridgeArtifact(t, newServer, newBridge.Client(), newBridge.URL, "")
	newConnectCtx, newConnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer newConnectCancel()
	newSession := connectDesktopBridgeArtifact(t, newConnectCtx, newServer, newArtifact.ConnectArtifact, newBridge.URL)
	assertDesktopBridgeSessionReady(t, newConnectCtx, newSession)
	_ = newSession.Close()
	assertDirectStateEventuallyEmpty(t, newServer)
}

func TestServer_E2E_DesktopBridgeSecurityDoesNotExpandPublicListener(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	bridge := desktopBridgeEndpointForServer(t, s)
	defer bridge.Close()
	artifact := mintDesktopBridgeArtifact(t, s, bridge.Client(), bridge.URL, "")
	s.releaseAcceptedSession(artifact.ChannelID)

	for name, origin := range map[string]string{
		"missing":  "",
		"mismatch": "http://127.0.0.1:1",
		"external": "http://example.com:23998",
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, bridge.URL+flowersec.WebSocketDirectPath, nil)
			req.Host = strings.TrimPrefix(bridge.URL, "http://")
			req.Header.Set("Connection", "Upgrade")
			req.Header.Set("Upgrade", "websocket")
			req.Header.Set("Sec-WebSocket-Key", "AAAAAAAAAAAAAAAAAAAAAA==")
			req.Header.Set("Sec-WebSocket-Version", "13")
			req.Header.Set(localDesktopBridgeTokenHeader, s.localUIBridgeToken)
			if origin != "" {
				req.Header.Set("Origin", origin)
			}
			res := httptest.NewRecorder()
			s.HandlerForDesktopBridge().ServeHTTP(res, req)
			if res.Code != http.StatusForbidden {
				t.Fatalf("bridge Flowersec route status = %d, want %d", res.Code, http.StatusForbidden)
			}
		})
	}

	public := httptest.NewServer(s.handler())
	defer public.Close()
	resp, err := public.Client().Post(public.URL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST public dynamic connect_artifact error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("public listener admitted an unconfigured dynamic authority")
	}
}

func TestServer_E2E_DesktopBridgePasswordLogoutAndExpiry(t *testing.T) {
	t.Run("logout", func(t *testing.T) {
		gate := accessgate.New(accessgate.Options{Password: "secret"})
		s := newDesktopBridgeTestServer(t, gate)
		s.appServer = s.a.CodeAppServer()
		bridge := desktopBridgeEndpointForServer(t, s)
		defer bridge.Close()
		client := bridgeClientWithCookies(t, bridge)
		resumeToken := unlockDesktopBridge(t, client, bridge.URL)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		envelope := mintDesktopBridgeArtifact(t, s, client, bridge.URL, resumeToken)
		current := connectDesktopBridgeArtifact(t, ctx, s, envelope.ConnectArtifact, bridge.URL)
		assertDesktopBridgeSessionReady(t, ctx, current)
		assertPluginCatalogEventuallyStatus(t, client, bridge.URL, envelope.PluginSessionCredential, http.StatusOK)

		logoutReq, err := http.NewRequest(http.MethodPost, bridge.URL+"/api/local/access/logout", nil)
		if err != nil {
			t.Fatalf("NewRequest logout error = %v", err)
		}
		logoutReq.Header.Set(localAccessResumeHeader, resumeToken)
		logoutResp, err := client.Do(logoutReq)
		if err != nil {
			t.Fatalf("POST logout error = %v", err)
		}
		defer logoutResp.Body.Close()
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("logout status = %d, want %d", logoutResp.StatusCode, http.StatusOK)
		}
		assertSessionEventuallyClosed(t, current)
		assertDirectStateEventuallyEmpty(t, s)
		assertPluginCredentialEventuallyRejected(t, s, envelope.PluginSessionCredential)
		if _, err := connectDesktopBridgeArtifactResult(ctx, s, envelope.ConnectArtifact, bridge.URL); err == nil {
			t.Fatal("logged-out Desktop artifact reconnected")
		}

		newResumeToken := unlockDesktopBridge(t, client, bridge.URL)
		newEnvelope := mintDesktopBridgeArtifact(t, s, client, bridge.URL, newResumeToken)
		newSession := connectDesktopBridgeArtifact(t, ctx, s, newEnvelope.ConnectArtifact, bridge.URL)
		assertDesktopBridgeSessionReady(t, ctx, newSession)
		_ = newSession.Close()
		assertDirectStateEventuallyEmpty(t, s)
	})

	t.Run("expiry", func(t *testing.T) {
		gate := accessgate.New(accessgate.Options{
			Password:        "secret",
			ResumeTTL:       3 * time.Second,
			LocalSessionTTL: 3 * time.Second,
		})
		s := newDesktopBridgeTestServer(t, gate)
		s.appServer = s.a.CodeAppServer()
		bridge := desktopBridgeEndpointForServer(t, s)
		defer bridge.Close()
		client := bridgeClientWithCookies(t, bridge)
		resumeToken := unlockDesktopBridge(t, client, bridge.URL)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		envelope := mintDesktopBridgeArtifact(t, s, client, bridge.URL, resumeToken)
		current := connectDesktopBridgeArtifact(t, ctx, s, envelope.ConnectArtifact, bridge.URL)
		assertDesktopBridgeSessionReady(t, ctx, current)
		assertPluginCatalogEventuallyStatus(t, client, bridge.URL, envelope.PluginSessionCredential, http.StatusOK)

		expired := gate.TakeExpiredLocalSessions(time.Now().Add(4 * time.Second))
		if len(expired) != 1 {
			t.Fatalf("expired Local UI sessions = %d, want 1", len(expired))
		}
		s.closePluginAccessSession(expired[0].AccessSessionID)
		assertSessionEventuallyClosed(t, current)
		assertDirectStateEventuallyEmpty(t, s)
		assertPluginCredentialEventuallyRejected(t, s, envelope.PluginSessionCredential)
		if _, err := connectDesktopBridgeArtifactResult(ctx, s, envelope.ConnectArtifact, bridge.URL); err == nil {
			t.Fatal("expired Desktop artifact reconnected")
		}
	})
}

func newDesktopBridgeTestServer(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	s := newTestServer(t, gate)
	s.a = newRuntimeHealthTestAgent(t, s.configPath)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for secure Local UI test server: %v", err)
	}
	bind, err := ParseBind(listener.Addr().String())
	if err != nil {
		_ = listener.Close()
		t.Fatalf("ParseBind() error = %v", err)
	}
	s.bind = bind
	if err := s.prepareSecureNetwork([]net.Listener{listener}); err != nil {
		_ = listener.Close()
		t.Fatalf("prepareSecureNetwork() error = %v", err)
	}
	if err := s.prepareDesktopBridgeListener(); err != nil {
		_ = listener.Close()
		t.Fatalf("prepareDesktopBridgeListener() error = %v", err)
	}
	if err := s.configureAcceptor(); err != nil {
		_ = listener.Close()
		t.Fatalf("configureAcceptor() error = %v", err)
	}
	if err := s.createDirectServers(); err != nil {
		_ = listener.Close()
		t.Fatalf("createDirectServers() error = %v", err)
	}
	if err := s.configureDesktopBridgeDirectHandler(); err != nil {
		_ = listener.Close()
		t.Fatalf("configureDesktopBridgeDirectHandler() error = %v", err)
	}
	if err := s.startDesktopBridgeServer(); err != nil {
		_ = listener.Close()
		t.Fatalf("startDesktopBridgeServer() error = %v", err)
	}
	s.srv = newLocalUIHTTPServer(s.networkHandler())
	s.listeners = []net.Listener{listener}
	s.serveSecureNetwork(s.srv, s.listeners)
	t.Cleanup(func() { _ = s.Close() })
	return s
}

type desktopBridgeTestEndpoint struct {
	URL    string
	client *http.Client
}

type desktopBridgeAuthorizationTransport struct {
	token string
	base  http.RoundTripper
}

func (transport desktopBridgeAuthorizationTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	clone := request.Clone(request.Context())
	clone.Header = request.Header.Clone()
	clone.Header.Set(localDesktopBridgeTokenHeader, transport.token)
	return transport.base.RoundTrip(clone)
}

func desktopBridgeEndpointForServer(t *testing.T, s *Server) *desktopBridgeTestEndpoint {
	t.Helper()
	if s == nil || strings.TrimSpace(s.localUIBridgeURL) == "" {
		t.Fatal("trusted Local UI bridge is unavailable")
	}
	if strings.TrimSpace(s.localUIBridgeToken) == "" {
		t.Fatal("trusted Local UI bridge authorization is unavailable")
	}
	return &desktopBridgeTestEndpoint{
		URL: strings.TrimRight(s.localUIBridgeURL, "/"),
		client: &http.Client{Transport: desktopBridgeAuthorizationTransport{
			token: s.localUIBridgeToken,
			base:  http.DefaultTransport,
		}},
	}
}

func (bridge *desktopBridgeTestEndpoint) Client() *http.Client { return bridge.client }
func (bridge *desktopBridgeTestEndpoint) Close()               {}

func bridgeClientWithCookies(t *testing.T, bridge *desktopBridgeTestEndpoint) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := bridge.Client()
	client.Jar = jar
	return client
}

func unlockDesktopBridge(t *testing.T, client *http.Client, bridgeURL string) string {
	t.Helper()
	resp, err := client.Post(bridgeURL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST bridge unlock error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bridge unlock status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body struct {
		Data struct {
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode bridge unlock error = %v", err)
	}
	if strings.TrimSpace(body.Data.ResumeToken) == "" {
		t.Fatal("bridge unlock did not issue a resume token")
	}
	return body.Data.ResumeToken
}

func mintPrivateDesktopBridgeArtifact(t *testing.T, client *http.Client, bridgeURL, resumeToken string) connectArtifactEnvelope {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, bridgeURL+"/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("NewRequest bridge connect_artifact error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(resumeToken) != "" {
		req.Header.Set(localAccessResumeHeader, resumeToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST bridge connect_artifact error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bridge connect_artifact status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode bridge connect_artifact error = %v", err)
	}
	return envelope
}

func mintDesktopBridgeArtifact(t *testing.T, s *Server, _ *http.Client, _ string, resumeToken string) connectArtifactEnvelope {
	t.Helper()
	publicURLs := s.DisplayURLs()
	if len(publicURLs) != 1 {
		t.Fatalf("public Local UI URLs = %#v, want one", publicURLs)
	}
	publicURL := strings.TrimRight(publicURLs[0], "/")
	client := publicLocalUIClientForServer(t, s)
	req, err := http.NewRequest(http.MethodPost, publicURL+"/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("NewRequest public connect_artifact error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(resumeToken) != "" {
		req.Header.Set(localAccessResumeHeader, resumeToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST public connect_artifact error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public connect_artifact status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode public connect_artifact error = %v", err)
	}
	var artifactWire struct {
		Path struct {
			Candidates []struct {
				URL string `json:"url"`
			} `json:"candidates"`
		} `json:"path"`
	}
	if err := json.Unmarshal(envelope.ConnectArtifact, &artifactWire); err != nil {
		t.Fatalf("decode bridge artifact candidate error = %v", err)
	}
	if len(artifactWire.Path.Candidates) != 1 {
		t.Fatalf("bridge artifact candidates = %#v, want one WSS candidate", artifactWire.Path.Candidates)
	}
	candidateURL := artifactWire.Path.Candidates[0].URL
	s.authorityMu.RLock()
	validCandidate := false
	for _, authority := range s.directAuthorities {
		validCandidate = validCandidate || candidateURL == "wss://"+authority+flowersec.WebSocketDirectPath
	}
	s.authorityMu.RUnlock()
	if !validCandidate {
		t.Fatalf("bridge artifact candidate = %q, want configured Flowersec WSS endpoint", candidateURL)
	}
	return envelope
}

func publicLocalUIClientForServer(t *testing.T, s *Server) *http.Client {
	t.Helper()
	trustRoots := x509.NewCertPool()
	if s == nil || s.deviceCA == nil || s.deviceCA.certificate == nil {
		t.Fatal("missing test Local UI device CA")
	}
	trustRoots.AddCert(s.deviceCA.certificate)
	return &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		MinVersion: tls.VersionTLS13,
		RootCAs:    trustRoots,
	}}}
}

func connectDesktopBridgeArtifact(t *testing.T, ctx context.Context, s *Server, encodedArtifact json.RawMessage, origin string) flowersec.Session {
	t.Helper()
	current, err := connectDesktopBridgeArtifactResult(ctx, s, encodedArtifact, origin)
	if err != nil {
		t.Fatalf("Connect() through Desktop bridge error = %v", err)
	}
	return current
}

func connectDesktopBridgeArtifactResult(ctx context.Context, s *Server, encodedArtifact json.RawMessage, origin string) (flowersec.Session, error) {
	artifact, err := flowersec.ParseArtifact(encodedArtifact)
	if err != nil {
		return nil, err
	}
	// These accepted-session tests intentionally isolate issuer and handler behavior.
	// TestServer_E2E_LocalPasswordFlow covers the real HTTP spend callback before Connect.
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		return nil, err
	}
	trustRoots := x509.NewCertPool()
	if s == nil || s.deviceCA == nil || s.deviceCA.certificate == nil {
		return nil, errors.New("missing test Local UI device CA")
	}
	trustRoots.AddCert(s.deviceCA.certificate)
	return flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{
		TrustRoots:     trustRoots,
		Origin:         strings.TrimRight(s.DisplayURLs()[0], "/"),
		ConnectTimeout: 5 * time.Second,
	})
}

func assertDesktopBridgeSessionReady(t *testing.T, ctx context.Context, current flowersec.Session) {
	t.Helper()
	if _, err := current.ProbeLiveness(ctx); err != nil {
		t.Fatalf("Desktop bridge session liveness error = %v", err)
	}
	var status accessrpc.StatusResponse
	if err := current.RPC().Call(ctx, accessrpc.TypeIDAccessStatus, &struct{}{}, &status); err != nil {
		t.Fatalf("access status RPC through Desktop bridge error = %v", err)
	}
	if status.PasswordRequired {
		t.Fatal("unlocked Desktop bridge session still reports password required")
	}
}

func assertPluginCatalogEventuallyStatus(t *testing.T, client *http.Client, bridgeURL, credential string, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var got int
	var body string
	for time.Now().Before(deadline) {
		got, body = pluginCatalogStatus(t, client, bridgeURL, credential)
		if got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("plugin catalog status = %d, want %d; body=%q", got, want, body)
}

func assertPluginCatalogStatus(t *testing.T, client *http.Client, bridgeURL, credential string, want int) {
	t.Helper()
	got, body := pluginCatalogStatus(t, client, bridgeURL, credential)
	if got != want {
		t.Fatalf("plugin catalog status = %d, want %d; body=%q", got, want, body)
	}
}

func pluginCatalogStatus(t *testing.T, client *http.Client, bridgeURL, credential string) (int, string) {
	t.Helper()
	return pluginRequestStatus(t, client, bridgeURL, credential, http.MethodPost, "/_redevplugin/api/plugins/catalog/query", `{}`)
}

func pluginRequestStatus(t *testing.T, client *http.Client, bridgeURL, credential, method, path, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, bridgeURL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest plugin API error = %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", bridgeURL)
	req.Header.Set("X-ReDevPlugin-CSRF", "redeven-env-v1")
	req.Header.Set(sessionhop.HeaderPluginSessionCredential, credential)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("plugin API request error = %v", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read plugin API response error = %v", err)
	}
	return resp.StatusCode, string(responseBody)
}

func assertPluginCredentialEventuallyRejected(t *testing.T, s *Server, credential string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, ok := s.a.ResolvePluginSessionCredential(credential); !ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("revoked Desktop plugin credential remained active")
}

func assertDirectStateEventuallyEmpty(t *testing.T, s *Server) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var pendingCount, accessBindingCount, authCount int
	for time.Now().Before(deadline) {
		s.pendingMu.Lock()
		pendingCount = len(s.pending)
		s.pendingMu.Unlock()
		s.directMu.Lock()
		accessBindingCount = len(s.activePluginSession)
		for _, access := range s.pluginAccess {
			if access != nil {
				accessBindingCount += len(access.pending)
			}
		}
		s.directMu.Unlock()
		s.authMu.Lock()
		authCount = len(s.handlerCleanup)
		s.authMu.Unlock()
		if pendingCount == 0 && accessBindingCount == 0 && authCount == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Desktop bridge state did not clean up: pending=%d access_bindings=%d auth=%d", pendingCount, accessBindingCount, authCount)
}

func assertSessionEventuallyClosed(t *testing.T, current flowersec.Session) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		_, err := current.ProbeLiveness(ctx)
		cancel()
		if err != nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("revoked Desktop bridge session remained live")
}

func TestServer_E2E_LocalPasswordFlow(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newDesktopBridgeTestServer(t, gate)
	serverURL := "https://" + s.listeners[0].Addr().String()
	trustRoots := x509.NewCertPool()
	trustRoots.AddCert(s.deviceCA.certificate)
	transport := &http.Transport{TLSClientConfig: &tls.Config{
		MinVersion: tls.VersionTLS13,
		RootCAs:    trustRoots,
	}}
	t.Cleanup(transport.CloseIdleConnections)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := &http.Client{Transport: transport, Jar: jar}

	redirectClient := &http.Client{Transport: transport}
	redirectClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	rootResp, err := redirectClient.Get(serverURL + "/")
	if err != nil {
		t.Fatalf("GET / error = %v", err)
	}
	defer rootResp.Body.Close()
	if rootResp.StatusCode != http.StatusFound {
		t.Fatalf("GET / status = %d, want %d", rootResp.StatusCode, http.StatusFound)
	}
	if loc := rootResp.Header.Get("Location"); loc != "/_redeven_proxy/env/" {
		t.Fatalf("GET / location = %q, want %q", loc, "/_redeven_proxy/env/")
	}

	envReq, err := http.NewRequest(http.MethodGet, serverURL+"/_redeven_proxy/env/", nil)
	if err != nil {
		t.Fatalf("NewRequest env error = %v", err)
	}
	envResp, err := client.Do(envReq)
	if err != nil {
		t.Fatalf("GET env shell error = %v", err)
	}
	defer envResp.Body.Close()
	if envResp.StatusCode != http.StatusOK {
		t.Fatalf("GET env shell status = %d, want %d", envResp.StatusCode, http.StatusOK)
	}

	runtimeLockedResp, err := client.Get(serverURL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET locked runtime error = %v", err)
	}
	defer runtimeLockedResp.Body.Close()
	if runtimeLockedResp.StatusCode != http.StatusLocked {
		t.Fatalf("locked runtime status = %d, want %d", runtimeLockedResp.StatusCode, http.StatusLocked)
	}

	wrongUnlockResp, err := client.Post(serverURL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"wrong"}`))
	if err != nil {
		t.Fatalf("POST wrong unlock error = %v", err)
	}
	defer wrongUnlockResp.Body.Close()
	if wrongUnlockResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong unlock status = %d, want %d", wrongUnlockResp.StatusCode, http.StatusUnauthorized)
	}

	unlockResp, err := client.Post(serverURL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST unlock error = %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockResp.StatusCode, http.StatusOK)
	}
	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			Unlocked    bool   `json:"unlocked"`
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(unlockResp.Body).Decode(&unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || !unlockBody.Data.Unlocked || unlockBody.Data.ResumeToken == "" {
		t.Fatalf("unexpected unlock body: %#v", unlockBody)
	}

	headerRuntimeReq, err := http.NewRequest(http.MethodGet, serverURL+"/api/local/runtime", nil)
	if err != nil {
		t.Fatalf("NewRequest header runtime error = %v", err)
	}
	headerRuntimeReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	headerRuntimeResp, err := client.Do(headerRuntimeReq)
	if err != nil {
		t.Fatalf("GET header runtime error = %v", err)
	}
	defer headerRuntimeResp.Body.Close()
	if headerRuntimeResp.StatusCode != http.StatusOK {
		t.Fatalf("header runtime status = %d, want %d", headerRuntimeResp.StatusCode, http.StatusOK)
	}

	runtimeResp, err := client.Get(serverURL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET unlocked runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("unlocked runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	connectInfoResp, err := client.Post(serverURL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST connect_artifact error = %v", err)
	}
	defer connectInfoResp.Body.Close()
	if connectInfoResp.StatusCode != http.StatusOK {
		t.Fatalf("connect_artifact status = %d, want %d", connectInfoResp.StatusCode, http.StatusOK)
	}

	headerConnectReq, err := http.NewRequest(http.MethodPost, serverURL+"/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("NewRequest header connect_artifact error = %v", err)
	}
	headerConnectReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	headerConnectResp, err := client.Do(headerConnectReq)
	if err != nil {
		t.Fatalf("POST header connect_artifact error = %v", err)
	}
	defer headerConnectResp.Body.Close()
	if headerConnectResp.StatusCode != http.StatusOK {
		t.Fatalf("header connect_artifact status = %d, want %d", headerConnectResp.StatusCode, http.StatusOK)
	}

	var connectBody connectArtifactEnvelope
	if err := json.NewDecoder(headerConnectResp.Body).Decode(&connectBody); err != nil {
		t.Fatalf("decode header connect_artifact body error = %v", err)
	}
	corruptArtifact := append([]byte(nil), connectBody.ConnectArtifact...)
	if len(corruptArtifact) < 2 {
		t.Fatal("connect artifact is unexpectedly empty")
	}
	corruptArtifact[len(corruptArtifact)-2] = 'x'
	if _, err := flowersec.ParseArtifact(corruptArtifact); err == nil {
		t.Fatal("tampered Flowersec artifact unexpectedly parsed")
	}
	connectLocalDirectSession(t, s, client, serverURL, s.deviceCA.certificate, unlockBody.Data.ResumeToken, connectBody)
}

func connectLocalDirectSession(t *testing.T, s *Server, httpClient *http.Client, serverURL string, certificate *x509.Certificate, resumeToken string, acquisition connectArtifactEnvelope) {
	t.Helper()
	if s == nil || s.a == nil {
		t.Fatal("test server missing agent")
	}
	artifact, err := flowersec.ParseArtifact(acquisition.ConnectArtifact)
	if err != nil {
		t.Fatalf("ParseArtifact() error = %v", err)
	}
	origin := strings.TrimPrefix(serverURL, "ws://")
	origin = strings.TrimPrefix(origin, "wss://")
	origin = strings.TrimPrefix(origin, "http://")
	origin = strings.TrimPrefix(origin, "https://")
	origin = "https://" + origin

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if certificate == nil {
		t.Fatal("test server certificate unavailable")
	}
	trustRoots := x509.NewCertPool()
	trustRoots.AddCert(certificate)
	attemptID, err := randomB64u(32)
	if err != nil {
		t.Fatalf("create artifact spend attempt error = %v", err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(spendCtx context.Context) error {
		payload := localSpendRequest{
			AttemptID: attemptID, Receipt: acquisition.SpendScope.Receipt,
			ArtifactDigestB64u: acquisition.SpendScope.ArtifactDigestB64u, ProjectionDigestB64u: acquisition.SpendScope.ProjectionDigestB64u,
			LauncherOrigin: acquisition.SpendScope.LauncherOrigin, RuntimeOrigin: acquisition.SpendScope.RuntimeOrigin,
			AppOrigin: acquisition.SpendScope.AppOrigin, Consumer: acquisition.SpendScope.Consumer,
			TargetBinding: acquisition.SpendScope.TargetBinding, ExpiresAt: acquisition.SpendScope.ExpiresAt,
		}
		body, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return marshalErr
		}
		req, requestErr := http.NewRequestWithContext(spendCtx, http.MethodPost, serverURL+"/api/local/direct/artifact/spend", bytes.NewReader(body))
		if requestErr != nil {
			return requestErr
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", serverURL)
		req.Header.Set(localAccessResumeHeader, resumeToken)
		resp, requestErr := httpClient.Do(req)
		if requestErr != nil {
			return requestErr
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			responseBody, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("artifact spend status = %d; body=%q", resp.StatusCode, responseBody)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("NewArtifactLease() error = %v", err)
	}
	client, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: trustRoots, Origin: origin, ConnectTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("ConnectDirect() error = %v", err)
	}
	defer client.Close()
	if _, err := client.ProbeLiveness(ctx); err != nil {
		t.Fatalf("accepted Flowersec session did not remain live: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.directMu.Lock()
		binding, active := s.activePluginSession[acquisition.ChannelID]
		access := s.pluginAccess[binding.accessSessionID]
		s.directMu.Unlock()
		if active && access != nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Flowersec accepted session %q was not bound to plugin access", acquisition.ChannelID)
}

func TestServer_E2E_CodespaceBrowserBootstrapFromResumeToken(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	cfgPath := writeTestConfig(t)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte("<html>codespace</html>"))
		case "/static/workbench.js":
			_, _ = w.Write([]byte("console.log('ok');"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	upstreamPort := upstream.Listener.Addr().(*net.TCPAddr).Port
	appSrv := newTestAppServerWithBackend(t, cfgPath, localUITestCodeSpaceBackend{port: upstreamPort})
	s := newTestServerWithAppServer(t, gate, appSrv, cfgPath)

	srv := httptest.NewServer(s.handler())
	defer srv.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := &http.Client{Jar: jar}

	unlockResp, err := client.Post(srv.URL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST unlock error = %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockResp.StatusCode, http.StatusOK)
	}

	var unlockBody struct {
		OK   bool `json:"ok"`
		Data struct {
			ResumeToken string `json:"resume_token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(unlockResp.Body).Decode(&unlockBody); err != nil {
		t.Fatalf("decode unlock body error = %v", err)
	}
	if !unlockBody.OK || unlockBody.Data.ResumeToken == "" {
		t.Fatalf("unexpected unlock body: %#v", unlockBody)
	}

	codespaceReq, err := http.NewRequest(http.MethodGet, srv.URL+"/cs/demo/?redeven_access_resume="+unlockBody.Data.ResumeToken, nil)
	if err != nil {
		t.Fatalf("NewRequest codespace error = %v", err)
	}
	codespaceReq.Host = "localhost:23998"
	codespaceResp, err := client.Do(codespaceReq)
	if err != nil {
		t.Fatalf("GET codespace error = %v", err)
	}
	defer codespaceResp.Body.Close()
	if codespaceResp.StatusCode != http.StatusOK {
		t.Fatalf("codespace status = %d, want %d", codespaceResp.StatusCode, http.StatusOK)
	}

	assetReq, err := http.NewRequest(http.MethodGet, srv.URL+"/cs/demo/static/workbench.js", nil)
	if err != nil {
		t.Fatalf("NewRequest asset error = %v", err)
	}
	assetReq.Host = "localhost:23998"
	assetResp, err := client.Do(assetReq)
	if err != nil {
		t.Fatalf("GET asset error = %v", err)
	}
	defer assetResp.Body.Close()
	if assetResp.StatusCode != http.StatusOK {
		t.Fatalf("asset status = %d, want %d", assetResp.StatusCode, http.StatusOK)
	}
}

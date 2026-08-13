package localui

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/accessrpc"
	fsrpc "github.com/floegence/redeven/internal/fs"
	"github.com/floegence/redeven/internal/monitor"
	"github.com/floegence/redeven/internal/sessionhop"
	"github.com/floegence/redeven/internal/terminal"
)

func TestServer_E2E_PlaintextLocalhostConnectsDirectSessionOnListenerIP(t *testing.T) {
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

	localhostURL := "http://" + net.JoinHostPort("localhost", fmt.Sprint(port))
	client := &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp4", listener.Addr().String())
		},
	}}
	t.Cleanup(client.CloseIdleConnections)

	resp, err := client.Post(localhostURL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST plaintext localhost connect_artifact error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("plaintext localhost connect_artifact status = %d, want %d; body=%q", resp.StatusCode, http.StatusOK, body)
	}
	var envelope connectArtifactEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode plaintext localhost connect artifact: %v", err)
	}
	var artifactWire struct {
		Path struct {
			Candidates []struct {
				URL string `json:"url"`
			} `json:"candidates"`
		} `json:"path"`
	}
	if err := json.Unmarshal(envelope.ConnectArtifact, &artifactWire); err != nil {
		t.Fatalf("decode plaintext localhost artifact candidate: %v", err)
	}
	wantCandidate := "ws://" + listener.Addr().String() + flowersec.WebSocketDirectPath
	if len(artifactWire.Path.Candidates) != 1 || artifactWire.Path.Candidates[0].URL != wantCandidate {
		t.Fatalf("plaintext localhost artifact candidates = %#v, want %q", artifactWire.Path.Candidates, wantCandidate)
	}

	connectCtx, connectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connectCancel()
	current := connectDesktopBridgeArtifact(t, connectCtx, envelope.ConnectArtifact, localhostURL)
	defer current.Close()

	var monitorResponse map[string]any
	if err := current.RPC().Call(connectCtx, monitor.TypeID_SYS_MONITOR, map[string]any{}, &monitorResponse); err != nil {
		t.Fatalf("monitor RPC through plaintext localhost direct session error = %v", err)
	}
	var pathContext map[string]any
	if err := current.RPC().Call(connectCtx, fsrpc.TypeID_FS_GET_PATH_CONTEXT, map[string]any{}, &pathContext); err != nil {
		t.Fatalf("filesystem path context RPC through plaintext localhost direct session error = %v", err)
	}
	homePath, _ := pathContext["home_path_abs"].(string)
	if homePath == "" {
		t.Fatalf("filesystem path context response is missing home_path_abs: %#v", pathContext)
	}
	var listResponse map[string]any
	if err := current.RPC().Call(connectCtx, fsrpc.TypeID_FS_LIST, map[string]any{"path": homePath}, &listResponse); err != nil {
		t.Fatalf("filesystem list RPC through plaintext localhost direct session error = %v", err)
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

func TestServer_E2E_DesktopBridgeDynamicLoopbackOriginConnectsDirectSession(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)

	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	envelope := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
	client := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
	assertDesktopBridgeSessionReady(t, ctx, client)
	_ = client.Close()
	assertDirectStateEventuallyEmpty(t, s)
}

func TestServer_E2E_DesktopBridgePluginAccessSurvivesAdmissionExpiry(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()

	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	envelope := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
	current := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
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
	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()
	envelope := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")

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
	if _, err := connectDesktopBridgeArtifactResult(ctx, envelope.ConnectArtifact, bridge.URL); err == nil {
		t.Fatal("expired unused Desktop bridge artifact connected")
	}
	assertDirectStateEventuallyEmpty(t, s)
}

func TestServer_E2E_DesktopBridgePluginScopeRevokeRemovesActiveBinding(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	s.appServer = s.a.CodeAppServer()
	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	envelope := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
	current := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
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
	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var previousCredential string
	for attempt := 1; attempt <= 2; attempt++ {
		envelope := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
		if envelope.PluginSessionCredential == previousCredential {
			t.Fatal("consecutive Desktop sessions reused a plugin credential")
		}
		current := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
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
		var history struct {
			FirstRetainedSequence  int64 `json:"first_retained_sequence"`
			CoveredThroughSequence int64 `json:"covered_through_sequence"`
			SnapshotEndSequence    int64 `json:"snapshot_end_sequence"`
			HistoryGeneration      int64 `json:"history_generation"`
		}
		if err := current.RPC().Call(ctx, terminal.TypeID_TERMINAL_HISTORY, map[string]any{
			"session_id": created.Session.ID,
			"start_seq":  1,
			"end_seq":    -1,
		}, &history); err != nil {
			t.Fatalf("terminal history RPC on Desktop bridge session %d error = %v", attempt, err)
		}
		if history.HistoryGeneration <= 0 || history.FirstRetainedSequence < 0 || history.CoveredThroughSequence < 0 ||
			history.CoveredThroughSequence > history.SnapshotEndSequence {
			t.Fatalf("terminal history contract on Desktop bridge session %d = %+v", attempt, history)
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
	firstBridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer firstBridge.Close()
	secondBridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer secondBridge.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	firstArtifact := mintDesktopBridgeArtifact(t, firstBridge.Client(), firstBridge.URL, "")
	secondArtifact := mintDesktopBridgeArtifact(t, secondBridge.Client(), secondBridge.URL, "")
	if firstArtifact.ChannelID == secondArtifact.ChannelID {
		t.Fatalf("Desktop windows shared channel ID %q", firstArtifact.ChannelID)
	}
	firstSession := connectDesktopBridgeArtifact(t, ctx, firstArtifact.ConnectArtifact, firstBridge.URL)
	defer firstSession.Close()
	secondSession := connectDesktopBridgeArtifact(t, ctx, secondArtifact.ConnectArtifact, secondBridge.URL)
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

	crossArtifact := mintDesktopBridgeArtifact(t, firstBridge.Client(), firstBridge.URL, "")
	if _, err := connectDesktopBridgeArtifactResult(ctx, crossArtifact.ConnectArtifact, secondBridge.URL); err == nil {
		t.Fatal("artifact minted for the first Desktop window connected with the second window Origin")
	}
	s.releaseAcceptedSession(crossArtifact.ChannelID)
	if _, err := connectDesktopBridgeArtifactResult(ctx, firstArtifact.ConnectArtifact, firstBridge.URL); err == nil {
		t.Fatal("consumed Desktop artifact connected a second time")
	}

	_ = firstSession.Close()
	_ = secondSession.Close()
	assertDirectStateEventuallyEmpty(t, s)
}

func TestServer_E2E_DesktopBridgeRestartRevokesOldState(t *testing.T) {
	oldServer := newDesktopBridgeTestServer(t, nil)
	oldBridge := httptest.NewServer(oldServer.HandlerForDesktopBridge())
	oldArtifact := mintDesktopBridgeArtifact(t, oldBridge.Client(), oldBridge.URL, "")
	oldBridge.Close()

	oldConnectCtx, oldConnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	_, oldConnectErr := connectDesktopBridgeArtifactResult(oldConnectCtx, oldArtifact.ConnectArtifact, oldBridge.URL)
	oldConnectCancel()
	if oldConnectErr == nil {
		t.Fatal("artifact connected after its Desktop bridge closed")
	}
	if err := oldServer.Close(); err != nil {
		t.Fatalf("old Server.Close() error = %v", err)
	}
	assertDirectStateEventuallyEmpty(t, oldServer)

	newServer := newDesktopBridgeTestServer(t, nil)
	newBridge := httptest.NewServer(newServer.HandlerForDesktopBridge())
	defer newBridge.Close()
	newArtifact := mintDesktopBridgeArtifact(t, newBridge.Client(), newBridge.URL, "")
	newConnectCtx, newConnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer newConnectCancel()
	newSession := connectDesktopBridgeArtifact(t, newConnectCtx, newArtifact.ConnectArtifact, newBridge.URL)
	assertDesktopBridgeSessionReady(t, newConnectCtx, newSession)
	_ = newSession.Close()
	assertDirectStateEventuallyEmpty(t, newServer)
}

func TestServer_E2E_DesktopBridgeSecurityDoesNotExpandPublicListener(t *testing.T) {
	s := newDesktopBridgeTestServer(t, nil)
	bridge := httptest.NewServer(s.HandlerForDesktopBridge())
	defer bridge.Close()
	artifact := mintDesktopBridgeArtifact(t, bridge.Client(), bridge.URL, "")
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
			if origin != "" {
				req.Header.Set("Origin", origin)
			}
			res := httptest.NewRecorder()
			s.HandlerForDesktopBridge().ServeHTTP(res, req)
			if res.Code != http.StatusForbidden {
				t.Fatalf("bridge websocket status = %d, want %d", res.Code, http.StatusForbidden)
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
		bridge := httptest.NewServer(s.HandlerForDesktopBridge())
		defer bridge.Close()
		client := bridgeClientWithCookies(t, bridge)
		resumeToken := unlockDesktopBridge(t, client, bridge.URL)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		envelope := mintDesktopBridgeArtifact(t, client, bridge.URL, resumeToken)
		current := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
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
		if _, err := connectDesktopBridgeArtifactResult(ctx, envelope.ConnectArtifact, bridge.URL); err == nil {
			t.Fatal("logged-out Desktop artifact reconnected")
		}

		newResumeToken := unlockDesktopBridge(t, client, bridge.URL)
		newEnvelope := mintDesktopBridgeArtifact(t, client, bridge.URL, newResumeToken)
		newSession := connectDesktopBridgeArtifact(t, ctx, newEnvelope.ConnectArtifact, bridge.URL)
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
		bridge := httptest.NewServer(s.HandlerForDesktopBridge())
		defer bridge.Close()
		client := bridgeClientWithCookies(t, bridge)
		resumeToken := unlockDesktopBridge(t, client, bridge.URL)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		envelope := mintDesktopBridgeArtifact(t, client, bridge.URL, resumeToken)
		current := connectDesktopBridgeArtifact(t, ctx, envelope.ConnectArtifact, bridge.URL)
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
		if _, err := connectDesktopBridgeArtifactResult(ctx, envelope.ConnectArtifact, bridge.URL); err == nil {
			t.Fatal("expired Desktop artifact reconnected")
		}
	})
}

func newDesktopBridgeTestServer(t *testing.T, gate *accessgate.Gate) *Server {
	t.Helper()
	s := newTestServer(t, gate)
	s.a = newRuntimeHealthTestAgent(t, s.configPath)
	s.networkAuthorities = map[string]struct{}{"127.0.0.1:23998": {}}
	if err := s.configureAcceptor(); err != nil {
		t.Fatalf("configureAcceptor() error = %v", err)
	}
	return s
}

func bridgeClientWithCookies(t *testing.T, bridge *httptest.Server) *http.Client {
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

func mintDesktopBridgeArtifact(t *testing.T, client *http.Client, bridgeURL, resumeToken string) connectArtifactEnvelope {
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
	wantURL := "ws" + strings.TrimPrefix(bridgeURL, "http") + flowersec.WebSocketDirectPath
	if len(artifactWire.Path.Candidates) != 1 || artifactWire.Path.Candidates[0].URL != wantURL {
		t.Fatalf("bridge artifact candidates = %#v, want %q", artifactWire.Path.Candidates, wantURL)
	}
	return envelope
}

func connectDesktopBridgeArtifact(t *testing.T, ctx context.Context, encodedArtifact json.RawMessage, origin string) flowersec.Session {
	t.Helper()
	current, err := connectDesktopBridgeArtifactResult(ctx, encodedArtifact, origin)
	if err != nil {
		t.Fatalf("Connect() through Desktop bridge error = %v", err)
	}
	return current
}

func connectDesktopBridgeArtifactResult(ctx context.Context, encodedArtifact json.RawMessage, origin string) (flowersec.Session, error) {
	artifact, err := flowersec.ParseArtifact(encodedArtifact)
	if err != nil {
		return nil, err
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		return nil, err
	}
	return flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{Origin: origin, ConnectTimeout: 5 * time.Second})
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
		authCount = len(s.authRecords) + len(s.authChannels) + len(s.handlerCleanup)
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
	s := newTestServer(t, gate)
	s.a = newRuntimeHealthTestAgent(t, s.configPath)

	srv := httptest.NewTLSServer(s.handler())
	defer srv.Close()
	s.authorityMu.Lock()
	if s.networkAuthorities == nil {
		s.networkAuthorities = make(map[string]struct{})
	}
	s.networkAuthorities[srv.Listener.Addr().String()] = struct{}{}
	s.authorityMu.Unlock()
	if err := s.configureAcceptor(); err != nil {
		t.Fatalf("configureAcceptor() error = %v", err)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("cookiejar.New() error = %v", err)
	}
	client := srv.Client()
	client.Jar = jar

	redirectClient := srv.Client()
	redirectClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	rootResp, err := redirectClient.Get(srv.URL + "/")
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

	envReq, err := http.NewRequest(http.MethodGet, srv.URL+"/_redeven_proxy/env/", nil)
	if err != nil {
		t.Fatalf("NewRequest env error = %v", err)
	}
	envReq.Host = "localhost:23998"
	envResp, err := client.Do(envReq)
	if err != nil {
		t.Fatalf("GET env shell error = %v", err)
	}
	defer envResp.Body.Close()
	if envResp.StatusCode != http.StatusOK {
		t.Fatalf("GET env shell status = %d, want %d", envResp.StatusCode, http.StatusOK)
	}

	runtimeLockedResp, err := client.Get(srv.URL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET locked runtime error = %v", err)
	}
	defer runtimeLockedResp.Body.Close()
	if runtimeLockedResp.StatusCode != http.StatusLocked {
		t.Fatalf("locked runtime status = %d, want %d", runtimeLockedResp.StatusCode, http.StatusLocked)
	}

	wrongUnlockResp, err := client.Post(srv.URL+"/api/local/access/unlock", "application/json", bytes.NewBufferString(`{"password":"wrong"}`))
	if err != nil {
		t.Fatalf("POST wrong unlock error = %v", err)
	}
	defer wrongUnlockResp.Body.Close()
	if wrongUnlockResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong unlock status = %d, want %d", wrongUnlockResp.StatusCode, http.StatusUnauthorized)
	}

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

	headerRuntimeReq, err := http.NewRequest(http.MethodGet, srv.URL+"/api/local/runtime", nil)
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

	runtimeResp, err := client.Get(srv.URL + "/api/local/runtime")
	if err != nil {
		t.Fatalf("GET unlocked runtime error = %v", err)
	}
	defer runtimeResp.Body.Close()
	if runtimeResp.StatusCode != http.StatusOK {
		t.Fatalf("unlocked runtime status = %d, want %d", runtimeResp.StatusCode, http.StatusOK)
	}

	connectInfoResp, err := client.Post(srv.URL+"/api/local/direct/connect_artifact", "application/json", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("POST connect_artifact error = %v", err)
	}
	defer connectInfoResp.Body.Close()
	if connectInfoResp.StatusCode != http.StatusOK {
		t.Fatalf("connect_artifact status = %d, want %d", connectInfoResp.StatusCode, http.StatusOK)
	}

	headerConnectReq, err := http.NewRequest(http.MethodPost, srv.URL+"/api/local/direct/connect_artifact", bytes.NewBufferString(`{}`))
	if err != nil {
		t.Fatalf("NewRequest header connect_artifact error = %v", err)
	}
	headerConnectReq.Header.Set(localAccessResumeHeader, unlockBody.Data.ResumeToken)
	headerConnectResp, err := srv.Client().Do(headerConnectReq)
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
	connectLocalDirectSession(t, s, srv.URL, srv.Certificate(), unlockBody.Data.ResumeToken, connectBody.ChannelID, connectBody.ConnectArtifact)
}

func connectLocalDirectSession(t *testing.T, s *Server, serverURL string, certificate *x509.Certificate, resumeToken, channelID string, encodedArtifact json.RawMessage) {
	t.Helper()
	if s == nil || s.a == nil {
		t.Fatal("test server missing agent")
	}
	artifact, err := flowersec.ParseArtifact(encodedArtifact)
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
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
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
		binding, active := s.activePluginSession[channelID]
		access := s.pluginAccess[binding.accessSessionID]
		s.directMu.Unlock()
		if active && access != nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Flowersec accepted session %q was not bound to plugin access", channelID)
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

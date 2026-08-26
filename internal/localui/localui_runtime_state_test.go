package localui

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redeven/internal/runtimemanagement"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
func newRuntimeControlTestAgent(t *testing.T, cfgPath string) *agent.Agent {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	a, err := agent.New(agent.Options{
		Config: &config.Config{
			AgentHomeDir:     t.TempDir(),
			PermissionPolicy: policy,
		},
		ConfigPath:       cfgPath,
		InstanceID:       "rt_test",
		LocalUIEnabled:   true,
		EffectiveRunMode: "desktop",
	})
	if err != nil {
		t.Fatalf("agent.New() error = %v", err)
	}
	runTestAgentUntilCleanup(t, a)
	return a
}

func TestServerStartPublishesRuntimeControlStatus(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()

	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              filepath.Dir(filepath.Dir(cfgPath)),
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		appServer:              newTestAppServer(t, cfgPath),
		diag: func() *diagnostics.Store {
			store, err := diagnostics.New(diagnostics.Options{
				Logger:   discardLogger(),
				StateDir: filepath.Dir(cfgPath),
				Source:   diagnostics.SourceAgent,
			})
			if err != nil {
				t.Fatalf("diagnostics.New() error = %v", err)
			}
			return store
		}(),
		a:        newRuntimeControlTestAgent(t, cfgPath),
		pending:  make(map[string]pendingDirect),
		deviceCA: newTestLocalUIDeviceCA(t),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	status, err := runtimemanagement.LoadStatus(ctx, s.runtimeControlSockPath, time.Second)
	if err != nil {
		t.Fatalf("LoadStatus() error = %v", err)
	}
	if status.State != runtimemanagement.AttachStateReady || status.Endpoint == nil {
		t.Fatalf("unexpected runtime status: %#v", status)
	}
	if status.Endpoint.LocalUIURL == "" || len(status.Endpoint.LocalUIURLs) == 0 {
		t.Fatalf("unexpected runtime endpoint: %#v", status.Endpoint)
	}
	if status.Endpoint.LocalUIBridgeURL == "" {
		t.Fatalf("missing trusted Local UI bridge endpoint: %#v", status.Endpoint)
	}
	if slices.Contains(status.Endpoint.LocalUIURLs, status.Endpoint.LocalUIBridgeURL) {
		t.Fatalf("trusted bridge URL leaked into public Local UI URLs: %#v", status.Endpoint)
	}
	if status.Endpoint.PasswordRequired {
		t.Fatalf("PasswordRequired = true, want false")
	}
	if status.Identity.StateDir != filepath.Dir(cfgPath) {
		t.Fatalf("unexpected identity metadata: %#v", status.Identity)
	}
	if status.Endpoint.RuntimeControl == nil ||
		status.Endpoint.RuntimeControl.ProtocolVersion != "redeven-runtime-control-v2" ||
		status.Endpoint.RuntimeControl.BaseURL == "" ||
		status.Endpoint.RuntimeControl.Token == "" {
		t.Fatalf("unexpected runtime-control endpoint: %#v", status.Endpoint.RuntimeControl)
	}

	forwardedAuthority := "127.0.0.1:54321"
	publicReq, err := http.NewRequestWithContext(ctx, http.MethodGet, status.Endpoint.LocalUIURL+"api/local/runtime/health", nil)
	if err != nil {
		t.Fatalf("NewRequest(public) error = %v", err)
	}
	publicReq.Host = forwardedAuthority
	trustRoots := x509.NewCertPool()
	trustRoots.AddCert(s.deviceCA.certificate)
	publicClient := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		MinVersion: tls.VersionTLS13,
		RootCAs:    trustRoots,
	}}}
	t.Cleanup(publicClient.CloseIdleConnections)
	publicResp, err := publicClient.Do(publicReq)
	if err != nil {
		t.Fatalf("Do(public) error = %v", err)
	}
	_ = publicResp.Body.Close()
	if publicResp.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("public listener status = %d, want %d", publicResp.StatusCode, http.StatusMisdirectedRequest)
	}

	bridgeReq, err := http.NewRequestWithContext(ctx, http.MethodGet, status.Endpoint.LocalUIBridgeURL+"api/local/runtime/health", nil)
	if err != nil {
		t.Fatalf("NewRequest(bridge) error = %v", err)
	}
	bridgeReq.Host = forwardedAuthority
	bridgeReq.Header.Set("Origin", "http://"+forwardedAuthority)
	bridgeReq.Header.Set(localDesktopBridgeTokenHeader, status.Endpoint.LocalUIBridgeToken)
	bridgeResp, err := http.DefaultClient.Do(bridgeReq)
	if err != nil {
		t.Fatalf("Do(bridge) error = %v", err)
	}
	defer bridgeResp.Body.Close()
	if bridgeResp.StatusCode != http.StatusOK {
		t.Fatalf("trusted bridge listener status = %d, want %d", bridgeResp.StatusCode, http.StatusOK)
	}
	var healthPayload struct {
		Data struct {
			LocalUIURL  string   `json:"local_ui_url"`
			LocalUIURLs []string `json:"local_ui_urls"`
		} `json:"data"`
	}
	if err := json.NewDecoder(bridgeResp.Body).Decode(&healthPayload); err != nil {
		t.Fatalf("Decode(bridge health) error = %v", err)
	}
	if healthPayload.Data.LocalUIURL != status.Endpoint.LocalUIURL {
		t.Fatalf("bridge health local_ui_url = %q, want public %q", healthPayload.Data.LocalUIURL, status.Endpoint.LocalUIURL)
	}
	if !slices.Equal(healthPayload.Data.LocalUIURLs, status.Endpoint.LocalUIURLs) {
		t.Fatalf("bridge health local_ui_urls = %#v, want public %#v", healthPayload.Data.LocalUIURLs, status.Endpoint.LocalUIURLs)
	}
	if slices.Contains(healthPayload.Data.LocalUIURLs, status.Endpoint.LocalUIBridgeURL) {
		t.Fatalf("bridge health exposed local_ui_bridge_url in public URL list: %#v", healthPayload.Data.LocalUIURLs)
	}

	bridgeURL := status.Endpoint.LocalUIBridgeURL
	if err := s.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	closedCtx, closedCancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer closedCancel()
	closedReq, err := http.NewRequestWithContext(closedCtx, http.MethodGet, bridgeURL+"api/local/runtime/health", nil)
	if err != nil {
		t.Fatalf("NewRequest(closed bridge) error = %v", err)
	}
	if closedResp, err := http.DefaultClient.Do(closedReq); err == nil {
		_ = closedResp.Body.Close()
		t.Fatalf("trusted bridge listener remained reachable after Close()")
	}
}

func TestServerStartDesktopModeUsesOnlyPrivateBridgeWithoutDeviceCA(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	stateRoot := t.TempDir()
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-private-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()
	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              stateRoot,
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		desktopPrivateAccess:   true,
		effectiveRunMode:       "local",
		appServer:              newTestAppServer(t, cfgPath),
		a:                      newRuntimeControlTestAgent(t, cfgPath),
		pending:                make(map[string]pendingDirect),
		directAuthorities:      make(map[string]string),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() without device CA error = %v", err)
	}
	defer func() { _ = s.Close() }()

	status, err := runtimemanagement.LoadStatus(ctx, s.runtimeControlSockPath, time.Second)
	if err != nil {
		t.Fatalf("LoadStatus() error = %v", err)
	}
	if status.State != runtimemanagement.AttachStateReady || status.Endpoint == nil {
		t.Fatalf("unexpected runtime status: %#v", status)
	}
	if status.Endpoint.LocalUIURL != "" || len(status.Endpoint.LocalUIURLs) != 0 {
		t.Fatalf("Desktop-only Runtime published public Local UI URLs: %#v", status.Endpoint)
	}
	if status.Endpoint.LocalUIBridgeURL == "" || status.Endpoint.LocalUIBridgeToken == "" {
		t.Fatalf("Desktop-only Runtime did not publish its private bridge: %#v", status.Endpoint)
	}
	if s.srv != nil || len(s.listeners) != 0 || len(s.directServers) != 0 {
		t.Fatalf("Desktop-only Runtime created public listeners")
	}
	if s.deviceCA != nil {
		t.Fatal("Desktop-only Runtime loaded a device CA")
	}
	if _, err := os.Stat(filepath.Join(stateRoot, localUIDeviceCADirName)); !os.IsNotExist(err) {
		t.Fatalf("Desktop-only Runtime created device CA state: %v", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, status.Endpoint.LocalUIBridgeURL+"api/local/runtime/health", nil)
	if err != nil {
		t.Fatalf("NewRequest(bridge) error = %v", err)
	}
	req.Header.Set(localDesktopBridgeTokenHeader, status.Endpoint.LocalUIBridgeToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do(bridge) error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Desktop bridge health status = %d", resp.StatusCode)
	}
}

func TestServerRuntimeControlUsesStructuredAuthErrors(t *testing.T) {
	cfgPath := writeTestConfig(t)
	bind, err := ParseBind("127.0.0.1:0")
	if err != nil {
		t.Fatalf("ParseBind() error = %v", err)
	}
	socketDir, err := os.MkdirTemp("/tmp", "rdv-localui-*")
	if err != nil {
		t.Fatalf("MkdirTemp() error = %v", err)
	}
	defer func() { _ = os.RemoveAll(socketDir) }()
	a := newRuntimeControlTestAgent(t, cfgPath)
	s := &Server{
		log:                    discardLogger(),
		bind:                   bind,
		configPath:             cfgPath,
		stateRoot:              filepath.Dir(filepath.Dir(cfgPath)),
		stateDir:               filepath.Dir(cfgPath),
		runtimeControlSockPath: filepath.Join(socketDir, "control.sock"),
		version:                "dev",
		appServer:              newTestAppServer(t, cfgPath),
		a:                      a,
		pending:                make(map[string]pendingDirect),
		deviceCA:               newTestLocalUIDeviceCA(t),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer func() { _ = s.Close() }()

	endpoint := s.RuntimeControlEndpointForDesktopBridge()
	if endpoint == nil {
		t.Fatalf("missing runtime-control endpoint")
	}

	req, err := http.NewRequest(http.MethodPost, endpoint.BaseURL+"/v2/provider-link", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+endpoint.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("StatusCode = %d, want %d", resp.StatusCode, http.StatusMethodNotAllowed)
	}
	var envelope struct {
		OK    bool `json:"ok"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if envelope.OK || envelope.Error == nil || envelope.Error.Code != "RUNTIME_CONTROL_METHOD_NOT_ALLOWED" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
}

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
	rpcwirev1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/rpc/v1"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
)

type providerDisconnectFakeRPC struct {
	mu       sync.Mutex
	typeID   uint32
	payload  json.RawMessage
	rpcError *rpcwirev1.RpcError
	err      error
}

func (f *providerDisconnectFakeRPC) Call(_ context.Context, typeID uint32, payload json.RawMessage) (json.RawMessage, *rpcwirev1.RpcError, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.typeID = typeID
	f.payload = append(f.payload[:0], payload...)
	if f.err != nil || f.rpcError != nil {
		return nil, f.rpcError, f.err
	}
	resp, err := json.Marshal(runtimeDisconnectResp{
		OK:         true,
		Cleared:    true,
		State:      "disconnected",
		ReasonCode: "runtime_disconnected",
	})
	return resp, nil, err
}

func providerLinkRemoteConfig(t *testing.T, cfgPath string) *config.Config {
	t.Helper()
	cfg := &config.Config{
		ControlplaneBaseURL:      "https://provider.example.test",
		ControlplaneProviderID:   "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        7,
		AgentInstanceID:          "ai_existing",
		Direct: &directv1.DirectConnectInfo{
			WsUrl:                    "ws://127.0.0.1:1/control/ws",
			ChannelId:                "ch_existing",
			E2eePskB64u:              "cHNr",
			ChannelInitExpireAtUnixS: 4102444800,
		},
		AgentHomeDir: t.TempDir(),
	}
	if cfgPath != "" {
		if err := config.Save(cfgPath, cfg); err != nil {
			t.Fatalf("config.Save() error = %v", err)
		}
	}
	return cfg
}

func linkProviderControlForTest(a *Agent, caller *providerDisconnectFakeRPC) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.controlChannelEnabled = true
	a.remoteEnabled = true
	a.effectiveRunMode = "hybrid"
	a.controlRPCSerial++
	a.controlRPC = caller
}

func newProviderLinkTestAgent(t *testing.T, cfgPath string, cfg *config.Config) *Agent {
	t.Helper()
	if cfg == nil {
		policy, err := config.ParsePermissionPolicyPreset("")
		if err != nil {
			t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
		}
		cfg = &config.Config{
			AgentHomeDir:     t.TempDir(),
			PermissionPolicy: policy,
		}
	}
	a, err := New(Options{
		Config:           cfg,
		ConfigPath:       cfgPath,
		LocalUIEnabled:   true,
		DesktopManaged:   true,
		EffectiveRunMode: "desktop",
		Version:          "dev",
	})
	if err != nil {
		t.Fatalf("agent.New() error = %v", err)
	}
	return a
}

func providerLinkTestServer(t *testing.T, handler func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"example_control_plane"}`))
			return
		}
		handler(w, r)
	}))
}

func writeProviderLinkBootstrapResponse(t *testing.T, w http.ResponseWriter, r *http.Request, channelID string) {
	t.Helper()
	if r.Method != http.MethodPost || r.URL.Path != "/api/rcpp/v1/runtime/bootstrap/exchange" {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}
	if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
		t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
	}
	var payload struct {
		EnvPublicID              string `json:"env_public_id"`
		LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode(request) error = %v", err)
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{
  "direct": {
    "ws_url": "ws://127.0.0.1:1/control/ws",
    "channel_id": "` + channelID + `",
    "e2ee_psk_b64u": "cHNr",
    "channel_init_expire_at_unix_s": 4102444800
  },
  "local_environment_binding": {
    "local_environment_public_id": "` + payload.LocalEnvironmentPublicID + `",
    "env_public_id": "` + payload.EnvPublicID + `",
    "generation": 7
  }
}`))
}

func TestConnectProviderPersistsConfigOnlyAfterBootstrapSucceeds(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := newProviderLinkTestAgent(t, cfgPath, nil)
	server := providerLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "ticket expired", http.StatusUnauthorized)
	})
	defer server.Close()

	_, err := a.ConnectProvider(context.Background(), ProviderLinkRequest{
		ProviderOrigin:  server.URL,
		ProviderID:      "example_control_plane",
		EnvPublicID:     "env_demo",
		BootstrapTicket: "ticket-123",
	})
	if err == nil {
		t.Fatalf("ConnectProvider() error = nil, want bootstrap failure")
	}
	var linkErr *ProviderLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != ProviderLinkErrorBootstrapFailed {
		t.Fatalf("ConnectProvider() error = %v, want %s", err, ProviderLinkErrorBootstrapFailed)
	}
	if binding := a.ProviderLinkBinding(); binding.State != runtimeservice.ProviderLinkStateUnbound {
		t.Fatalf("ProviderLinkBinding() = %#v, want unbound", binding)
	}
	if _, loadErr := config.Load(cfgPath); loadErr == nil || !strings.Contains(loadErr.Error(), "no such file") {
		t.Fatalf("config.Load() error = %v, want no saved config", loadErr)
	}
}

func TestConnectProviderRechecksActiveWorkBeforePersistingConfig(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	initial := &config.Config{
		ControlplaneBaseURL:      "https://old.example.invalid",
		ControlplaneProviderID:   "old_provider",
		EnvironmentID:            "env_old",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        1,
		AgentInstanceID:          "ai_existing",
		Direct: &directv1.DirectConnectInfo{
			WsUrl:                    "ws://127.0.0.1:1/control/ws",
			ChannelId:                "ch_old",
			E2eePskB64u:              "cHNr",
			ChannelInitExpireAtUnixS: 4102444800,
		},
		AgentHomeDir: t.TempDir(),
	}
	if err := config.Save(cfgPath, initial); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}
	a := newProviderLinkTestAgent(t, cfgPath, initial)
	releaseExchange := make(chan struct{})
	exchangeStarted := make(chan struct{})
	server := providerLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		close(exchangeStarted)
		<-releaseExchange
		writeProviderLinkBootstrapResponse(t, w, r, "ch_new")
	})
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		_, err := a.ConnectProvider(context.Background(), ProviderLinkRequest{
			ProviderOrigin:         server.URL,
			ProviderID:             "example_control_plane",
			EnvPublicID:            "env_new",
			BootstrapTicket:        "ticket-123",
			AllowRelinkWhenIdle:    true,
			ExpectedProviderOrigin: initial.ControlplaneBaseURL,
			ExpectedProviderID:     initial.ControlplaneProviderID,
			ExpectedEnvPublicID:    initial.EnvironmentID,
			ExpectedGeneration:     initial.BindingGeneration,
		})
		errCh <- err
	}()

	select {
	case <-exchangeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("provider bootstrap exchange did not start")
	}
	a.mu.Lock()
	a.sessions["ch_provider_active"] = &activeSession{
		meta:              session.Meta{EndpointID: "env_old"},
		connectedAtUnixMs: time.Now().UnixMilli(),
	}
	a.mu.Unlock()
	close(releaseExchange)

	select {
	case err := <-errCh:
		var linkErr *ProviderLinkError
		if !errors.As(err, &linkErr) || linkErr.Code != ProviderLinkErrorActiveWork {
			t.Fatalf("ConnectProvider() error = %v, want %s", err, ProviderLinkErrorActiveWork)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ConnectProvider() did not return")
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if cfg.ControlplaneBaseURL != initial.ControlplaneBaseURL ||
		cfg.EnvironmentID != initial.EnvironmentID ||
		cfg.BindingGeneration != initial.BindingGeneration ||
		cfg.Direct == nil ||
		cfg.Direct.ChannelId != "ch_old" {
		t.Fatalf("config changed after blocked relink: %#v", cfg)
	}
	if binding := a.ProviderLinkBinding(); binding.EnvPublicID != "env_old" || binding.BindingGeneration != 1 {
		t.Fatalf("ProviderLinkBinding() changed after blocked relink: %#v", binding)
	}
}

func TestConnectProviderRefreshesExistingMatchingBindingWhenExplicitlyRequested(t *testing.T) {
	server := providerLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeProviderLinkBootstrapResponse(t, w, r, "ch_refreshed")
	})
	defer server.Close()

	cfg := &config.Config{
		ControlplaneBaseURL:      server.URL,
		ControlplaneProviderID:   "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        3,
		AgentInstanceID:          "ai_existing",
		Direct: &directv1.DirectConnectInfo{
			WsUrl:                    "ws://127.0.0.1:1/control/ws",
			ChannelId:                "ch_existing",
			E2eePskB64u:              "cHNr",
			ChannelInitExpireAtUnixS: 4102444800,
		},
		AgentHomeDir: t.TempDir(),
	}
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}
	a := newProviderLinkTestAgent(t, cfgPath, cfg)

	before := a.RuntimeServiceSnapshot()
	if before.RemoteEnabled {
		t.Fatalf("RemoteEnabled before connect = true, want false")
	}
	if before.EffectiveRunMode != "desktop" {
		t.Fatalf("EffectiveRunMode before connect = %q, want desktop", before.EffectiveRunMode)
	}
	if before.Bindings.ProviderLink.State != runtimeservice.ProviderLinkStateLinked || before.Bindings.ProviderLink.RemoteEnabled {
		t.Fatalf("ProviderLink before connect = %#v, want linked but remote disabled", before.Bindings.ProviderLink)
	}

	resp, err := a.ConnectProvider(context.Background(), ProviderLinkRequest{
		ProviderOrigin:  server.URL,
		ProviderID:      "example_control_plane",
		EnvPublicID:     "env_demo",
		BootstrapTicket: "ticket-123",
	})
	if err != nil {
		t.Fatalf("ConnectProvider() error = %v", err)
	}
	if resp.Binding.State != runtimeservice.ProviderLinkStateLinked || !resp.Binding.RemoteEnabled {
		t.Fatalf("ConnectProvider() binding = %#v, want linked with remote enabled", resp.Binding)
	}
	after := a.RuntimeServiceSnapshot()
	if !after.RemoteEnabled || after.EffectiveRunMode != "hybrid" {
		t.Fatalf("RuntimeServiceSnapshot() after connect = %#v, want hybrid remote enabled", after)
	}
	if after.Bindings.ProviderLink.State != runtimeservice.ProviderLinkStateLinked || !after.Bindings.ProviderLink.RemoteEnabled {
		t.Fatalf("ProviderLink after connect = %#v, want linked remote enabled", after.Bindings.ProviderLink)
	}
	saved, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if saved.Direct == nil || saved.Direct.ChannelId != "ch_refreshed" {
		t.Fatalf("saved Direct = %#v, want refreshed channel", saved.Direct)
	}
	if saved.BindingGeneration != 7 {
		t.Fatalf("BindingGeneration = %d, want refreshed generation 7", saved.BindingGeneration)
	}
}

func TestDisconnectProviderSendsRuntimeDisconnectBeforeClearingConfig(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := providerLinkRemoteConfig(t, cfgPath)
	a := newProviderLinkTestAgent(t, cfgPath, cfg)
	fakeRPC := &providerDisconnectFakeRPC{}
	linkProviderControlForTest(a, fakeRPC)

	resp, err := a.DisconnectProvider(context.Background())
	if err != nil {
		t.Fatalf("DisconnectProvider() error = %v", err)
	}
	if resp.Binding.State != runtimeservice.ProviderLinkStateUnbound || resp.Binding.LastDisconnectedAtUnixMS <= 0 {
		t.Fatalf("DisconnectProvider() binding = %#v, want unbound with disconnect time", resp.Binding)
	}

	fakeRPC.mu.Lock()
	gotTypeID := fakeRPC.typeID
	gotPayload := append([]byte(nil), fakeRPC.payload...)
	fakeRPC.mu.Unlock()
	if gotTypeID != controlRPCTypeRuntimeDisconnect {
		t.Fatalf("runtime disconnect RPC type = %d, want %d", gotTypeID, controlRPCTypeRuntimeDisconnect)
	}
	var req runtimeDisconnectReq
	if err := json.Unmarshal(gotPayload, &req); err != nil {
		t.Fatalf("Unmarshal(runtime disconnect request) error = %v", err)
	}
	if req.EnvPublicID != "env_demo" ||
		req.ProviderID != "example_control_plane" ||
		req.LocalEnvironmentPublicID != "le_existing" ||
		req.BindingGeneration != 7 ||
		req.AgentInstanceID != "ai_existing" ||
		req.ReasonCode != providerDisconnectReasonUser {
		t.Fatalf("runtime disconnect request = %#v, want current provider binding snapshot", req)
	}

	saved, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if saved.ControlplaneBaseURL != "" ||
		saved.ControlplaneProviderID != "" ||
		saved.EnvironmentID != "" ||
		saved.LocalEnvironmentPublicID != "" ||
		saved.BindingGeneration != 0 ||
		saved.Direct != nil {
		t.Fatalf("saved config after disconnect = %#v, want provider fields cleared", saved)
	}
	if saved.AgentInstanceID != "ai_existing" {
		t.Fatalf("AgentInstanceID = %q, want preserved", saved.AgentInstanceID)
	}
	if a.currentControlRPC() != nil {
		t.Fatalf("currentControlRPC still set after provider disconnect")
	}
	binding := a.ProviderLinkBinding()
	if binding.State != runtimeservice.ProviderLinkStateUnbound {
		t.Fatalf("ProviderLinkBinding() = %#v, want unbound", binding)
	}
}

func TestDisconnectProviderConflictDoesNotClearConfig(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := providerLinkRemoteConfig(t, cfgPath)
	a := newProviderLinkTestAgent(t, cfgPath, cfg)
	msg := "local environment binding mismatch"
	fakeRPC := &providerDisconnectFakeRPC{rpcError: &rpcwirev1.RpcError{Code: 409, Message: &msg}}
	linkProviderControlForTest(a, fakeRPC)

	_, err := a.DisconnectProvider(context.Background())
	var linkErr *ProviderLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != ProviderLinkErrorBindingNotCurrent {
		t.Fatalf("DisconnectProvider() error = %v, want %s", err, ProviderLinkErrorBindingNotCurrent)
	}

	saved, loadErr := config.Load(cfgPath)
	if loadErr != nil {
		t.Fatalf("config.Load() error = %v", loadErr)
	}
	if saved.ControlplaneBaseURL != cfg.ControlplaneBaseURL ||
		saved.ControlplaneProviderID != cfg.ControlplaneProviderID ||
		saved.EnvironmentID != cfg.EnvironmentID ||
		saved.LocalEnvironmentPublicID != cfg.LocalEnvironmentPublicID ||
		saved.BindingGeneration != cfg.BindingGeneration ||
		saved.Direct == nil ||
		saved.Direct.ChannelId != cfg.Direct.ChannelId {
		t.Fatalf("config changed after rejected disconnect: %#v", saved)
	}
	if binding := a.ProviderLinkBinding(); binding.State != runtimeservice.ProviderLinkStateLinked || !binding.RemoteEnabled {
		t.Fatalf("ProviderLinkBinding() = %#v, want linked remote enabled", binding)
	}
}

func TestDisconnectProviderRequiresActiveControlChannel(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := providerLinkRemoteConfig(t, cfgPath)
	a := newProviderLinkTestAgent(t, cfgPath, cfg)

	_, err := a.DisconnectProvider(context.Background())
	var linkErr *ProviderLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != ProviderLinkErrorDisconnectRejected {
		t.Fatalf("DisconnectProvider() error = %v, want %s", err, ProviderLinkErrorDisconnectRejected)
	}

	saved, loadErr := config.Load(cfgPath)
	if loadErr != nil {
		t.Fatalf("config.Load() error = %v", loadErr)
	}
	if saved.ControlplaneBaseURL != cfg.ControlplaneBaseURL ||
		saved.EnvironmentID != cfg.EnvironmentID ||
		saved.BindingGeneration != cfg.BindingGeneration ||
		saved.Direct == nil {
		t.Fatalf("config changed after inactive-channel disconnect: %#v", saved)
	}
}

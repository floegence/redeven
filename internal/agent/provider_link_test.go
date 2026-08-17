package agent

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	flowercontrol "github.com/floegence/flowersec/flowersec-go/v2/controlplane"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
)

type providerDisconnectFakeRPC struct {
	mu       sync.Mutex
	typeID   uint32
	payload  json.RawMessage
	rpcError *flowersec.RPCError
	err      error
}

func (f *providerDisconnectFakeRPC) Call(_ context.Context, typeID uint32, request, response any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.typeID = typeID
	payload, marshalErr := json.Marshal(request)
	if marshalErr != nil {
		return marshalErr
	}
	f.payload = append(f.payload[:0], payload...)
	if f.err != nil || f.rpcError != nil {
		if f.err != nil {
			return f.err
		}
		return f.rpcError
	}
	encoded, err := json.Marshal(runtimeDisconnectResp{
		OK:         true,
		Cleared:    true,
		State:      "disconnected",
		ReasonCode: "runtime_disconnected",
	})
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, response)
}

func testDirectConnectInfo() *config.DirectConnectInfo {
	return &config.DirectConnectInfo{
		ArtifactJSON:   []byte(controlArtifactFixture),
		ExpiresAtUnixS: 4102444800,
	}
}

func providerLinkRemoteConfig(t *testing.T, cfgPath string) *config.Config {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	digest := sha256.Sum256([]byte(controlArtifactFixture))
	cfg := &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://dev.redeven.test",
		ControlplaneProviderID:   "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        7,
		AgentInstanceID:          "ai_existing",
		Direct:                   testDirectConnectInfo(),
		ControlArtifactPool: &config.ControlArtifactPool{
			SchemaVersion:         config.ControlArtifactPoolSchemaVersion,
			LogicalBindingID:      "provider-binding-7",
			TargetWaterline:       config.ControlArtifactTargetWaterline,
			RefreshHorizonSeconds: config.ControlArtifactRefreshHorizonS,
			BindingGeneration:     7,
			RecoveryState:         config.ControlArtifactRecoveryReady,
			Entries: []config.ControlArtifactEntry{{
				Sequence:       1,
				ArtifactJSON:   []byte(controlArtifactFixture),
				ArtifactDigest: base64.RawURLEncoding.EncodeToString(digest[:]),
				ChannelID:      "provider-control-7",
				ExpiresAtUnixS: time.Now().Add(4 * time.Minute).Unix(),
			}},
		},
		AgentHomeDir:     t.TempDir(),
		PermissionPolicy: policy,
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
	if cfgPath == "" {
		cfgPath = filepath.Join(t.TempDir(), "config.json")
	}
	if cfg == nil {
		cfg = &config.Config{
			AgentHomeDir: t.TempDir(),
		}
	}
	stateRoot := t.TempDir()
	if cfg.PermissionPolicy == nil {
		policy, err := config.ParsePermissionPolicyPreset("")
		if err != nil {
			t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
		}
		cfg.PermissionPolicy = policy
	}
	a, err := New(Options{
		Config:           cfg,
		ConfigPath:       cfgPath,
		StateRoot:        stateRoot,
		LocalUIEnabled:   true,
		EffectiveRunMode: "desktop",
		Version:          "dev",
	})
	if err != nil {
		t.Fatalf("agent.New() error = %v", err)
	}
	t.Cleanup(func() {
		if a.code != nil {
			_ = a.code.Close()
		}
	})
	return a
}

func providerLinkTestServer(t *testing.T, handler func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"example_control_plane"}`))
			return
		}
		handler(w, r)
	}))
}

type providerLinkRuntimeLinkPoolEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type providerLinkRuntimeLinkPool struct {
	Version                       string                             `json:"version"`
	LogicalProviderBindingID      string                             `json:"logical_provider_binding_id"`
	BindingGeneration             int64                              `json:"binding_generation"`
	TargetWaterline               int                                `json:"target_waterline"`
	RefreshHorizonSeconds         int64                              `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                             `json:"server_highest_artifact_sequence"`
	Entries                       []providerLinkRuntimeLinkPoolEntry `json:"entries"`
	ResponseDigestB64u            string                             `json:"response_digest_b64u"`
}

func writeProviderRuntimeLinkResponse(t *testing.T, w http.ResponseWriter, r *http.Request, channelPrefix string) {
	t.Helper()
	if r.Method != http.MethodPost || r.URL.Path != "/api/rcpp/v3/runtime-link/exchange" {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}
	if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
		t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
	}
	var payload struct {
		ProtocolVersion          string `json:"protocol_version"`
		EnvPublicID              string `json:"env_public_id"`
		ProviderOrigin           string `json:"provider_origin"`
		LocalEnvironmentPublicID string `json:"local_environment_public_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode(request) error = %v", err)
	}
	if payload.ProtocolVersion != "rcpp-v3" || payload.ProviderOrigin == "" {
		t.Fatalf("ProviderOrigin is empty")
	}
	endpoints, err := flowercontrol.NewEndpointSet("wss://example.com/flowersec/v2/direct")
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(4 * time.Minute).Truncate(time.Second)
	pool := providerLinkRuntimeLinkPool{
		Version:                       config.ControlArtifactPoolContractVersion,
		LogicalProviderBindingID:      "binding-7",
		BindingGeneration:             7,
		TargetWaterline:               config.ControlArtifactTargetWaterline,
		RefreshHorizonSeconds:         config.ControlArtifactRefreshHorizonS,
		ServerHighestArtifactSequence: config.ControlArtifactTargetWaterline,
		Entries:                       make([]providerLinkRuntimeLinkPoolEntry, 0, config.ControlArtifactTargetWaterline),
	}
	for sequence := 1; sequence <= config.ControlArtifactTargetWaterline; sequence++ {
		channelID := fmt.Sprintf("%s-%d", channelPrefix, sequence)
		issued, issueErr := flowercontrol.NewIssuer().IssueDirect(flowercontrol.DirectIssueOptions{
			Session: flowercontrol.SessionOptions{
				ChannelID: channelID,
				ExpiresAt: expires,
			},
			Endpoints:         endpoints,
			RendezvousGroupID: "provider-link-test",
			ListenerAudience:  "redeven",
			UpstreamAddress:   "127.0.0.1:1",
		})
		if issueErr != nil {
			t.Fatal(issueErr)
		}
		pool.Entries = append(pool.Entries, providerLinkRuntimeLinkPoolEntry{
			ArtifactJSON:      issued.ArtifactJSON(),
			ArtifactChannelID: channelID,
			BindingGeneration: 7,
			ArtifactSequence:  uint64(sequence),
			ExpiresAtUnixS:    expires.Unix(),
		})
	}
	unsigned, err := json.Marshal(pool)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(unsigned)
	pool.ResponseDigestB64u = base64.RawURLEncoding.EncodeToString(digest[:])
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{
		"protocol_version":      "rcpp-v3",
		"provider_id":           "example_control_plane",
		"provider_origin":       payload.ProviderOrigin,
		"access_point_id":       "dev",
		"access_point_origin":   "https://" + r.Host,
		"env_public_id":         payload.EnvPublicID,
		"control_artifact_pool": pool,
		"local_environment_binding": map[string]any{
			"local_environment_public_id": payload.LocalEnvironmentPublicID,
			"env_public_id":               payload.EnvPublicID,
			"generation":                  7,
		},
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatalf("Encode(response) error = %v", err)
	}
}

func TestConnectProviderPersistsConfigOnlyAfterRuntimeLinkExchangeSucceeds(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := newProviderLinkTestAgent(t, cfgPath, nil)
	server := providerLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "ticket expired", http.StatusUnauthorized)
	})
	defer server.Close()

	_, err := a.ConnectProvider(context.Background(), ProviderLinkRequest{
		ProviderOrigin:        "https://redeven.test",
		ProviderID:            "example_control_plane",
		EnvPublicID:           "env_demo",
		AccessPointOrigin:     server.URL,
		RuntimeLinkTicket:     "ticket-123",
		runtimeLinkHTTPClient: server.Client(),
	})
	if err == nil {
		t.Fatalf("ConnectProvider() error = nil, want Runtime link exchange failure")
	}
	var linkErr *ProviderLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != ProviderLinkErrorExchangeFailed {
		t.Fatalf("ConnectProvider() error = %v, want %s", err, ProviderLinkErrorExchangeFailed)
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
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://old.example.invalid",
		ControlplaneProviderID:   "old_provider",
		EnvironmentID:            "env_old",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        1,
		AgentInstanceID:          "ai_existing",
		Direct:                   testDirectConnectInfo(),
		AgentHomeDir:             t.TempDir(),
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
		writeProviderRuntimeLinkResponse(t, w, r, "ch_new")
	})
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		_, err := a.ConnectProvider(context.Background(), ProviderLinkRequest{
			ProviderOrigin:            "https://redeven.test",
			ProviderID:                "example_control_plane",
			EnvPublicID:               "env_new",
			AccessPointOrigin:         server.URL,
			RuntimeLinkTicket:         "ticket-123",
			AllowRelinkWhenIdle:       true,
			ExpectedProviderOrigin:    initial.ProviderOrigin,
			ExpectedProviderID:        initial.ControlplaneProviderID,
			ExpectedEnvPublicID:       initial.EnvironmentID,
			ExpectedAccessPointOrigin: initial.ControlplaneBaseURL,
			ExpectedGeneration:        initial.BindingGeneration,
			runtimeLinkHTTPClient:     server.Client(),
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
		cfg.Direct == nil || cfg.Direct.ExpiresAtUnixS != initial.Direct.ExpiresAtUnixS || cfg.Direct.Spent {
		t.Fatalf("config changed after blocked relink: %#v", cfg)
	}
	if binding := a.ProviderLinkBinding(); binding.EnvPublicID != "env_old" || binding.BindingGeneration != 1 {
		t.Fatalf("ProviderLinkBinding() changed after blocked relink: %#v", binding)
	}
}

func TestConnectProviderRefreshesExistingMatchingBindingWhenExplicitlyRequested(t *testing.T) {
	server := providerLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeProviderRuntimeLinkResponse(t, w, r, "ch_refreshed")
	})
	defer server.Close()

	cfg := &config.Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      server.URL,
		ControlplaneProviderID:   "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        3,
		AgentInstanceID:          "ai_existing",
		Direct:                   testDirectConnectInfo(),
		AgentHomeDir:             t.TempDir(),
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
		ProviderOrigin:        "https://redeven.test",
		ProviderID:            "example_control_plane",
		EnvPublicID:           "env_demo",
		AccessPointOrigin:     server.URL,
		RuntimeLinkTicket:     "ticket-123",
		runtimeLinkHTTPClient: server.Client(),
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
	if saved.Direct != nil {
		t.Fatalf("saved Direct = %#v, want nil after artifact-pool bootstrap", saved.Direct)
	}
	if saved.ControlArtifactPool == nil || len(saved.ControlArtifactPool.Entries) != config.ControlArtifactTargetWaterline {
		t.Fatalf("saved ControlArtifactPool = %#v, want ready bootstrap pool", saved.ControlArtifactPool)
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
		req.ProviderOrigin != "https://redeven.test" ||
		req.ProviderID != "example_control_plane" ||
		req.AccessPointOrigin != "https://dev.redeven.test" ||
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
	if saved.ProviderOrigin != "" ||
		saved.ControlplaneBaseURL != "" ||
		saved.ControlplaneProviderID != "" ||
		saved.EnvironmentID != "" ||
		saved.LocalEnvironmentPublicID != "" ||
		saved.BindingGeneration != 0 ||
		saved.Direct != nil ||
		saved.ControlArtifactPool != nil {
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
	fakeRPC := &providerDisconnectFakeRPC{rpcError: &flowersec.RPCError{Code: 409, Message: msg}}
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
	if saved.ProviderOrigin != cfg.ProviderOrigin ||
		saved.ControlplaneBaseURL != cfg.ControlplaneBaseURL ||
		saved.ControlplaneProviderID != cfg.ControlplaneProviderID ||
		saved.EnvironmentID != cfg.EnvironmentID ||
		saved.LocalEnvironmentPublicID != cfg.LocalEnvironmentPublicID ||
		saved.BindingGeneration != cfg.BindingGeneration ||
		saved.Direct == nil || saved.Direct.ExpiresAtUnixS != cfg.Direct.ExpiresAtUnixS || saved.Direct.Spent != cfg.Direct.Spent ||
		saved.ControlArtifactPool == nil || saved.ControlArtifactPool.BindingGeneration != cfg.ControlArtifactPool.BindingGeneration ||
		len(saved.ControlArtifactPool.Entries) != len(cfg.ControlArtifactPool.Entries) {
		t.Fatalf("config changed after rejected disconnect: %#v", saved)
	}
	if binding := a.ProviderLinkBinding(); binding.State != runtimeservice.ProviderLinkStateLinked || !binding.RemoteEnabled {
		t.Fatalf("ProviderLinkBinding() = %#v, want linked remote enabled", binding)
	}
}

func TestDisconnectProviderClearsConfigWithoutActiveControlChannel(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := providerLinkRemoteConfig(t, cfgPath)
	a := newProviderLinkTestAgent(t, cfgPath, cfg)

	resp, err := a.DisconnectProvider(context.Background())
	if err != nil {
		t.Fatalf("DisconnectProvider() error = %v", err)
	}
	if resp.Binding.State != runtimeservice.ProviderLinkStateUnbound || resp.Binding.LastDisconnectedAtUnixMS <= 0 {
		t.Fatalf("DisconnectProvider() binding = %#v, want unbound with disconnect time", resp.Binding)
	}

	saved, loadErr := config.Load(cfgPath)
	if loadErr != nil {
		t.Fatalf("config.Load() error = %v", loadErr)
	}
	if saved.ProviderOrigin != "" ||
		saved.ControlplaneBaseURL != "" ||
		saved.ControlplaneProviderID != "" ||
		saved.EnvironmentID != "" ||
		saved.LocalEnvironmentPublicID != "" ||
		saved.BindingGeneration != 0 ||
		saved.Direct != nil ||
		saved.ControlArtifactPool != nil {
		t.Fatalf("saved config after inactive-channel disconnect = %#v, want provider fields cleared", saved)
	}
	if saved.AgentInstanceID != "ai_existing" {
		t.Fatalf("AgentInstanceID = %q, want preserved", saved.AgentInstanceID)
	}
	if binding := a.ProviderLinkBinding(); binding.State != runtimeservice.ProviderLinkStateUnbound {
		t.Fatalf("ProviderLinkBinding() = %#v, want unbound", binding)
	}
}

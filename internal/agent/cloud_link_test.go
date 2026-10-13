package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	rc "github.com/floegence/redeven/internal/runtimecloud/protocol"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	flowercontrol "github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/runtimeservice"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestDirectCloudChangesPreserveGatewayMembers(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	cfg := cloudLinkRemoteConfig(t, "")
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, cfg.LocalEnvironmentPublicID)
	cfg.Gateways = []*gatewaymembership.RuntimeConfig{member}
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatal(err)
	}
	a := newCloudLinkTestAgent(t, cfgPath, cfg)
	savedAI := &config.AIConfig{Providers: []config.AIProvider{{
		ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: "saved-account",
		ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}},
	}}}
	if _, err := config.Update(cfgPath, func(current *config.Config) error { current.AI = savedAI; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DisconnectCloud(t.Context()); err != nil {
		t.Fatal(err)
	}
	detached := a.remoteConfigSnapshot()
	if detached.LocalEnvironmentPublicID != member.RuntimePublicID || !reflect.DeepEqual(detached.Gateways, cfg.Gateways) {
		t.Fatal("disconnect changed paired Runtime identity")
	}
	if !reflect.DeepEqual(detached.AI, savedAI) {
		t.Fatal("disconnect overwrote the saved ChatGPT binding")
	}
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if _, err := config.Update(cfgPath, func(current *config.Config) error {
			current.Shell = "/bin/zsh"
			return nil
		}); err != nil {
			t.Error(err)
		}
		// An independent reconnect may rotate credentials during the Cloud exchange.
		a.mu.Lock()
		next := *a.cfg
		rotated := next.GatewayMember(member.GatewayID).Clone()
		rotated.Revision++
		next.SetGatewayMember(member.GatewayID, rotated)
		if err := config.SaveConnection(cfgPath, &next); err != nil {
			t.Error(err)
		}
		a.cfg = &next
		a.mu.Unlock()
		writeCloudRuntimeLinkResponse(t, w, r, "paired-runtime")
	})
	defer server.Close()
	if _, err := a.ConnectCloud(t.Context(), CloudLinkRequest{CloudOrigin: server.URL, CloudID: "example_control_plane", EnvPublicID: "env_demo", RuntimeLinkTicket: "ticket-123", runtimeLinkHTTPClient: server.Client()}); err != nil {
		t.Fatal(err)
	}
	saved, err := config.Load(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Gateways) != 1 || saved.Gateways[0].MemberID != member.MemberID || saved.Gateways[0].Revision != member.Revision+1 {
		t.Fatal("Cloud connection overwrote concurrent Gateway progress")
	}
	if !reflect.DeepEqual(saved.AI, savedAI) || saved.Shell != "/bin/zsh" {
		t.Fatal("Cloud exchange overwrote local settings saved while the exchange was in flight")
	}
}

func TestConnectCloudRetriesWhenRegionHasNotStarted(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://" + listener.Addr().String()
	_ = listener.Close()
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := newCloudLinkTestAgent(t, cfgPath, &config.Config{AgentHomeDir: t.TempDir()})
	_, err = a.ConnectCloud(context.Background(), CloudLinkRequest{
		CloudOrigin: origin, CloudID: "example_control_plane",
		EnvPublicID: "env_new", RuntimeLinkTicket: "ticket-123",
	})
	var linkErr *CloudLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != CloudLinkErrorUnavailable {
		t.Fatalf("ConnectCloud() error = %v, want %s", err, CloudLinkErrorUnavailable)
	}
}

func TestConnectCloudDoesNotRetryUntrustedRegionCertificate(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("untrusted certificate must stop before the exchange")
	}))
	defer server.Close()
	a := newCloudLinkTestAgent(t, filepath.Join(t.TempDir(), "config.json"), nil)
	_, err := a.ConnectCloud(context.Background(), CloudLinkRequest{
		CloudOrigin: server.URL, CloudID: "example_control_plane",
		EnvPublicID: "env_new", RuntimeLinkTicket: "ticket-123",
	})
	var linkErr *CloudLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != CloudLinkErrorExchangeFailed {
		t.Fatalf("ConnectCloud() error = %v, want certificate review", err)
	}
}

func TestConnectCloudRetriesTemporaryDNSFailure(t *testing.T) {
	a := newCloudLinkTestAgent(t, filepath.Join(t.TempDir(), "config.json"), nil)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(context.Context, string, string) (net.Conn, error) {
		return nil, &net.DNSError{Name: "redeven.test", Err: "temporary resolver failure", IsTemporary: true}
	}
	_, err := a.ConnectCloud(context.Background(), CloudLinkRequest{CloudOrigin: "https://redeven.test", CloudID: "example_control_plane", EnvPublicID: "env_new", RuntimeLinkTicket: "ticket-123", runtimeLinkHTTPClient: &http.Client{Transport: transport}})
	var linkErr *CloudLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != CloudLinkErrorUnavailable {
		t.Fatalf("ConnectCloud() error = %v, want %s", err, CloudLinkErrorUnavailable)
	}
}

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
	encoded, err := json.Marshal(map[string]any{"ok": true})
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, response)
}

func cloudLinkRemoteConfig(t *testing.T, cfgPath string) *config.Config {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	digest := sha256.Sum256([]byte(controlArtifactFixture))
	cfg := &config.Config{
		CloudOrigin:              "https://redeven.test",
		AccessPointOrigin:        "https://dev.redeven.test",
		CloudID:                  "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        7,
		AgentInstanceID:          "ai_existing",
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
	attachTestCloudAssociation(cfg)
	if cfgPath != "" {
		if err := config.Save(cfgPath, cfg); err != nil {
			t.Fatalf("config.Save() error = %v", err)
		}
	}
	return cfg
}

func newCloudLinkTestAgent(t *testing.T, cfgPath string, cfg *config.Config) *Agent {
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

func cloudLinkTestServer(t *testing.T, handler func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/rcpp/v5/runtime-link/resolve" {
			var request struct {
				EnvPublicID string `json:"env_public_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatal(err)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"protocol_version": "rcpp-v5", "cloud_id": "example_control_plane",
				"cloud_origin": "https://" + r.Host, "env_public_id": request.EnvPublicID,
				"access_point_id": "dev", "access_point_origin": "https://" + r.Host,
				"expires_at_unix_ms": time.Now().Add(time.Minute).UnixMilli(), "namespace_public_id": "namespace",
			})
			return
		}
		if r.URL.Path == "/api/console/v1/runtime-cloud/v5/challenges" {
			var q rc.ChallengeRequest
			_ = json.NewDecoder(r.Body).Decode(&q)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": rc.ChallengeResponse{Proof: rc.Proof{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: "https://" + r.Host, NamespacePublicID: q.NamespacePublicID, RuntimePublicID: q.RuntimePublicID, Purpose: q.Purpose, ChallengeID: "challenge", NonceB64u: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}}})
			return
		}
		handler(w, r)
	}))
}

type cloudLinkRuntimeLinkPoolEntry struct {
	ArtifactJSON      json.RawMessage `json:"artifact_json"`
	ArtifactChannelID string          `json:"artifact_channel_id"`
	BindingGeneration int64           `json:"binding_generation"`
	ArtifactSequence  uint64          `json:"artifact_sequence"`
	ExpiresAtUnixS    int64           `json:"expires_at_unix_s"`
}

type cloudLinkRuntimeLinkPool struct {
	Version                       string                          `json:"version"`
	LogicalCloudBindingID         string                          `json:"logical_cloud_binding_id"`
	BindingGeneration             int64                           `json:"binding_generation"`
	TargetWaterline               int                             `json:"target_waterline"`
	RefreshHorizonSeconds         int64                           `json:"refresh_horizon_seconds"`
	ServerHighestArtifactSequence uint64                          `json:"server_highest_artifact_sequence"`
	Entries                       []cloudLinkRuntimeLinkPoolEntry `json:"entries"`
	ResponseDigestB64u            string                          `json:"response_digest_b64u"`
}

func writeCloudRuntimeLinkResponse(t *testing.T, w http.ResponseWriter, r *http.Request, channelPrefix string, endpointURLs ...string) {
	t.Helper()
	if r.Method != http.MethodPost || r.URL.Path != "/api/console/v1/runtime-cloud/v5/enroll" {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}
	var signed rc.SignedRequest
	var enrollment rc.EnrollRequest
	if json.NewDecoder(r.Body).Decode(&signed) != nil || json.Unmarshal(signed.Payload, &enrollment) != nil || signed.Proof.Verify(enrollment.PublicKeyB64u, signed.Payload, time.Now()) != nil {
		t.Fatal("invalid independent Cloud identity")
	}
	payload := struct {
		LocalEnvironmentPublicID, EnvPublicID, CloudOrigin string
		ExpectedBindingGeneration                          int64
	}{LocalEnvironmentPublicID: enrollment.RuntimePublicID, EnvPublicID: enrollment.Authorization.EnvPublicID, CloudOrigin: "https://" + r.Host}
	endpointURL := "wss://example.com/flowersec/v3/direct"
	if len(endpointURLs) != 0 {
		endpointURL = endpointURLs[0]
	}
	endpoints, err := flowercontrol.NewEndpointSet(flowercontrol.EndpointConfig{
		ID: "websocket", URL: endpointURL, TLS: flowercontrol.CAPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	generation := int64(7)
	if payload.ExpectedBindingGeneration > 0 {
		generation = payload.ExpectedBindingGeneration + 1
	}
	expires := time.Now().Add(4 * time.Minute).Truncate(time.Second)
	pool := cloudLinkRuntimeLinkPool{
		Version:                       config.ControlArtifactPoolContractVersion,
		LogicalCloudBindingID:         "binding-7",
		BindingGeneration:             generation,
		TargetWaterline:               config.ControlArtifactTargetWaterline,
		RefreshHorizonSeconds:         config.ControlArtifactRefreshHorizonS,
		ServerHighestArtifactSequence: config.ControlArtifactTargetWaterline,
		Entries:                       make([]cloudLinkRuntimeLinkPoolEntry, 0, config.ControlArtifactTargetWaterline),
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
		pool.Entries = append(pool.Entries, cloudLinkRuntimeLinkPoolEntry{
			ArtifactJSON:      issued.ArtifactJSON(),
			ArtifactChannelID: channelID,
			BindingGeneration: generation,
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
	pool.LogicalCloudBindingID = "runtime-cloud-v5:binding"
	pool.ResponseDigestB64u = ""
	unsigned, _ = json.Marshal(pool)
	digest = sha256.Sum256(unsigned)
	pool.ResponseDigestB64u = base64.RawURLEncoding.EncodeToString(digest[:])
	var shared rc.ControlArtifactPoolV2
	raw, _ := json.Marshal(pool)
	_ = json.Unmarshal(raw, &shared)
	binding := rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding", CloudID: "example_control_plane", NamespacePublicID: "namespace", RuntimePublicID: enrollment.RuntimePublicID, EnvPublicID: enrollment.Authorization.EnvPublicID, OwnerKind: rc.OwnerUser, OwnerPublicID: "user", Generation: generation}, Region: "dev", State: "active", PublicKeyB64u: enrollment.PublicKeyB64u, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}
	response := rc.RecoverResponse{ProtocolVersion: rc.ProtocolVersion, State: rc.ApprovalApproved, Binding: &binding, Closures: []rc.Closure{}, Delivery: &rc.CredentialDelivery{ProtocolVersion: rc.ProtocolVersion, CloudOrigin: payload.CloudOrigin, RegionOrigin: "https://" + r.Host, Binding: binding, DeliveryRequestID: enrollment.OperationID, ControlArtifactPool: &shared}}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"success": true, "data": response}); err != nil {
		t.Fatal(err)
	}

}

func TestConnectCloudPersistsConfigOnlyAfterRuntimeLinkExchangeSucceeds(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := newCloudLinkTestAgent(t, cfgPath, nil)
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"INVALID_RUNTIME_LINK_TICKET","message":"Ticket expired"}}`))
	})
	defer server.Close()

	_, err := a.ConnectCloud(context.Background(), CloudLinkRequest{
		CloudOrigin:           server.URL,
		CloudID:               "example_control_plane",
		EnvPublicID:           "env_demo",
		RuntimeLinkTicket:     "ticket-123",
		runtimeLinkHTTPClient: server.Client(),
	})
	if err == nil {
		t.Fatalf("ConnectCloud() error = nil, want Runtime link exchange failure")
	}
	var linkErr *CloudLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != "CLOUD_LINK_AUTHORIZATION_REQUIRED" {
		t.Fatalf("ConnectCloud() error = %v, want %s", err, "CLOUD_LINK_AUTHORIZATION_REQUIRED")
	}
	if binding := a.CloudLinkBinding(); binding.State != runtimeservice.CloudLinkStateUnbound {
		t.Fatalf("CloudLinkBinding() = %#v, want unbound", binding)
	}
	if _, loadErr := config.Load(cfgPath); loadErr == nil || !strings.Contains(loadErr.Error(), "no such file") {
		t.Fatalf("config.Load() error = %v, want no saved config", loadErr)
	}
}

func TestConnectCloudDistinguishesRevokedPermissionFromExpiredAuthorization(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := newCloudLinkTestAgent(t, cfgPath, nil)
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":{"code":"NOT_AUTHORIZED","message":"permission revoked"}}`)
	})
	defer server.Close()

	_, err := a.ConnectCloud(context.Background(), CloudLinkRequest{
		CloudOrigin:           server.URL,
		CloudID:               "example_control_plane",
		EnvPublicID:           "env_demo",
		RuntimeLinkTicket:     "ticket-123",
		runtimeLinkHTTPClient: server.Client(),
	})
	if err == nil {
		t.Fatal("ConnectCloud() error = nil, want permission rejection")
	}
	var linkErr *CloudLinkError
	if !errors.As(err, &linkErr) || linkErr.Code != CloudLinkErrorPermissionRevoked {
		t.Fatalf("ConnectCloud() error = %v, want %s", err, CloudLinkErrorPermissionRevoked)
	}
}

func TestConnectCloudRechecksActiveWorkBeforePersistingConfig(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	initial := &config.Config{
		CloudOrigin:              "https://redeven.test",
		AccessPointOrigin:        "https://old.example.invalid",
		CloudID:                  "old_provider",
		EnvironmentID:            "env_old",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        1,
		AgentInstanceID:          "ai_existing",
		AgentHomeDir:             t.TempDir(),
	}
	if err := config.Save(cfgPath, initial); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}
	attachTestCloudAssociation(initial)
	if err := config.Save(cfgPath, initial); err != nil {
		t.Fatal(err)
	}
	a := newCloudLinkTestAgent(t, cfgPath, initial)
	releaseExchange := make(chan struct{})
	exchangeStarted := make(chan struct{})
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		close(exchangeStarted)
		<-releaseExchange
		writeCloudRuntimeLinkResponse(t, w, r, "ch_new")
	})
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		_, err := a.ConnectCloud(context.Background(), CloudLinkRequest{
			CloudOrigin:               server.URL,
			CloudID:                   "example_control_plane",
			EnvPublicID:               "env_new",
			RuntimeLinkTicket:         "ticket-123",
			AllowRelinkWhenIdle:       true,
			ExpectedCloudOrigin:       initial.CloudOrigin,
			ExpectedCloudID:           initial.CloudID,
			ExpectedEnvPublicID:       initial.EnvironmentID,
			ExpectedAccessPointOrigin: initial.AccessPointOrigin,
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
		var linkErr *CloudLinkError
		if !errors.As(err, &linkErr) || linkErr.Code != CloudLinkErrorActiveWork {
			t.Fatalf("ConnectCloud() error = %v, want %s", err, CloudLinkErrorActiveWork)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ConnectCloud() did not return")
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if cfg.AccessPointOrigin != initial.AccessPointOrigin ||
		cfg.EnvironmentID != initial.EnvironmentID ||
		cfg.BindingGeneration != initial.BindingGeneration {
		t.Fatalf("config changed after blocked relink: %#v", cfg)
	}
	if binding := a.CloudLinkBinding(); binding.EnvPublicID != "env_old" || binding.BindingGeneration != 1 {
		t.Fatalf("CloudLinkBinding() changed after blocked relink: %#v", binding)
	}
}

func TestConnectCloudRefreshesExistingMatchingBindingWhenExplicitlyRequested(t *testing.T) {
	server := cloudLinkTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeCloudRuntimeLinkResponse(t, w, r, "ch_refreshed")
	})
	defer server.Close()

	cfg := &config.Config{
		CloudOrigin:              server.URL,
		AccessPointOrigin:        server.URL,
		CloudID:                  "example_control_plane",
		EnvironmentID:            "env_demo",
		LocalEnvironmentPublicID: "le_existing",
		BindingGeneration:        3,
		AgentInstanceID:          "ai_existing",
		AgentHomeDir:             t.TempDir(),
	}
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	attachTestCloudAssociation(cfg)
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatalf("config.Save() error = %v", err)
	}
	a := newCloudLinkTestAgent(t, cfgPath, cfg)

	before := a.RuntimeServiceSnapshot()
	if before.RemoteEnabled {
		t.Fatalf("RemoteEnabled before connect = true, want false")
	}
	if before.EffectiveRunMode != "desktop" {
		t.Fatalf("EffectiveRunMode before connect = %q, want desktop", before.EffectiveRunMode)
	}
	if before.Bindings.CloudLink.State != runtimeservice.CloudLinkStateLinked || before.Bindings.CloudLink.RemoteEnabled {
		t.Fatalf("CloudLink before connect = %#v, want linked but remote disabled", before.Bindings.CloudLink)
	}
	// Startup can enable remote mode even when expired artifacts prevent a
	// control session. An explicit refresh must still obtain a fresh pool.
	a.enableProviderControlChannelLocked()

	resp, err := a.ConnectCloud(context.Background(), CloudLinkRequest{
		CloudOrigin:           server.URL,
		CloudID:               "example_control_plane",
		EnvPublicID:           "env_demo",
		RuntimeLinkTicket:     "ticket-123",
		runtimeLinkHTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("ConnectCloud() error = %v", err)
	}
	if resp.Binding.State != runtimeservice.CloudLinkStateLinked || !resp.Binding.RemoteEnabled {
		t.Fatalf("ConnectCloud() binding = %#v, want linked with remote enabled", resp.Binding)
	}
	after := a.RuntimeServiceSnapshot()
	if !after.RemoteEnabled || after.EffectiveRunMode != "hybrid" {
		t.Fatalf("RuntimeServiceSnapshot() after connect = %#v, want hybrid remote enabled", after)
	}
	if after.Bindings.CloudLink.State != runtimeservice.CloudLinkStateLinked || !after.Bindings.CloudLink.RemoteEnabled {
		t.Fatalf("CloudLink after connect = %#v, want linked remote enabled", after.Bindings.CloudLink)
	}
	saved, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("config.Load() error = %v", err)
	}
	if saved.ControlArtifactPool == nil || len(saved.ControlArtifactPool.Entries) != config.ControlArtifactTargetWaterline {
		t.Fatalf("saved ControlArtifactPool = %#v, want ready bootstrap pool", saved.ControlArtifactPool)
	}
	if saved.BindingGeneration != 7 {
		t.Fatalf("BindingGeneration = %d, want refreshed generation 7", saved.BindingGeneration)
	}
}

// Tests must represent the current persisted association instead of bypassing the loader.
func attachTestCloudAssociation(cfg *config.Config) {
	key := ed25519.NewKeyFromSeed(make([]byte, 32))
	public := base64.RawURLEncoding.EncodeToString(key.Public().(ed25519.PublicKey))
	if cfg.CloudID == "" {
		cfg.CloudID = "example_control_plane"
	}
	cfg.CloudAssociation = &config.CloudAssociation{Revision: 1, Enabled: true, CloudID: cfg.CloudID, CloudOrigin: cfg.CloudOrigin, RegionOrigin: cfg.AccessPointOrigin, NamespacePublicID: "namespace", RuntimePublicID: cfg.LocalEnvironmentPublicID, PublicKeyB64u: public, PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key), ApprovalState: rc.ApprovalApproved, Binding: &rc.Binding{BindingFence: rc.BindingFence{PublicID: "binding", CloudID: cfg.CloudID, NamespacePublicID: "namespace", RuntimePublicID: cfg.LocalEnvironmentPublicID, EnvPublicID: cfg.EnvironmentID, OwnerKind: rc.OwnerUser, OwnerPublicID: "user", Generation: cfg.BindingGeneration}, Region: "dev", State: "active", PublicKeyB64u: public, IdentityExpiresAtUnixMS: 4102444800000}}
	cfg.CloudRoute = &config.CloudRoute{Kind: config.CloudRouteDirect, Revision: 1}
}

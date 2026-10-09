package config

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	flowercontrol "github.com/floegence/flowersec/flowersec-go/v5/controlplane"
)

func TestBootstrapConfigExplicitLogLevelOverridesPreviousConfig(t *testing.T) {
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-cloud.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"cloud_id":"example_control_plane"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/rcpp/v4/runtime-link/exchange" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
		}
		var payload runtimeLinkExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode(request) error = %v", err)
		}
		assertBootstrapDeliveryRequestID(t, payload.DeliveryRequestIDB64u)
		writeBootstrapTestResponse(t, w, r.Host, payload.LocalEnvironmentPublicID, 7)
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := Save(layout.ConfigPath, &Config{
		CloudOrigin:              server.URL,
		AccessPointOrigin:        "https://old.example.invalid",
		EnvironmentID:            "env_old",
		LocalEnvironmentPublicID: "le_existing",
		AgentInstanceID:          "ai_existing",
		LogFormat:                "json",
		LogLevel:                 "debug",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	writtenPath, err := BootstrapConfig(ctx, BootstrapArgs{
		CloudOrigin:       server.URL,
		EnvironmentID:     "env_123",
		RuntimeLinkTicket: "ticket-123",
		StateRoot:         stateRoot,
		LogLevel:          "info",
		HTTPClient:        server.Client(),
	})
	if err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
	if writtenPath != layout.ConfigPath {
		t.Fatalf("writtenPath = %q, want %q", writtenPath, layout.ConfigPath)
	}

	cfg, err := Load(layout.ConfigPath)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}
	if cfg.CloudOrigin != server.URL {
		t.Fatalf("CloudOrigin = %q, want %q", cfg.CloudOrigin, "https://redeven.test")
	}
	if cfg.AgentInstanceID != "ai_existing" {
		t.Fatalf("AgentInstanceID = %q, want %q", cfg.AgentInstanceID, "ai_existing")
	}
	if cfg.LocalEnvironmentPublicID != "le_existing" {
		t.Fatalf("LocalEnvironmentPublicID = %q, want %q", cfg.LocalEnvironmentPublicID, "le_existing")
	}
	if cfg.BindingGeneration != 7 {
		t.Fatalf("BindingGeneration = %d, want 7", cfg.BindingGeneration)
	}
	if cfg.EnvironmentID != "env_123" {
		t.Fatalf("EnvironmentID = %q, want %q", cfg.EnvironmentID, "env_123")
	}
	if cfg.CloudID != "example_control_plane" {
		t.Fatalf("CloudID = %q, want %q", cfg.CloudID, "example_control_plane")
	}
	if cfg.Direct != nil {
		t.Fatalf("Direct = %#v, want nil", cfg.Direct)
	}
	if cfg.ControlArtifactPool == nil || len(cfg.ControlArtifactPool.Entries) != 2 {
		t.Fatalf("ControlArtifactPool = %#v", cfg.ControlArtifactPool)
	}
	configBody, err := os.ReadFile(layout.ConfigPath)
	if err != nil {
		t.Fatalf("ReadFile(config) error = %v", err)
	}
	if strings.Contains(string(configBody), "ticket-123") {
		t.Fatalf("config contains bootstrap ticket: %s", configBody)
	}
	assertBootstrapAttemptRemoved(t, layout.ConfigPath)
}

func TestSavePreservesUnknownConfigFields(t *testing.T) {
	path := t.TempDir() + "/config.json"
	if err := os.WriteFile(path, []byte(`{
  "agent_home_dir": "/tmp",
  "future_runtime_field": {
    "enabled": true,
    "label": "kept"
  }
}`), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Shell = "/bin/sh"
	if err := Save(path, cfg); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	var raw map[string]any
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	future, ok := raw["future_runtime_field"].(map[string]any)
	if !ok {
		t.Fatalf("future_runtime_field missing after save: %s", string(b))
	}
	if future["enabled"] != true || future["label"] != "kept" {
		t.Fatalf("future_runtime_field = %#v", future)
	}
	if raw["shell"] != "/bin/sh" {
		t.Fatalf("shell = %#v", raw["shell"])
	}
}

func TestBootstrapConfigSupportsRuntimeLinkTicketExchange(t *testing.T) {
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-cloud.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"cloud_id":"example_control_plane"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/rcpp/v4/runtime-link/exchange" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
		}
		var payload runtimeLinkExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode(request) error = %v", err)
		}
		if payload.EnvPublicID != "env_123" {
			t.Fatalf("EnvPublicID = %q", payload.EnvPublicID)
		}
		if payload.CloudOrigin != "https://"+r.Host {
			t.Fatalf("CloudOrigin = %q", payload.CloudOrigin)
		}
		if payload.LocalEnvironmentPublicID == "" {
			t.Fatalf("LocalEnvironmentPublicID is empty")
		}
		if payload.AgentInstanceID == "" {
			t.Fatalf("AgentInstanceID is empty")
		}
		assertBootstrapDeliveryRequestID(t, payload.DeliveryRequestIDB64u)
		writeBootstrapTestResponse(t, w, r.Host, payload.LocalEnvironmentPublicID, 3)
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	writtenPath, err := BootstrapConfig(ctx, BootstrapArgs{
		CloudOrigin:       server.URL,
		EnvironmentID:     "env_123",
		RuntimeLinkTicket: "ticket-123",
		StateRoot:         stateRoot,
		HTTPClient:        server.Client(),
	})
	if err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
	if writtenPath != layout.ConfigPath {
		t.Fatalf("writtenPath = %q, want %q", writtenPath, layout.ConfigPath)
	}

	cfg, err := Load(layout.ConfigPath)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.CloudID != "example_control_plane" {
		t.Fatalf("CloudID = %q, want %q", cfg.CloudID, "example_control_plane")
	}
	if cfg.Direct != nil {
		t.Fatalf("Direct = %#v, want nil", cfg.Direct)
	}
	if cfg.ControlArtifactPool == nil || len(cfg.ControlArtifactPool.Entries) != 2 {
		t.Fatalf("ControlArtifactPool = %#v", cfg.ControlArtifactPool)
	}
	if cfg.LocalEnvironmentPublicID == "" {
		t.Fatalf("LocalEnvironmentPublicID is empty")
	}
	if cfg.BindingGeneration != 3 {
		t.Fatalf("BindingGeneration = %d, want 3", cfg.BindingGeneration)
	}
	assertBootstrapAttemptRemoved(t, layout.ConfigPath)
}

func TestBootstrapConfigRejectsMismatchedBootstrapResponseEnvironment(t *testing.T) {
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-cloud.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"cloud_id":"example_control_plane"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/rcpp/v4/runtime-link/exchange":
			var payload runtimeLinkExchangeRequest
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			writeBootstrapTestResponseForEnvironment(t, w, r.Host, payload.LocalEnvironmentPublicID, 3, "env_other")
		default:
			t.Fatalf("unexpected request = %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	_, err := BootstrapConfig(context.Background(), BootstrapArgs{
		CloudOrigin:       server.URL,
		EnvironmentID:     "env_123",
		RuntimeLinkTicket: "ticket-123",
		StateRoot:         t.TempDir(),
		HTTPClient:        server.Client(),
	})
	if err == nil || !strings.Contains(err.Error(), "env_public_id mismatch") {
		t.Fatalf("BootstrapConfig() error = %v, want env_public_id mismatch", err)
	}
}

func TestBootstrapConfigRejectsExchangeAssignmentDrift(t *testing.T) {
	for _, field := range []string{"cloud_id", "cloud_origin", "access_point_id", "access_point_origin", "protocol_version"} {
		t.Run(field, func(t *testing.T) {
			server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request runtimeLinkExchangeRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					return
				}
				recorder := httptest.NewRecorder()
				writeBootstrapTestResponse(t, recorder, r.Host, request.LocalEnvironmentPublicID, 3)
				var response map[string]json.RawMessage
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Error(err)
					return
				}
				response[field] = json.RawMessage(`""`)
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			stateRoot := t.TempDir()
			if _, err := BootstrapConfig(context.Background(), BootstrapArgs{
				CloudOrigin: server.URL, EnvironmentID: "env_123", RuntimeLinkTicket: "ticket",
				StateRoot: stateRoot, HTTPClient: server.Client(),
			}); err == nil {
				t.Fatal("exchange must match every assigned identity and protocol field")
			}
			layout, err := LocalEnvironmentStateLayout(stateRoot)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(layout.ConfigPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("invalid exchange wrote configuration: %v", err)
			}
		})
	}
}

func TestBootstrapConfigReusesPendingDeliveryAttemptAfterUncertainResponse(t *testing.T) {
	var mu sync.Mutex
	requests := make([]runtimeLinkExchangeRequest, 0, 2)
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/rcpp/v4/runtime-link/exchange" {
			t.Fatalf("request = %s %s, want bootstrap exchange", r.Method, r.URL.Path)
		}
		var payload runtimeLinkExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode(request) error = %v", err)
		}
		assertBootstrapDeliveryRequestID(t, payload.DeliveryRequestIDB64u)
		mu.Lock()
		requests = append(requests, payload)
		attemptNumber := len(requests)
		mu.Unlock()
		if attemptNumber == 1 {
			http.Error(w, "temporary response loss", http.StatusServiceUnavailable)
			return
		}
		writeBootstrapTestResponse(t, w, r.Host, payload.LocalEnvironmentPublicID, 5)
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	args := BootstrapArgs{
		CloudOrigin:       server.URL,
		EnvironmentID:     "env_123",
		RuntimeLinkTicket: "ticket-123",
		StateRoot:         stateRoot,
		HTTPClient:        server.Client(),
	}
	if _, err := BootstrapConfig(context.Background(), args); err == nil {
		t.Fatal("first BootstrapConfig() error = nil, want uncertain response failure")
	}
	attemptPath := layout.ConfigPath + ".cloud-link-delivery-v2.json"
	if _, err := os.Stat(attemptPath); err != nil {
		t.Fatalf("Stat(pending attempt) error = %v", err)
	}
	if _, err := BootstrapConfig(context.Background(), args); err != nil {
		t.Fatalf("second BootstrapConfig() error = %v", err)
	}

	mu.Lock()
	gotRequests := append([]runtimeLinkExchangeRequest(nil), requests...)
	mu.Unlock()
	if len(gotRequests) != 2 {
		t.Fatalf("request count = %d, want 2", len(gotRequests))
	}
	first, second := gotRequests[0], gotRequests[1]
	if first.DeliveryRequestIDB64u != second.DeliveryRequestIDB64u ||
		first.AgentInstanceID != second.AgentInstanceID ||
		first.LocalEnvironmentPublicID != second.LocalEnvironmentPublicID {
		t.Fatalf("bootstrap identity changed across retry: first=%#v second=%#v", first, second)
	}
	assertBootstrapAttemptRemoved(t, layout.ConfigPath)
}

func TestBootstrapConfigRotatesAuthenticatedExpiredDeliveryAttempt(t *testing.T) {
	var mu sync.Mutex
	requests := make([]runtimeLinkExchangeRequest, 0, 2)
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/rcpp/v4/runtime-link/exchange" {
			t.Fatalf("request = %s %s, want bootstrap exchange", r.Method, r.URL.Path)
		}
		var payload runtimeLinkExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode(request) error = %v", err)
		}
		assertBootstrapDeliveryRequestID(t, payload.DeliveryRequestIDB64u)
		mu.Lock()
		requests = append(requests, payload)
		attemptNumber := len(requests)
		mu.Unlock()
		if attemptNumber == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(bootstrapExchangeErrorResponse{
				Success: false,
				Error: &bootstrapExchangeError{
					Code:    "RUNTIME_LINK_DELIVERY_EXPIRED",
					Message: "Bootstrap delivery is no longer available",
				},
			})
			return
		}
		writeBootstrapTestResponse(t, w, r.Host, payload.LocalEnvironmentPublicID, 6)
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := BootstrapConfig(context.Background(), BootstrapArgs{
		CloudOrigin:       server.URL,
		EnvironmentID:     "env_123",
		RuntimeLinkTicket: "fresh-ticket",
		StateRoot:         stateRoot,
		HTTPClient:        server.Client(),
	}); err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}

	mu.Lock()
	gotRequests := append([]runtimeLinkExchangeRequest(nil), requests...)
	mu.Unlock()
	if len(gotRequests) != 2 {
		t.Fatalf("request count = %d, want expired attempt plus one fresh attempt", len(gotRequests))
	}
	first, second := gotRequests[0], gotRequests[1]
	if first.DeliveryRequestIDB64u == second.DeliveryRequestIDB64u {
		t.Fatalf("expired bootstrap request id was reused: %q", first.DeliveryRequestIDB64u)
	}
	if first.AgentInstanceID != second.AgentInstanceID || first.LocalEnvironmentPublicID != second.LocalEnvironmentPublicID {
		t.Fatalf("bootstrap identity changed while retiring delivery attempt: first=%#v second=%#v", first, second)
	}
	assertBootstrapAttemptRemoved(t, layout.ConfigPath)
}

func TestBootstrapConfigRejectsMissingRuntimeLinkTicket(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := BootstrapConfig(ctx, BootstrapArgs{
		CloudOrigin:   "https://redeven.test",
		EnvironmentID: "env_123",
		StateRoot:     t.TempDir(),
	})
	if err == nil || err.Error() != "missing bootstrap ticket" {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
}

func TestExchangeRuntimeLinkTicketRejectsPlaintextControlplane(t *testing.T) {
	_, err := exchangeRuntimeLinkTicket(context.Background(), cloudLinkResolveArgs{}, "http://127.0.0.1:8080", "env", "ticket", bootstrapDeliveryAttempt{})
	if err == nil || !strings.Contains(err.Error(), "requires an HTTPS origin") {
		t.Fatalf("exchangeRuntimeLinkTicket() error = %v, want HTTPS rejection", err)
	}
}

func TestBootstrapResponseDecodeRejectsRetiredAndUnknownFields(t *testing.T) {
	for _, raw := range []string{
		`{"cloud_id":"provider","direct":null}`,
		`{"cloud_id":"provider","control_artifact_pool":{"version":"control_artifact_pool_v2","unexpected":true}}`,
		`{"cloud_id":"provider"}{"cloud_id":"second"}`,
	} {
		var response runtimeLinkExchangeResponse
		if err := decodeExactRuntimeLinkResponse([]byte(raw), &response); err == nil {
			t.Fatalf("decodeExactRuntimeLinkResponse(%s) error = nil", raw)
		}
	}
}

func TestExchangeRuntimeLinkTicketEnforcesPoolResponseByteBound(t *testing.T) {
	server := newCloudLinkTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(strings.Repeat("x", ControlArtifactMaxResponseBytes+1)))
	}))
	defer server.Close()
	requestID := base64.RawURLEncoding.EncodeToString(make([]byte, sha256.Size))
	_, err := exchangeRuntimeLinkTicket(context.Background(), cloudLinkResolveArgs{HTTPClient: server.Client()}, server.URL, "env", "ticket", bootstrapDeliveryAttempt{
		BootstrapDeliveryRequestIDB64u: requestID,
	})
	if err == nil || !strings.Contains(err.Error(), "exceeds exact byte bound") {
		t.Fatalf("exchangeRuntimeLinkTicket() error = %v, want exact byte bound", err)
	}
}

func TestPrepareBootstrapDeliveryAttemptRejectsDifferentPendingTarget(t *testing.T) {
	path := t.TempDir() + "/config.json"
	first, attemptPath, err := prepareBootstrapDeliveryAttempt(path, "https://provider-a.test", "https://access-a.test", "env-a", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := prepareBootstrapDeliveryAttempt(path, "https://provider-b.test", "https://access-a.test", "env-a", nil); err == nil {
		t.Fatal("different provider overwrote an uncertain bootstrap delivery attempt")
	}
	raw, err := os.ReadFile(attemptPath)
	if err != nil {
		t.Fatal(err)
	}
	var persisted bootstrapDeliveryAttempt
	if err := decodeExactBootstrapDeliveryAttempt(raw, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.BootstrapDeliveryRequestIDB64u != first.BootstrapDeliveryRequestIDB64u || persisted.CloudOrigin != first.CloudOrigin {
		t.Fatalf("pending attempt changed: got %#v want %#v", persisted, first)
	}
}

func TestBootstrapAndPersistedPoolsRejectDuplicateArtifactIdentity(t *testing.T) {
	digestDuplicate := bootstrapTestControlArtifactPool(t, 7)
	digestDuplicate.Entries[1].ArtifactJSON = append(json.RawMessage(nil), digestDuplicate.Entries[0].ArtifactJSON...)
	finalizeBootstrapTestPoolDigest(t, digestDuplicate)
	if _, err := controlArtifactPoolFromBootstrap(*digestDuplicate, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "repeats an artifact digest") {
		t.Fatalf("duplicate bootstrap artifact error = %v", err)
	}

	channelDuplicate := bootstrapTestControlArtifactPool(t, 7)
	channelDuplicate.Entries[1].ArtifactChannelID = channelDuplicate.Entries[0].ArtifactChannelID
	finalizeBootstrapTestPoolDigest(t, channelDuplicate)
	if _, err := controlArtifactPoolFromBootstrap(*channelDuplicate, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "repeats an artifact channel") {
		t.Fatalf("duplicate bootstrap channel error = %v", err)
	}

	persisted, err := controlArtifactPoolFromBootstrap(*bootstrapTestControlArtifactPool(t, 7), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	persisted.Entries[1].ArtifactJSON = append(json.RawMessage(nil), persisted.Entries[0].ArtifactJSON...)
	persisted.Entries[1].ArtifactDigest = persisted.Entries[0].ArtifactDigest
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "repeats an artifact digest") {
		t.Fatalf("duplicate persisted artifact error = %v", err)
	}
}

func TestBootstrapAndPersistedPoolsRejectSharedContractDrift(t *testing.T) {
	waterlineDrift := bootstrapTestControlArtifactPool(t, 7)
	waterlineDrift.TargetWaterline = 1
	finalizeBootstrapTestPoolDigest(t, waterlineDrift)
	if _, err := controlArtifactPoolFromBootstrap(*waterlineDrift, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("bootstrap target waterline drift error = %v", err)
	}

	sequenceOverflow := bootstrapTestControlArtifactPool(t, 7)
	sequenceOverflow.Entries[1].ArtifactSequence = uint64(math.MaxInt64) + 1
	sequenceOverflow.ServerHighestArtifactSequence = uint64(math.MaxInt64) + 1
	finalizeBootstrapTestPoolDigest(t, sequenceOverflow)
	if _, err := controlArtifactPoolFromBootstrap(*sequenceOverflow, 7, time.Now()); err == nil || !strings.Contains(err.Error(), "contract mismatch") {
		t.Fatalf("bootstrap sequence overflow error = %v", err)
	}

	persisted, err := controlArtifactPoolFromBootstrap(*bootstrapTestControlArtifactPool(t, 7), 7, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	persisted.TargetWaterline = 1
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "target_waterline") {
		t.Fatalf("persisted target waterline drift error = %v", err)
	}
	persisted.TargetWaterline = ControlArtifactTargetWaterline
	persisted.Entries[1].Sequence = uint64(math.MaxInt64) + 1
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "sequences must increase") {
		t.Fatalf("persisted sequence overflow error = %v", err)
	}
	persisted.Entries[1].Sequence = 2
	responseDigest := sha256.Sum256([]byte("response"))
	persisted.PendingTopUp = &ControlArtifactPendingTopUp{
		RequestIDB64u:      base64.RawURLEncoding.EncodeToString(make([]byte, sha256.Size)),
		BindingGeneration:  7,
		State:              ControlArtifactTopUpApplied,
		ResponseDigestB64u: base64.RawURLEncoding.EncodeToString(responseDigest[:]),
		HighestSequence:    uint64(math.MaxInt64) + 1,
	}
	if err := persisted.Validate(time.Now().Unix()); err == nil || !strings.Contains(err.Error(), "server waterline") {
		t.Fatalf("persisted pending waterline overflow error = %v", err)
	}
}

func writeBootstrapTestResponse(t *testing.T, w http.ResponseWriter, host, localEnvironmentPublicID string, generation int64) {
	writeBootstrapTestResponseForEnvironment(t, w, host, localEnvironmentPublicID, generation, "env_123")
}

func writeBootstrapTestResponseForEnvironment(t *testing.T, w http.ResponseWriter, host, localEnvironmentPublicID string, generation int64, envPublicID string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	response := runtimeLinkExchangeResponse{
		ProtocolVersion:     "rcpp-v4",
		CloudID:             "example_control_plane",
		CloudOrigin:         "https://" + host,
		AccessPointID:       "dev",
		AccessPointOrigin:   "https://" + host,
		EnvPublicID:         envPublicID,
		ControlArtifactPool: bootstrapTestControlArtifactPool(t, generation),
		LocalEnvironmentBinding: &LocalEnvironmentBinding{
			LocalEnvironmentPublicID: localEnvironmentPublicID,
			EnvPublicID:              "env_123",
			Generation:               generation,
		},
	}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatalf("Encode(response) error = %v", err)
	}
}

func newCloudLinkTestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/rcpp/v4/runtime-link/resolve" {
			var request struct {
				ProtocolVersion string `json:"protocol_version"`
				EnvPublicID     string `json:"env_public_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			if request.ProtocolVersion != "rcpp-v4" || request.EnvPublicID == "" {
				t.Error("invalid resolve request")
			}
			_ = json.NewEncoder(w).Encode(runtimeLinkAssignment{
				ProtocolVersion: "rcpp-v4", CloudID: "example_control_plane", CloudOrigin: "https://" + r.Host,
				AccessPointID: "dev", AccessPointOrigin: "https://" + r.Host, EnvPublicID: request.EnvPublicID,
				ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli(),
			})
			return
		}
		handler.ServeHTTP(w, r)
	}))
}

func bootstrapTestControlArtifactPool(t *testing.T, generation int64) *bootstrapControlArtifactPool {
	t.Helper()
	endpoints, err := flowercontrol.NewEndpointSet(flowercontrol.EndpointConfig{
		ID: "websocket", URL: "wss://example.com/flowersec/v3/direct", TLS: flowercontrol.CAPolicy(),
	})
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(4 * time.Minute).Truncate(time.Second)
	pool := &bootstrapControlArtifactPool{
		Version:                       ControlArtifactPoolContractVersion,
		LogicalCloudBindingID:         fmt.Sprintf("binding-%d", generation),
		BindingGeneration:             generation,
		TargetWaterline:               ControlArtifactTargetWaterline,
		RefreshHorizonSeconds:         ControlArtifactRefreshHorizonS,
		ServerHighestArtifactSequence: ControlArtifactTargetWaterline,
		Entries:                       make([]bootstrapControlArtifactPoolEntry, 0, ControlArtifactTargetWaterline),
	}
	for sequence := 1; sequence <= ControlArtifactTargetWaterline; sequence++ {
		channelID := fmt.Sprintf("bootstrap-%d-%d", generation, sequence)
		issued, err := flowercontrol.NewIssuer().IssueDirect(flowercontrol.DirectIssueOptions{
			Session: flowercontrol.SessionOptions{
				ChannelID: channelID,
				ExpiresAt: expires,
			},
			Endpoints:         endpoints,
			RendezvousGroupID: "bootstrap-test",
			ListenerAudience:  "redeven",
			UpstreamAddress:   "127.0.0.1:1",
		})
		if err != nil {
			t.Fatal(err)
		}
		pool.Entries = append(pool.Entries, bootstrapControlArtifactPoolEntry{
			ArtifactJSON:      issued.ArtifactJSON(),
			ArtifactChannelID: channelID,
			BindingGeneration: generation,
			ArtifactSequence:  uint64(sequence),
			ExpiresAtUnixS:    expires.Unix(),
		})
	}
	finalizeBootstrapTestPoolDigest(t, pool)
	return pool
}

func finalizeBootstrapTestPoolDigest(t *testing.T, pool *bootstrapControlArtifactPool) {
	t.Helper()
	pool.ResponseDigestB64u = ""
	unsigned, err := json.Marshal(pool)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(unsigned)
	pool.ResponseDigestB64u = base64.RawURLEncoding.EncodeToString(digest[:])
}

func assertBootstrapDeliveryRequestID(t *testing.T, value string) {
	t.Helper()
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size || base64.RawURLEncoding.EncodeToString(decoded) != value {
		t.Fatalf("bootstrap delivery request id = %q, want canonical 32-byte base64url", value)
	}
}

func assertBootstrapAttemptRemoved(t *testing.T, configPath string) {
	t.Helper()
	_, err := os.Stat(configPath + ".cloud-link-delivery-v2.json")
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending bootstrap delivery attempt still exists: %v", err)
	}
}

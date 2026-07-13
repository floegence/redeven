package config

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestBootstrapConfigExplicitLogLevelOverridesPreviousConfig(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"example_control_plane"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/rcpp/v2/runtime/bootstrap/exchange" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "provider_id": "example_control_plane",
  "provider_origin": "https://redeven.test",
  "access_point_id": "dev",
	  "access_point_origin": "https://` + r.Host + `",
  "direct": {
    "ws_url": "wss://dev.redeven.test/control/ws",
    "channel_id": "ch_123",
    "e2ee_psk_b64u": "cHNr",
    "channel_init_expire_at_unix_s": 4102444800
  },
  "local_environment_binding": {
    "local_environment_public_id": "le_existing",
    "env_public_id": "env_123",
    "generation": 7
  }
}`))
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	layout, err := LocalEnvironmentStateLayout(stateRoot)
	if err != nil {
		t.Fatalf("LocalEnvironmentStateLayout() error = %v", err)
	}
	if err := Save(layout.ConfigPath, &Config{
		ProviderOrigin:           "https://redeven.test",
		ControlplaneBaseURL:      "https://old.example.invalid",
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
		ProviderOrigin:      "https://redeven.test",
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_123",
		BootstrapTicket:     "ticket-123",
		StateRoot:           stateRoot,
		LogLevel:            "info",
		HTTPClient:          server.Client(),
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
	if cfg.ProviderOrigin != "https://redeven.test" {
		t.Fatalf("ProviderOrigin = %q, want %q", cfg.ProviderOrigin, "https://redeven.test")
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
	if cfg.ControlplaneProviderID != "example_control_plane" {
		t.Fatalf("ControlplaneProviderID = %q, want %q", cfg.ControlplaneProviderID, "example_control_plane")
	}
	if cfg.Direct == nil || cfg.Direct.ChannelId != "ch_123" {
		t.Fatalf("Direct = %#v", cfg.Direct)
	}
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

func TestBootstrapConfigSupportsBootstrapTicketExchange(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"example_control_plane"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/rcpp/v2/runtime/bootstrap/exchange" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
		}
		var payload bootstrapTicketExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode(request) error = %v", err)
		}
		if payload.EnvPublicID != "env_123" {
			t.Fatalf("EnvPublicID = %q", payload.EnvPublicID)
		}
		if payload.ProviderOrigin != "https://redeven.test" {
			t.Fatalf("ProviderOrigin = %q", payload.ProviderOrigin)
		}
		if payload.LocalEnvironmentPublicID == "" {
			t.Fatalf("LocalEnvironmentPublicID is empty")
		}
		if payload.AgentInstanceID == "" {
			t.Fatalf("AgentInstanceID is empty")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "provider_id": "example_control_plane",
  "provider_origin": "https://redeven.test",
  "access_point_id": "dev",
	  "access_point_origin": "https://` + r.Host + `",
  "direct": {
    "ws_url": "wss://dev.redeven.test/control/ws",
    "channel_id": "ch_ticket",
    "e2ee_psk_b64u": "cHNr",
    "channel_init_expire_at_unix_s": 4102444800
  },
  "local_environment_binding": {
    "local_environment_public_id": "` + payload.LocalEnvironmentPublicID + `",
    "env_public_id": "env_123",
    "generation": 3
  }
}`))
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
		ProviderOrigin:      "https://redeven.test",
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_123",
		BootstrapTicket:     "ticket-123",
		StateRoot:           stateRoot,
		HTTPClient:          server.Client(),
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
	if cfg.ControlplaneProviderID != "example_control_plane" {
		t.Fatalf("ControlplaneProviderID = %q, want %q", cfg.ControlplaneProviderID, "example_control_plane")
	}
	if cfg.Direct == nil || cfg.Direct.ChannelId != "ch_ticket" {
		t.Fatalf("Direct = %#v", cfg.Direct)
	}
	if cfg.LocalEnvironmentPublicID == "" {
		t.Fatalf("LocalEnvironmentPublicID is empty")
	}
	if cfg.BindingGeneration != 3 {
		t.Fatalf("BindingGeneration = %d, want 3", cfg.BindingGeneration)
	}
}

func TestBootstrapConfigRejectsMissingBootstrapTicket(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := BootstrapConfig(ctx, BootstrapArgs{
		ProviderOrigin:      "https://redeven.test",
		ControlplaneBaseURL: "https://dev.redeven.test",
		EnvironmentID:       "env_123",
		StateRoot:           t.TempDir(),
	})
	if err == nil || err.Error() != "missing bootstrap ticket" {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
}

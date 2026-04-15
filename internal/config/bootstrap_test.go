package config

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBootstrapConfigExplicitLogLevelOverridesPreviousConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"redeven_portal"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer token-123")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "success": true,
  "data": {
    "direct": {
      "ws_url": "wss://region.example.invalid/control/ws",
      "channel_id": "ch_123",
      "e2ee_psk_b64u": "cHNr",
      "channel_init_expire_at_unix_s": 4102444800
    }
  }
}`))
	}))
	defer server.Close()

	cfgPath := filepath.Join(t.TempDir(), "config.json")
	if err := Save(cfgPath, &Config{
		ControlplaneBaseURL: "https://old.example.invalid",
		EnvironmentID:       "env_old",
		AgentInstanceID:     "ai_existing",
		LogFormat:           "json",
		LogLevel:            "debug",
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	writtenPath, err := BootstrapConfig(ctx, BootstrapArgs{
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_123",
		EnvironmentToken:    "token-123",
		ConfigPath:          cfgPath,
		LogLevel:            "info",
	})
	if err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
	if writtenPath != cfgPath {
		t.Fatalf("writtenPath = %q, want %q", writtenPath, cfgPath)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("LogLevel = %q, want %q", cfg.LogLevel, "info")
	}
	if cfg.AgentInstanceID != "ai_existing" {
		t.Fatalf("AgentInstanceID = %q, want %q", cfg.AgentInstanceID, "ai_existing")
	}
	if cfg.EnvironmentID != "env_123" {
		t.Fatalf("EnvironmentID = %q, want %q", cfg.EnvironmentID, "env_123")
	}
	if cfg.ControlplaneProviderID != "redeven_portal" {
		t.Fatalf("ControlplaneProviderID = %q, want %q", cfg.ControlplaneProviderID, "redeven_portal")
	}
	if cfg.Direct == nil || cfg.Direct.ChannelId != "ch_123" {
		t.Fatalf("Direct = %#v", cfg.Direct)
	}
}

func TestBootstrapConfigSupportsBootstrapTicketExchange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"redeven_portal"}`))
			return
		case r.Method != http.MethodPost:
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/rcpp/v1/runtime/bootstrap/exchange" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer ticket-123" {
			t.Fatalf("Authorization = %q, want %q", got, "Bearer ticket-123")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "direct": {
    "ws_url": "wss://region.example.invalid/control/ws",
    "channel_id": "ch_ticket",
    "e2ee_psk_b64u": "cHNr",
    "channel_init_expire_at_unix_s": 4102444800
  }
}`))
	}))
	defer server.Close()

	cfgPath := filepath.Join(t.TempDir(), "config.json")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	writtenPath, err := BootstrapConfig(ctx, BootstrapArgs{
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_123",
		BootstrapTicket:     "ticket-123",
		ConfigPath:          cfgPath,
	})
	if err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
	if writtenPath != cfgPath {
		t.Fatalf("writtenPath = %q, want %q", writtenPath, cfgPath)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ControlplaneProviderID != "redeven_portal" {
		t.Fatalf("ControlplaneProviderID = %q, want %q", cfg.ControlplaneProviderID, "redeven_portal")
	}
	if cfg.Direct == nil || cfg.Direct.ChannelId != "ch_ticket" {
		t.Fatalf("Direct = %#v", cfg.Direct)
	}
}

func TestBootstrapConfigWritesScopeMetadataWithProviderIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/.well-known/redeven-provider.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"provider_id":"redeven_portal"}`))
			return
		case r.Method == http.MethodPost && r.URL.Path == "/api/rcpp/v1/runtime/bootstrap/exchange":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
  "direct": {
    "ws_url": "wss://region.example.invalid/control/ws",
    "channel_id": "ch_ticket",
    "e2ee_psk_b64u": "cHNr",
    "channel_init_expire_at_unix_s": 4102444800
  }
}`))
			return
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	stateRoot := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cfgPath, err := BootstrapConfig(ctx, BootstrapArgs{
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_123",
		BootstrapTicket:     "ticket-123",
		StateRoot:           stateRoot,
	})
	if err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}

	layout, err := StateLayoutForConfigPath(cfgPath)
	if err != nil {
		t.Fatalf("StateLayoutForConfigPath() error = %v", err)
	}

	body, err := os.ReadFile(layout.ScopeMetadataPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", layout.ScopeMetadataPath, err)
	}
	var metadata ScopeMetadata
	if err := json.Unmarshal(body, &metadata); err != nil {
		t.Fatalf("json.Unmarshal(scope metadata) error = %v", err)
	}
	if metadata.BoundControlplaneBaseURL != server.URL {
		t.Fatalf("BoundControlplaneBaseURL = %q, want %q", metadata.BoundControlplaneBaseURL, server.URL)
	}
	if metadata.BoundControlplaneProviderID != "redeven_portal" {
		t.Fatalf("BoundControlplaneProviderID = %q, want %q", metadata.BoundControlplaneProviderID, "redeven_portal")
	}
	if metadata.BoundEnvironmentID != "env_123" {
		t.Fatalf("BoundEnvironmentID = %q, want %q", metadata.BoundEnvironmentID, "env_123")
	}
}

func TestBootstrapConfigRejectsMultipleCredentials(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := BootstrapConfig(ctx, BootstrapArgs{
		ControlplaneBaseURL: "https://region.example.invalid",
		EnvironmentID:       "env_123",
		EnvironmentToken:    "token-123",
		BootstrapTicket:     "ticket-123",
		ConfigPath:          filepath.Join(t.TempDir(), "config.json"),
	})
	if err == nil || err.Error() != "provide only one of environment token or bootstrap ticket" {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}
}

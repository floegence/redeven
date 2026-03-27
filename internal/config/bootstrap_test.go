package config

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestBootstrapConfigExplicitLogLevelOverridesPreviousConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
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
	if cfg.Direct == nil || cfg.Direct.ChannelId != "ch_123" {
		t.Fatalf("Direct = %#v", cfg.Direct)
	}
}

func TestBootstrapConfigPreservesDebugConsolePreferences(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
  "success": true,
  "data": {
    "direct": {
      "ws_url": "wss://region.example.invalid/control/ws",
      "channel_id": "ch_456",
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
		DebugConsole: &DebugConsoleConfig{
			Enabled:          true,
			CollectUIMetrics: true,
		},
	}); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := BootstrapConfig(ctx, BootstrapArgs{
		ControlplaneBaseURL: server.URL,
		EnvironmentID:       "env_456",
		EnvironmentToken:    "token-456",
		ConfigPath:          cfgPath,
	}); err != nil {
		t.Fatalf("BootstrapConfig() error = %v", err)
	}

	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DebugConsole == nil {
		t.Fatalf("DebugConsole = nil, want preserved config")
	}
	if !cfg.DebugConsole.Enabled || !cfg.DebugConsole.CollectUIMetrics {
		t.Fatalf("DebugConsole = %#v, want enabled + collect_ui_metrics preserved", cfg.DebugConsole)
	}
}

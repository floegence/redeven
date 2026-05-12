package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
)

func TestDesktopBrokerModelSnapshotFiltersMissingKeys(t *testing.T) {
	t.Parallel()

	secretStore := settings.NewSecretsStore(filepath.Join(t.TempDir(), "secrets.json"))
	if err := secretStore.SetAIProviderAPIKey("openai", "sk-local"); err != nil {
		t.Fatalf("SetAIProviderAPIKey: %v", err)
	}
	snapshot, err := buildDesktopBrokerModelSnapshot(&config.AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []config.AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []config.AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: "https://api.anthropic.com",
				Models:  []config.AIProviderModel{{ModelName: "claude-sonnet-4-5"}},
			},
		},
	}, secretStore)
	if err != nil {
		t.Fatalf("buildDesktopBrokerModelSnapshot: %v", err)
	}
	if snapshot == nil {
		t.Fatalf("snapshot is nil")
	}
	if snapshot.CurrentModel != "openai/gpt-5-mini" {
		t.Fatalf("CurrentModel=%q", snapshot.CurrentModel)
	}
	if got, want := len(snapshot.Models), 1; got != want {
		t.Fatalf("len(Models)=%d, want %d", got, want)
	}
	if snapshot.Models[0].ID != "openai/gpt-5-mini" {
		t.Fatalf("model ID=%q", snapshot.Models[0].ID)
	}
	if !reflect.DeepEqual(snapshot.MissingKeyProviderIDs, []string{"anthropic"}) {
		t.Fatalf("MissingKeyProviderIDs=%v", snapshot.MissingKeyProviderIDs)
	}
}

func TestServiceListModelsUsesDesktopBrokerWithoutRemoteConfig(t *testing.T) {
	t.Parallel()

	var sawAuth bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer broker-token" {
			sawAuth = true
		}
		switch r.URL.Path {
		case "/v1/status":
			_ = json.NewEncoder(w).Encode(DesktopAIBrokerStatus{
				Connected:   true,
				Available:   true,
				ModelSource: "desktop_local_environment",
				ModelCount:  1,
			})
			return
		case "/v1/models":
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(DesktopBrokerModelSnapshot{
			Configured: true,
			Models: []DesktopBrokerModel{{
				ID:           "openai/gpt-5-mini",
				ProviderID:   "openai",
				ProviderType: "openai",
				ModelName:    "gpt-5-mini",
				Label:        "OpenAI / gpt-5-mini",
			}},
		})
	}))
	defer server.Close()
	client, err := newDesktopAIBrokerClient(&DesktopAIBrokerEndpoint{
		URL:       server.URL,
		Token:     "broker-token",
		SessionID: "broker-session",
	})
	if err != nil {
		t.Fatalf("newDesktopAIBrokerClient: %v", err)
	}
	svc := &Service{desktopBroker: client}

	if !svc.Enabled() {
		t.Fatalf("Enabled=false, want true")
	}
	out, err := svc.ListModels()
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if !sawAuth {
		t.Fatalf("broker auth header was not sent")
	}
	if out.CurrentModel != "desktop-broker:openai/gpt-5-mini" {
		t.Fatalf("CurrentModel=%q", out.CurrentModel)
	}
	if got, want := len(out.Models), 1; got != want {
		t.Fatalf("len(Models)=%d, want %d", got, want)
	}
	model := out.Models[0]
	if model.ID != "desktop-broker:openai/gpt-5-mini" {
		t.Fatalf("model.ID=%q", model.ID)
	}
	if model.Source != "desktop_broker" || model.SourceLabel != "Desktop" {
		t.Fatalf("model source=(%q,%q), want desktop broker", model.Source, model.SourceLabel)
	}
	if out.Runtime == nil || out.Runtime.RemoteConfigured {
		t.Fatalf("Runtime=%#v, want broker-only runtime status", out.Runtime)
	}
}

func TestDesktopBrokerProviderStreamsAndMapsErrors(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/stream" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer broker-token" {
			t.Fatalf("Authorization=%q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Redeven-AI-Broker-Session") != "broker-session" {
			t.Fatalf("broker session header=%q", r.Header.Get("X-Redeven-AI-Broker-Session"))
		}
		requests++
		var body desktopBrokerStreamRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if body.Request.Model != "openai/gpt-5-mini" {
			t.Fatalf("broker request model=%q", body.Request.Model)
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		enc := json.NewEncoder(w)
		_ = enc.Encode(desktopBrokerStreamFrame{Type: "event", Event: &StreamEvent{Type: StreamEventTextDelta, Text: "hi"}})
		_ = enc.Encode(desktopBrokerStreamFrame{Type: "result", Result: &TurnResult{FinishReason: "stop", Text: "hi"}})
	}))
	defer server.Close()
	client, err := newDesktopAIBrokerClient(&DesktopAIBrokerEndpoint{
		URL:       server.URL,
		Token:     "broker-token",
		SessionID: "broker-session",
	})
	if err != nil {
		t.Fatalf("newDesktopAIBrokerClient: %v", err)
	}
	provider := client.Provider("openai/gpt-5-mini")
	var events []StreamEvent
	result, err := provider.StreamTurn(context.Background(), TurnRequest{
		Model: "desktop-broker:openai/gpt-5-mini",
	}, func(ev StreamEvent) {
		events = append(events, ev)
	})
	if err != nil {
		t.Fatalf("StreamTurn: %v", err)
	}
	if requests != 1 {
		t.Fatalf("requests=%d, want 1", requests)
	}
	if result.Text != "hi" || result.FinishReason != "stop" {
		t.Fatalf("result=%#v", result)
	}
	if len(events) != 1 || events[0].Text != "hi" {
		t.Fatalf("events=%#v", events)
	}
}

func TestDesktopBrokerServerAuthorizesSessionAndExpiry(t *testing.T) {
	t.Parallel()

	t.Run("requires session header", func(t *testing.T) {
		t.Parallel()

		srv := (&desktopAIBrokerServer{
			token:           "broker-token",
			sessionID:       "broker-session",
			expiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli(),
		}).routes()
		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		req.Header.Set("Authorization", "Bearer broker-token")
		rec := httptest.NewRecorder()

		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status=%d, want %d", rec.Code, http.StatusUnauthorized)
		}
		var payload desktopBrokerError
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if payload.Code != "UNAUTHORIZED" {
			t.Fatalf("error code=%q", payload.Code)
		}
	})

	t.Run("rejects expired token", func(t *testing.T) {
		t.Parallel()

		srv := (&desktopAIBrokerServer{
			token:           "broker-token",
			sessionID:       "broker-session",
			expiresAtUnixMS: time.Now().Add(-time.Hour).UnixMilli(),
		}).routes()
		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		req.Header.Set("Authorization", "Bearer broker-token")
		req.Header.Set("X-Redeven-AI-Broker-Session", "broker-session")
		rec := httptest.NewRecorder()

		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status=%d, want %d", rec.Code, http.StatusUnauthorized)
		}
		var payload desktopBrokerError
		if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
			t.Fatalf("Decode: %v", err)
		}
		if payload.Code != "TOKEN_EXPIRED" {
			t.Fatalf("error code=%q", payload.Code)
		}
	})
}

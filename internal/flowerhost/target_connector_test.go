package flowerhost

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
)

func TestTargetConnectorOpensFlowerTargetSession(t *testing.T) {
	t.Parallel()

	var seenPath string
	var seenAuth string
	var seenCapabilities []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seenAuth = r.Header.Get("authorization")
		var request struct {
			RequiredCapabilities []string `json:"required_capabilities"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		seenCapabilities = request.RequiredCapabilities
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"entry_ticket":  "ticket_1",
			"target_id":     "cp:test:env:env_a",
			"floe_app":      "com.floegence.redeven.flower",
			"session_kind":  "flower_host_rpc",
			"code_space_id": "flower-host:test",
			"env_public_id": "env_a",
			"can_read":      true,
			"can_write":     true,
			"can_execute":   false,
			"capability": map[string]any{
				"can_read":    true,
				"can_write":   true,
				"can_execute": false,
			},
			"expires_at_unix_ms": int64(4102444800000),
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		HostID: "flower-host:test",
		ResolveAccessToken: func(_ context.Context, providerOrigin string) (string, bool, error) {
			if providerOrigin != server.URL {
				t.Fatalf("provider origin=%q", providerOrigin)
			}
			return "access-token", true, nil
		},
	})
	session, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read", "write"})
	if err != nil {
		t.Fatalf("OpenTargetSession: %v", err)
	}
	if seenPath != "/api/rcpp/v1/environments/env_a/flower/target-session" {
		t.Fatalf("path=%q", seenPath)
	}
	if seenAuth != "Bearer access-token" {
		t.Fatalf("authorization=%q", seenAuth)
	}
	if len(seenCapabilities) != 2 || seenCapabilities[0] != "read" || seenCapabilities[1] != "write" {
		t.Fatalf("required_capabilities=%v", seenCapabilities)
	}
	if session.SessionID != "ticket_1" || session.SessionKind != "flower_host_rpc" || session.FloeApp != "com.floegence.redeven.flower" {
		t.Fatalf("session=%#v", session)
	}
	if session.TargetID != "cp:test:env:env_a" || session.EnvPublicID != "env_a" || session.ChannelID != "flower-host:test" {
		t.Fatalf("session binding=%#v", session)
	}
	if !session.Capabilities.CanRead || !session.Capabilities.CanWrite || session.Capabilities.CanExecute {
		t.Fatalf("capabilities=%#v", session.Capabilities)
	}
}

func TestTargetConnectorRejectsInvalidRequiredCapability(t *testing.T) {
	t.Parallel()

	connector := NewTargetConnector(TargetConnectorOptions{
		ResolveAccessToken: func(context.Context, string) (string, bool, error) {
			return "access-token", true, nil
		},
	})
	_, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: "https://region.example.test",
		EnvPublicID:    "env_a",
	}, []string{"admin"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetConnectorRejectsSessionForDifferentTarget(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"entry_ticket":       "ticket_1",
			"target_id":          "cp:test:env:env_b",
			"floe_app":           "com.floegence.redeven.flower",
			"session_kind":       "flower_host_rpc",
			"code_space_id":      "flower-host:test",
			"env_public_id":      "env_a",
			"capability":         map[string]any{"can_read": true},
			"expires_at_unix_ms": int64(4102444800000),
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		ResolveAccessToken: func(context.Context, string) (string, bool, error) {
			return "access-token", true, nil
		},
	})
	_, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetConnectorRejectsEntryGrantForDifferentChannel(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/rcpp/v1/environments/env_a/flower/target-session":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"entry_ticket":       "ticket_1",
				"target_id":          "cp:test:env:env_a",
				"floe_app":           "com.floegence.redeven.flower",
				"session_kind":       "flower_host_rpc",
				"code_space_id":      "flower-host:test",
				"env_public_id":      "env_a",
				"capability":         map[string]any{"can_read": true},
				"expires_at_unix_ms": int64(4102444800000),
			})
		case "/v1/channel/init/entry":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"grant_client": &controlv1.ChannelInitGrant{ChannelId: "different-channel"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		ResolveAccessToken: func(context.Context, string) (string, bool, error) {
			return "access-token", true, nil
		},
	})
	_, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetConnectorRejectsLegacyTopLevelCapabilities(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"entry_ticket":       "ticket_1",
			"floe_app":           "com.floegence.redeven.flower",
			"session_kind":       "flower_host_rpc",
			"code_space_id":      "flower-host:test",
			"can_read":           true,
			"can_write":          true,
			"can_execute":        true,
			"expires_at_unix_ms": int64(4102444800000),
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		ResolveAccessToken: func(context.Context, string) (string, bool, error) {
			return "access-token", true, nil
		},
	})
	_, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unauthorized" {
		t.Fatalf("reason=%q err=%v, want target_unauthorized", got, err)
	}
}

func TestTargetConnectorFailsClosedWithoutAuthorization(t *testing.T) {
	t.Parallel()

	connector := NewTargetConnector(TargetConnectorOptions{})
	_, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: "https://region.example.test",
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unauthorized" {
		t.Fatalf("reason=%q err=%v, want target_unauthorized", got, err)
	}
}

func TestTargetConnectorMapsOfflineTargetToUnreachable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "offline", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		ResolveAccessToken: func(context.Context, string) (string, bool, error) {
			return "access-token", true, nil
		},
	})
	_, err := connector.OpenTargetSession(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unreachable" {
		t.Fatalf("reason=%q err=%v, want target_unreachable", got, err)
	}
}

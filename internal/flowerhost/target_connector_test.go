package flowerhost

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
)

func TestTargetConnectorRequestsCarrierBrokerOnly(t *testing.T) {
	t.Parallel()

	var seenPath string
	var seenAuth string
	var seenBody targetBrokerOpenSessionRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seenAuth = r.Header.Get("authorization")
		if err := json.NewDecoder(r.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"data": TargetSessionGrant{
				TargetID:       "cp:test:env:env_a",
				ProviderOrigin: "http://provider.example.test",
				EnvPublicID:    "env_a",
				GrantClient: &controlv1.ChannelInitGrant{
					ChannelId: "ch_target",
				},
				Capabilities: TargetSessionCapabilities{
					CanRead:  true,
					CanWrite: true,
				},
				ExpiresAtUnixMs: int64(4102444800000),
			},
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		BrokerURL:   server.URL,
		BrokerToken: "broker-token",
	})
	grant, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: "http://provider.example.test",
		ProviderID:     "reference_provider",
		EnvPublicID:    "env_a",
	}, []string{"read", "write"})
	if err != nil {
		t.Fatalf("OpenTargetGrant: %v", err)
	}
	if strings.Contains(seenPath, "/flower/"+"target-session") || seenPath != "/v1/targets/open-session" {
		t.Fatalf("path=%q, want carrier broker path", seenPath)
	}
	if seenAuth != "Bearer broker-token" {
		t.Fatalf("authorization=%q", seenAuth)
	}
	if seenBody.TargetID != "cp:test:env:env_a" || seenBody.EnvPublicID != "env_a" || seenBody.ProviderOrigin != "http://provider.example.test" {
		t.Fatalf("request body=%#v", seenBody)
	}
	if len(seenBody.RequiredCapabilities) != 2 || seenBody.RequiredCapabilities[0] != "read" || seenBody.RequiredCapabilities[1] != "write" {
		t.Fatalf("required_capabilities=%v", seenBody.RequiredCapabilities)
	}
	if grant.GrantClient == nil || grant.GrantClient.ChannelId != "ch_target" {
		t.Fatalf("grant=%#v", grant)
	}
}

func TestTargetConnectorRejectsInvalidRequiredCapability(t *testing.T) {
	t.Parallel()

	connector := NewTargetConnector(TargetConnectorOptions{
		BrokerURL:   "http://127.0.0.1:1",
		BrokerToken: "broker-token",
	})
	_, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: "https://region.example.test",
		EnvPublicID:    "env_a",
	}, []string{"admin"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetConnectorRejectsGrantForDifferentTarget(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"data": TargetSessionGrant{
				TargetID:        "cp:test:env:env_b",
				ProviderOrigin:  "http://provider.example.test",
				EnvPublicID:     "env_a",
				GrantClient:     &controlv1.ChannelInitGrant{ChannelId: "ch_target"},
				Capabilities:    TargetSessionCapabilities{CanRead: true},
				ExpiresAtUnixMs: int64(4102444800000),
			},
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		BrokerURL:   server.URL,
		BrokerToken: "broker-token",
	})
	_, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: "http://provider.example.test",
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unsupported" {
		t.Fatalf("reason=%q err=%v, want target_unsupported", got, err)
	}
}

func TestTargetConnectorFailsClosedWithoutBroker(t *testing.T) {
	t.Parallel()

	connector := NewTargetConnector(TargetConnectorOptions{})
	_, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
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
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "target is offline",
		})
	}))
	defer server.Close()

	connector := NewTargetConnector(TargetConnectorOptions{
		BrokerURL:   server.URL,
		BrokerToken: "broker-token",
	})
	_, err := connector.OpenTargetGrant(context.Background(), FlowerTargetRef{
		TargetID:       "cp:test:env:env_a",
		ProviderOrigin: server.URL,
		EnvPublicID:    "env_a",
	}, []string{"read"})
	if got := TargetConnectReason(err); got != "target_unreachable" {
		t.Fatalf("reason=%q err=%v, want target_unreachable", got, err)
	}
}

package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestPlatformCatalogIsSessionScopedWithoutLocalConfiguration(t *testing.T) {
	var revoked atomic.Bool
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked.Load() {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		switch r.URL.Path {
		case "/api/ai/v1/leases/renew":
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: token, RenewalToken: token, ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
		case "/api/ai/v1/catalog":
			models := []platformCatalogModel{{ModelID: token, DisplayName: "Authorized model", Available: true, Capabilities: []string{"text", "responses", "tools", "image_input", "reasoning"}, ContextWindow: 32000, MaxOutputTokens: 2048, ReasoningLevels: []string{"low", "high"}, ReasoningDefaultLevel: "low"}}
			_ = json.NewEncoder(w).Encode(platformModelCatalog{Models: models})
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer edge.Close()
	svc := &Service{}
	meta := &session.Meta{EndpointID: "env", NamespacePublicID: "ns", UserPublicID: "a", PlatformAIGatewayURL: edge.URL, PlatformAIGrant: "model-a", PlatformAIEntitlementVersion: 1}
	if !svc.EnabledForSession(meta) || svc.Enabled() {
		t.Fatal("session availability changed global state")
	}
	first, err := svc.ListModelsForSession(t.Context(), meta)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Models) != 1 || first.CurrentModel != "platform/model-a" || !first.Models[0].SupportsImageInput || first.Models[0].MaxOutputTokens != 2048 || first.Models[0].ReasoningCapability.DefaultLevel != "low" || !first.Runtime.RemoteConfigured {
		t.Fatalf("incomplete catalog: %+v", first)
	}
	if err := svc.SetCurrentModelForSession(t.Context(), meta, first.CurrentModel, func(*config.AIConfig) error {
		t.Fatal("platform preference persisted into environment config")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	other := *meta
	other.UserPublicID, other.PlatformAIGrant = "b", "model-b"
	second, err := svc.ListModelsForSession(t.Context(), &other)
	if err != nil || len(second.Models) != 1 || second.CurrentModel != "platform/model-b" {
		t.Fatalf("cross-user catalog leak: %+v %v", second, err)
	}
	if err := svc.SetCurrentModelForSession(t.Context(), &other, first.CurrentModel, nil); err == nil {
		t.Fatal("unauthorized model accepted")
	}
	if svc.cfg != nil {
		t.Fatal("catalog mutated configuration")
	}
	if _, err := svc.ListModels(); err == nil {
		t.Fatal("unscoped request inherited a platform catalog")
	}
	revoked.Store(true)
	if _, err := svc.ListModelsForSession(t.Context(), meta); err == nil {
		t.Fatal("revoked catalog remained accessible")
	}
}

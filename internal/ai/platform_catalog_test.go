package ai

import (
	"encoding/json"
	"fmt"
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
	blocked, err := svc.ListModelsForSession(t.Context(), meta)
	if err != nil || len(blocked.Models) != 0 || blocked.Runtime.PlatformError == "" || blocked.CurrentModel != first.CurrentModel {
		t.Fatalf("revoked catalog must preserve selection without authorizing models: %+v %v", blocked, err)
	}
}

func TestPlatformCatalogModelAliasBoundary(t *testing.T) {
	for _, alias := range []string{strings.Repeat("a", 128), strings.Repeat("a", 129), strings.Repeat("a", 255), strings.Repeat("/", 255), strings.Repeat("a", 256), "bad alias", "bad%alias", ""} {
		t.Run(fmt.Sprintf("length=%d/%s", len(alias), strings.ReplaceAll(alias, "/", "s")), func(t *testing.T) {
			edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/ai/v1/leases/renew" {
					_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "token", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
					return
				}
				catalog := platformModelCatalog{}
				for _, model := range []string{"short", alias} {
					catalog.Models = append(catalog.Models, platformCatalogModel{ModelID: model, Available: true, Capabilities: []string{"text", "chat"}, ContextWindow: 32000, MaxOutputTokens: 1024})
				}
				_ = json.NewEncoder(w).Encode(catalog)
			}))
			t.Cleanup(edge.Close)
			meta := &session.Meta{EndpointID: "env", UserPublicID: "user", PlatformAIGrant: "grant", PlatformAIGatewayURL: edge.URL, PlatformAIEntitlementVersion: 1}
			svc := &Service{}
			listed, err := svc.ListModelsForSession(t.Context(), meta)
			valid := len(alias) > 0 && len(alias) <= 255 && !strings.ContainsAny(alias, " %")
			if err != nil {
				t.Fatal(err)
			}
			if !valid {
				if listed.Runtime.PlatformError == "" {
					t.Fatal("invalid alias accepted")
				}
				return
			}
			if listed.Runtime.PlatformError != "" || len(listed.Models) != 2 {
				t.Fatalf("valid catalog rejected: %+v", listed)
			}
			id := "platform/" + config.AIModelLocalName(alias)
			if err := svc.SetCurrentModelForSession(t.Context(), meta, id, nil); err != nil {
				t.Fatal(err)
			}
			got, err := svc.resolveRunModel(t.Context(), nil, "", "", &run{sessionMeta: meta})
			if err != nil || got.ID != id || got.WireModelName != alias {
				t.Fatalf("alias round trip: %+v %v", got, err)
			}
		})
	}
}

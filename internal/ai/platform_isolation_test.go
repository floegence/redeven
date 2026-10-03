package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestPlatformOutagePreservesLocalModels(t *testing.T) {
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer edge.Close()
	cfg := &config.AIConfig{CurrentModelID: "local/local-model", Providers: []config.AIProvider{{ID: "local", Type: "openai_compatible", BaseURL: "http://127.0.0.1:19001/v1", Models: []config.AIProviderModel{{ModelName: "local-model", ContextWindow: 32000, MaxOutputTokens: 1024}}}}}
	svc := &Service{cfg: cfg}
	meta := &session.Meta{EndpointID: "env", UserPublicID: "user"}
	before, err := svc.ListModelsForSession(t.Context(), meta)
	if err != nil || len(before.Models) != 1 {
		t.Fatalf("local baseline failed: %+v %v", before, err)
	}
	baseline, err := svc.resolveRunModel(t.Context(), cfg, "local/local-model", "", &run{cfg: cfg, sessionMeta: meta})
	if err != nil || baseline.ID != "local/local-model" {
		t.Fatalf("local run baseline failed: %+v %v", baseline, err)
	}
	meta.PlatformAIGrant = "grant"
	meta.PlatformAIGatewayURL = edge.URL
	meta.PlatformAIEntitlementVersion = 1
	after, err := svc.ListModelsForSession(t.Context(), meta)
	t.Logf("local model catalog before platform metadata: %d models; with unavailable platform: models=%v error=%v", len(before.Models), after, err)
	if err != nil || after == nil || len(after.Models) != 1 || after.Runtime.PlatformError == "" {
		t.Fatalf("local catalog unavailable: %+v %v", after, err)
	}
	_, err = svc.resolveRunModel(t.Context(), cfg, "local/local-model", "", &run{cfg: cfg, sessionMeta: meta})
	t.Logf("explicit local model run with unavailable platform: %v", err)
	if err != nil {
		t.Fatalf("local model blocked: %v", err)
	}
	if _, err = svc.resolveRunModel(t.Context(), cfg, "platform/test", "", &run{cfg: cfg, sessionMeta: meta}); err == nil {
		t.Fatal("unavailable platform accepted")
	}
}

func TestPlatformPreferenceCannotOverrideExplicitLocalSelection(t *testing.T) {
	var revoked atomic.Bool
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked.Load() {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if r.URL.Path == "/api/ai/v1/leases/renew" {
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "token", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
		} else {
			_ = json.NewEncoder(w).Encode(platformModelCatalog{Models: []platformCatalogModel{{ModelID: "test", DisplayName: "Test", Available: true, Capabilities: []string{"text", "chat"}, ContextWindow: 32000, MaxOutputTokens: 1024}}})
		}
	}))
	t.Cleanup(edge.Close)
	cfg := &config.AIConfig{CurrentModelID: "local/local-model", Providers: []config.AIProvider{{ID: "local", Type: "openai_compatible", BaseURL: "http://127.0.0.1:19001/v1", Models: []config.AIProviderModel{{ModelName: "local-model", ContextWindow: 32000, MaxOutputTokens: 1024}}}}}
	svc := &Service{cfg: cfg}
	meta := &session.Meta{EndpointID: "env", UserPublicID: "user", PlatformAIGrant: "grant", PlatformAIGatewayURL: edge.URL, PlatformAIEntitlementVersion: 1}
	if err := svc.SetCurrentModelForSession(t.Context(), meta, "platform/test", nil); err != nil {
		t.Fatal(err)
	}
	revoked.Store(true)
	if _, err := svc.resolveRunModel(t.Context(), cfg, "", "", &run{cfg: cfg, sessionMeta: meta}); err == nil {
		t.Fatal("platform default silently fell back to a local model")
	}
	if err := svc.SetCurrentModelForSession(t.Context(), meta, "local/local-model", func(*config.AIConfig) error { return nil }); err != nil {
		t.Fatal(err)
	}
	revoked.Store(false)
	listed, err := svc.ListModelsForSession(t.Context(), meta)
	if err != nil || listed.CurrentModel != "local/local-model" {
		t.Fatalf("platform preference reclaimed selection: %+v %v", listed, err)
	}
}

func TestExplicitLocalModelOperationsDoNotContactPlatform(t *testing.T) {
	var calls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	t.Cleanup(edge.Close)
	cfg := &config.AIConfig{CurrentModelID: "local/local-model", Providers: []config.AIProvider{{ID: "local", Type: "openai_compatible", BaseURL: "http://127.0.0.1:19001/v1", Models: []config.AIProviderModel{{ModelName: "local-model", ContextWindow: 32000, MaxOutputTokens: 1024}}}}}
	svc := &Service{cfg: cfg}
	meta := &session.Meta{EndpointID: "env", UserPublicID: "user", PlatformAIGrant: "grant", PlatformAIGatewayURL: edge.URL, PlatformAIEntitlementVersion: 1}
	if _, err := svc.resolveRunModel(t.Context(), cfg, "local/local-model", "", &run{cfg: cfg, sessionMeta: meta}); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := svc.threadReasoningDefaults(t.Context(), meta, "local/local-model"); err != nil {
		t.Fatal(err)
	}
	_ = svc.AttachmentCapabilitiesForSession(t.Context(), meta, "local/local-model")
	if calls.Load() != 0 {
		t.Fatalf("local operations contacted platform %d times", calls.Load())
	}
}

func TestExplicitModelThreadOperationsStayIndependentOfPlatform(t *testing.T) {
	for _, outage := range []string{"unavailable", "revoked", "timeout"} {
		t.Run(outage, func(t *testing.T) {
			var calls atomic.Int32
			edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch outage {
				case "revoked":
					w.WriteHeader(http.StatusForbidden)
				case "timeout":
					<-r.Context().Done()
				default:
					w.WriteHeader(http.StatusServiceUnavailable)
				}
			}))
			t.Cleanup(edge.Close)
			cfg := &config.AIConfig{CurrentModelID: "local/first", Providers: []config.AIProvider{{
				ID: "local", Type: "openai_compatible", BaseURL: "http://127.0.0.1:19001/v1",
				Models: []config.AIProviderModel{
					{ModelName: "first", ContextWindow: 32000, MaxOutputTokens: 1024, InputModalities: []string{"text", "image"}},
					{ModelName: "second", ContextWindow: 32000, MaxOutputTokens: 1024, InputModalities: []string{"text", "image"}},
				},
			}}}
			svc := newTestService(t, cfg)
			meta := testSendTurnMeta()
			meta.PlatformAIGrant, meta.PlatformAIGatewayURL, meta.PlatformAIEntitlementVersion = "grant", edge.URL, 1
			// Explicit selections must override even a previously selected platform model.
			svc.platformModelPreferences = map[string]platformModelPreference{platformPreferenceScope(meta): {model: "platform/unavailable", used: time.Now()}}
			desktopIDs := []string{desktopModelSourceModelIDPrefix + "first", desktopModelSourceModelIDPrefix + "second"}
			source, cleanup := startTestDesktopModelSource(t, func(frame DesktopModelSourceRPCFrame) DesktopModelSourceRPCFrame {
				if frame.Method != "ai.models.list" {
					return testDesktopModelSourceError(frame.ID, "METHOD_NOT_FOUND", "unexpected method")
				}
				return testDesktopModelSourceResult(t, frame.ID, DesktopModelSourceModelSnapshot{
					Configured: true, CurrentModel: desktopIDs[0],
					Models: []DesktopModelSourceModel{
						{ID: desktopIDs[0], ContextWindow: 32000, MaxOutputTokens: 1024, InputModalities: []string{"text", "image"}, SupportsImageInput: true},
						{ID: desktopIDs[1], ContextWindow: 32000, MaxOutputTokens: 1024, InputModalities: []string{"text", "image"}, SupportsImageInput: true},
					},
				})
			})
			t.Cleanup(cleanup)
			svc.desktopModelSource = source
			for _, models := range [][]string{{"local/first", "local/second"}, desktopIDs} {
				ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
				thread, err := svc.CreateThread(ctx, meta, "Independent model", models[0], "", "")
				if err != nil {
					cancel()
					t.Fatalf("create %s: %v", models[0], err)
				}
				if err := svc.SetThreadModel(ctx, meta, thread.ThreadID, models[1]); err != nil {
					cancel()
					t.Fatalf("switch to %s: %v", models[1], err)
				}
				stored, err := svc.GetThread(ctx, meta, thread.ThreadID)
				if err != nil || stored.ModelID != models[1] {
					cancel()
					t.Fatalf("persisted selection: %+v %v", stored, err)
				}
				resolved, err := svc.resolveRunModel(ctx, cfg, models[1], models[1], &run{cfg: cfg, sessionMeta: meta})
				if err != nil || resolved.ID != models[1] {
					cancel()
					t.Fatalf("resolve %s: %+v %v", models[1], resolved, err)
				}
				if _, _, known, err := svc.threadReasoningDefaults(ctx, meta, models[1]); err != nil || !known {
					cancel()
					t.Fatalf("reasoning for %s: known=%v error=%v", models[1], known, err)
				}
				capabilities := svc.AttachmentCapabilitiesForSession(ctx, meta, models[1])
				cancel()
				if !capabilities.Enabled {
					t.Fatalf("image attachment capability lost for %s: %+v", models[1], capabilities)
				}
			}
			if calls.Load() != 0 {
				t.Fatalf("explicit model operations contacted platform %d times", calls.Load())
			}
		})
	}
}

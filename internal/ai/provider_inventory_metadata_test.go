package ai

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/floegence/redeven/internal/ai/context/adapter"
	"github.com/floegence/redeven/internal/config"
)

func TestProviderInventoryGatewayMetadataSurvivesResolutionAndRestart(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"auto/agent","display_name":"Agent","context_window":922000,"context_length":922000,"max_input_tokens":922000,"max_output_tokens":128000,"modalities":{"input":["text","image"]},"tool_call":true,"reasoning":true,"reasoning_levels":["low","medium","high","xhigh","max","ultra"]}],"has_more":false}`))
	}))
	defer server.Close()
	for _, kind := range []string{"openai", "openai_compatible"} {
		t.Run(kind, func(t *testing.T) {
			p := config.AIProvider{ID: "gateway", Type: kind, BaseURL: server.URL, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"auto%2Fagent"}}}
			if kind == "openai_compatible" {
				p.ModelSelection = nil
				p.Models = []config.AIProviderModel{{ModelName: "auto%2Fagent", WireModelName: "auto/agent"}}
			}
			svc := &Service{}
			root := t.TempDir()
			manager := newModelCatalogManager(root, nil, svc.discoverProviderCatalog, nil)
			cfg := &config.AIConfig{Providers: []config.AIProvider{p}}
			manager.configure(cfg)
			result, err := manager.sync(t.Context(), providerCatalogRequest(p, ""))
			if err != nil || len(result.Models) != 1 {
				t.Fatalf("discovery: %+v %v", result, err)
			}
			discovered := result.Models[0]
			if discovered.ContextWindow != 922000 || discovered.MaxOutputTokens != 128000 || !slices.Equal(discovered.InputModalities, []string{"text", "image"}) || discovered.SupportsTools == nil || !*discovered.SupportsTools || discovered.Status != "" || !discovered.ReasoningCapability.SupportsLevel(config.AIReasoningLevel("ultra")) {
				t.Fatalf("metadata lost: %+v", discovered)
			}
			for _, resolved := range []*config.AIConfig{manager.resolve(cfg), config.WithLocalModelCatalogs(cfg, root, nil)} {
				models := resolved.Providers[0].EffectiveModels()
				if len(models) != 1 || models[0].ContextWindow != 922000 || !models[0].SupportsImageInput() || !models[0].ReasoningCapability.SupportsLevel(config.AIReasoningLevel("ultra")) {
					t.Fatalf("resolution lost metadata: %+v", models)
				}
				capability, err := adapter.NewResolver().Resolve(t.Context(), resolved.Providers[0], "gateway/auto%2Fagent")
				if err != nil || capability.MaxContextTokens != 875900 || capability.MaxOutputTokens != 128000 || !capability.SupportsImageInput || !capability.ReasoningCapability.SupportsLevel(config.AIReasoningLevelUltra) {
					t.Fatalf("runtime capability: %+v %v", capability, err)
				}

			}
		})
	}
}

func TestProviderInventoryMetadataPartialKnownAndExplicitRejection(t *testing.T) {
	for _, tc := range []struct {
		name, body      string
		context, output int
		images, tools   bool
		status          string
	}{
		{"known sparse", `{"id":"gpt-6.1-sol","context_window":32000}`, 32000, 32000, true, true, ""},
		{"known full", `{"id":"gpt-6.1-sol","context_window":64000,"max_output_tokens":4096,"modalities":{"input":["text"]},"tool_call":true}`, 64000, 4096, false, true, ""},
		{"unknown partial", `{"id":"auto/agent","context_window":64000}`, 64000, 0, false, false, "needs_configuration"},
		{"explicit tool rejection", `{"id":"gpt-6.1-sol","tool_call":false}`, 1050000, 128000, true, false, "unsupported"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"data":[` + tc.body + `]}`)) }))
			defer server.Close()
			models, err := discoverModelCatalog(t.Context(), ModelCatalogRequest{Type: "openai", BaseURL: server.URL}, server.Client())
			if err != nil || len(models) != 1 {
				t.Fatalf("discovery: %+v %v", models, err)
			}
			p := config.AIProvider{Type: "openai"}.WithDiscoveredModels(models)
			m := p.CatalogModels()[0]
			if m.ContextWindow != tc.context || m.MaxOutputTokens != tc.output || m.SupportsImageInput() != tc.images || (m.SupportsTools == nil && m.Status != "needs_configuration" || m.SupportsTools != nil && *m.SupportsTools) != tc.tools || m.Status != tc.status {
				t.Fatalf("metadata: %+v", m)
			}
		})
	}
}

func TestProviderInventoryRejectsConflictsWithoutPublishingPartialSnapshot(t *testing.T) {
	body := `{"data":[{"id":"auto/agent","context_window":64000,"max_output_tokens":4096,"tool_call":true}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
	defer server.Close()
	p := config.AIProvider{ID: "gateway", Type: "openai", BaseURL: server.URL, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"auto%2Fagent"}}}
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}}
	root := t.TempDir()
	m := newModelCatalogManager(root, nil, (&Service{}).discoverProviderCatalog, nil)
	m.configure(cfg)
	if _, err := m.sync(t.Context(), providerCatalogRequest(p, "")); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{`{"id":"a","context_window":100,"context_length":200}`, `{"id":"a","tool_call":false,"supported_parameters":["tools"]}`, `{"id":"a","reasoning_levels":["invented"]}`} {
		body = `{"data":[{"id":"first"},` + invalid + `]}`
		if _, err := m.sync(t.Context(), providerCatalogRequest(p, "")); err == nil {
			t.Fatal("invalid metadata accepted")
		}
		cached, err := config.ReadModelCatalogSnapshot(root, config.ModelCatalogIdentity(p, ""))
		if err != nil || len(cached) != 1 || cached[0].ContextWindow != 64000 {
			t.Fatalf("failed discovery changed cache: %+v %v", cached, err)
		}
	}
}

package ai

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestModelDirectoryPublishesBackendDefaultsWithoutConfiguredProviders(t *testing.T) {
	s := &Service{}
	directory := s.projectModelDirectory(&config.AIConfig{}, &ModelsResponse{Runtime: &AIRuntimeStatus{}}, nil)
	raw, err := json.Marshal(directory)
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Defaults map[string][]ModelCatalogModel `json:"provider_defaults"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, kind := range []string{"openai", "anthropic", "google", "moonshot", "chatglm", "deepseek", "qwen", "xai", "groq"} {
		want := config.AIProviderCatalog(kind)
		got := response.Defaults[kind]
		if len(want) == 0 || len(got) != len(want) {
			t.Fatalf("%s defaults: got %d, want %d", kind, len(got), len(want))
		}
		for i, model := range got {
			want[i].EffectiveContextWindowPercent = want[i].EffectiveContextWindowPercentValue()
			if !reflect.DeepEqual(model.AIProviderModel, want[i]) || model.WebSearch.Status == "" {
				t.Fatalf("%s/%s defaults differ from backend catalog", kind, model.ModelName)
			}
		}
		count += len(got)
	}
	if count != 140 || len(directory.Models) != 0 || len(directory.Sources) != 0 {
		t.Fatalf("defaults must describe 140 models without configuring a source: %d, %+v", count, directory)
	}
}

func TestModelDirectoryRetainsReviewedMetadataForUnavailableSelections(t *testing.T) {
	for _, providerType := range []string{"openai", "anthropic", "google", "moonshot", "chatglm", "deepseek", "qwen", "xai", "groq"} {
		t.Run(providerType, func(t *testing.T) {
			catalog := config.AIProviderCatalog(providerType)
			p := config.AIProvider{ID: providerType, Type: providerType, ModelSelection: &config.AIModelSelection{SelectedModels: []string{}}}
			for _, m := range catalog {
				p.ModelSelection.SelectedModels = append(p.ModelSelection.SelectedModels, m.ModelName)
			}
			p = p.WithDiscoveredModels([]config.AIProviderModel{})
			s := &Service{}
			out := &ModelsResponse{Runtime: &AIRuntimeStatus{}}
			directory := s.projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{p}}, out, nil)
			for i, expected := range catalog {
				got := directory.Models[i]
				if got.State != "unavailable" || got.ContextWindow != expected.EffectiveInputWindowTokens() || got.MaxOutputTokens != expected.MaxOutputTokens || !reflect.DeepEqual(got.InputModalities, expected.NormalizedInputModalities()) || !reflect.DeepEqual(got.ReasoningCapability, expected.EffectiveReasoningCapability(providerType)) {
					t.Fatalf("%s lost metadata while unavailable: %+v", expected.ModelName, got)
				}
			}
		})
	}
}

func TestChatGPTDirectoryHasNoUnconfirmedChoices(t *testing.T) {
	p := config.AIProvider{ID: "openai", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: "account", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}}}
	s := &Service{}
	directory := s.projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{p}}, &ModelsResponse{Runtime: &AIRuntimeStatus{}}, nil)
	if len(directory.ProviderCatalogs[p.ID]) != 0 || len(directory.Models) != 1 || directory.Models[0].State != "unavailable" || directory.Models[0].ContextWindow == 0 {
		t.Fatalf("unconfirmed account borrowed availability or lost defaults: %+v", directory)
	}
}

func TestModelDirectoryCatalogCarriesSearchPolicy(t *testing.T) {
	p := config.AIProvider{ID: "openai", Type: "openai", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6.1-sol"}}}
	s := &Service{}
	directory := s.projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{p}}, &ModelsResponse{Runtime: &AIRuntimeStatus{}}, nil)
	for _, m := range directory.ProviderCatalogs[p.ID] {
		expected := config.ResolveAIWebSearch(p, m.EffectiveWireModelName(), false).AIWebSearchAvailability
		if m.WebSearch != expected || m.WebSearch.Status == "" {
			t.Fatalf("%s lost reviewed search policy", m.ModelName)
		}
	}
}

func TestModelDirectoryPublishesDeepSeekSearchAndFetchDefaults(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		p := config.AIProvider{ID: "ds", Type: "deepseek", WebSearch: &config.AIProviderWebSearch{Enabled: enabled, Source: "native"}}
		directory := (&Service{}).projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{p}}, &ModelsResponse{Runtime: &AIRuntimeStatus{}}, nil)
		defaults := directory.SearchPolicies[p.Type]
		configured := directory.ProviderSearchPolicies[p.ID]
		if !defaults.Enabled || !defaults.DefaultEnabled || !defaults.DefaultModelEnabled || defaults.DefaultFetchSource != "deepseek" || configured.Enabled != enabled || configured.DefaultFetchSource != defaults.DefaultFetchSource {
			t.Fatalf("enabled=%v: defaults=%+v configured=%+v", enabled, defaults, configured)
		}
	}
}

func TestModelDirectoryResolvesAPIKeyByProviderIdentity(t *testing.T) {
	provider := config.AIProvider{ID: "my-openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini", ContextWindow: 400000}}}
	s := &Service{resolveProviderKey: func(id string) (string, bool, error) {
		if id != provider.ID {
			t.Errorf("credential lookup used %q instead of provider ID", id)
			return "", false, nil
		}
		return "test-api-key", true, nil
	}}
	out := ModelsResponse{Models: []Model{{ID: "my-openai/gpt-5-mini"}}, Runtime: &AIRuntimeStatus{}}
	out.Directory = s.projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{provider}}, &out, nil)
	if len(out.Directory.Sources) != 1 || out.Directory.Sources[0].State != "ready" {
		t.Fatalf("configured API-key source was unavailable: %+v", out.Directory)
	}
}

func TestModelDirectorySearchProjectionMatchesExplicitAliasIntent(t *testing.T) {
	for _, providerEnabled := range []bool{false, true} {
		for _, modelEnabled := range []bool{false, true} {
			p := config.AIProvider{ID: "proxy", Type: "openai", BaseURL: "https://flow-node.com/v1", WebSearch: &config.AIProviderWebSearch{Enabled: providerEnabled, Source: config.AIWebSearchSourceNative}, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent"}, ModelOverrides: []config.AIProviderModel{{ModelName: "agent", WireModelName: "gpt-6.1-sol", WebSearchEnabled: &modelEnabled}}}}
			model := p.ModelMetadata("agent")
			out := &ModelsResponse{Models: []Model{configModelView("proxy/agent", "Agent", p, model)}, Runtime: &AIRuntimeStatus{}}
			directory := (&Service{}).projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{p}}, out, nil)
			expected := config.ResolveAIWebSearch(p, "agent", false)
			if len(directory.Models) != 1 || directory.Models[0].WebSearch != expected.AIWebSearchAvailability || directory.ProviderSearchPolicies[p.ID].Enabled != providerEnabled || expected.HostedTool() != (providerEnabled && modelEnabled) {
				t.Fatalf("provider=%v model=%v: %+v", providerEnabled, modelEnabled, directory)
			}
			if catalog := modelCatalogView(p, model); catalog.WebSearch != expected.AIWebSearchAvailability {
				t.Fatalf("alias catalog differs from runtime: %+v", catalog)
			}
		}
	}
}

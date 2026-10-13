package ai

import (
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

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

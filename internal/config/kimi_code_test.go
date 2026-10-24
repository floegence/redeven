package config

import "testing"

func TestKimiCodeCatalogAndProtocol(t *testing.T) {
	if AIProviderProtocol("kimi_code", AIWebSearchDisabled) != "openai-responses" {
		t.Fatal("Kimi Code must use Responses")
	}
	if len(AIProviderCatalog("kimi_code")) != 6 {
		t.Fatal("missing subscription catalog")
	}
	for _, name := range []string{"k3.1-pro", "k3", "k3-256k"} {
		m, ok := AIModelCatalogEntry("kimi_code", name)
		if !ok || m.ContextWindow != 262144 {
			t.Fatalf("unsafe subscription capacity: %+v", m)
		}
		if err := ValidateAIProviderReasoningCapability("kimi_code", m.ReasoningCapability); err != nil {
			t.Fatal(err)
		}
		if m.ReasoningCapability.DisableSupported {
			t.Fatal("must not silently route to a different model")
		}
	}
	for _, name := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"} {
		m, ok := AIModelCatalogEntry("moonshot", name)
		if !ok || m.ContextWindow != 1048576 || m.ReasoningCapability.DefaultLevel != "max" {
			t.Fatalf("missing K3.1 capability: %+v", m)
		}
	}
}

func TestKimiCodeProviderValidation(t *testing.T) {
	fresh := func() AIModelProfile {
		return AIModelProfile{Providers: []AIProvider{{ID: "subscription", Type: "kimi_code", BaseURL: "https://api.kimi.com/coding/v1", ModelSelection: &AIModelSelection{SelectedModels: []string{"k3.1-pro"}}}}}
	}
	for _, endpoint := range []string{"https://api.kimi.com/coding/v1", "https://api.kimi.ai/coding/v1/"} {
		profile := fresh()
		profile.Providers[0].BaseURL = endpoint
		if err := profile.Validate(); err != nil {
			t.Fatalf("valid subscription rejected: %v", err)
		}
	}
	for _, tc := range []struct {
		name   string
		change func(*AIProvider)
	}{
		{"API billing endpoint", func(p *AIProvider) { p.BaseURL = "https://api.moonshot.cn/v1" }},
		{"unreviewed endpoint", func(p *AIProvider) { p.BaseURL = "https://proxy.example/coding/v1" }},
		{"unknown model", func(p *AIProvider) { p.ModelSelection.SelectedModels = []string{"K3.1 Pro"} }},
		{"custom model", func(p *AIProvider) {
			p.ModelSelection.CustomModels = []AIProviderModel{{ModelName: "custom", ContextWindow: 1000}}
		}},
		{"excess context", func(p *AIProvider) {
			p.ModelSelection.ModelOverrides = []AIProviderModel{{ModelName: "k3.1-pro", ContextWindow: 1048577}}
		}},
		{"wire alias", func(p *AIProvider) {
			p.ModelSelection.ModelOverrides = []AIProviderModel{{ModelName: "k3.1-pro", WireModelName: "kimi-for-coding"}}
		}},
		{"thinking off", func(p *AIProvider) {
			m, _ := AIModelCatalogEntry("kimi_code", "k3.1-pro")
			m.ReasoningCapability.DisableSupported = true
			p.ModelSelection.ModelOverrides = []AIProviderModel{m}
		}},
		{"unsupported effort", func(p *AIProvider) {
			m, _ := AIModelCatalogEntry("kimi_code", "k3.1-pro")
			m.ReasoningCapability.SupportedLevels = append(m.ReasoningCapability.SupportedLevels, "medium")
			p.ModelSelection.ModelOverrides = []AIProviderModel{m}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profile := fresh()
			tc.change(&profile.Providers[0])
			if err := profile.Validate(); err == nil {
				t.Fatal("invalid subscription configuration accepted")
			}
		})
	}
	profile := fresh()
	profile.Providers[0].ModelSelection.ModelOverrides = []AIProviderModel{{ModelName: "k3.1-pro", ContextWindow: 1048576}}
	if err := profile.Validate(); err != nil {
		t.Fatalf("explicit eligible 1M context rejected: %v", err)
	}
	if profile.Providers[0].EffectiveResponsesContinuation() {
		t.Fatal("subscription must replay history")
	}
	if AIProviderAPIKeyOptional("kimi_code") {
		t.Fatal("subscription requires its own key")
	}
}

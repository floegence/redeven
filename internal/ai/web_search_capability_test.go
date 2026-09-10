package ai

import (
	"context"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"

	"github.com/floegence/redeven/internal/config"
)

func TestDeepSeekCatalogDoesNotAdvertiseIgnoredBuiltinTools(t *testing.T) {
	for _, model := range config.AIProviderCatalog("deepseek") {
		capability := resolveProviderWebSearchCapability(config.AIProvider{Type: "deepseek"}, model.EffectiveWireModelName())
		if capability.Status != "unavailable" || capability.Reason != "unsupported" || capability.Mode != providerWebSearchModeDisabled || capability.HostedTool() || capability.LocalTool() {
			t.Errorf("%s advertises ignored search: %+v", model.ModelName, capability)
		}
	}
}

func TestDeepSeekRejectsFrozenUnsupportedHostedSearch(t *testing.T) {
	adapter := newFloretProviderAdapter(nil, "deepseek", "deepseek-v4-flash", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
	_, err := adapter.turnRequest(context.Background(), flprovider.Request{HostedTools: []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search", Options: map[string]any{"wire_shape": "deepseek_native"}}}})
	if err == nil || !strings.Contains(err.Error(), "unsupported deepseek hosted search") {
		t.Fatalf("unsupported frozen declaration was silently accepted: %v", err)
	}
}

func TestDeepSeekGatewayRejectsHostedSearchBeforeDispatch(t *testing.T) {
	_, err := (&deepSeekProvider{}).StreamTurn(context.Background(), ModelGatewayRequest{Model: "deepseek-v4-flash", WebSearchMode: "deepseek_native"}, nil)
	if err == nil || !strings.Contains(err.Error(), "DeepSeek Responses does not support hosted web search") {
		t.Fatalf("unsupported search reached gateway preparation: %v", err)
	}
}

func TestHostedSearchPromptDoesNotDenyURLDiscovery(t *testing.T) {
	section := buildPromptWebResearchCapabilitySection(promptRuntimeSnapshot{AvailableToolNames: "web_search, web_fetch"}).render()
	if strings.Contains(section, "URL discovery is unavailable") || !strings.Contains(section, "use web_search") {
		t.Fatalf("hosted search contradicts prompt: %s", section)
	}
}

func TestDesktopModelSourceKeepsProviderTransportOwnedByDesktop(t *testing.T) {
	adapter := newFloretProviderAdapter(nil, DesktopModelSourceProviderType, "desktop:model", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
	request, err := adapter.turnRequest(context.Background(), flprovider.Request{})
	if err != nil {
		t.Fatal(err)
	}
	if request.Protocol != "" {
		t.Fatalf("forwarded Desktop transport %q as a provider protocol", request.Protocol)
	}
	if adapter.stateCompatibilityRoute() != "desktop-model-source" {
		t.Fatal("Desktop continuation identity changed")
	}
}

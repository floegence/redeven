package ai

import (
	"context"

	flprovider "github.com/floegence/floret/v7/provider"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestDeepSeekVisionSearchCatalogAdmission(t *testing.T) {
	capability := resolveProviderWebSearchCapability(config.AIProvider{Type: "deepseek"}, "deepseek-v4-flash-vision-exp")
	if capability.Mode != providerWebSearchModeDeepSeekNative {
		t.Fatalf("Vision search mode=%q, want native search", capability.Mode)
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

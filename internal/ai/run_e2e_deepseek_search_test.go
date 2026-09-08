package ai

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
)

// Paid opt-in qualification uses only the configured official endpoint and
// retains neither credentials nor raw response receipts in its test output.
func TestE2E_FlowerDeepSeekV4NativeSearch(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E") != "1" {
		t.Skip("enable the real DeepSeek qualification")
	}
	baseURL := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_BASE_URL"))
	assertOfficialDeepSeekCompactionEndpoint(t, baseURL)
	apiKey := strings.TrimSpace(os.Getenv("REDEVEN_FLOWER_CONTEXT_E2E_API_KEY"))
	if apiKey == "" {
		t.Fatal("DeepSeek credential is required")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	gateway := &deepSeekProvider{baseURL: baseURL, apiKey: apiKey}
	request := ModelGatewayRequest{RunID: "search-qualification", PromptScopeID: "search-qualification", Model: "deepseek-v4-flash", Budgets: TurnBudgets{MaxOutputToken: 4096}, WebSearchMode: providerWebSearchModeDeepSeekNative, ProviderControls: ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Use your web_search tool to look up the latest Go release on go.dev. You must actually search the web, then give a short answer with a source citation."}}}}}
	starts, results := 0, 0
	first, err := gateway.StreamTurn(ctx, request, func(event StreamEvent) {
		if event.HostedToolEvent != nil {
			switch event.HostedToolEvent.Type {
			case flprovider.EventHostedToolCall:
				starts++
			case flprovider.EventHostedToolResult:
				results++
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if starts == 0 || results == 0 || first.ProviderState == nil || first.Text == "" {
		t.Fatalf("search starts=%d results=%d citations=%d state=%t text=%t", starts, results, len(first.Sources), first.ProviderState != nil, first.Text != "")
	}
	request.PreviousState = first.ProviderState
	request.WebSearchMode = providerWebSearchModeDisabled
	parts := []ContentPart{{Type: "text", Text: first.Text}}
	if first.Reasoning != "" {
		parts = append(parts, ContentPart{Type: "reasoning", Text: first.Reasoning})
	}
	request.Messages = append(request.Messages, Message{Role: "assistant", Content: parts}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "Using that search result, repeat only the release version without another search."}}})
	second, err := gateway.StreamTurn(ctx, request, nil)
	if err != nil || second.Text == "" {
		t.Fatalf("native search history replay failed: %v", err)
	}
	t.Logf("native search starts=%d results=%d citations=%d; stateless follow-up passed", starts, results, len(first.Sources))
}

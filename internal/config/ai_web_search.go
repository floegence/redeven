package config

import (
	"encoding/json"
	"net/url"
	"strings"
)

const (
	AIWebSearchDisabled = "disabled"
	AIWebSearchOpenAI   = "openai_responses_builtin"
	AIWebSearchDeepSeek = "deepseek_native"
	AIWebSearchKimi     = "kimi_builtin"
	AIWebSearchGLM      = "glm_web_search_tool"
	AIWebSearchQwen     = "qwen_responses_web_search"
	AIWebSearchBrave    = "external_brave"
)

// AIWebSearchAvailability is a read-only product projection, never configuration.
type AIWebSearchAvailability struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type aiWebSearchDeclaration struct {
	Status          string   `json:"status"`
	Mode            string   `json:"mode"`
	SourceURLs      []string `json:"source_urls"`
	SourceCheckedAt string   `json:"source_checked_at"`
}

var webSearchCatalog = func() map[string]aiWebSearchDeclaration {
	var data struct {
		WebSearch map[string]aiWebSearchDeclaration `json:"web_search"`
	}
	if err := json.Unmarshal(modelCatalogJSON, &data); err != nil {
		panic(err)
	}
	return data.WebSearch
}()

// AIWebSearchResolution is the single provider/model search decision. Mode also
// determines the provider transport, independently of a request's tool surface.
type AIWebSearchResolution struct {
	AIWebSearchAvailability
	Mode              string
	DeclarationStatus string
}

func (c AIWebSearchResolution) LocalTool() bool {
	return c.Status == "available" && c.Mode == AIWebSearchBrave
}
func (c AIWebSearchResolution) HostedTool() bool {
	return c.Status == "available" && c.Mode != AIWebSearchDisabled && c.Mode != AIWebSearchBrave
}

// ResolveAIWebSearch uses the actual wire identity. The caller supplies only
// credential presence; this pure decision never reads or retains a secret.
func ResolveAIWebSearch(provider AIProvider, wireModelName string, braveKeyConfigured bool) AIWebSearchResolution {
	typ := strings.ToLower(strings.TrimSpace(provider.Type))
	out := AIWebSearchResolution{AIWebSearchAvailability: AIWebSearchAvailability{Status: "unavailable", Reason: "not_integrated"}, Mode: AIWebSearchDisabled, DeclarationStatus: "not_integrated"}
	if typ == "openai_compatible" {
		out.DeclarationStatus = "configured"
		out.Reason = "not_configured"
		if provider.WebSearch == nil {
			return out
		}
		switch strings.ToLower(strings.TrimSpace(provider.WebSearch.Mode)) {
		case "", AIProviderWebSearchModeDisabled:
			return out
		case AIProviderWebSearchModeOpenAIBuiltin:
			out.Mode = AIWebSearchOpenAI
		case AIProviderWebSearchModeBrave:
			out.Mode = AIWebSearchBrave
			if !braveKeyConfigured {
				out.Reason = "needs_credentials"
				return out
			}
		default:
			out.Reason = "invalid_configuration"
			return out
		}
		out.Status, out.Reason = "available", "configured"
		return out
	}
	decl, exists := webSearchCatalog[typ+"/"+strings.TrimSpace(wireModelName)]
	if exists {
		out.DeclarationStatus = decl.Status
		out.Reason = decl.Status
		if decl.Status != "supported" {
			return out
		}
		out.Mode = decl.Mode
	} else if typ == "openai" {
		// Preserve the existing official-endpoint contract for user-owned models.
		// Shipped models always require their own reviewed catalog declaration.
		out.DeclarationStatus, out.Mode = "provider_configured", AIWebSearchOpenAI
	} else {
		out.Reason = "not_integrated"
		return out
	}
	if typ == "openai" && strings.TrimSpace(provider.BaseURL) != "" {
		u, err := url.Parse(provider.BaseURL)
		if err != nil || !strings.EqualFold(u.Hostname(), "api.openai.com") {
			out.Mode, out.Reason = AIWebSearchDisabled, "endpoint_not_supported"
			return out
		}
	}
	out.Status, out.Reason = "available", "catalog_supported"
	return out
}

// AIProviderProtocol selects a stable transport before individual requests
// select tools. Titles and continuation must not switch protocol implicitly.
func AIProviderProtocol(providerType, searchMode string) string {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "deepseek":
		return "deepseek-responses-v1"
	case "anthropic":
		return "anthropic-messages"
	case "desktop_model_source":
		return "desktop-model-source"
	case "openai":
		return "openai-responses"
	case "qwen", "openai_compatible":
		if searchMode == AIWebSearchOpenAI || searchMode == AIWebSearchQwen || searchMode == AIWebSearchBrave {
			return "openai-responses"
		}
	}
	return "openai-chat-completions"
}

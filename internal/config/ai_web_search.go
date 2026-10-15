package config

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	AIWebSearchDisabled = "disabled"
	AIWebSearchOpenAI   = "openai_responses_builtin"
	AIWebSearchKimi     = "kimi_builtin"
	AIWebSearchGLM      = "glm_web_search_tool"
	AIWebSearchQwen     = "qwen_responses_web_search"
	AIWebSearchBrave    = "external_brave"
)

// AIWebSearchAvailability is a read-only product projection, never configuration.
type AIWebSearchAvailability struct {
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	RecommendedEnabled bool   `json:"recommended_enabled"`
	ModelEnabled       bool   `json:"model_enabled"`
}

const (
	AIWebSearchSourceNative = "native"
	AIWebSearchSourceBrave  = "brave"
)

// AIWebSearchPolicy supplies backend-owned defaults and provider intent to editors.
type AIWebSearchPolicy struct {
	SupportedSources    []string `json:"supported_sources"`
	Editable            bool     `json:"editable"`
	DefaultEnabled      bool     `json:"default_enabled"`
	DefaultModelEnabled bool     `json:"default_model_enabled"`
	Enabled             bool     `json:"enabled"`
	Source              string   `json:"source"`
}

// NativeAIWebSearchMode is the single registry of integrated hosted adapters.
func NativeAIWebSearchMode(providerType string) string {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "openai", "openai_compatible", "redeven_platform":
		return AIWebSearchOpenAI
	case "moonshot":
		return AIWebSearchKimi
	case "chatglm":
		return AIWebSearchGLM
	case "qwen":
		return AIWebSearchQwen
	default:
		return AIWebSearchDisabled
	}
}

func ResolveAIWebSearchPolicy(provider AIProvider) AIWebSearchPolicy {
	typ := strings.ToLower(strings.TrimSpace(provider.Type))
	editable := NativeAIWebSearchMode(typ) != AIWebSearchDisabled && typ != "redeven_platform"
	out := AIWebSearchPolicy{Editable: editable, DefaultEnabled: editable && typ != "openai_compatible", DefaultModelEnabled: typ == "openai" || typ == "openai_compatible", Source: AIWebSearchSourceNative}
	if editable {
		out.SupportedSources = []string{AIWebSearchSourceNative}
		if typ == "openai_compatible" {
			out.SupportedSources = append(out.SupportedSources, AIWebSearchSourceBrave)
		}
	} else {
		out.SupportedSources = []string{}
	}
	out.Enabled = out.DefaultEnabled
	if provider.WebSearch != nil {
		out.Enabled, out.Source = provider.WebSearch.Enabled, provider.WebSearch.Source
	}
	return out
}

// UnmarshalJSON upgrades the released mode shape at the configuration boundary.
// Existing persisted profiles are the only legacy consumer; startup writes the
// canonical shape before publishing configuration. Runtime never reads mode.
func (s *AIProviderWebSearch) UnmarshalJSON(data []byte) error {
	var in struct {
		Enabled *bool   `json:"enabled"`
		Source  *string `json:"source"`
		Mode    *string `json:"mode"`
	}
	if err := json.Unmarshal(data, &in); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if in.Mode != nil || len(fields) == 0 {
		if in.Enabled != nil || in.Source != nil {
			return fmt.Errorf("web_search cannot combine mode with enabled/source")
		}
		*s = AIProviderWebSearch{Source: AIWebSearchSourceNative, legacy: true}
		mode := ""
		if in.Mode != nil {
			mode = *in.Mode
		}
		switch strings.ToLower(strings.TrimSpace(mode)) {
		case "", "disabled":
		case "openai_builtin":
			s.Enabled = true
		case "brave":
			s.Enabled, s.Source = true, AIWebSearchSourceBrave
		default:
			return fmt.Errorf("invalid web_search.mode %q", mode)
		}
		return nil
	}
	if in.Enabled == nil || in.Source == nil {
		return fmt.Errorf("web_search requires enabled and source")
	}
	*s = AIProviderWebSearch{Enabled: *in.Enabled, Source: strings.ToLower(strings.TrimSpace(*in.Source))}
	return nil
}

func (p AIProvider) validateWebSearch() error {
	if p.WebSearch == nil {
		return nil
	}
	source := p.WebSearch.Source
	if source != AIWebSearchSourceNative && source != AIWebSearchSourceBrave {
		return fmt.Errorf("invalid web_search.source %q", source)
	}
	if source == AIWebSearchSourceBrave && strings.ToLower(strings.TrimSpace(p.Type)) != "openai_compatible" {
		return fmt.Errorf("Brave search is only supported for openai_compatible providers")
	}
	if p.WebSearch.Enabled && !ResolveAIWebSearchPolicy(p).Editable {
		return fmt.Errorf("web search is not integrated for %s", p.Type)
	}
	return nil
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

// AIWebSearchResolution is the single provider/model search decision. Mode
// is frozen with the turn and selects its provider transport.
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

// ResolveAIWebSearch accepts the configured model identity, preserving aliases
// and explicit per-model intent. Credentials are represented only by presence.
func ResolveAIWebSearch(provider AIProvider, modelName string, braveKeyConfigured bool) AIWebSearchResolution {
	typ := strings.ToLower(strings.TrimSpace(provider.Type))
	model := provider.ModelMetadata(strings.TrimSpace(modelName))
	wire := model.EffectiveWireModelName()
	decl, known := webSearchCatalog[typ+"/"+wire]
	recommended := known && decl.Status == "supported"
	if !known && (typ == "openai" || typ == "openai_compatible") {
		recommended = true
	}
	if typ == "redeven_platform" {
		recommended = model.HostedWebSearch
	}
	enabled := recommended
	if model.WebSearchEnabled != nil {
		enabled = *model.WebSearchEnabled
	}
	out := AIWebSearchResolution{AIWebSearchAvailability: AIWebSearchAvailability{Status: "unavailable", Reason: "not_integrated", RecommendedEnabled: recommended, ModelEnabled: enabled}, Mode: NativeAIWebSearchMode(typ), DeclarationStatus: decl.Status}
	policy := ResolveAIWebSearchPolicy(provider)
	if typ == "redeven_platform" {
		policy.Enabled = true
	}
	if policy.Source == AIWebSearchSourceBrave {
		out.Mode = AIWebSearchBrave
	}
	if out.Mode == AIWebSearchDisabled {
		if known {
			out.Reason = decl.Status
		}
		return out
	}
	if err := provider.validateWebSearch(); err != nil && typ != "redeven_platform" {
		out.Reason = "invalid_configuration"
		return out
	}
	if !policy.Enabled {
		out.Mode, out.Reason = AIWebSearchDisabled, "provider_disabled"
		return out
	}
	if !enabled {
		out.Mode, out.Reason = AIWebSearchDisabled, "model_disabled"
		return out
	}
	if out.Mode == AIWebSearchBrave && !braveKeyConfigured {
		out.Reason = "needs_credentials"
		return out
	}
	out.Status, out.Reason = "available", "configured"
	if known && decl.Status == "supported" && out.Mode != AIWebSearchBrave {
		out.Reason = "catalog_supported"
	}
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

package ai

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

// Only endpoints with a documented complete inventory participate in automatic
// sync. Others keep shipped/manual capabilities without claiming absence.
func catalogEndpointSupported(in ModelCatalogRequest) bool {
	if in.AuthMethod == config.AIAuthChatGPT {
		return true
	}
	switch in.Type {
	case "openai", "anthropic", "google", "moonshot", "deepseek", "xai", "groq", "openrouter", "ollama", "openai_compatible":
		return true
	}
	return false
}
func discoverProviderInventory(ctx context.Context, in ModelCatalogRequest, client *http.Client) ([]config.AIProviderModel, error) {
	if !catalogEndpointSupported(in) {
		return config.AIProviderCatalog(in.Type), nil
	}
	base := strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	if base == "" {
		switch in.Type {
		case "openai":
			base = "https://api.openai.com/v1"
		case "anthropic":
			base = "https://api.anthropic.com"
		case "google":
			base = "https://generativelanguage.googleapis.com/v1beta/openai"
		}
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid model catalog endpoint")
	}
	out := []config.AIProviderModel{}
	seen := map[string]bool{}
	add := func(id, name string, contextWindow, output int) error {
		if strings.TrimSpace(id) == "" || seen[id] {
			return errors.New("invalid or duplicate model catalog identity")
		}
		seen[id] = true
		if len(seen) > 10000 {
			return errors.New("model catalog exceeds inventory limit")
		}
		m, known := config.AIModelCatalogEntry(in.Type, id)
		if !known {
			m = config.AIProviderModel{ModelName: config.AIModelLocalName(id), WireModelName: id, Status: "needs_configuration"}
		}
		if name != "" {
			m.DisplayName = name
		}
		if contextWindow > 0 {
			m.ContextWindow = contextWindow
		}
		if output > 0 {
			m.MaxOutputTokens = output
		}
		out = append(out, m)
		return nil
	}
	pages := map[string]bool{}
	cursor := ""
	for page := 0; page < 100; page++ {
		if pages[cursor] {
			return nil, errors.New("model catalog repeated a page")
		}
		pages[cursor] = true
		headers := map[string]string{}
		endpoint := base + "/models"
		key := in.APIKey
		switch in.Type {
		case "anthropic":
			endpoint = strings.TrimSuffix(base, "/v1") + "/v1/models"
			headers["x-api-key"] = key
			headers["anthropic-version"] = "2023-06-01"
			key = ""
			if cursor != "" {
				endpoint += "?after_id=" + url.QueryEscape(cursor)
			}
		case "google":
			endpoint = strings.TrimSuffix(base, "/openai") + "/models"
			headers["x-goog-api-key"] = key
			key = ""
			if cursor != "" {
				endpoint += "?pageToken=" + url.QueryEscape(cursor)
			}
		default:
			if cursor != "" {
				endpoint += "?after=" + url.QueryEscape(cursor)
			}
		}
		var response struct {
			Data []struct {
				ID   string `json:"id"`
				Name string `json:"display_name"`
			} `json:"data"`
			HasMore *bool  `json:"has_more"`
			LastID  string `json:"last_id"`
			Models  []struct {
				Name        string   `json:"name"`
				DisplayName string   `json:"displayName"`
				Context     int      `json:"inputTokenLimit"`
				Output      int      `json:"outputTokenLimit"`
				Methods     []string `json:"supportedGenerationMethods"`
			} `json:"models"`
			Next string `json:"nextPageToken"`
		}
		if err = catalogJSONHeaders(ctx, client, http.MethodGet, endpoint, key, headers, nil, &response); err != nil {
			return nil, err
		}
		if in.Type == "google" {
			if response.Models == nil {
				return nil, errors.New("model catalog omitted models")
			}
			for _, m := range response.Models {
				if !strings.HasPrefix(m.Name, "models/") || m.Methods == nil {
					return nil, errors.New("incomplete model catalog capability")
				}
				if !slices.Contains(m.Methods, "generateContent") {
					continue
				}
				if m.Context <= 0 || m.Output <= 0 {
					return nil, errors.New("incomplete generation model capability")
				}
				if err = add(strings.TrimPrefix(m.Name, "models/"), m.DisplayName, m.Context, m.Output); err != nil {
					return nil, err
				}
			}
			if response.Next == "" {
				return out, nil
			}
			cursor = response.Next
		} else {
			if response.Data == nil || in.Type == "anthropic" && response.HasMore == nil {
				return nil, errors.New("model catalog omitted complete inventory")
			}
			for _, m := range response.Data {
				if err = add(m.ID, m.Name, 0, 0); err != nil {
					return nil, err
				}
			}
			if response.HasMore == nil || !*response.HasMore {
				return out, nil
			}
			cursor = response.LastID
			if cursor == "" && len(response.Data) > 0 {
				cursor = response.Data[len(response.Data)-1].ID
			}
			if cursor == "" {
				return nil, errors.New("model catalog omitted pagination cursor")
			}
		}
		if len(out) > 10000 {
			return nil, errors.New("model catalog exceeds inventory limit")
		}
	}
	return nil, errors.New("model catalog pagination incomplete")
}

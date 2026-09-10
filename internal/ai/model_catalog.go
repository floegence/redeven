package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/config"
)

type ModelCatalogRequest struct {
	ProviderID string `json:"provider_id,omitempty"`
	Type       string `json:"type"`
	BaseURL    string `json:"base_url,omitempty"`
	APIKey     string `json:"api_key,omitempty"`
}

type ModelCatalogModel struct {
	config.AIProviderModel
	WebSearch config.AIWebSearchAvailability `json:"web_search"`
}

type ModelCatalogResponse struct {
	Models []ModelCatalogModel `json:"models"`
}

// DiscoverModelCatalog queries an explicitly selected endpoint without changing
// configuration, installing models, or retaining credentials in catalog data.
func (s *Service) DiscoverModelCatalog(ctx context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
	if in.APIKey == "" && in.ProviderID != "" && s != nil && s.resolveProviderKey != nil {
		key, _, err := s.resolveProviderKey(in.ProviderID)
		if err != nil {
			return ModelCatalogResponse{}, err
		}
		in.APIKey = key
	}
	models, err := discoverModelCatalog(ctx, in, &http.Client{Timeout: 20 * time.Second})
	if err != nil {
		return ModelCatalogResponse{}, err
	}
	provider := config.AIProvider{ID: in.ProviderID, Type: in.Type, BaseURL: in.BaseURL}
	out := make([]ModelCatalogModel, 0, len(models))
	for _, model := range models {
		out = append(out, ModelCatalogModel{AIProviderModel: model, WebSearch: config.ResolveAIWebSearch(provider, model.EffectiveWireModelName(), false).AIWebSearchAvailability})
	}
	return ModelCatalogResponse{Models: out}, nil
}

func discoverModelCatalog(ctx context.Context, in ModelCatalogRequest, client *http.Client) ([]config.AIProviderModel, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if config.AIProviderUsesCatalog(in.Type) {
		return config.AIProviderCatalog(in.Type), nil
	}
	base := strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	if base == "" {
		switch in.Type {
		case "openrouter":
			base = "https://openrouter.ai/api/v1"
		case "ollama":
			base = "http://127.0.0.1:11434/v1"
		}
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid model catalog endpoint")
	}
	switch in.Type {
	case "openrouter":
		var response struct {
			Data []struct {
				ID           string `json:"id"`
				Name         string `json:"name"`
				Context      int    `json:"context_length"`
				Architecture struct {
					Input  []string `json:"input_modalities"`
					Output []string `json:"output_modalities"`
				} `json:"architecture"`
				Parameters  []string `json:"supported_parameters"`
				TopProvider struct {
					MaxTokens int `json:"max_completion_tokens"`
				} `json:"top_provider"`
				Expiration string `json:"expiration_date"`
			} `json:"data"`
		}
		if err := catalogJSON(ctx, client, http.MethodGet, base+"/models?supported_parameters=tools", in.APIKey, nil, &response); err != nil {
			return nil, err
		}
		out := make([]config.AIProviderModel, 0, len(response.Data))
		seen := map[string]bool{}
		for _, m := range response.Data {
			if m.ID == "" || seen[m.ID] || !slices.Contains(m.Parameters, "tools") || !slices.Equal(m.Architecture.Output, []string{"text"}) || m.Context <= 0 {
				continue
			}
			if m.Expiration != "" && m.Expiration <= time.Now().UTC().Format("2006-01-02") {
				continue
			}
			seen[m.ID] = true
			model := config.AIProviderModel{ModelName: config.AIModelLocalName(m.ID), WireModelName: m.ID, DisplayName: m.Name, ContextWindow: m.Context, MaxOutputTokens: m.TopProvider.MaxTokens, InputModalities: catalogInputModalities(m.Architecture.Input)}
			// Supported effort controls are a specific wire declaration, not an inference
			// from a model-family name or an unqualified reasoning boolean.
			if slices.Contains(m.Parameters, "reasoning") || slices.Contains(m.Parameters, "reasoning_effort") {
				model.ReasoningCapability = config.AIReasoningCapabilityForModel("openrouter", m.ID)
			}
			out = append(out, model)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].DisplayName < out[j].DisplayName })
		return out, nil
	case "ollama":
		base = strings.TrimSuffix(base, "/v1")
		var response struct {
			Models []struct {
				Name       string `json:"name"`
				RemoteHost string `json:"remote_host"`
			} `json:"models"`
		}
		if err := catalogJSON(ctx, client, http.MethodGet, base+"/api/tags", in.APIKey, nil, &response); err != nil {
			return nil, err
		}
		var running struct {
			Models []struct {
				Name          string `json:"name"`
				ContextLength int    `json:"context_length"`
			} `json:"models"`
		}
		if err := catalogJSON(ctx, client, http.MethodGet, base+"/api/ps", in.APIKey, nil, &running); err != nil {
			return nil, err
		}
		servedContexts := map[string]int{}
		for _, model := range running.Models {
			if model.ContextLength > 0 {
				servedContexts[model.Name] = model.ContextLength
			}
		}
		out := make([]config.AIProviderModel, 0, len(response.Models))
		seen := map[string]bool{}
		for _, m := range response.Models {
			if m.Name == "" || m.RemoteHost != "" || seen[m.Name] {
				continue
			}
			seen[m.Name] = true
			var detail struct {
				Capabilities []string       `json:"capabilities"`
				Info         map[string]any `json:"model_info"`
				RemoteHost   string         `json:"remote_host"`
				Parameters   string         `json:"parameters"`
			}
			if err := catalogJSON(ctx, client, http.MethodPost, base+"/api/show", in.APIKey, map[string]string{"model": m.Name}, &detail); err != nil {
				return nil, err
			}
			if detail.RemoteHost != "" || !slices.Contains(detail.Capabilities, "tools") {
				continue
			}
			// OpenAI-compatible requests cannot set Ollama num_ctx. Use the
			// loaded context, an explicit Modelfile setting, or the conservative
			// documented 4K default; the model's theoretical maximum is a cap.
			contextWindow := 4096
			for _, line := range strings.Split(detail.Parameters, "\n") {
				var key string
				var value int
				if _, err := fmt.Sscanf(line, "%s %d", &key, &value); err == nil && key == "num_ctx" && value > 0 {
					contextWindow = value
				}
			}
			if current := servedContexts[m.Name]; current > 0 {
				contextWindow = current
			}
			for key, value := range detail.Info {
				if strings.HasSuffix(key, ".context_length") {
					if n, ok := value.(float64); ok && n > 0 && int(n) < contextWindow {
						contextWindow = int(n)
					}
				}
			}
			model := config.AIProviderModel{ModelName: config.AIModelLocalName(m.Name), WireModelName: m.Name, DisplayName: m.Name, ContextWindow: contextWindow, InputModalities: []string{"text"}}
			if slices.Contains(detail.Capabilities, "vision") {
				model.InputModalities = append(model.InputModalities, "image")
			}
			if slices.Contains(detail.Capabilities, "thinking") {
				model.ReasoningCapability = config.AIReasoningCapabilityForModel("ollama", m.Name)
			}
			out = append(out, model)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ModelName < out[j].ModelName })
		return out, nil
	default:
		return nil, fmt.Errorf("model discovery is unsupported for %s", in.Type)
	}
}

func catalogInputModalities(input []string) []string {
	out := []string{"text"}
	if slices.Contains(input, "image") {
		out = append(out, "image")
	}
	return out
}

func catalogJSON(ctx context.Context, client *http.Client, method, endpoint, key string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	// Credentials must not follow a redirect to another catalog host.
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := copyClient.Do(req)
	if err != nil {
		return fmt.Errorf("query model catalog: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("model catalog returned HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16<<20+1))
	if err != nil {
		return err
	}
	if len(raw) > 16<<20 {
		return errors.New("model catalog response exceeds 16 MiB")
	}
	if err = json.Unmarshal(raw, out); err != nil {
		return errors.New("model catalog returned invalid JSON")
	}
	return nil
}

func resolveModelCatalogs(ctx context.Context, cfg *config.AIConfig, resolveKey func(string) (string, bool, error), modelID string) (*config.AIConfig, error) {
	if cfg == nil {
		return nil, nil
	}
	next := *cfg
	next.Providers = append([]config.AIProvider(nil), cfg.Providers...)
	var failures []error
	for i, p := range next.Providers {
		if p.Type != "ollama" || p.ModelSelection == nil || (modelID != "" && !strings.HasPrefix(modelID, p.ID+"/")) {
			continue
		}
		key := ""
		if resolveKey != nil {
			var err error
			key, _, err = resolveKey(p.ID)
			if err != nil {
				failures = append(failures, err)
				continue
			}
		}
		models, err := discoverModelCatalog(ctx, ModelCatalogRequest{Type: p.Type, BaseURL: p.BaseURL, APIKey: key}, &http.Client{Timeout: 20 * time.Second})
		if err != nil {
			failures = append(failures, fmt.Errorf("ollama catalog for %s: %w", p.ID, err))
			continue
		}
		next.Providers[i] = p.WithDiscoveredModels(models)
	}
	return &next, errors.Join(failures...)
}

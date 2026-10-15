package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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

	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
)

type ModelCatalogRequest struct {
	ProviderID string `json:"provider_id,omitempty"`
	AuthMethod string `json:"auth_method,omitempty"`
	AccountID  string `json:"account_id,omitempty"`
	Type       string `json:"type"`
	BaseURL    string `json:"base_url,omitempty"`
	APIKey     string `json:"api_key,omitempty"`
}

type ModelCatalogModel struct {
	config.AIProviderModel
	WebSearch config.AIWebSearchAvailability `json:"web_search"`
}

func modelCatalogView(provider config.AIProvider, model config.AIProviderModel) ModelCatalogModel {
	model.EffectiveContextWindowPercent = model.EffectiveContextWindowPercentValue()
	provider.Models = append(append([]config.AIProviderModel(nil), provider.Models...), model)
	return ModelCatalogModel{AIProviderModel: model, WebSearch: config.ResolveAIWebSearch(provider, model.ModelName, false).AIWebSearchAvailability}
}

type ModelCatalogResponse struct {
	Models []ModelCatalogModel `json:"models"`
}

// DiscoverModelCatalog is the explicit settings action. It shares the same
// owner, deadline and in-flight work as silent automatic synchronization.
func (s *Service) DiscoverModelCatalog(ctx context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
	if in.APIKey == "" && in.ProviderID != "" && s.resolveProviderKey != nil && in.AuthMethod != config.AIAuthChatGPT {
		key, _, err := s.resolveProviderKey(in.ProviderID)
		if err != nil {
			return ModelCatalogResponse{}, err
		}
		in.APIKey = key
	}
	if s.modelCatalogs == nil {
		return s.discoverProviderCatalog(ctx, in)
	}
	return s.modelCatalogs.sync(ctx, in)
}

func (s *Service) discoverProviderCatalog(ctx context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
	if in.AuthMethod == config.AIAuthChatGPT {
		if s.chatGPT == nil || in.Type != "openai" || in.BaseURL != "" && in.BaseURL != chatgpt.Resource || in.APIKey != "" {
			return ModelCatalogResponse{}, errors.New("invalid ChatGPT catalog request")
		}
		models, err := s.chatGPT.Models(ctx, in.AccountID)
		if err != nil {
			return ModelCatalogResponse{}, err
		}
		return reviewedChatGPTCatalog(models), nil
	}
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
		out = append(out, modelCatalogView(provider, model))
	}
	return ModelCatalogResponse{Models: out}, nil
}

func discoverModelCatalog(ctx context.Context, in ModelCatalogRequest, client *http.Client) ([]config.AIProviderModel, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if in.Type != "openrouter" && in.Type != "ollama" {
		return discoverProviderInventory(ctx, in, client)
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
					Context   int `json:"context_length"`
					MaxTokens int `json:"max_completion_tokens"`
				} `json:"top_provider"`
				Expiration string `json:"expiration_date"`
			} `json:"data"`
		}
		if err := catalogJSON(ctx, client, http.MethodGet, base+"/models?supported_parameters=tools", in.APIKey, nil, &response); err != nil {
			return nil, err
		}
		if response.Data == nil {
			return nil, errors.New("model catalog omitted data")
		}
		out := make([]config.AIProviderModel, 0, len(response.Data))
		seen := map[string]bool{}
		incomplete := 0
		for _, m := range response.Data {
			if m.ID == "" || seen[m.ID] {
				return nil, errors.New("incomplete model catalog entry")
			}
			seen[m.ID] = true
			if m.Parameters == nil || m.Architecture.Output == nil {
				incomplete++
				continue
			}
			if !slices.Contains(m.Parameters, "tools") || !slices.Equal(m.Architecture.Output, []string{"text"}) {
				continue
			}
			contextWindow := m.Context
			if contextWindow <= 0 {
				// OpenRouter currently reports context_length=0 for some models while
				// publishing the serving capacity in top_provider.context_length.
				contextWindow = m.TopProvider.Context
			}
			if contextWindow <= 0 {
				incomplete++
				continue
			}
			if m.Expiration != "" && m.Expiration <= time.Now().UTC().Format("2006-01-02") {
				continue
			}
			// OpenRouter reports the provider's output limit independently from the
			// model context window. It can be larger than the window, but the
			// snapshot contract requires a safe output capacity for this model.
			maxOutputTokens := m.TopProvider.MaxTokens
			if maxOutputTokens > contextWindow {
				maxOutputTokens = contextWindow
			}
			model := config.AIProviderModel{ModelName: config.AIModelLocalName(m.ID), WireModelName: m.ID, DisplayName: m.Name, ContextWindow: contextWindow, MaxOutputTokens: maxOutputTokens, InputModalities: catalogInputModalities(m.Architecture.Input)}
			// Supported effort controls are a specific wire declaration, not an inference
			// from a model-family name or an unqualified reasoning boolean.
			if slices.Contains(m.Parameters, "reasoning") || slices.Contains(m.Parameters, "reasoning_effort") {
				model.ReasoningCapability = config.OpenRouterReasoningCapability()
			}
			out = append(out, model)
		}
		if len(out) == 0 && incomplete > 0 {
			return nil, errors.New("OpenRouter model catalog has no usable tool models")
		}
		sort.Slice(out, func(i, j int) bool { return out[i].DisplayName < out[j].DisplayName })
		return out, nil
	case "ollama":
		base = strings.TrimSuffix(base, "/v1")
		var response struct {
			Models []struct {
				Name       string `json:"name"`
				Digest     string `json:"digest"`
				RemoteHost string `json:"remote_host"`
			} `json:"models"`
		}
		if err := catalogJSON(ctx, client, http.MethodGet, base+"/api/tags", in.APIKey, nil, &response); err != nil {
			return nil, err
		}
		if response.Models == nil {
			return nil, errors.New("model catalog omitted installed models")
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
		if running.Models == nil {
			return nil, errors.New("model catalog omitted running models")
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
			if m.Name == "" || seen[m.Name] {
				return nil, errors.New("invalid installed model identity")
			}
			seen[m.Name] = true
			if m.RemoteHost != "" {
				continue
			}
			var detail struct {
				Capabilities []string        `json:"capabilities"`
				Info         map[string]any  `json:"model_info"`
				RemoteHost   string          `json:"remote_host"`
				Parameters   string          `json:"parameters"`
				Thinking     json.RawMessage `json:"thinking"`
				Details      struct {
					Quantization string `json:"quantization_level"`
				} `json:"details"`
			}
			if err := catalogJSON(ctx, client, http.MethodPost, base+"/api/show", in.APIKey, map[string]string{"model": m.Name}, &detail); err != nil {
				return nil, err
			}
			if detail.Capabilities == nil {
				return nil, errors.New("incomplete installed model metadata")
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
			model := config.AIProviderModel{ModelDigest: m.Digest, Quantization: detail.Details.Quantization, ModelName: config.AIModelLocalName(m.Name), WireModelName: m.Name, DisplayName: m.Name, ContextWindow: contextWindow, InputModalities: []string{"text"}}
			if slices.Contains(detail.Capabilities, "vision") {
				model.InputModalities = append(model.InputModalities, "image")
			}
			model.ReasoningCapability, err = config.OllamaReasoningCapability(detail.Thinking, slices.Contains(detail.Capabilities, "thinking"))
			if err != nil {
				return nil, fmt.Errorf("ollama model %q thinking metadata: %w", m.Name, err)
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
	return catalogJSONHeaders(ctx, client, method, endpoint, key, nil, body, out)
}
func catalogJSONHeaders(ctx context.Context, client *http.Client, method, endpoint, key string, headers map[string]string, body any, out any) error {
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
	for name, value := range headers {
		req.Header.Set(name, value)
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

// Scope alias groups to a connection and identical effective parameters.
func modelAliasGroup(p config.AIProvider, m config.AIProviderModel) string {
	if m.ModelDigest == "" {
		return ""
	}
	raw, _ := json.Marshal([]any{p.ID, p.BaseURL, m.ModelDigest, m.ContextWindow, m.MaxOutputTokens, m.EffectiveContextWindowPercent, m.InputModalities, m.ReasoningCapability, m.DefaultReasoningSelection})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// Account availability narrows capabilities; unknown slugs need explicit configuration.
func reviewedChatGPTCatalog(models []chatgpt.Model) ModelCatalogResponse {
	out := ModelCatalogResponse{Models: []ModelCatalogModel{}}
	for _, accountModel := range models {
		reviewed, ok := config.AIModelCatalogEntry("openai", accountModel.Slug)
		if !ok {
			reviewed = config.AIProviderModel{ModelName: config.AIModelLocalName(accountModel.Slug), WireModelName: accountModel.Slug, Status: "needs_configuration"}
		}
		reviewed.DisplayName = accountModel.DisplayName
		out.Models = append(out.Models, modelCatalogView(config.AIProvider{Type: "openai"}, reviewed))
	}
	return out
}

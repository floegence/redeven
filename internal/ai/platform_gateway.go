package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/openai/openai-go"
	ooption "github.com/openai/openai-go/option"
)

const platformGatewayProviderType = "redeven_platform"

// The Edge envelope preserves Floret identity and the SDK-rendered request.
// Provider credentials never enter the runtime.
type platformGatewayRunRequest struct {
	ThreadID           string          `json:"thread_id"`
	RunID              string          `json:"run_id"`
	TurnID             string          `json:"turn_id"`
	TraceID            string          `json:"trace_id,omitempty"`
	PromptScopeID      string          `json:"prompt_scope_id"`
	LogicalRequestID   string          `json:"logical_request_id"`
	AttemptID          string          `json:"attempt_id"`
	AttemptEpoch       int             `json:"attempt_epoch"`
	EntitlementVersion int64           `json:"entitlement_version"`
	Protocol           string          `json:"protocol"`
	Payload            json.RawMessage `json:"payload"`
}

type platformGatewayLease struct {
	Token              string `json:"token"`
	RenewalToken       string `json:"renewal_token"`
	ExpiresAtUnix      int64  `json:"expires_at_unix"`
	EntitlementVersion int64  `json:"entitlement_version"`
}

type platformGatewayProvider struct {
	baseURL            string
	grantToken         string
	renewalToken       string
	entitlementVersion int64
	httpClient         *http.Client
	modelID            string
	mu                 sync.Mutex
}

func newPlatformGatewayProvider(baseURL, grantToken, modelID string, versions ...int64) (ModelGateway, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || strings.TrimSpace(grantToken) == "" || strings.TrimSpace(modelID) == "" {
		return nil, errors.New("platform AI gateway URL, grant and model are required")
	}
	origin, err := url.Parse(baseURL)
	if err != nil || origin.Hostname() == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" {
		return nil, errors.New("invalid platform AI gateway origin")
	}
	ip := net.ParseIP(origin.Hostname())
	if origin.Scheme != "https" && (origin.Scheme != "http" || ip == nil || !ip.IsLoopback()) {
		return nil, errors.New("platform AI requires HTTPS")
	}
	version := int64(0)
	if len(versions) > 0 {
		version = versions[0]
	}
	return &platformGatewayProvider{baseURL: baseURL, grantToken: grantToken, entitlementVersion: version, modelID: modelID, httpClient: &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: 5 * time.Minute}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (p *platformGatewayProvider) renew(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/api/ai/v1/leases/renew", nil)
	if err != nil {
		return errors.New("platform AI lease unavailable")
	}
	token := p.grantToken
	if p.renewalToken != "" {
		token = p.renewalToken
	}
	r.Header.Set("Authorization", "Bearer "+token)
	resp, err := p.httpClient.Do(r)
	if err != nil {
		return errors.New("platform AI lease unavailable")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		return errors.New("platform AI authorization must be refreshed")
	}
	var lease platformGatewayLease
	if err = json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&lease); err != nil || lease.Token == "" || lease.RenewalToken == "" || lease.ExpiresAtUnix <= time.Now().Unix() || lease.EntitlementVersion != p.entitlementVersion {
		return errors.New("invalid platform AI lease")
	}
	p.grantToken = lease.Token
	p.renewalToken = lease.RenewalToken
	return nil
}

type platformRequestTransport struct {
	provider *platformGatewayProvider
	request  ModelGatewayRequest
}

func (t platformRequestTransport) RoundTrip(native *http.Request) (*http.Response, error) {
	if native.Method != http.MethodPost || !strings.HasSuffix(native.URL.Path, "/responses") && !strings.HasSuffix(native.URL.Path, "/chat/completions") {
		return nil, errors.New("unsupported platform AI protocol")
	}
	payload, err := io.ReadAll(io.LimitReader(native.Body, 8<<20))
	_ = native.Body.Close()
	if err != nil {
		return nil, errors.New("platform AI request unavailable")
	}
	protocol := "responses"
	if strings.HasSuffix(native.URL.Path, "/chat/completions") {
		protocol = "chat"
	}
	in := t.request
	body, err := json.Marshal(platformGatewayRunRequest{ThreadID: string(in.ThreadID), RunID: string(in.RunID), TurnID: string(in.TurnID), TraceID: string(in.TraceID), PromptScopeID: string(in.PromptScopeID), LogicalRequestID: string(in.LogicalRequestID), AttemptID: in.AttemptID, AttemptEpoch: in.AttemptEpoch, EntitlementVersion: t.provider.entitlementVersion, Protocol: protocol, Payload: payload})
	if err != nil {
		return nil, errors.New("platform AI request unavailable")
	}
	r, err := http.NewRequestWithContext(native.Context(), http.MethodPost, t.provider.baseURL+"/api/ai/v1/requests", bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("platform AI request unavailable")
	}
	t.provider.mu.Lock()
	token := t.provider.grantToken
	t.provider.mu.Unlock()
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "text/event-stream")
	return t.provider.httpClient.Do(r)
}

func (p *platformGatewayProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	prepared, err := p.prepareTurn(ctx, req)
	if err != nil {
		return ModelGatewayResult{}, err
	}
	defer func() { _ = prepared.Close() }()
	return prepared.StreamTurn(ctx, onEvent)
}

func (p *platformGatewayProvider) prepareTurn(ctx context.Context, req ModelGatewayRequest) (preparedModelGatewayTurn, error) {
	if p == nil || p.httpClient == nil {
		return nil, errors.New("platform AI gateway unavailable")
	}
	if req.RunID == "" || req.ThreadID == "" || req.TurnID == "" || req.LogicalRequestID == "" || req.AttemptID == "" || req.PromptScopeID == "" {
		return nil, errors.New("platform AI requires an admitted Floret request identity")
	}
	if err := p.renew(ctx); err != nil {
		return nil, err
	}
	protocol, err := p.modelProtocol(ctx)
	if err != nil {
		return nil, err
	}
	req.Protocol = protocol
	req.Model = p.modelID
	client := &http.Client{Transport: platformRequestTransport{provider: p, request: req}}
	provider := &openAIProvider{providerType: "openai", requireTerminal: true, client: openai.NewClient(ooption.WithAPIKey("platform-lease"), ooption.WithBaseURL(p.baseURL+"/v1"), ooption.WithHTTPClient(client), ooption.WithMaxRetries(0))}
	// Reuse SDK serializers and stream parsers; Floret owns tools and transcript.
	return provider.prepareTurn(ctx, req)
}

func (p *platformGatewayProvider) modelProtocol(ctx context.Context) (string, error) {
	catalog, err := p.catalog(ctx)
	if err != nil {
		return "", err
	}
	for _, model := range catalog.Models {
		if model.ModelID != p.modelID || !model.Available {
			continue
		}
		for _, capability := range model.Capabilities {
			switch capability {
			case "chat":
				return "openai-chat-completions", nil
			case "responses":
				return "openai-responses", nil
			}
		}
	}
	return "", errors.New("platform model unavailable")
}

type platformModelCatalog struct {
	Models []platformCatalogModel `json:"models"`
}

type platformCatalogModel struct {
	ModelID               string   `json:"model_id"`
	DisplayName           string   `json:"display_name"`
	Available             bool     `json:"available"`
	Capabilities          []string `json:"capabilities"`
	ContextWindow         int      `json:"context_window"`
	MaxOutputTokens       int      `json:"max_output_tokens"`
	ReasoningLevels       []string `json:"reasoning_levels"`
	ReasoningDefaultLevel string   `json:"reasoning_default_level"`
}

func (p *platformGatewayProvider) catalog(ctx context.Context) (platformModelCatalog, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/api/ai/v1/catalog", nil)
	if err != nil {
		return platformModelCatalog{}, errors.New("platform model catalog unavailable")
	}
	p.mu.Lock()
	token := p.grantToken
	p.mu.Unlock()
	r.Header.Set("Authorization", "Bearer "+token)
	response, err := p.httpClient.Do(r)
	if err != nil {
		return platformModelCatalog{}, errors.New("platform model catalog unavailable")
	}
	defer func() { _ = response.Body.Close() }()
	var catalog platformModelCatalog
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&catalog) != nil {
		return platformModelCatalog{}, errors.New("platform model catalog unavailable")
	}
	return catalog, nil
}

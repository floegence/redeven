package flowerhost

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type HTTPSecretResolver struct {
	BaseURL string
	Token   string
	Client  *http.Client
	Timeout time.Duration
}

func (r HTTPSecretResolver) TargetSessionBrokerEndpoint() (baseURL string, token string) {
	return strings.TrimRight(strings.TrimSpace(r.BaseURL), "/"), strings.TrimSpace(r.Token)
}

type secretResolveRequest struct {
	ProviderID string `json:"provider_id,omitempty"`
	Kind       string `json:"kind"`
}

type secretResolveResponse struct {
	OK         bool                 `json:"ok"`
	Configured bool                 `json:"configured"`
	Value      string               `json:"value,omitempty"`
	Error      loopbackErrorPayload `json:"error,omitempty"`
}

type secretResolverStatusResponse struct {
	OK    bool                 `json:"ok"`
	Error loopbackErrorPayload `json:"error,omitempty"`
}

type loopbackErrorPayload struct {
	Code    string
	Message string
}

func (e *loopbackErrorPayload) UnmarshalJSON(raw []byte) error {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		e.Message = strings.TrimSpace(text)
		return nil
	}
	var record struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return err
	}
	e.Code = strings.TrimSpace(record.Code)
	e.Message = strings.TrimSpace(record.Message)
	return nil
}

func (e loopbackErrorPayload) String() string {
	message := strings.TrimSpace(e.Message)
	if message != "" {
		return message
	}
	if code := strings.TrimSpace(e.Code); code != "" {
		return code
	}
	return ""
}

func (r HTTPSecretResolver) CheckSecretResolver(ctx context.Context) error {
	baseURL := strings.TrimRight(strings.TrimSpace(r.BaseURL), "/")
	token := strings.TrimSpace(r.Token)
	if baseURL == "" || token == "" {
		return nil
	}
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL+"/v1/status", nil)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+token)
	client := r.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var decoded secretResolverStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !decoded.OK {
		message := decoded.Error.String()
		if message == "" {
			message = fmt.Sprintf("secret resolver status returned HTTP %d", resp.StatusCode)
		}
		return errors.New(message)
	}
	return nil
}

func (r HTTPSecretResolver) ResolveProviderAPIKey(ctx context.Context, providerID string) (string, bool, error) {
	return r.resolve(ctx, providerID, "provider_api_key")
}

func (r HTTPSecretResolver) ResolveWebSearchProviderAPIKey(ctx context.Context, providerID string) (string, bool, error) {
	return r.resolve(ctx, providerID, "web_search_api_key")
}

func (r HTTPSecretResolver) resolve(ctx context.Context, providerID string, kind string) (string, bool, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(r.BaseURL), "/")
	token := strings.TrimSpace(r.Token)
	providerID = strings.TrimSpace(providerID)
	if baseURL == "" || token == "" {
		return "", false, nil
	}
	if providerID == "" {
		return "", false, errors.New("missing secret subject")
	}
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	if ctx == nil {
		ctx = context.Background()
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request := secretResolveRequest{ProviderID: providerID, Kind: kind}
	body, err := json.Marshal(request)
	if err != nil {
		return "", false, err
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/v1/secrets/resolve", bytes.NewReader(body))
	if err != nil {
		return "", false, err
	}
	req.Header.Set("authorization", "Bearer "+token)
	req.Header.Set("content-type", "application/json")
	client := r.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	var decoded secretResolveResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return "", false, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !decoded.OK {
		message := decoded.Error.String()
		if message == "" {
			message = fmt.Sprintf("secret resolver returned HTTP %d", resp.StatusCode)
		}
		return "", false, errors.New(message)
	}
	return strings.TrimSpace(decoded.Value), decoded.Configured && strings.TrimSpace(decoded.Value) != "", nil
}

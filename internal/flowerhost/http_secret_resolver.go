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

type secretResolveRequest struct {
	ProviderID     string `json:"provider_id,omitempty"`
	ProviderOrigin string `json:"provider_origin,omitempty"`
	Kind           string `json:"kind"`
}

type secretResolveResponse struct {
	OK         bool   `json:"ok"`
	Configured bool   `json:"configured"`
	Value      string `json:"value,omitempty"`
	Error      string `json:"error,omitempty"`
}

func (r HTTPSecretResolver) ResolveProviderAPIKey(ctx context.Context, providerID string) (string, bool, error) {
	return r.resolve(ctx, providerID, "provider_api_key")
}

func (r HTTPSecretResolver) ResolveWebSearchProviderAPIKey(ctx context.Context, providerID string) (string, bool, error) {
	return r.resolve(ctx, providerID, "web_search_api_key")
}

func (r HTTPSecretResolver) ResolveControlPlaneAccessToken(ctx context.Context, providerOrigin string) (string, bool, error) {
	return r.resolve(ctx, providerOrigin, "control_plane_access_token")
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
	request := secretResolveRequest{Kind: kind}
	if strings.TrimSpace(kind) == "control_plane_access_token" {
		request.ProviderOrigin = providerID
	} else {
		request.ProviderID = providerID
	}
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
		message := strings.TrimSpace(decoded.Error)
		if message == "" {
			message = fmt.Sprintf("secret resolver returned HTTP %d", resp.StatusCode)
		}
		return "", false, errors.New(message)
	}
	return strings.TrimSpace(decoded.Value), decoded.Configured && strings.TrimSpace(decoded.Value) != "", nil
}

package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const platformGatewayProviderType = "redeven_platform"

type platformGatewayRunRequest struct {
	GrantToken         string `json:"grant_token"`
	EntitlementVersion int64  `json:"entitlement_version"`
	RunID              string `json:"run_id"`
	AttemptID          string `json:"attempt_id"`
	ModelID            string `json:"model_id"`
	MaxOutputTokens    int64  `json:"max_output_tokens"`
	MessagesJSON       []byte `json:"messages_json,omitempty"`
}

type platformGatewayRunResponse struct {
	Text           string  `json:"text"`
	BasicUnitsUsed float64 `json:"basic_units_used"`
	Status         string  `json:"status"`
	Error          *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type platformGatewayProvider struct {
	baseURL            string
	grantToken         string
	entitlementVersion int64
	httpClient         *http.Client
	modelID            string
}

func newPlatformGatewayProvider(baseURL, grantToken, modelID string, versions ...int64) (ModelGateway, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	grantToken = strings.TrimSpace(grantToken)
	modelID = strings.TrimSpace(modelID)
	if baseURL == "" || grantToken == "" || modelID == "" {
		return nil, errors.New("platform AI gateway URL, grant and model are required")
	}
	version := int64(0)
	if len(versions) > 0 {
		version = versions[0]
	}
	return &platformGatewayProvider{baseURL: baseURL, grantToken: grantToken, entitlementVersion: version, modelID: modelID, httpClient: &http.Client{Timeout: 2 * time.Minute}}, nil
}

func (p *platformGatewayProvider) StreamTurn(ctx context.Context, req ModelGatewayRequest, onEvent func(StreamEvent)) (ModelGatewayResult, error) {
	if p == nil || p.httpClient == nil {
		return ModelGatewayResult{}, errors.New("platform AI gateway provider is not configured")
	}
	attemptID, err := randomPlatformAttemptID()
	if err != nil {
		return ModelGatewayResult{}, err
	}
	messages, err := json.Marshal(req.Messages)
	if err != nil {
		return ModelGatewayResult{}, fmt.Errorf("marshal platform AI messages: %w", err)
	}
	maxOutput := int64(req.Budgets.MaxOutputToken)
	if maxOutput <= 0 {
		maxOutput = 1024
	}
	body, err := json.Marshal(platformGatewayRunRequest{GrantToken: p.grantToken, EntitlementVersion: p.entitlementVersion, RunID: strings.TrimSpace(string(req.RunID)), AttemptID: attemptID, ModelID: p.modelID, MaxOutputTokens: maxOutput, MessagesJSON: messages})
	if err != nil {
		return ModelGatewayResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/api/ai/v1/runs", bytes.NewReader(body))
	if err != nil {
		return ModelGatewayResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := p.httpClient.Do(request)
	if err != nil {
		return ModelGatewayResult{}, fmt.Errorf("platform AI gateway request: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return ModelGatewayResult{}, err
	}
	var decoded platformGatewayRunResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return ModelGatewayResult{}, fmt.Errorf("decode platform AI gateway response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if decoded.Error != nil && decoded.Error.Message != "" {
			return ModelGatewayResult{}, fmt.Errorf("platform AI gateway: %s", decoded.Error.Message)
		}
		return ModelGatewayResult{}, fmt.Errorf("platform AI gateway returned HTTP %d", response.StatusCode)
	}
	if decoded.Status != "completed" {
		return ModelGatewayResult{}, errors.New("platform AI gateway did not complete the run")
	}
	if onEvent != nil && decoded.Text != "" {
		onEvent(StreamEvent{Type: StreamEventTextDelta, Text: decoded.Text})
		onEvent(StreamEvent{Type: StreamEventFinishReason, FinishHint: "stop"})
	}
	return ModelGatewayResult{FinishReason: "stop", Text: decoded.Text}, nil
}

func randomPlatformAttemptID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "platform_attempt_" + hex.EncodeToString(raw[:]), nil
}

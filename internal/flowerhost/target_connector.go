package flowerhost

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type TargetConnector struct {
	client      *http.Client
	brokerURL   string
	brokerToken string
}

type TargetConnectorOptions struct {
	HTTPClient  *http.Client
	BrokerURL   string
	BrokerToken string
}

type targetBrokerOpenSessionRequest struct {
	TargetID             string            `json:"target_id"`
	ProviderOrigin       string            `json:"provider_origin,omitempty"`
	ProviderID           string            `json:"provider_id,omitempty"`
	EnvPublicID          string            `json:"env_public_id"`
	RequiredCapabilities []string          `json:"required_capabilities"`
	Reason               map[string]string `json:"reason,omitempty"`
	Metadata             map[string]any    `json:"metadata,omitempty"`
}

type targetBrokerOpenSessionResponse struct {
	OK         bool                 `json:"ok"`
	Data       *TargetSessionGrant  `json:"data,omitempty"`
	Configured bool                 `json:"configured,omitempty"`
	Error      loopbackErrorPayload `json:"error,omitempty"`
}

func NewTargetConnector(opts TargetConnectorOptions) *TargetConnector {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	return &TargetConnector{
		client:      client,
		brokerURL:   strings.TrimRight(strings.TrimSpace(opts.BrokerURL), "/"),
		brokerToken: strings.TrimSpace(opts.BrokerToken),
	}
}

func (c *TargetConnector) OpenTargetGrant(ctx context.Context, target FlowerTargetRef, requiredCapabilities []string) (TargetSessionGrant, error) {
	if c == nil {
		return TargetSessionGrant{}, errors.New("target connector not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	providerOrigin, err := canonicalProviderOrigin(target.ProviderOrigin)
	if err != nil {
		return TargetSessionGrant{}, err
	}
	envPublicID := strings.TrimSpace(target.EnvPublicID)
	targetID := strings.TrimSpace(target.TargetID)
	if targetID == "" || envPublicID == "" {
		return TargetSessionGrant{}, targetConnectError{code: "target_unsupported", message: "Target does not include provider origin and environment identity."}
	}
	if c.brokerURL == "" || c.brokerToken == "" {
		return TargetSessionGrant{}, targetConnectError{code: "target_unauthorized", message: "No carrier session broker is available for this Flower Host."}
	}
	capabilities, err := normalizeTargetCapabilities(requiredCapabilities)
	if err != nil {
		return TargetSessionGrant{}, err
	}
	body, err := json.Marshal(targetBrokerOpenSessionRequest{
		TargetID:             targetID,
		ProviderOrigin:       providerOrigin,
		ProviderID:           strings.TrimSpace(target.ProviderID),
		EnvPublicID:          envPublicID,
		RequiredCapabilities: capabilities,
	})
	if err != nil {
		return TargetSessionGrant{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.brokerURL+"/v1/targets/open-session", bytes.NewReader(body))
	if err != nil {
		return TargetSessionGrant{}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+c.brokerToken)
	resp, err := c.client.Do(req)
	if err != nil {
		return TargetSessionGrant{}, targetConnectError{code: "target_unreachable", message: err.Error()}
	}
	defer resp.Body.Close()
	var payload targetBrokerOpenSessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return TargetSessionGrant{}, err
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return TargetSessionGrant{}, targetConnectError{code: "target_unauthorized", message: "Carrier broker rejected the target session request."}
	}
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusServiceUnavailable {
		return TargetSessionGrant{}, targetConnectError{code: "target_unreachable", message: brokerErrorMessage(payload, fmt.Sprintf("Target runtime is not reachable (HTTP %d).", resp.StatusCode))}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !payload.OK {
		return TargetSessionGrant{}, targetConnectError{code: "target_unreachable", message: brokerErrorMessage(payload, fmt.Sprintf("Target session broker failed with HTTP %d.", resp.StatusCode))}
	}
	if payload.Data == nil {
		return TargetSessionGrant{}, targetConnectError{code: "target_unsupported", message: "Carrier broker returned an incomplete target session."}
	}
	grant := *payload.Data
	if got := strings.TrimSpace(grant.TargetID); got != "" && got != targetID {
		return TargetSessionGrant{}, targetConnectError{code: "target_unsupported", message: "Carrier broker returned a target session for a different target."}
	}
	if got := strings.TrimSpace(grant.EnvPublicID); got != "" && got != envPublicID {
		return TargetSessionGrant{}, targetConnectError{code: "target_unsupported", message: "Carrier broker returned a target session for a different environment."}
	}
	if grant.GrantClient == nil || strings.TrimSpace(grant.GrantClient.ChannelId) == "" {
		return TargetSessionGrant{}, targetConnectError{code: "target_unsupported", message: "Carrier broker returned an incomplete target grant."}
	}
	if grant.ExpiresAtUnixMs <= time.Now().UnixMilli() {
		return TargetSessionGrant{}, targetConnectError{code: "target_unauthorized", message: "Carrier broker returned an expired target session."}
	}
	if !capabilityGrantsRequired(grant.Capabilities, capabilities) {
		return TargetSessionGrant{}, targetConnectError{code: "target_unauthorized", message: "Carrier broker did not grant the requested target capabilities."}
	}
	grant.TargetID = targetID
	grant.ProviderOrigin = providerOrigin
	grant.EnvPublicID = envPublicID
	return grant, nil
}

func brokerErrorMessage(payload targetBrokerOpenSessionResponse, fallback string) string {
	if message := payload.Error.String(); message != "" {
		return message
	}
	return fallback
}

func canonicalProviderOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", targetConnectError{code: "target_unsupported", message: "Target provider origin is missing."}
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", targetConnectError{code: "target_unsupported", message: "Target provider origin is invalid."}
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", targetConnectError{code: "target_unsupported", message: "Target provider origin must use http or https."}
	}
	if strings.TrimSpace(parsed.Path) != "" && parsed.Path != "/" {
		return "", targetConnectError{code: "target_unsupported", message: "Target provider origin must not include a path."}
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = ""
	return parsed.String(), nil
}

func normalizeTargetCapabilities(capabilities []string) ([]string, error) {
	out := make([]string, 0, len(capabilities))
	seen := make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		capability = strings.TrimSpace(strings.ToLower(capability))
		switch capability {
		case "read", "write", "execute":
		default:
			return nil, targetConnectError{code: "target_unsupported", message: "Target capability request is invalid."}
		}
		if _, ok := seen[capability]; ok {
			continue
		}
		seen[capability] = struct{}{}
		out = append(out, capability)
	}
	return out, nil
}

func capabilityGrantsRequired(capability TargetSessionCapabilities, required []string) bool {
	for _, item := range required {
		switch strings.TrimSpace(strings.ToLower(item)) {
		case "":
		case "read":
			if !capability.CanRead {
				return false
			}
		case "write":
			if !capability.CanWrite {
				return false
			}
		case "execute":
			if !capability.CanExecute {
				return false
			}
		default:
			return false
		}
	}
	return true
}

type targetConnectError struct {
	code    string
	message string
}

func (e targetConnectError) Error() string {
	msg := strings.TrimSpace(e.message)
	if msg == "" {
		msg = "Target connection failed."
	}
	return strings.TrimSpace(e.code) + ": " + msg
}

func (e targetConnectError) Code() string {
	return strings.TrimSpace(e.code)
}

func TargetConnectReason(err error) string {
	var connectErr targetConnectError
	if errors.As(err, &connectErr) {
		return strings.TrimSpace(connectErr.code)
	}
	if err == nil {
		return ""
	}
	return "target_unreachable"
}

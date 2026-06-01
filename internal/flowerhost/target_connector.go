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

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
)

const flowerTargetSessionPathSuffix = "/flower/target-session"

type TargetConnector struct {
	client      *http.Client
	hostID      string
	accessToken func(ctx context.Context, providerOrigin string) (string, bool, error)
}

type TargetConnectorOptions struct {
	HTTPClient         *http.Client
	HostID             string
	ResolveAccessToken func(ctx context.Context, providerOrigin string) (string, bool, error)
}

func NewTargetConnector(opts TargetConnectorOptions) *TargetConnector {
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	return &TargetConnector{
		client:      client,
		hostID:      strings.TrimSpace(opts.HostID),
		accessToken: opts.ResolveAccessToken,
	}
}

func (c *TargetConnector) OpenTargetSession(ctx context.Context, target FlowerTargetRef, requiredCapabilities []string) (FlowerTargetSession, error) {
	if c == nil {
		return FlowerTargetSession{}, errors.New("target connector not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	providerOrigin, err := canonicalProviderOrigin(target.ProviderOrigin)
	if err != nil {
		return FlowerTargetSession{}, err
	}
	envPublicID := strings.TrimSpace(target.EnvPublicID)
	if strings.TrimSpace(target.TargetID) == "" || envPublicID == "" {
		return FlowerTargetSession{}, targetConnectError{code: "target_unsupported", message: "Target does not include provider origin and environment identity."}
	}
	if c.accessToken == nil {
		return FlowerTargetSession{}, targetConnectError{code: "target_unauthorized", message: "No provider authorization is available for this Flower Host."}
	}
	token, ok, err := c.accessToken(ctx, providerOrigin)
	if err != nil {
		return FlowerTargetSession{}, err
	}
	if !ok || strings.TrimSpace(token) == "" {
		return FlowerTargetSession{}, targetConnectError{code: "target_unauthorized", message: "Provider authorization is missing for this target."}
	}
	capabilities, err := normalizeTargetCapabilities(requiredCapabilities)
	if err != nil {
		return FlowerTargetSession{}, err
	}
	body, err := json.Marshal(map[string]any{
		"flower_host_id":        c.hostID,
		"required_capabilities": capabilities,
	})
	if err != nil {
		return FlowerTargetSession{}, err
	}
	targetURL := providerOrigin + "/api/rcpp/v1/environments/" + url.PathEscape(envPublicID) + flowerTargetSessionPathSuffix
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return FlowerTargetSession{}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+strings.TrimSpace(token))
	resp, err := c.client.Do(req)
	if err != nil {
		return FlowerTargetSession{}, targetConnectError{code: "target_unreachable", message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return FlowerTargetSession{}, targetConnectError{code: "target_unauthorized", message: "Provider rejected the Flower target session request."}
	}
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusServiceUnavailable {
		return FlowerTargetSession{}, targetConnectError{code: "target_unreachable", message: fmt.Sprintf("Target runtime is not reachable (HTTP %d).", resp.StatusCode)}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return FlowerTargetSession{}, targetConnectError{code: "target_unreachable", message: fmt.Sprintf("Target session request failed with HTTP %d.", resp.StatusCode)}
	}
	var payload struct {
		EntryTicket     string                        `json:"entry_ticket"`
		TargetID        string                        `json:"target_id"`
		FloeApp         string                        `json:"floe_app"`
		SessionKind     string                        `json:"session_kind"`
		CodeSpaceID     string                        `json:"code_space_id"`
		EndpointID      string                        `json:"endpoint_id"`
		EnvPublicID     string                        `json:"env_public_id"`
		CanRead         bool                          `json:"can_read"`
		CanWrite        bool                          `json:"can_write"`
		CanExecute      bool                          `json:"can_execute"`
		Capability      FlowerTargetSessionCapability `json:"capability"`
		ExpiresAtUnixMs int64                         `json:"expires_at_unix_ms"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return FlowerTargetSession{}, err
	}
	if strings.TrimSpace(payload.SessionKind) != "flower_host_rpc" || strings.TrimSpace(payload.FloeApp) != "com.floegence.redeven.flower" {
		return FlowerTargetSession{}, targetConnectError{code: "target_unsupported", message: "Provider returned a non-Flower target session."}
	}
	if strings.TrimSpace(payload.EntryTicket) == "" || strings.TrimSpace(payload.CodeSpaceID) == "" {
		return FlowerTargetSession{}, targetConnectError{code: "target_unsupported", message: "Provider returned an incomplete Flower target session."}
	}
	if got := strings.TrimSpace(firstNonEmpty(payload.EnvPublicID, payload.EndpointID)); got != "" && got != envPublicID {
		return FlowerTargetSession{}, targetConnectError{code: "target_unsupported", message: "Provider returned a Flower target session for a different environment."}
	}
	if got := strings.TrimSpace(payload.TargetID); got != "" && got != strings.TrimSpace(target.TargetID) {
		return FlowerTargetSession{}, targetConnectError{code: "target_unsupported", message: "Provider returned a Flower target session for a different target."}
	}
	if payload.ExpiresAtUnixMs <= time.Now().UnixMilli() {
		return FlowerTargetSession{}, targetConnectError{code: "target_unauthorized", message: "Provider returned an expired Flower target session."}
	}
	capability := payload.Capability
	if !capabilityGrantsRequired(capability, capabilities) {
		return FlowerTargetSession{}, targetConnectError{code: "target_unauthorized", message: "Provider did not grant the requested Flower target capabilities."}
	}
	return FlowerTargetSession{
		SessionID:       strings.TrimSpace(payload.EntryTicket),
		TargetID:        strings.TrimSpace(target.TargetID),
		ChannelID:       strings.TrimSpace(payload.CodeSpaceID),
		EnvPublicID:     envPublicID,
		SessionKind:     strings.TrimSpace(payload.SessionKind),
		FloeApp:         strings.TrimSpace(payload.FloeApp),
		Capabilities:    capability,
		ExpiresAtUnixMs: payload.ExpiresAtUnixMs,
	}, nil
}

type TargetGrant struct {
	Session     FlowerTargetSession
	GrantClient *controlv1.ChannelInitGrant
}

func (c *TargetConnector) OpenTargetGrant(ctx context.Context, target FlowerTargetRef, requiredCapabilities []string) (TargetGrant, error) {
	session, err := c.OpenTargetSession(ctx, target, requiredCapabilities)
	if err != nil {
		return TargetGrant{}, err
	}
	grantClient, err := c.exchangeEntryTicket(ctx, target, session)
	if err != nil {
		return TargetGrant{}, err
	}
	return TargetGrant{Session: session, GrantClient: grantClient}, nil
}

func (c *TargetConnector) exchangeEntryTicket(ctx context.Context, target FlowerTargetRef, session FlowerTargetSession) (*controlv1.ChannelInitGrant, error) {
	if c == nil {
		return nil, errors.New("target connector not initialized")
	}
	providerOrigin, err := canonicalProviderOrigin(target.ProviderOrigin)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]string{
		"endpoint_id": strings.TrimSpace(target.EnvPublicID),
		"floe_app":    "com.floegence.redeven.flower",
	})
	if err != nil {
		return nil, err
	}
	entryURL := providerOrigin + "/v1/channel/init/entry?endpoint_id=" + url.QueryEscape(strings.TrimSpace(target.EnvPublicID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, entryURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+strings.TrimSpace(session.SessionID))
	req.Header.Set("origin", providerOrigin)
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, targetConnectError{code: "target_unreachable", message: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, targetConnectError{code: "target_unauthorized", message: "Provider rejected the Flower entry ticket."}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, targetConnectError{code: "target_unreachable", message: fmt.Sprintf("Flower entry ticket exchange failed with HTTP %d.", resp.StatusCode)}
	}
	var payload struct {
		GrantClient *controlv1.ChannelInitGrant `json:"grant_client"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.GrantClient == nil || strings.TrimSpace(payload.GrantClient.ChannelId) == "" {
		return nil, targetConnectError{code: "target_unsupported", message: "Provider returned an incomplete Flower grant."}
	}
	if strings.TrimSpace(payload.GrantClient.ChannelId) != strings.TrimSpace(session.ChannelID) {
		return nil, targetConnectError{code: "target_unsupported", message: "Provider returned a Flower grant for a different channel."}
	}
	return payload.GrantClient, nil
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

func capabilityGrantsRequired(capability FlowerTargetSessionCapability, required []string) bool {
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

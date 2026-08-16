package supervisor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	gatewaylifecycle "github.com/floegence/redeven/internal/runtimegateway/lifecycle"
	gatewayprotocol "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimemanagement"
	"github.com/floegence/redeven/internal/runtimeservice"
)

const runtimeControlProtocolVersion = "redeven-runtime-control-v2"

type runtimeControlClient struct {
	socketPath string
	timeout    time.Duration
}

type runtimeControlEnvelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (c runtimeControlClient) identity(ctx context.Context) (runtimeservice.RuntimeIdentity, error) {
	var identity runtimeservice.RuntimeIdentity
	if err := c.call(ctx, http.MethodGet, "/v2/runtime/identity", nil, &identity); err != nil {
		return runtimeservice.RuntimeIdentity{}, err
	}
	return identity, nil
}

func (c runtimeControlClient) snapshot(ctx context.Context) (gatewayprotocol.WorkloadSnapshot, error) {
	var snapshot gatewayprotocol.WorkloadSnapshot
	if err := c.call(ctx, http.MethodGet, "/v2/runtime/workload-snapshot", nil, &snapshot); err != nil {
		return gatewayprotocol.WorkloadSnapshot{}, err
	}
	return gatewayprotocol.NormalizeWorkloadSnapshot(snapshot), nil
}

func (c runtimeControlClient) beginFence(ctx context.Context, operationID string, generation int64) (gatewaylifecycle.LifecycleFence, error) {
	var fence struct {
		Token    string                           `json:"token"`
		Snapshot gatewayprotocol.WorkloadSnapshot `json:"snapshot"`
	}
	err := c.call(ctx, http.MethodPost, "/v2/runtime/lifecycle-fence/begin", map[string]any{
		"protocol_version":  runtimeControlProtocolVersion,
		"operation_id":      operationID,
		"target_generation": generation,
	}, &fence)
	if err != nil {
		return gatewaylifecycle.LifecycleFence{}, err
	}
	return gatewaylifecycle.LifecycleFence{Token: strings.TrimSpace(fence.Token), Snapshot: gatewayprotocol.NormalizeWorkloadSnapshot(fence.Snapshot)}, nil
}

func (c runtimeControlClient) releaseFence(ctx context.Context, token string) error {
	return c.call(ctx, http.MethodPost, "/v2/runtime/lifecycle-fence/release", map[string]any{
		"protocol_version": runtimeControlProtocolVersion,
		"fence_token":      token,
	}, &struct{}{})
}

func (c runtimeControlClient) shutdown(ctx context.Context, token string) error {
	return c.call(ctx, http.MethodPost, "/v2/runtime/shutdown", map[string]any{
		"protocol_version": runtimeControlProtocolVersion,
		"fence_token":      token,
	}, &struct{}{})
}

func (c runtimeControlClient) health(ctx context.Context) error {
	var health struct {
		Status             string `json:"status"`
		ServiceProtocol    string `json:"service_protocol"`
		CompatibilityEpoch int    `json:"compatibility_epoch"`
	}
	if err := c.call(ctx, http.MethodGet, "/v2/runtime/health", nil, &health); err != nil {
		return err
	}
	if health.Status != "ok" || health.ServiceProtocol != gatewayprotocol.RuntimeServiceProtocolV2 || health.CompatibilityEpoch != gatewayprotocol.RuntimeCompatibilityEpochV2 {
		return errors.New("Runtime health facts are incompatible with Gateway lifecycle")
	}
	return nil
}

func (c runtimeControlClient) call(ctx context.Context, method string, path string, body any, output any) error {
	status, err := runtimemanagement.LoadStatus(ctx, c.socketPath, c.requestTimeout())
	if err != nil {
		return fmt.Errorf("load Runtime control endpoint: %w", err)
	}
	if status.State != runtimemanagement.AttachStateReady || status.Endpoint == nil || status.Endpoint.RuntimeControl == nil {
		return errors.New("Runtime control endpoint is unavailable")
	}
	endpoint := status.Endpoint.RuntimeControl
	if endpoint.ProtocolVersion != runtimeControlProtocolVersion || strings.TrimSpace(endpoint.Token) == "" {
		return errors.New("Runtime control protocol is incompatible")
	}
	baseURL, err := validateRuntimeControlBaseURL(endpoint.BaseURL)
	if err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimSuffix(baseURL, "/")+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+endpoint.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: c.requestTimeout()}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, 1<<20)
	decoder := json.NewDecoder(limited)
	var envelope runtimeControlEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return fmt.Errorf("decode Runtime control response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || !envelope.OK {
		if envelope.Error != nil && strings.TrimSpace(envelope.Error.Message) != "" {
			return fmt.Errorf("Runtime control %s: %s", strings.TrimSpace(envelope.Error.Code), strings.TrimSpace(envelope.Error.Message))
		}
		return fmt.Errorf("Runtime control returned HTTP %d", response.StatusCode)
	}
	if output == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, output); err != nil {
		return fmt.Errorf("decode Runtime control data: %w", err)
	}
	return nil
}

func (c runtimeControlClient) requestTimeout() time.Duration {
	if c.timeout > 0 {
		return c.timeout
	}
	return 5 * time.Second
}

func validateRuntimeControlBaseURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("Runtime control endpoint is invalid")
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() || parsed.Port() == "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("Runtime control endpoint is not an exact loopback authority")
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

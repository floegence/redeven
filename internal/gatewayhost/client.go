package gatewayhost

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/desktopbridge"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/gatewaystate"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Client is the official local Gateway host API client. Credentials stay here.
type Client struct {
	endpoint, token, socketPath string
	transport                   *http.Transport
}

func DefaultRoot() string {
	if root := strings.TrimSpace(os.Getenv("REDEVEN_GATEWAY_STATE_ROOT")); root != "" {
		return root
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".redeven", "gateways", "default", "state")
}
func TokenPath(root string) string { return filepath.Join(root, "gateway-host-admin.json") }

// ServiceRecord is the exact public record written by the official Gateway CLI.
// It locates the host API and does not contain member state or credentials.
type ServiceRecord struct {
	Status                 string `json:"status"`
	PID                    int    `json:"pid,omitempty"`
	Listen                 string `json:"listen,omitempty"`
	PublicListen           string `json:"public_listen,omitempty"`
	StateRoot              string `json:"state_root"`
	Executable             string `json:"executable,omitempty"`
	ProcessStartedAtUnixMS int64  `json:"process_started_at_unix_ms,omitempty"`
	ErrorMessage           string `json:"error_message,omitempty"`
	ErrorCode              string `json:"error_code,omitempty"`
	Recovery               string `json:"recovery,omitempty"`
}

func Open(root string) (*Client, error) {
	// Read the Gateway's published service record, never its private member store.
	var status ServiceRecord
	if root == "" || gatewaystate.Read(filepath.Join(root, "gateway-service.pid.json"), &status) != nil || status.PID <= 0 || status.Status != "running" {
		return nil, errors.New("Gateway service record is unavailable")
	}
	return New(root, status.Listen)
}
func New(root, listen string) (*Client, error) {
	if !filepath.IsAbs(listen) {
		return nil, errors.New("invalid Gateway management socket")
	}
	info, err := os.Lstat(listen)
	if err != nil || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("Gateway management socket is not private")
	}
	var token string
	if gatewaystate.Read(TokenPath(root), &token) != nil || len(token) < 32 {
		return nil, errors.New("Gateway host administrator credential is unavailable")
	}
	return &Client{endpoint: "http://gateway-host", token: token, socketPath: listen, transport: &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", listen)
	}, MaxResponseHeaderBytes: 16 << 10}}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) Catalog(ctx context.Context) (gp.CatalogResponse, error) {
	var catalog gp.CatalogResponse
	err := c.Request(ctx, "/gateway/v6/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog)
	if err == nil && catalog.ProtocolVersion != gp.Version {
		err = errors.New("Update Gateway to the current protocol")
	}
	return catalog, err
}
func (c *Client) Request(ctx context.Context, route string, input, output any) error {
	return c.RequestWithOperation(ctx, route, input, output, rand.Text())
}

// RequestWithOperation preserves caller-owned recovery identity across failures.
// It never retries a mutation whose effects may already have committed.
func (c *Client) RequestWithOperation(ctx context.Context, route string, input, output any, operationID string) error {
	err := c.request(ctx, route, input, output, operationID)
	if err != nil {
		return fmt.Errorf("%w; operation ID: %s (query with redeven-gateway operations query --operation-id %s)", err, operationID, operationID)
	}
	return nil
}
func (c *Client) request(ctx context.Context, route string, input, output any, operationID string) error {
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+route, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	request.Header.Set(gatewayservice.HostAdminHeader, c.token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(gatewayservice.OperationIDHeader, operationID)
	client := &http.Client{Transport: c.transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("gateway administration is unavailable")
	}
	defer response.Body.Close()
	var envelope struct {
		OK    bool            `json:"ok"`
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&envelope) != nil {
		return errors.New("invalid Gateway administration response")
	}
	if response.StatusCode != http.StatusOK || !envelope.OK {
		if envelope.Error != nil {
			return fmt.Errorf("gateway operation failed (%s)", envelope.Error.Code)
		}
		return errors.New("gateway operation failed")
	}
	if output != nil {
		return json.Unmarshal(envelope.Data, output)
	}
	return nil
}

func (c *Client) SurfaceDialer(memberURL string) desktopbridge.SurfaceDialer {
	return desktopbridge.NewGatewaySurfaceDialer("unix:"+c.socketPath, memberURL, c.token)
}

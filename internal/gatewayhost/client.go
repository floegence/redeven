package gatewayhost

import (
	"bytes"
	"context"
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
	endpoint, token string
	transport       *http.Transport
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
func Open(root string) (*Client, error) {
	// Read the Gateway's published service record, never its private member store.
	var status struct {
		Listen string `json:"listen"`
		PID    int    `json:"pid"`
	}
	if root == "" || gatewaystate.Read(filepath.Join(root, "gateway-service.pid.json"), &status) != nil || status.PID <= 0 {
		return nil, errors.New("Gateway service record is unavailable")
	}
	return New(root, status.Listen)
}
func New(root, listen string) (*Client, error) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return nil, errors.New("invalid Gateway administration endpoint")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil, errors.New("Gateway administration requires a local IP endpoint")
	}
	if ip.IsUnspecified() {
		if ip.To4() == nil {
			host = "::1"
		} else {
			host = "127.0.0.1"
		}
	} else if !ip.IsLoopback() {
		return nil, errors.New("Gateway administration listener must include loopback")
	}
	var token string
	if gatewaystate.Read(TokenPath(root), &token) != nil || len(token) < 32 {
		return nil, errors.New("Gateway host administrator credential is unavailable")
	}
	return &Client{endpoint: "http://" + net.JoinHostPort(host, port), token: token, transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, MaxResponseHeaderBytes: 16 << 10}}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) Catalog(ctx context.Context) (gp.CatalogResponse, error) {
	var catalog gp.CatalogResponse
	err := c.Request(ctx, "/gateway/v5/catalog", gp.CatalogRequest{ProtocolVersion: gp.Version}, &catalog)
	if err == nil && catalog.ProtocolVersion != gp.Version {
		err = errors.New("Update Gateway to the current protocol")
	}
	return catalog, err
}
func (c *Client) Request(ctx context.Context, route string, input, output any) error {
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
	return desktopbridge.NewGatewaySurfaceDialer(c.endpoint+"/", memberURL, c.token)
}

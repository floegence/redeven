package gatewaymembership

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

// EndpointClient owns a reusable transport for one exact membership and trust
// configuration. Its owner must cancel in-flight calls before replacing it.
type EndpointClient struct {
	member        *RuntimeConfig
	authenticated bool
	client        *http.Client
}

func NewEndpointClient(member *RuntimeConfig, authenticated bool) (*EndpointClient, error) {
	if member == nil || len(member.ConnectionEndpoints()) == 0 {
		return nil, ErrState
	}
	tlsConfig, err := member.TLSConfig(authenticated)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSClientConfig: tlsConfig, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 2, MaxIdleConns: 8, IdleConnTimeout: time.Minute, MaxResponseHeaderBytes: 16 << 10}
	return &EndpointClient{member: member.Clone(), authenticated: authenticated, client: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("gateway redirects are prohibited") }}}, nil
}
func (c *EndpointClient) Close() {
	if c != nil && c.client != nil {
		c.client.CloseIdleConnections()
	}
}
func (c *EndpointClient) Request(ctx context.Context, path string, body, out any) error {
	// Reusing TLS must not extend a member certificate's authorization lifetime.
	if _, err := c.member.TLSConfig(c.authenticated); err != nil {
		return err
	}
	var last error
	for _, endpoint := range c.member.ConnectionEndpoints() {
		err := requestGatewayEndpoint(ctx, c.client, endpoint, path, body, out)
		if err == nil {
			return nil
		}
		last = err
		if !errors.Is(err, errGatewayUnavailable) {
			return err
		}
	}
	return last
}

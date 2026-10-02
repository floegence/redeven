package runtimeproxy

import (
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redevplugin/v3/pkg/externalsource"
)

const (
	PresetID        = "redeven-runtime"
	MaxWSFrameBytes = 32 * 1024 * 1024
	// EnvAppMaxBodyBytes preserves the published plugin package upload contract.
	EnvAppMaxBodyBytes = externalsource.MaxArtifactBytes
)

// EnvAppRequestHeaders is shared by the issuer scope and the session server.
func EnvAppRequestHeaders() []string {
	return []string{
		"X-ReDevPlugin-CSRF", "X-ReDevPlugin-Expected-Management-Revision",
		"Upload-Staging-Scope-ID", "Upload-Staging-Capability", "Upload-Content-Length",
		"Upload-Content-SHA256", "Upload-Display-Name-SHA256", "Idempotency-Key",
	}
}

// EnvAppResponseHeaders carries product attachment authorization to native clients.
func EnvAppResponseHeaders() []string {
	return []string{"Upload-Staging-Capability"}
}

// Options is the Redeven-owned policy subset applied to Flowersec's public
// carrier-neutral ProxyServer.
type Options struct {
	Upstream                    string
	UpstreamOrigin              string
	DefaultHTTPRequestTimeout   time.Duration
	MaxHTTPRequestTimeout       time.Duration
	MaxConcurrentStreams        int
	MaxBodyBytes                int64
	BlockedResponseHeaders      []string
	ExtraRequestHeaders         []string
	ExtraResponseHeaders        []string
	ExtraWebSocketHeaders       []string
	ForbiddenCookieNames        []string
	ForbiddenCookieNamePrefixes []string
	OnError                     func(error)
}

func ProductBlockedResponseHeaders() []string {
	return []string{"Content-Security-Policy", "Content-Security-Policy-Report-Only", "X-Frame-Options"}
}

func New(opts Options) (*flowersec.ProxyServer, error) {
	blocked := append([]string{}, opts.BlockedResponseHeaders...)
	blocked = append(blocked, ProductBlockedResponseHeaders()...)
	return flowersec.NewProxyServer(flowersec.ProxyServerOptions{
		Upstream:                    opts.Upstream,
		UpstreamOrigin:              opts.UpstreamOrigin,
		MaxConcurrentStreams:        opts.MaxConcurrentStreams,
		MaxWebSocketFrameBytes:      MaxWSFrameBytes,
		MaxBodyBytes:                opts.MaxBodyBytes,
		DefaultHTTPRequestTimeout:   opts.DefaultHTTPRequestTimeout,
		MaxHTTPRequestTimeout:       opts.MaxHTTPRequestTimeout,
		BlockedResponseHeaders:      blocked,
		ExtraRequestHeaders:         opts.ExtraRequestHeaders,
		ExtraResponseHeaders:        opts.ExtraResponseHeaders,
		ExtraWebSocketHeaders:       opts.ExtraWebSocketHeaders,
		ForbiddenCookieNames:        opts.ForbiddenCookieNames,
		ForbiddenCookieNamePrefixes: opts.ForbiddenCookieNamePrefixes,
		OnError:                     opts.OnError,
	})
}

// RegisterStreamHandlers binds the product proxy to Flowersec's role-neutral
// application stream registry.
func RegisterStreamHandlers(handlers flowersec.StreamHandlerRegistrar, opts Options) (*flowersec.ProxyServer, error) {
	proxy, err := New(opts)
	if err != nil {
		return nil, err
	}
	if err := proxy.RegisterStreamHandlers(handlers); err != nil {
		_ = proxy.Close()
		return nil, err
	}
	return proxy, nil
}

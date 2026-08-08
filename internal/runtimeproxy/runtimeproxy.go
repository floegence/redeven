package runtimeproxy

import (
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
)

const (
	PresetID        = "redeven-runtime"
	MaxWSFrameBytes = 32 * 1024 * 1024
)

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

func Register(handlers *flowersec.SessionHandlers, opts Options) (*flowersec.ProxyServer, error) {
	proxy, err := New(opts)
	if err != nil {
		return nil, err
	}
	if err := proxy.Register(handlers); err != nil {
		_ = proxy.Close()
		return nil, err
	}
	return proxy, nil
}

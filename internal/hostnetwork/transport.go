package hostnetwork

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/net/http/httpproxy"
)

// Transport uses current host routing for one HTTP request. The caller owns
// authorization, redirect handling, response limits and artifact verification.
// Construct a separate transport for each authorization scope.
type Transport struct {
	slots    chan struct{}
	base     *http.Transport
	mutation *http.Transport
	resolve  func(context.Context, *url.URL) ([]*url.URL, error)
}
type routeKey struct{}
type route struct{ proxy *url.URL }

// NewTransport does not resolve proxies or perform network I/O.
func NewTransport(config *tls.Config) *Transport {
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = func(request *http.Request) (*url.URL, error) {
		value, ok := request.Context().Value(routeKey{}).(route)
		if !ok {
			return nil, errors.New("missing host network route")
		}
		return value.proxy, nil
	}
	base.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if config != nil {
		base.TLSClientConfig = config.Clone()
		if base.TLSClientConfig.MinVersion < tls.VersionTLS12 {
			base.TLSClientConfig.MinVersion = tls.VersionTLS12
		}
	}
	base.TLSClientConfig.ClientSessionCache = nil
	base.DisableCompression = true
	base.MaxIdleConns = 2
	base.MaxIdleConnsPerHost = 2
	base.MaxConnsPerHost = 8
	base.IdleConnTimeout = 30 * time.Second
	base.ResponseHeaderTimeout = 20 * time.Second
	mutation := base.Clone()
	// A fresh HTTP/1 connection makes ambiguous writes non-replayable, including
	// requests carrying an idempotency header supplied by an application.
	mutation.DisableKeepAlives = true
	mutation.ForceAttemptHTTP2 = false
	mutation.Protocols = new(http.Protocols)
	mutation.Protocols.SetHTTP1(true)
	configureTLS(base, nil)
	configureTLS(mutation, nil)
	return &Transport{slots: make(chan struct{}, 8), base: base, mutation: mutation, resolve: func(ctx context.Context, target *url.URL) ([]*url.URL, error) { return systemProxies(ctx, target, "") }}
}
func (transport *Transport) CloseIdleConnections() {
	transport.base.CloseIdleConnections()
	transport.mutation.CloseIdleConnections()
}
func (transport *Transport) RoundTrip(request *http.Request) (*http.Response, error) {
	select {
	case transport.slots <- struct{}{}:
	case <-request.Context().Done():
		if request.Body != nil {
			_ = request.Body.Close()
		}
		return nil, request.Context().Err()
	}
	release := sync.OnceFunc(func() { <-transport.slots })
	transferred := false
	defer func() {
		if !transferred {
			release()
		}
	}()
	started := false
	defer func() {
		if !started && request.Body != nil {
			_ = request.Body.Close()
		}
	}()
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	routes, selected, err := environmentRoutes(request.URL, os.LookupEnv)
	if err != nil {
		return nil, err
	}
	if !selected {
		routes, err = transport.resolve(request.Context(), request.URL)
		if err != nil {
			return nil, err
		}
	}
	if len(routes) == 0 {
		return nil, errors.New("host network returned no route")
	}
	readOnly := (request.Method == http.MethodGet || request.Method == http.MethodHead) && (request.Body == nil || request.Body == http.NoBody)
	client := transport.mutation
	if readOnly {
		client = transport.base
	}
	var last error
	for _, proxy := range routes {
		if err := request.Context().Err(); err != nil {
			return nil, err
		}
		var connected atomic.Bool
		trace := &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { connected.Store(true) }}
		ctx := httptrace.WithClientTrace(context.WithValue(request.Context(), routeKey{}, route{proxy: proxy}), trace)
		started = true
		response, err := client.RoundTrip(request.Clone(ctx))
		if err == nil {
			response.Request = request
			if response.Body != nil {
				response.Body = &responseBody{ReadCloser: response.Body, release: release}
				transferred = true
			}
			return response, nil
		}
		last = err
		// Only a failed dial before an application connection exists can advance a
		// bodyless read to another route explicitly returned by host configuration.
		// Certificate, protocol, HTTP response and unknown-outcome errors stop here.
		if !readOnly || connected.Load() || !isDialFailure(err) {
			break
		}
	}
	return nil, last
}
func environmentRoutes(target *url.URL, lookup func(string) (string, bool)) ([]*url.URL, bool, error) {
	get := func(upper, lower string) (string, bool) {
		if value, ok := lookup(upper); ok {
			return value, true
		}
		return lookup(lower)
	}
	httpProxy, httpSet := get("HTTP_PROXY", "http_proxy")
	httpsProxy, httpsSet := get("HTTPS_PROXY", "https_proxy")
	all, allSet := get("ALL_PROXY", "all_proxy")
	noProxy, _ := get("NO_PROXY", "no_proxy")
	if !httpSet && allSet {
		httpProxy, httpSet = all, true
	}
	if !httpsSet && allSet {
		httpsProxy, httpsSet = all, true
	}
	requestMethod, _ := lookup("REQUEST_METHOD")
	config := httpproxy.Config{HTTPProxy: httpProxy, HTTPSProxy: httpsProxy, NoProxy: noProxy, CGI: requestMethod != ""}
	selected := httpSet && target.Scheme == "http" || httpsSet && target.Scheme == "https"
	if config.NoProxy != "" {
		probe := config
		probe.HTTPProxy = "http://proxy.invalid"
		probe.HTTPSProxy = "http://proxy.invalid"
		proxy, err := probe.ProxyFunc()(target)
		if err != nil {
			return nil, true, err
		}
		if proxy == nil {
			return []*url.URL{nil}, true, nil
		}
	}
	if !selected {
		return nil, false, nil
	}
	raw := config.HTTPProxy
	if target.Scheme == "https" {
		raw = config.HTTPSProxy
	}
	if raw != "" {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			parsed, err = url.Parse("http://" + raw)
		}
		if err != nil || parsed.Hostname() == "" || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, true, errors.New("invalid configured proxy URL")
		}
		if port := parsed.Port(); port != "" {
			number, err := strconv.Atoi(port)
			if err != nil || number < 1 || number > 65535 {
				return nil, true, errors.New("invalid configured proxy port")
			}
		}
		switch strings.ToLower(parsed.Scheme) {
		case "http", "https", "socks5", "socks5h":
		default:
			return nil, true, errors.New("unsupported configured proxy scheme")
		}
	}
	proxy, err := config.ProxyFunc()(target)
	if err != nil {
		return nil, true, err
	}
	if proxy != nil {
		switch strings.ToLower(proxy.Scheme) {
		case "http", "https", "socks5", "socks5h":
		default:
			return nil, true, errors.New("unsupported configured proxy scheme")
		}
	}
	return []*url.URL{proxy}, true, nil
}

func isDialFailure(err error) bool {
	for err != nil {
		if op, ok := err.(*net.OpError); ok && op.Op == "dial" {
			return true
		}
		err = errors.Unwrap(err)
	}
	return false
}

type responseBody struct {
	io.ReadCloser
	release func()
}

func (body *responseBody) Read(value []byte) (int, error) {
	count, err := body.ReadCloser.Read(value)
	if err != nil {
		body.release()
	}
	return count, err
}
func (body *responseBody) Close() error { defer body.release(); return body.ReadCloser.Close() }

// An HTTPS proxy and its origin are separate TLS peers. Origin client identity,
// explicit server name and private roots must never apply to the proxy hop.
func configureTLS(transport *http.Transport, proxyConfig *tls.Config) {
	transport.DialTLSContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		selected, _ := ctx.Value(routeKey{}).(route)
		config := transport.TLSClientConfig.Clone()
		if selected.proxy != nil && selected.proxy.Scheme == "https" {
			config = &tls.Config{MinVersion: tls.VersionTLS12}
			if proxyConfig != nil {
				config = proxyConfig.Clone()
			}
			config.ServerName = selected.proxy.Hostname()
			config.NextProtos = []string{"http/1.1"}
		} else {
			if config.ServerName == "" {
				host, _, err := net.SplitHostPort(address)
				if err != nil {
					return nil, err
				}
				config.ServerName = host
			}
			if transport.DisableKeepAlives {
				config.NextProtos = []string{"http/1.1"}
			}
		}
		connection, err := transport.DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		secured := tls.Client(connection, config)
		handshakeCtx, cancel := context.WithTimeout(ctx, transport.TLSHandshakeTimeout)
		defer cancel()
		if err := secured.HandshakeContext(handshakeCtx); err != nil {
			_ = connection.Close()
			return nil, err
		}
		return secured, nil
	}
}

package hostapps

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"sync"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
)

// A sharing route owns its accepted connections, including hijacked WebSockets.
// Retiring a share must revoke live input without ending the host application.
type applicationProxy struct {
	net.Listener
	mu          sync.Mutex
	connections map[*applicationConnection]struct{}
	closed      bool
	transport   *http.Transport
}
type applicationConnection struct {
	net.Conn
	owner *applicationProxy
}

func (c *applicationConnection) Close() error {
	err := c.Conn.Close()
	c.owner.mu.Lock()
	delete(c.owner.connections, c)
	c.owner.mu.Unlock()
	return err
}
func (p *applicationProxy) Accept() (net.Conn, error) {
	c, err := p.Listener.Accept()
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		_ = c.Close()
		return nil, net.ErrClosed
	}
	tracked := &applicationConnection{Conn: c, owner: p}
	p.connections[tracked] = struct{}{}
	return tracked, nil
}
func (p *applicationProxy) Close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	for c := range p.connections {
		_ = c.Conn.Close()
	}
	p.connections = nil
	p.mu.Unlock()
	p.transport.CloseIdleConnections()
	return p.Listener.Close()
}
func newApplicationProxy(target string, assets *nativeapps.ClientAssets) (*applicationProxy, string, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, "", err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, "", err
	}
	p := &applicationProxy{Listener: listener, connections: make(map[*applicationConnection]struct{})}
	p.transport = http.DefaultTransport.(*http.Transport).Clone()
	proxy := &httputil.ReverseProxy{Transport: p.transport}
	proxy.Rewrite = func(r *httputil.ProxyRequest) {
		r.SetURL(u)
		// The native application's WebSocket origin check sees the sharing host.
		r.Out.Host = r.In.Host
		// Let the transport decompress documents before the SDK rewrites references.
		r.Out.Header.Del("Accept-Encoding")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Set("Cache-Control", "no-store")
		resp.Header.Del("ETag")
		resp.Header.Del("Last-Modified")
		if assets == nil || resp.StatusCode != http.StatusOK || resp.Request.Method != http.MethodGet ||
			(resp.Request.URL.Path != "/index.html" && resp.Request.URL.Path != "/") {
			return nil
		}
		const limit = 2 << 20
		body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
		_ = resp.Body.Close()
		if err != nil {
			return err
		}
		if len(body) > limit {
			return fmt.Errorf("application document exceeds size limit")
		}
		body, err = assets.RewriteHTML(body, ClientAssetsPath+assets.Digest()+"/")
		if err != nil {
			return err
		}
		resp.Body = io.NopCloser(bytes.NewReader(body))
		resp.ContentLength = int64(len(body))
		resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
		return nil
	}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(p) }()
	return p, listener.Addr().String(), nil
}

// ClientAssetsPath is independent of the ephemeral sharing route. Only the
// authenticated appserver serves this namespace, never a port-forward backend.
const ClientAssetsPath = "/_redeven_proxy/host-application-assets/"

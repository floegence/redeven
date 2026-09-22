package hostapps

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"time"
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
func newApplicationProxy(target string) (*applicationProxy, string, error) {
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
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.Transport = p.transport
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = server.Serve(p) }()
	return p, listener.Addr().String(), nil
}

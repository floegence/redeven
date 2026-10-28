package environmentcenter

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
)

type routeConnection interface {
	http.RoundTripper
	Close()
}

// Local IPC carries one admitted route, never administrator factors or state.
type connectorLeaseRequest struct {
	Protocol int
	Gateway  GatewayRecord
	Route    storedRoute
	Device   string
}
type connectorLeaseResponse struct {
	Protocol int
	Lease    string `json:",omitempty"`
	Error    string `json:",omitempty"`
}

const connectorErrorHeader = "X-Redeven-Connector-Error"

func connectorFailure(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(connectorLeaseResponse{Protocol: 1, Error: connectionCode(err)})
}

func connectorProxyFailure(w http.ResponseWriter, status int, err error) {
	w.Header().Set(connectorErrorHeader, connectionCode(err))
	http.Error(w, "Connector request failed", status)
}

type connectorLease struct {
	owner  routeConnection
	cancel context.CancelFunc
	active int
}
type connectorWorker struct {
	mu     sync.Mutex
	leases map[string]*connectorLease
	active int
}

func (s *connectorWorker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	trusted, _ := r.Context().Value(ownerKey{}).(bool)
	if !trusted {
		http.Error(w, "Connector peer denied", 403)
		return
	}
	if r.URL.Path == "/v1/leases" && r.Method == "POST" {
		var input connectorLeaseRequest
		if err := readJSON(w, r, &input); err != nil || input.Protocol != 1 || r.Header.Get("Origin") != "" {
			http.Error(w, "Connector protocol unsupported", 400)
			return
		}
		input.Route.Route.Certificate, input.Route.Route.PrivateKey = input.Route.Certificate, input.Route.PrivateKey
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		s.mu.Lock()
		if len(s.leases) >= 128 {
			s.mu.Unlock()
			connectorFailure(w, 429, ErrBusy)
			return
		}
		id := randomID()
		lease := &connectorLease{cancel: cancel}
		s.leases[id] = lease
		s.mu.Unlock()
		defer func() { s.mu.Lock(); delete(s.leases, id); s.mu.Unlock() }()
		owner, err := connect(ctx, input.Gateway, input.Route.Route, input.Device)
		if err != nil {
			connectorFailure(w, 502, err)
			return
		}
		defer owner.Close()
		s.mu.Lock()
		lease.owner = owner
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if json.NewEncoder(w).Encode(connectorLeaseResponse{Protocol: 1, Lease: id}) != nil {
			return
		}
		if http.NewResponseController(w).Flush() != nil {
			return
		}
		<-ctx.Done()
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/proxy/")
	s.mu.Lock()
	lease := s.leases[id]
	if !strings.HasPrefix(r.URL.Path, "/v1/proxy/") || lease == nil || lease.owner == nil {
		s.mu.Unlock()
		connectorProxyFailure(w, 503, &gatewayError{Code: "CENTER_CONNECTOR_UNREACHABLE"})
		return
	}
	if lease.active >= 32 || s.active >= 192 {
		s.mu.Unlock()
		connectorProxyFailure(w, 429, ErrBusy)
		return
	}
	lease.active++
	s.active++
	s.mu.Unlock()
	defer func() { s.mu.Lock(); lease.active--; s.active--; s.mu.Unlock() }()
	target := r.Header.Get("X-Redeven-Connector-Target")
	out, err := http.NewRequestWithContext(r.Context(), r.Method, target, nil)
	if err != nil {
		connectorProxyFailure(w, 403, ErrDenied)
		return
	}
	proxy := &httputil.ReverseProxy{Transport: lease.owner, FlushInterval: -1, Rewrite: func(p *httputil.ProxyRequest) {
		p.Out.URL = out.URL
		p.Out.Host = p.In.Host
		p.Out.Header.Del("X-Redeven-Connector-Target")
	}, ModifyResponse: func(response *http.Response) error {
		// Only the local worker may classify a transport failure.
		response.Header.Del(connectorErrorHeader)
		return nil
	}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
		connectorProxyFailure(w, 502, err)
	}}
	proxy.ServeHTTP(w, r)
}

// ServeConnector has no persistent state and authenticates the exact Center UID.
// Every route lease ends when its owning Center control connection closes.
func ServeConnector(ctx context.Context, socket string, centerUID int) error {
	if centerUID < 0 || !filepath.IsAbs(socket) {
		return errors.New("Connector requires an absolute socket and Center UID")
	}
	if info, err := os.Lstat(socket); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("Unsafe Connector socket path")
		}
		probe, dialErr := net.DialTimeout("unix", socket, time.Second)
		if dialErr == nil {
			probe.Close()
			return errors.New("Connector socket is already serving")
		}
		if err = os.Remove(socket); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(socket)
	if err = os.Chmod(socket, 0660); err != nil {
		return err
	}
	worker := &connectorWorker{leases: map[string]*connectorLease{}}
	server := &http.Server{Handler: worker, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 64 << 10, ConnContext: func(ctx context.Context, conn net.Conn) context.Context {
		return context.WithValue(ctx, ownerKey{}, connectorPeer(conn, centerUID))
	}}
	stop := context.AfterFunc(ctx, func() {
		_ = server.Close()
		worker.mu.Lock()
		defer worker.mu.Unlock()
		for _, lease := range worker.leases {
			lease.cancel()
		}
	})
	defer stop()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

type workerGeneration struct {
	lease     string
	transport *http.Transport
	control   io.ReadCloser
	cancel    context.CancelFunc
	ctx       context.Context
}
type workerConnection struct {
	mu      sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	socket  string
	uid     int
	input   connectorLeaseRequest
	current *workerGeneration
	closed  bool
}

func connectWorker(ctx context.Context, socket string, uid int, gateway GatewayRecord, route Route, device string) (*workerConnection, error) {
	life, cancel := context.WithCancel(ctx)
	c := &workerConnection{ctx: life, cancel: cancel, socket: socket, uid: uid, input: connectorLeaseRequest{Protocol: 1, Gateway: gateway, Route: storedRoute{Route: route, Certificate: route.Certificate, PrivateKey: route.PrivateKey}, Device: device}}
	context.AfterFunc(life, c.Close)
	if _, err := c.generation(ctx); err != nil {
		c.Close()
		return nil, err
	}
	return c, nil
}
func (c *workerConnection) generation(parent context.Context) (*workerGeneration, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || c.ctx.Err() != nil {
		return nil, ErrDenied
	}
	if c.current != nil && c.current.ctx.Err() == nil {
		return c.current, nil
	}
	life, cancel := context.WithCancel(c.ctx)
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 9, MaxIdleConns: 8, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 30 * time.Second, MaxResponseHeaderBytes: 64 << 10, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, "unix", c.socket)
		if err != nil {
			return nil, err
		}
		if !connectorPeer(conn, c.uid) {
			conn.Close()
			return nil, ErrDenied
		}
		tracked := &connectorSocket{Conn: conn}
		tracked.stop = context.AfterFunc(life, func() { _ = conn.Close() })
		return tracked, nil
	}}
	raw, err := json.Marshal(c.input)
	if err != nil {
		cancel()
		return nil, err
	}
	request, _ := http.NewRequestWithContext(life, "POST", "http://connector/v1/leases", strings.NewReader(string(raw)))
	request.Header.Set("Content-Type", "application/json")
	detach := context.AfterFunc(parent, cancel)
	deadline := time.AfterFunc(30*time.Second, cancel)
	response, err := transport.RoundTrip(request)
	if err != nil {
		detach()
		deadline.Stop()
		cancel()
		transport.CloseIdleConnections()
		if parent.Err() != nil {
			return nil, parent.Err()
		}
		if c.ctx.Err() != nil {
			return nil, c.ctx.Err()
		}
		return nil, &gatewayError{Code: "CENTER_CONNECTOR_UNREACHABLE", Retryable: true}
	}
	var result connectorLeaseResponse
	err = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result)
	detach()
	deadline.Stop()
	if err != nil || result.Protocol != 1 || response.StatusCode != 200 || result.Error != "" || result.Lease == "" || life.Err() != nil {
		cancel()
		response.Body.Close()
		transport.CloseIdleConnections()
		if parent.Err() != nil {
			return nil, parent.Err()
		}
		if c.ctx.Err() != nil {
			return nil, c.ctx.Err()
		}
		if err == nil && result.Protocol == 1 && response.StatusCode != 200 && result.Error != "" {
			return nil, &gatewayError{Code: connectionCode(&gatewayError{Code: result.Error}), Retryable: response.StatusCode >= 500 || response.StatusCode == 429}
		}
		return nil, &gatewayError{Code: "CENTER_CONNECTOR_UNSUPPORTED"}
	}
	generation := &workerGeneration{lease: result.Lease, transport: transport, control: response.Body, cancel: cancel, ctx: life}
	c.current = generation
	go func() {
		_, _ = io.Copy(io.Discard, response.Body)
		cancel()
		response.Body.Close()
		transport.CloseIdleConnections()
	}()
	return generation, nil
}
func (c *workerConnection) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Scheme+"://"+request.URL.Host != gatewaymembership.ServiceOrigin(c.input.Route.RuntimeID) || request.Host != strings.TrimPrefix(c.input.Route.Origin, "https://") {
		return nil, ErrDenied
	}
	generation, err := c.generation(request.Context())
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(request.Context())
	detach := context.AfterFunc(generation.ctx, cancel)
	out := request.Clone(ctx)
	target := request.URL.String()
	out.URL.Scheme, out.URL.Host, out.URL.Path, out.URL.RawPath, out.URL.RawQuery = "http", "connector", "/v1/proxy/"+generation.lease, "", ""
	out.Header.Set("X-Redeven-Connector-Target", target)
	// Never replay business requests across generations; the caller owns retries.
	response, err := generation.transport.RoundTrip(out)
	if err != nil {
		detach()
		cancel()
		return nil, err
	}
	if code := response.Header.Get(connectorErrorHeader); code != "" {
		response.Body.Close()
		detach()
		cancel()
		return nil, &gatewayError{Code: connectionCode(&gatewayError{Code: code}), Retryable: response.StatusCode >= 500}
	}
	response.Body = &connectorResponseBody{ReadCloser: response.Body, done: func() { detach(); cancel() }}
	return response, nil
}

type connectorResponseBody struct {
	io.ReadCloser
	done func()
}

func (b *connectorResponseBody) Close() error { b.done(); return b.ReadCloser.Close() }
func (b *connectorResponseBody) Write(p []byte) (int, error) {
	if writer, ok := b.ReadCloser.(io.Writer); ok {
		return writer.Write(p)
	}
	return 0, errors.New("Connector body is not duplex")
}

type connectorSocket struct {
	net.Conn
	stop func() bool
}

func (c *connectorSocket) Close() error { c.stop(); return c.Conn.Close() }
func (c *workerConnection) Close() {
	c.cancel()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	if c.current != nil {
		c.current.cancel()
		c.current.control.Close()
		c.current.transport.CloseIdleConnections()
	}
}

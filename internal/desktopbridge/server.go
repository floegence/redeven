package desktopbridge

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
	"sync"
	"time"

	"github.com/floegence/redeven/internal/runtimemanagement"
	"golang.org/x/net/http2"
)

type SurfaceDialer func(context.Context, StreamSurface) (net.Conn, error)

type Server struct {
	DialSurface SurfaceDialer
	Hello       Hello
	OnShutdown  func()
}

// IMPORTANT: The Desktop bridge is a placement transport. It must not become
// a provider tunnel, published-port shortcut, or host-network fallback.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	if s == nil {
		return errors.New("missing bridge server")
	}
	if in == nil || out == nil {
		return errors.New("missing bridge stdio")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	conn := newStdioConn(in, out)
	defer conn.Close()
	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stopWatch:
		}
	}()
	server := &http2.Server{
		MaxConcurrentStreams:         MaxConcurrentStreams,
		MaxDecoderHeaderTableSize:    4 << 10,
		MaxEncoderHeaderTableSize:    4 << 10,
		MaxReadFrameSize:             16 << 10,
		ReadIdleTimeout:              15 * time.Second,
		PingTimeout:                  10 * time.Second,
		WriteByteTimeout:             30 * time.Second,
		MaxUploadBufferPerStream:     StreamReceiveWindowBytes,
		MaxUploadBufferPerConnection: SessionReceiveWindowBytes,
	}
	server.ServeConn(conn, &http2.ServeConnOpts{
		Context: ctx,
		BaseConfig: &http.Server{
			MaxHeaderBytes: MaxHeaderListBytes,
		},
		Handler: http.HandlerFunc(s.serveHTTP),
	})
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return nil
}

func (s *Server) serveHTTP(w http.ResponseWriter, r *http.Request) {
	if r == nil || r.ProtoMajor != 2 {
		writeBridgeError(w, http.StatusBadRequest, ErrorInvalidRequest)
		return
	}
	switch {
	case r.Method == http.MethodGet && r.Host == BridgeAuthority && r.URL.Path == HelloPath:
		hello := s.Hello
		hello.ProtocolVersion = ProtocolVersion
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(hello)
	case r.Method == http.MethodPost && r.Host == BridgeAuthority && r.URL.Path == ShutdownRuntimePath:
		w.WriteHeader(http.StatusNoContent)
		flushResponse(w)
		if s.OnShutdown != nil {
			go s.OnShutdown()
		}
	case r.Method == http.MethodConnect:
		s.serveSurface(w, r)
	default:
		writeBridgeError(w, http.StatusNotFound, ErrorInvalidRequest)
	}
}

func (s *Server) serveSurface(w http.ResponseWriter, r *http.Request) {
	surface, ok := SurfaceFromAuthority(r.Host)
	if !ok || s.DialSurface == nil {
		writeBridgeError(w, http.StatusNotFound, ErrorSurfaceUnavailable)
		return
	}
	conn, err := s.DialSurface(r.Context(), surface)
	if err != nil {
		writeBridgeError(w, http.StatusBadGateway, ErrorSurfaceDialFailed)
		return
	}
	defer conn.Close()
	w.WriteHeader(http.StatusOK)
	flushResponse(w)
	streamDone := make(chan struct{})
	defer close(streamDone)
	go func() {
		select {
		case <-r.Context().Done():
			_ = conn.Close()
		case <-streamDone:
		}
	}()

	requestDone := make(chan struct{})
	go func() {
		defer close(requestDone)
		_, _ = io.Copy(conn, r.Body)
		if closer, ok := conn.(interface{ CloseWrite() error }); ok {
			_ = closer.CloseWrite()
		}
	}()
	_, _ = io.Copy(flushingWriter{writer: w}, conn)
	_ = conn.Close()
	<-requestDone
}

func writeBridgeError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(ErrorCodeHeader, strings.TrimSpace(code))
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code string `json:"code"`
	}{Code: strings.TrimSpace(code)})
}

func flushResponse(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

type flushingWriter struct {
	writer http.ResponseWriter
}

func (w flushingWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	flushResponse(w.writer)
	return n, err
}

type stdioConn struct {
	reader io.Reader
	writer io.Writer
	once   sync.Once
}

func newStdioConn(reader io.Reader, writer io.Writer) *stdioConn {
	return &stdioConn{reader: reader, writer: writer}
}

func (c *stdioConn) Read(p []byte) (int, error)       { return c.reader.Read(p) }
func (c *stdioConn) Write(p []byte) (int, error)      { return c.writer.Write(p) }
func (c *stdioConn) LocalAddr() net.Addr              { return stdioAddr("local") }
func (c *stdioConn) RemoteAddr() net.Addr             { return stdioAddr("remote") }
func (c *stdioConn) SetDeadline(time.Time) error      { return nil }
func (c *stdioConn) SetReadDeadline(time.Time) error  { return nil }
func (c *stdioConn) SetWriteDeadline(time.Time) error { return nil }
func (c *stdioConn) Close() error {
	c.once.Do(func() {
		if closer, ok := c.reader.(io.Closer); ok {
			_ = closer.Close()
		}
		if closer, ok := c.writer.(io.Closer); ok {
			_ = closer.Close()
		}
	})
	return nil
}

type stdioAddr string

func (stdioAddr) Network() string  { return "stdio" }
func (a stdioAddr) String() string { return string(a) }

func NewTrustedBridgeSurfaceDialer(localUIBridgeURL string, runtimeControlURL string) (SurfaceDialer, error) {
	localUIAddr, err := trustedLoopbackAddrFromURL(localUIBridgeURL)
	if err != nil {
		return nil, fmt.Errorf("invalid trusted Local UI bridge URL: %w", err)
	}
	return newSurfaceDialer(localUIAddr, dialAddrFromURL(runtimeControlURL), "", ""), nil
}

func NewGatewaySurfaceDialer(gatewayURL string, managedGatewayBridgeToken string) SurfaceDialer {
	return newSurfaceDialer("", "", dialAddrFromURL(gatewayURL), managedGatewayBridgeToken)
}

func newSurfaceDialer(localUIAddr string, runtimeControlAddr string, gatewayAddr string, managedGatewayBridgeToken string) SurfaceDialer {
	return func(ctx context.Context, surface StreamSurface) (net.Conn, error) {
		addr := ""
		switch surface {
		case StreamSurfaceLocalUI:
			addr = localUIAddr
		case StreamSurfaceRuntimeControl:
			addr = runtimeControlAddr
		case StreamSurfaceGatewayProtocol:
			addr = gatewayAddr
		default:
			return nil, fmt.Errorf("unknown bridge surface %q", surface)
		}
		if addr == "" {
			return nil, fmt.Errorf("bridge surface %s is unavailable", surface)
		}
		dialer := net.Dialer{Timeout: 10 * time.Second}
		conn, err := dialer.DialContext(ctx, "tcp", addr)
		if err != nil {
			return nil, err
		}
		if surface == StreamSurfaceGatewayProtocol && strings.TrimSpace(managedGatewayBridgeToken) != "" {
			return &gatewayProtocolHeaderConn{
				Conn:  conn,
				token: strings.TrimSpace(managedGatewayBridgeToken),
			}, nil
		}
		return conn, nil
	}
}

func ProbeSurface(ctx context.Context, dial SurfaceDialer, surface StreamSurface) error {
	if dial == nil {
		return errors.New("missing bridge surface dialer")
	}
	conn, err := dial(ctx, surface)
	if err != nil {
		return err
	}
	return conn.Close()
}

type gatewayProtocolHeaderConn struct {
	net.Conn

	mu       sync.Mutex
	token    string
	injected bool
	buffer   []byte
}

func (c *gatewayProtocolHeaderConn) CloseWrite() error {
	if closer, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return closer.CloseWrite()
	}
	return nil
}

func (c *gatewayProtocolHeaderConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.injected || strings.TrimSpace(c.token) == "" {
		return c.Conn.Write(p)
	}
	const maxHandshakeBytes = 64 * 1024
	c.buffer = append(c.buffer, p...)
	headerEnd := bytes.Index(c.buffer, []byte("\r\n\r\n"))
	if headerEnd < 0 {
		if len(c.buffer) <= maxHandshakeBytes {
			return len(p), nil
		}
		c.buffer = nil
		c.injected = true
		return 0, fmt.Errorf("gateway handshake exceeds %d bytes", maxHandshakeBytes)
	}
	if headerEnd+len("\r\n\r\n") > maxHandshakeBytes {
		c.buffer = nil
		c.injected = true
		return 0, fmt.Errorf("gateway handshake exceeds %d bytes", maxHandshakeBytes)
	}
	managedHeader := []byte("X-Redeven-Gateway-Managed-Bridge-Token: " + c.token)
	header := make([]byte, 0, headerEnd+len(managedHeader)+len("\r\n\r\n\r\n"))
	header = append(header, c.buffer[:headerEnd]...)
	header = append(header, '\r', '\n')
	header = append(header, managedHeader...)
	header = append(header, c.buffer[headerEnd:headerEnd+len("\r\n\r\n")]...)
	body := c.buffer[headerEnd+len("\r\n\r\n"):]
	c.injected = true
	c.buffer = nil
	if err := writeAll(c.Conn, header); err != nil {
		return 0, err
	}
	if err := writeAll(c.Conn, body); err != nil {
		return 0, err
	}
	return len(p), nil
}

func writeAll(w io.Writer, p []byte) error {
	for len(p) > 0 {
		n, err := w.Write(p)
		if err != nil {
			return err
		}
		if n <= 0 {
			return io.ErrShortWrite
		}
		p = p[n:]
	}
	return nil
}

func dialAddrFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Host == "" {
		return ""
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ""
	}
	return parsed.Host
}

func trustedLoopbackAddrFromURL(raw string) (string, error) {
	normalized, err := runtimemanagement.NormalizeLocalUIBridgeURL(raw)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(normalized)
	if err != nil || parsed == nil {
		return "", errors.New("URL must be an HTTP loopback endpoint")
	}
	return parsed.Host, nil
}

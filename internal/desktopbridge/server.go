package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

type SurfaceDialer func(context.Context, StreamSurface) (net.Conn, error)

type Server struct {
	DialSurface SurfaceDialer
	Hello       Hello
	OnShutdown  func()

	readMu    sync.Mutex
	writeMu   sync.Mutex
	streamsMu sync.Mutex
	streams   map[string]net.Conn
}

// IMPORTANT: The Desktop bridge is a placement transport. It must not become
// a provider tunnel, published-port shortcut, or host-network fallback.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	if s == nil {
		return errors.New("missing bridge server")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	hello := s.Hello
	hello.ProtocolVersion = ProtocolVersion
	if err := s.writeJSONFrame(out, FrameTypeHello, "bridge", hello); err != nil {
		return err
	}
	s.streams = make(map[string]net.Conn)
	defer s.closeStreams()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		s.readMu.Lock()
		header, payload, err := ReadFrame(in)
		s.readMu.Unlock()
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		switch header.Type {
		case FrameTypeStreamOpen:
			s.handleStreamOpen(ctx, out, header.StreamID, payload)
		case FrameTypeStreamData:
			s.handleStreamData(out, header.StreamID, payload)
		case FrameTypeStreamClose:
			s.closeStream(header.StreamID)
		case FrameTypeShutdownRuntime:
			if s.OnShutdown != nil {
				s.OnShutdown()
			}
			return nil
		case FrameTypePing:
			if err := s.writeFrame(out, FrameHeader{StreamID: header.StreamID, Type: FrameTypePong}, nil); err != nil {
				return err
			}
		default:
			if err := s.writeStreamError(out, header.StreamID, "UNSUPPORTED_FRAME", fmt.Sprintf("Unsupported bridge frame type: %s", header.Type)); err != nil {
				return err
			}
		}
	}
}

func (s *Server) handleStreamOpen(ctx context.Context, out io.Writer, streamID string, payload []byte) {
	if strings.TrimSpace(streamID) == "" {
		return
	}
	if s.DialSurface == nil {
		_ = s.writeStreamError(out, streamID, "SURFACE_UNAVAILABLE", "Bridge surface dialer is unavailable.")
		return
	}
	var open StreamOpen
	if err := json.Unmarshal(payload, &open); err != nil {
		_ = s.writeStreamError(out, streamID, "INVALID_STREAM_OPEN", "Bridge stream open payload is invalid.")
		return
	}
	conn, err := s.DialSurface(ctx, open.Surface)
	if err != nil {
		_ = s.writeStreamError(out, streamID, "SURFACE_DIAL_FAILED", err.Error())
		return
	}
	s.streamsMu.Lock()
	if existing := s.streams[streamID]; existing != nil {
		_ = existing.Close()
	}
	s.streams[streamID] = conn
	s.streamsMu.Unlock()
	go s.copyConnToBridge(out, streamID, conn)
}

func (s *Server) handleStreamData(out io.Writer, streamID string, payload []byte) {
	conn := s.streamByID(streamID)
	if conn == nil {
		_ = s.writeStreamError(out, streamID, "STREAM_NOT_FOUND", "Bridge stream is not open.")
		return
	}
	if len(payload) == 0 {
		return
	}
	if _, err := conn.Write(payload); err != nil {
		_ = s.writeStreamError(out, streamID, "STREAM_WRITE_FAILED", err.Error())
		s.closeStream(streamID)
	}
}

func (s *Server) copyConnToBridge(out io.Writer, streamID string, conn net.Conn) {
	defer s.closeStream(streamID)
	buf := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if writeErr := s.writeFrame(out, FrameHeader{StreamID: streamID, Type: FrameTypeStreamData}, append([]byte(nil), buf[:n]...)); writeErr != nil {
				return
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !isClosedNetworkError(err) {
				_ = s.writeStreamError(out, streamID, "STREAM_READ_FAILED", err.Error())
			}
			_ = s.writeFrame(out, FrameHeader{StreamID: streamID, Type: FrameTypeStreamClose}, nil)
			return
		}
	}
}

func (s *Server) streamByID(streamID string) net.Conn {
	s.streamsMu.Lock()
	defer s.streamsMu.Unlock()
	return s.streams[strings.TrimSpace(streamID)]
}

func (s *Server) closeStream(streamID string) {
	s.streamsMu.Lock()
	conn := s.streams[strings.TrimSpace(streamID)]
	delete(s.streams, strings.TrimSpace(streamID))
	s.streamsMu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}

func (s *Server) closeStreams() {
	s.streamsMu.Lock()
	streams := s.streams
	s.streams = make(map[string]net.Conn)
	s.streamsMu.Unlock()
	for _, conn := range streams {
		if conn != nil {
			_ = conn.Close()
		}
	}
}

func (s *Server) writeJSONFrame(w io.Writer, frameType string, streamID string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.writeFrame(w, FrameHeader{StreamID: streamID, Type: frameType}, payload)
}

func (s *Server) writeStreamError(w io.Writer, streamID string, code string, message string) error {
	return s.writeJSONFrame(w, FrameTypeStreamError, streamID, StreamError{
		Code:    strings.TrimSpace(code),
		Message: strings.TrimSpace(message),
	})
}

func (s *Server) writeFrame(w io.Writer, header FrameHeader, payload []byte) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return WriteFrame(w, header, payload)
}

func isClosedNetworkError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "use of closed network connection") || strings.Contains(text, "closed pipe")
}

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

func (c *gatewayProtocolHeaderConn) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.injected || strings.TrimSpace(c.token) == "" {
		return c.Conn.Write(p)
	}
	c.buffer = append(c.buffer, p...)
	headerEnd := bytes.Index(c.buffer, []byte("\r\n\r\n"))
	if headerEnd < 0 && len(c.buffer) < 64*1024 {
		return len(p), nil
	}
	out := c.buffer
	if headerEnd >= 0 {
		header := []byte("X-Redeven-Gateway-Managed-Bridge-Token: " + c.token)
		next := make([]byte, 0, len(c.buffer)+len(header)+2)
		next = append(next, c.buffer[:headerEnd]...)
		next = append(next, "\r\n"...)
		next = append(next, header...)
		next = append(next, c.buffer[headerEnd:]...)
		out = next
	}
	c.injected = true
	c.buffer = nil
	if err := writeAll(c.Conn, out); err != nil {
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
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("URL must be an HTTP loopback endpoint")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", errors.New("URL path must be root")
	}
	addrPort, err := netip.ParseAddrPort(parsed.Host)
	if err != nil || addrPort.Port() == 0 {
		return "", errors.New("URL must include a loopback host and port")
	}
	addr := addrPort.Addr()
	if !addr.IsLoopback() || addr.Zone() != "" || addr.Is4In6() {
		return "", errors.New("URL host must be loopback")
	}
	return addrPort.String(), nil
}

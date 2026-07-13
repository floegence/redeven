package localui

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

const (
	localUIBodyLimit      = int64(1 << 30)
	localUIJSONBodyLimit  = int64(64 << 10)
	localUIWSReadLimit    = int64(16 << 20)
	localUIMaxHeaderBytes = 32 << 10
)

func (s *Server) configureNetworkAuthorities(listeners []net.Listener) error {
	if s == nil {
		return nil
	}
	allowed := make(map[string]struct{}, len(listeners)+1)
	for _, listener := range listeners {
		if listener == nil {
			return fmt.Errorf("missing Local UI listener")
		}
		addr, ok := listener.Addr().(*net.TCPAddr)
		if !ok || addr == nil || addr.IP == nil {
			return fmt.Errorf("Local UI listener must use a loopback TCP address")
		}
		parsedAddr, err := netip.ParseAddr(addr.IP.String())
		if err != nil || addr.Port <= 0 || addr.Zone != "" || !parsedAddr.IsLoopback() {
			return fmt.Errorf("Local UI listener must use a loopback TCP address")
		}
		host := parsedAddr.String()
		allowed[net.JoinHostPort(host, strconv.Itoa(addr.Port))] = struct{}{}
		if s.bind.localhost {
			allowed[net.JoinHostPort("localhost", strconv.Itoa(addr.Port))] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return fmt.Errorf("missing Local UI authorities")
	}
	s.authorityMu.Lock()
	s.networkAuthorities = allowed
	s.authorityMu.Unlock()
	return nil
}

func canonicalLoopbackAuthority(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.ContainsAny(value, "@/?#%") {
		return "", fmt.Errorf("invalid authority")
	}
	host, portRaw, err := net.SplitHostPort(value)
	if err != nil || host == "" || portRaw == "" {
		return "", fmt.Errorf("invalid authority")
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil || port <= 0 || port > 65535 || portRaw != strconv.Itoa(port) {
		return "", fmt.Errorf("invalid authority port")
	}
	if strings.EqualFold(host, "localhost") {
		return net.JoinHostPort("localhost", strconv.Itoa(port)), nil
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return "", fmt.Errorf("authority host must be a loopback literal")
	}
	if addr.Zone() != "" || addr.Is4In6() || !addr.IsLoopback() {
		return "", fmt.Errorf("authority host must be loopback")
	}
	return net.JoinHostPort(addr.String(), strconv.Itoa(port)), nil
}

func (s *Server) isAllowedNetworkAuthority(raw string) bool {
	canonical, err := canonicalLoopbackAuthority(raw)
	if err != nil || s == nil {
		return false
	}
	s.authorityMu.RLock()
	_, exact := s.networkAuthorities[canonical]
	configured := len(s.networkAuthorities) > 0
	s.authorityMu.RUnlock()
	if exact {
		return true
	}
	// Desktop, SSH, and container bridges terminate on a different local port but
	// preserve a canonical loopback authority. Arbitrary DNS names remain rejected.
	return configured
}

func (s *Server) isTrustedOrAllowedAuthority(raw string) bool {
	if _, err := canonicalLoopbackAuthority(raw); err != nil || s == nil {
		return false
	}
	s.authorityMu.RLock()
	configured := len(s.networkAuthorities) > 0
	s.authorityMu.RUnlock()
	return !configured || s.isAllowedNetworkAuthority(raw)
}

func (s *Server) networkHandler() http.Handler {
	next := s.handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r == nil || !s.isAllowedNetworkAuthority(r.Host) {
			http.Error(w, "invalid Local UI authority", http.StatusMisdirectedRequest)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, localUIBodyLimit)
		}
		next.ServeHTTP(w, r)
	})
}

func withLocalUISecurityHeaders(next http.Handler) http.Handler {
	if next == nil {
		return http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := &localUISecurityResponseWriter{ResponseWriter: w}
		wrapped.apply()
		next.ServeHTTP(wrapped, r)
	})
}

type localUISecurityResponseWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *localUISecurityResponseWriter) apply() {
	if w.Header().Get("Content-Security-Policy") == "" {
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if w.Header().Get("Referrer-Policy") == "" {
		w.Header().Set("Referrer-Policy", "no-referrer")
	}
	if w.Header().Get("Permissions-Policy") == "" {
		w.Header().Set("Permissions-Policy", "browsing-topics=()")
	}
	if w.Header().Get("X-Frame-Options") == "" {
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	}
}

func (w *localUISecurityResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *localUISecurityResponseWriter) WriteHeader(statusCode int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.apply()
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *localUISecurityResponseWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}

func (w *localUISecurityResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		if !w.wroteHeader {
			w.WriteHeader(http.StatusOK)
		}
		flusher.Flush()
	}
}

func (w *localUISecurityResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	w.apply()
	return hijacker.Hijack()
}

func (w *localUISecurityResponseWriter) Push(target string, opts *http.PushOptions) error {
	if pusher, ok := w.ResponseWriter.(http.Pusher); ok {
		return pusher.Push(target, opts)
	}
	return http.ErrNotSupported
}

func (w *localUISecurityResponseWriter) ReadFrom(r io.Reader) (int64, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if readerFrom, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return readerFrom.ReadFrom(r)
	}
	return io.Copy(struct{ io.Writer }{w.ResponseWriter}, r)
}

func strictSameOriginWSRequest(r *http.Request, requireOrigin bool) bool {
	if r == nil {
		return false
	}
	expected, err := canonicalLoopbackAuthority(r.Host)
	if err != nil {
		return false
	}
	originRaw := strings.TrimSpace(r.Header.Get("Origin"))
	if originRaw == "" {
		return !requireOrigin
	}
	origin, err := url.Parse(originRaw)
	if err != nil || origin == nil || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		return false
	}
	expectedScheme := "http"
	if r.TLS != nil {
		expectedScheme = "https"
	}
	if !strings.EqualFold(strings.TrimSpace(origin.Scheme), expectedScheme) {
		return false
	}
	actual, err := canonicalLoopbackAuthority(origin.Host)
	return err == nil && actual == expected
}

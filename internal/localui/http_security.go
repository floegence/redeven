package localui

import (
	"bufio"
	"context"
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
	resolver := s.resolveAccessHosts
	if resolver == nil {
		resolver = resolveNetworkAccessHosts
	}
	accessHosts, err := resolver(s.bind)
	if err != nil {
		return err
	}
	if s.bind.IsNetworkExposure() && len(accessHosts) == 0 {
		return fmt.Errorf("no active non-loopback unicast address is available for %s", s.bind.ListenLabel())
	}

	allowed := make(map[string]struct{}, len(listeners)+len(accessHosts))
	displayURLs := make([]string, 0, len(accessHosts))
	for _, listener := range listeners {
		if listener == nil {
			return fmt.Errorf("missing Local UI listener")
		}
		addr, ok := listener.Addr().(*net.TCPAddr)
		if !ok || addr == nil || addr.IP == nil {
			return fmt.Errorf("Local UI listener must use a TCP address")
		}
		parsedAddr, err := netip.ParseAddr(addr.IP.String())
		if err != nil || addr.Port <= 0 || addr.Zone != "" || parsedAddr.Is4In6() {
			return fmt.Errorf("Local UI listener has an invalid TCP address")
		}
		if s.bind.IsLoopbackOnly() {
			if !parsedAddr.IsLoopback() {
				return fmt.Errorf("loopback Local UI bind resolved to a non-loopback listener")
			}
			host := parsedAddr.String()
			allowed[net.JoinHostPort(host, strconv.Itoa(addr.Port))] = struct{}{}
			if s.bind.localhost {
				allowed[net.JoinHostPort("localhost", strconv.Itoa(addr.Port))] = struct{}{}
			}
			continue
		}
		if s.bind.IsWildcard() {
			if !parsedAddr.IsUnspecified() {
				return fmt.Errorf("wildcard Local UI bind resolved to a non-wildcard listener")
			}
		} else if parsedAddr.String() != s.bind.Host() {
			return fmt.Errorf("Local UI listener address %s does not match bind %s", parsedAddr, s.bind.Host())
		}
		for _, host := range accessHosts {
			authority := net.JoinHostPort(host.String(), strconv.Itoa(addr.Port))
			allowed[authority] = struct{}{}
			displayURLs = append(displayURLs, formatHTTPURL(host.String(), addr.Port))
		}
	}
	if len(allowed) == 0 {
		return fmt.Errorf("missing Local UI authorities")
	}
	s.authorityMu.Lock()
	s.networkAuthorities = allowed
	s.displayURLs = dedupeStrings(displayURLs)
	s.authorityMu.Unlock()
	return nil
}

func canonicalLocalUIAuthority(raw string) (string, error) {
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
		return "", fmt.Errorf("authority host must be an IP literal")
	}
	if addr.Zone() != "" || addr.Is4In6() || addr.IsUnspecified() || addr.IsMulticast() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
		return "", fmt.Errorf("invalid authority host")
	}
	if !addr.IsLoopback() && !eligibleNetworkAccessAddress(addr) {
		return "", fmt.Errorf("invalid authority host")
	}
	return net.JoinHostPort(addr.String(), strconv.Itoa(port)), nil
}

func canonicalLoopbackAuthority(raw string) (string, error) {
	canonical, err := canonicalLocalUIAuthority(raw)
	if err != nil {
		return "", err
	}
	host, _, err := net.SplitHostPort(canonical)
	if err != nil || strings.EqualFold(host, "localhost") {
		return canonical, err
	}
	addr, err := netip.ParseAddr(host)
	if err != nil || !addr.IsLoopback() {
		return "", fmt.Errorf("authority host must be loopback")
	}
	return canonical, nil
}

func (s *Server) isAllowedNetworkAuthority(raw string) bool {
	canonical, err := canonicalLocalUIAuthority(raw)
	if err != nil || s == nil {
		return false
	}
	s.authorityMu.RLock()
	_, allowed := s.networkAuthorities[canonical]
	s.authorityMu.RUnlock()
	return allowed
}

type localUIRequestTrustKey struct{}

func withTrustedLocalUIBridge(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), localUIRequestTrustKey{}, true))
}

func isTrustedLocalUIBridge(r *http.Request) bool {
	trusted, _ := r.Context().Value(localUIRequestTrustKey{}).(bool)
	return trusted
}

func (s *Server) isTrustedOrAllowedAuthority(r *http.Request) bool {
	if r == nil || s == nil {
		return false
	}
	if isTrustedLocalUIBridge(r) {
		_, err := canonicalLoopbackAuthority(r.Host)
		return err == nil
	}
	s.authorityMu.RLock()
	configured := len(s.networkAuthorities) > 0
	s.authorityMu.RUnlock()
	if configured {
		return s.isAllowedNetworkAuthority(r.Host)
	}
	// Direct handler use is limited to in-process tests and trusted embeddings.
	// Public listeners always install networkHandler after configuring authorities.
	_, err := canonicalLocalUIAuthority(r.Host)
	return err == nil
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
	expected, err := canonicalLocalUIAuthority(r.Host)
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
	actual, err := canonicalLocalUIAuthority(origin.Host)
	return err == nil && actual == expected
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

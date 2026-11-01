package hostnetwork

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
)

func clearProxyEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"} {
		previous, exists := os.LookupEnv(key)
		if err := os.Unsetenv(key); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if exists {
				_ = os.Setenv(key, previous)
			} else {
				_ = os.Unsetenv(key)
			}
		})
	}
}
func directTransport(config *tls.Config) *Transport {
	tr := NewTransport(config)
	tr.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{nil}, nil }
	return tr
}
func TestAuthorizedWriteUsesBodyAndTLS(t *testing.T) {
	clearProxyEnvironment(t)
	var calls atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil || r.Method != "POST" || string(body) != "write content" {
			t.Errorf("write %s %q %v", r.Method, body, err)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	tr := directTransport(&tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12})
	defer tr.CloseIdleConnections()
	req, _ := http.NewRequest("POST", server.URL, strings.NewReader("write content"))
	response, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusCreated || calls.Load() != 1 {
		t.Fatalf("status %d calls %d", response.StatusCode, calls.Load())
	}
}
func TestUnknownWriteOutcomeNeverReplays(t *testing.T) {
	clearProxyEnvironment(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close()
	}))
	defer server.Close()
	tr := directTransport(nil)
	defer tr.CloseIdleConnections()
	tr.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{nil, nil}, nil }
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		before := calls.Load()
		req, _ := http.NewRequest(method, server.URL, strings.NewReader("mutation"))
		req.Header.Set("Idempotency-Key", "caller-key")
		if _, err := tr.RoundTrip(req); err == nil {
			t.Fatal("missing unknown outcome")
		}
		if got := calls.Load() - before; got != 1 {
			t.Fatalf("%s sent %d times", method, got)
		}
	}
}
func TestTLSFailureNeverChangesRoute(t *testing.T) {
	clearProxyEnvironment(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("untrusted TLS reached handler") }))
	defer server.Close()
	tr := directTransport(nil)
	defer tr.CloseIdleConnections()
	tr.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{nil, nil}, nil }
	var dials atomic.Int32
	tr.base.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		dials.Add(1)
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}
	req, _ := http.NewRequest("GET", server.URL, nil)
	if _, err := tr.RoundTrip(req); err == nil {
		t.Fatal("untrusted certificate accepted")
	}
	if dials.Load() != 1 {
		t.Fatalf("TLS failure advanced routes: %d", dials.Load())
	}
}
func TestProxyCredentialsDoNotReachOrigin(t *testing.T) {
	clearProxyEnvironment(t)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") != "" {
			t.Error("proxy credential leaked")
		}
		_, _ = io.WriteString(w, "origin")
	}))
	defer origin.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") == "" {
			t.Error("configured proxy credential missing")
		}
		http.Redirect(w, r, origin.URL, http.StatusFound)
	}))
	defer proxy.Close()
	proxyURL, _ := url.Parse(proxy.URL)
	proxyURL.User = url.UserPassword("configured-user", "configured-password")
	tr := directTransport(nil)
	defer tr.CloseIdleConnections()
	tr.resolve = func(_ context.Context, target *url.URL) ([]*url.URL, error) {
		if target.Host == strings.TrimPrefix(origin.URL, "http://") {
			return []*url.URL{nil}, nil
		}
		return []*url.URL{proxyURL}, nil
	}
	request, _ := http.NewRequest("GET", "http://source.example/package", nil)
	response, err := tr.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusFound || request.Header.Get("Proxy-Authorization") != "" {
		t.Fatal("transport changed caller request or followed redirect")
	}
	next, _ := http.NewRequest("GET", origin.URL, nil)
	response, err = tr.RoundTrip(next)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
}

func TestReadAndWriteShareBoundedInFlightLimit(t *testing.T) {
	clearProxyEnvironment(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "body") }))
	defer server.Close()
	tr := directTransport(nil)
	defer tr.CloseIdleConnections()
	responses := make([]*http.Response, 0, 8)
	defer func() {
		for _, response := range responses {
			_ = response.Body.Close()
		}
	}()
	for i := 0; i < 8; i++ {
		method := http.MethodGet
		if i%2 == 1 {
			method = http.MethodPost
		}
		req, _ := http.NewRequest(method, server.URL, nil)
		response, err := tr.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		responses = append(responses, response)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	blocked, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if _, err := tr.RoundTrip(blocked); err != context.Canceled {
		t.Fatalf("limit cancel %v", err)
	}
	_ = responses[0].Body.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	response, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
}

func TestHTTPSConnectProxyPreservesTLSAndCredentialBoundary(t *testing.T) {
	clearProxyEnvironment(t)
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Proxy-Authorization") != "" {
			t.Error("CONNECT credential reached origin")
		}
		_, _ = io.WriteString(w, "secure origin")
	}))
	defer origin.Close()
	var connects atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connects.Add(1)
		if r.Method != http.MethodConnect || r.Header.Get("Proxy-Authorization") != "Basic dXNlcjpwYXNz" {
			t.Error("missing configured CONNECT credential")
			w.WriteHeader(407)
			return
		}
		upstream, err := net.Dial("tcp", r.Host)
		if err != nil {
			t.Error(err)
			w.WriteHeader(502)
			return
		}
		client, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			_ = upstream.Close()
			t.Error(err)
			return
		}
		_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
		go func() { defer client.Close(); defer upstream.Close(); _, _ = io.Copy(client, upstream) }()
		go func() { defer client.Close(); defer upstream.Close(); _, _ = io.Copy(upstream, client) }()
	}))
	defer proxy.Close()
	roots := x509.NewCertPool()
	roots.AddCert(origin.Certificate())
	tr := directTransport(&tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12})
	defer tr.CloseIdleConnections()
	proxyURL, _ := url.Parse(proxy.URL)
	proxyURL.User = url.UserPassword("user", "pass")
	tr.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{proxyURL}, nil }
	request, _ := http.NewRequest(http.MethodGet, origin.URL, nil)
	response, err := tr.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || string(body) != "secure origin" || connects.Load() != 1 {
		t.Fatalf("CONNECT body=%q count=%d error=%v", body, connects.Load(), err)
	}
}

func TestTLSProxyDoesNotReceiveOriginClientIdentity(t *testing.T) {
	clearProxyEnvironment(t)
	var originRequests, proxyRequests atomic.Int32
	origin := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		originRequests.Add(1)
		if len(r.TLS.PeerCertificates) != 1 {
			t.Error("origin client identity missing")
		}
		_, _ = io.WriteString(w, "origin identity")
	}))
	origin.TLS = &tls.Config{ClientAuth: tls.RequestClientCert}
	origin.StartTLS()
	defer origin.Close()
	proxy := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyRequests.Add(1)
		if len(r.TLS.PeerCertificates) != 0 {
			t.Error("origin client identity leaked to proxy")
		}
		if r.Method != http.MethodConnect {
			t.Error("missing CONNECT")
			w.WriteHeader(400)
			return
		}
		upstream, err := net.Dial("tcp", r.Host)
		if err != nil {
			t.Error(err)
			w.WriteHeader(502)
			return
		}
		client, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			_ = upstream.Close()
			t.Error(err)
			return
		}
		_, _ = io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n")
		go func() { defer client.Close(); defer upstream.Close(); _, _ = io.Copy(client, upstream) }()
		go func() { defer client.Close(); defer upstream.Close(); _, _ = io.Copy(upstream, client) }()
	}))
	proxy.TLS = &tls.Config{ClientAuth: tls.RequestClientCert}
	proxy.StartTLS()
	defer proxy.Close()
	roots := x509.NewCertPool()
	roots.AddCert(origin.Certificate())
	tr := directTransport(&tls.Config{RootCAs: roots, Certificates: origin.TLS.Certificates, ServerName: "example.com", MinVersion: tls.VersionTLS12})
	defer tr.CloseIdleConnections()
	proxyRoots := x509.NewCertPool()
	proxyRoots.AddCert(proxy.Certificate())
	configureTLS(tr.base, &tls.Config{RootCAs: proxyRoots, MinVersion: tls.VersionTLS12})
	proxyURL, _ := url.Parse(proxy.URL)
	tr.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{proxyURL}, nil }
	request, _ := http.NewRequest(http.MethodGet, origin.URL, nil)
	response, err := tr.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || originRequests.Load() != 1 || proxyRequests.Load() != 1 {
		t.Fatalf("origin %d proxy %d error %v", originRequests.Load(), proxyRequests.Load(), err)
	}
}

package hostnetwork

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"

	"testing"
)

func TestEnvironmentProxyPolicy(t *testing.T) {
	target, _ := url.Parse("https://repo.corp/package")
	cases := []struct {
		name     string
		env      map[string]string
		selected bool
		want     string
	}{
		{"system", map[string]string{}, false, ""},
		{"explicit-direct", map[string]string{"HTTPS_PROXY": ""}, true, ""},
		{"explicit-direct-over-all", map[string]string{"HTTPS_PROXY": "", "ALL_PROXY": "http://proxy.example:8080"}, true, ""},
		{"lowercase", map[string]string{"https_proxy": "http://proxy.example:8080"}, true, "http://proxy.example:8080"},
		{"ipv6", map[string]string{"HTTPS_PROXY": "http://[::1]:8080"}, true, "http://[::1]:8080"},
		{"cidr-bypass", map[string]string{"HTTPS_PROXY": "http://proxy.example:8080", "NO_PROXY": "repo.corp"}, true, ""},
		{"https", map[string]string{"HTTPS_PROXY": "http://proxy.example:8080"}, true, "http://proxy.example:8080"},
		{"socks", map[string]string{"ALL_PROXY": "socks5h://proxy.example:1080"}, true, "socks5h://proxy.example:1080"},
		{"bypass", map[string]string{"HTTPS_PROXY": "http://proxy.example:8080", "NO_PROXY": ".corp"}, true, ""},
		{"bypass-system", map[string]string{"NO_PROXY": ".corp"}, true, ""},
		{"unrelated-bypass", map[string]string{"NO_PROXY": ".other"}, false, ""},
		{"bypass-unused-malformed-proxy", map[string]string{"HTTPS_PROXY": "http://bad proxy:8080", "NO_PROXY": ".corp"}, true, ""},
		{"proxy-root-path", map[string]string{"HTTPS_PROXY": "http://proxy.example:8080/"}, true, "http://proxy.example:8080/"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			routes, selected, err := environmentRoutes(target, func(key string) (string, bool) { value, ok := tt.env[key]; return value, ok })
			if err != nil || selected != tt.selected {
				t.Fatalf("selected %v error %v", selected, err)
			}
			got := ""
			if len(routes) > 0 && routes[0] != nil {
				got = routes[0].String()
			}
			if got != tt.want {
				t.Fatalf("proxy %s want %s", got, tt.want)
			}
		})
	}
}
func TestConfiguredRouteOrderAndNoInventedFallback(t *testing.T) {
	clearProxyEnvironment(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "host bytes") }))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	blocked, _ := url.Parse("http://127.0.0.1:1")
	transport := NewTransport(nil)
	defer transport.CloseIdleConnections()
	transport.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{blocked}, nil }
	req, _ := http.NewRequest("GET", target.String(), nil)
	if _, err := transport.RoundTrip(req); err == nil {
		t.Fatal("invented direct fallback")
	}
	transport.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{blocked, nil}, nil }
	response, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || string(body) != "host bytes" {
		t.Fatalf("download %q %v", body, err)
	}
	unavailable := errors.New("proxy configuration unavailable")
	transport.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return nil, unavailable }
	if _, err := transport.RoundTrip(req); !errors.Is(err, unavailable) {
		t.Fatalf("resolution error %v", err)
	}
}
func TestHostTransportCancellationAndRedirect(t *testing.T) {
	clearProxyEnvironment(t)
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { count++; http.Redirect(w, r, "/other", http.StatusFound) }))
	defer server.Close()
	transport := NewTransport(nil)
	defer transport.CloseIdleConnections()
	transport.resolve = func(context.Context, *url.URL) ([]*url.URL, error) { return []*url.URL{nil}, nil }
	req, _ := http.NewRequest("GET", server.URL, nil)
	response, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 302 || count != 1 {
		t.Fatal("transport followed redirect")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := transport.RoundTrip(req.WithContext(ctx)); err != context.Canceled {
		t.Fatalf("cancel %v", err)
	}

}

func TestMalformedProxyDoesNotSilentlyUseDirectRoute(t *testing.T) {
	target, _ := url.Parse("https://repo.corp/package")
	for _, value := range []string{"http://bad proxy:8080", "http://proxy.example:99999", "ftp://proxy.example:21"} {
		_, selected, err := environmentRoutes(target, func(key string) (string, bool) {
			if key == "HTTPS_PROXY" {
				return value, true
			}
			return "", false
		})
		if !selected || err == nil {
			t.Fatalf("malformed proxy silently accepted %q", value)
		}
	}
}

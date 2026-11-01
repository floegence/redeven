package hostnetwork

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

func configJSON(value map[string]any) string { b, _ := json.Marshal(value); return string(b) }
func TestNativeProxyConfiguration(t *testing.T) {
	target, _ := url.Parse("https://github.com/example")
	tests := []struct {
		name   string
		config map[string]any
		want   string
	}{
		{"direct", map[string]any{}, ""},
		{"static", map[string]any{"HTTPSEnable": 1, "HTTPSProxy": "proxy.example", "HTTPSPort": 8443}, "http://proxy.example:8443"},
		{"bypass", map[string]any{"HTTPSEnable": 1, "HTTPSProxy": "proxy.example", "HTTPSPort": 8443, "ExceptionsList": []string{"*.com"}}, ""},
		{"socks", map[string]any{"SOCKSEnable": 1, "SOCKSProxy": "proxy.example", "SOCKSPort": 1080}, "socks5://proxy.example:1080"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			routes, err := systemProxies(context.Background(), target, configJSON(tt.config))
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if len(routes) > 0 && routes[0] != nil {
				got = routes[0].String()
			}
			if len(routes) != 1 || got != tt.want {
				t.Fatalf("routes %v want %s", routes, tt.want)
			}
		})
	}
}
func TestNativePACOrderAndCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ns-proxy-autoconfig")
		io.WriteString(w, "function FindProxyForURL(url, host) { return 'PROXY proxy.example:8080; SOCKS socks.example:1080; DIRECT'; }")
	}))
	defer server.Close()
	config := configJSON(map[string]any{"ProxyAutoConfigEnable": 1, "ProxyAutoConfigURLString": server.URL})
	target, _ := url.Parse("https://github.com/example")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	routes, err := systemProxies(ctx, target, config)
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) < 3 || routes[0].String() != "http://proxy.example:8080" || routes[1].String() != "socks5://socks.example:1080" || routes[2] != nil {
		t.Fatalf("routes %v", routes)
	}
	cancelled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	if _, err := systemProxies(cancelled, target, config); err != context.Canceled {
		t.Fatalf("cancel %v", err)
	}
}
func TestCurrentSystemNetwork(t *testing.T) {
	if os.Getenv("REDEVEN_NETWORK_LIVE_TEST") != "1" {
		t.Skip("explicit live network qualification")
	}
	transport := NewTransport(nil)
	defer transport.CloseIdleConnections()
	for _, target := range []string{
		"https://api.open-meteo.com/v1/forecast?latitude=31.23&longitude=121.47&current=temperature_2m,weather_code",
		"https://geocoding-api.open-meteo.com/v1/search?name=Shanghai&count=1",
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		response, err := transport.RoundTrip(request)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		_ = response.Body.Close()
		cancel()
		if err != nil || response.StatusCode != http.StatusOK || !json.Valid(body) {
			t.Fatalf("weather status %d bytes %d error %v", response.StatusCode, len(body), err)
		}
		t.Logf("%s status=%d JSON bytes=%d", request.URL.Hostname(), response.StatusCode, len(body))
	}
}

func TestNativePACCancellationDuringResolution(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	defer close(release)
	config := configJSON(map[string]any{"ProxyAutoConfigEnable": 1, "ProxyAutoConfigURLString": server.URL + "/slow"})
	target, _ := url.Parse("https://github.com/cancel")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := systemProxies(ctx, target, config); done <- err }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("PAC did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatalf("cancel error %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("PAC cancellation blocked")
	}
}
func TestNativeProxyConfigurationRefresh(t *testing.T) {
	target, _ := url.Parse("https://github.com/example")
	for _, port := range []int{8081, 8082} {
		routes, err := systemProxies(context.Background(), target, configJSON(map[string]any{"HTTPSEnable": 1, "HTTPSProxy": "proxy.example", "HTTPSPort": port}))
		if err != nil || len(routes) != 1 || routes[0].Port() != fmt.Sprint(port) {
			t.Fatalf("stale proxy configuration: %v %v", routes, err)
		}
	}
}

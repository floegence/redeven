package pluginmarket

import (
	"net/http"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/hostnetwork"
)

type closeTrackingTransport struct{ closed int }

func (*closeTrackingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	panic("construction must not perform network I/O")
}
func (transport *closeTrackingTransport) CloseIdleConnections() { transport.closed++ }

func TestDefaultMarketTransportUsesHostNetworkWithoutStartupIO(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	service, err := NewService(ServiceOptions{CachePath: filepath.Join(t.TempDir(), "market.json")})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := service.httpClient.Transport.(*hostnetwork.Transport); !ok {
		t.Fatalf("default transport %T", service.httpClient.Transport)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestMarketClosePreservesCallerOwnedClient(t *testing.T) {
	transport := &closeTrackingTransport{}
	service, err := NewService(ServiceOptions{CachePath: filepath.Join(t.TempDir(), "market.json"), HTTPClient: &http.Client{Transport: transport}})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if transport.closed != 0 {
		t.Fatal("closed caller-owned transport")
	}
}

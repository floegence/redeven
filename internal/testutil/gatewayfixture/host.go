package gatewayfixture

import (
	"context"
	"crypto/rand"
	"io"
	"net"
	"net/http"
	"testing"
)

// HostHandler sends fixture administration through the real private listener.
func HostHandler(t *testing.T, socket string) http.Handler {
	t.Helper()
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	t.Cleanup(transport.CloseIdleConnections)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := r.Clone(r.Context())
		request.URL.Scheme = "http"
		request.URL.Host = "gateway-host"
		request.RequestURI = ""
		request.Header.Set("X-Redeven-Operation-ID", rand.Text())
		response, err := transport.RoundTrip(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		for k, v := range response.Header {
			w.Header()[k] = v
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	})
}

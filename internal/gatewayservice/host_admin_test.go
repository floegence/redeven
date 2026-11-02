package gatewayservice

import (
	"context"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHostAdministrationRequiresPrivateSocketAndCredential(t *testing.T) {
	token := strings.Repeat("a", 43)
	server, err := New(Options{StateRoot: t.TempDir(), HostAdminToken: token, PublicURL: "https://gateway.internal:7443", DesktopBridgeTransport: true, ManagedBridgeToken: "desktop-bridge-secret"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, remote, token, origin string
		want                        int
	}{
		{"local without credential", "127.0.0.1:21000", "", "", http.StatusUnauthorized},
		{"bridge token is not administrator", "127.0.0.1:21000", "desktop-bridge-secret", "", http.StatusUnauthorized},
		{"remote with credential", "192.0.2.1:21000", token, "", http.StatusUnauthorized},
		{"browser with credential", "127.0.0.1:21000", token, "https://malicious.example", http.StatusForbidden},
		{"loopback with credential is not host", "127.0.0.1:21000", token, "", http.StatusUnauthorized},
		{"socket administrator", "@", token, "", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "http://localhost/gateway/v6/invitation-codes", strings.NewReader(`{"protocol_version":"redeven-gateway-v6"}`))
			request.RemoteAddr = tc.remote
			if tc.remote == "@" {
				request = request.WithContext(context.WithValue(request.Context(), hostSocketKey{}, server))
			}
			request.Header.Set(HostAdminHeader, tc.token)
			request.Header.Set(OperationIDHeader, rand.Text())
			request.Header.Set("Origin", tc.origin)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("status %d, want %d", response.Code, tc.want)
			}
		})
	}
}

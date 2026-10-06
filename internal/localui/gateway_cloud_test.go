package localui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayCloudJoinRequiresTrustedRuntimeControl(t *testing.T) {
	s := &runtimeControlServer{token: "private-control-token"}
	for _, tc := range []struct {
		name, remote, auth, origin, method, body string
		status                                   int
	}{
		{"no_token", "127.0.0.1:2000", "", "", "POST", "{}", http.StatusUnauthorized},
		{"remote", "192.0.2.2:2000", "Bearer private-control-token", "", "POST", "{}", http.StatusForbidden},
		{"browser_origin", "127.0.0.1:2000", "Bearer private-control-token", "https://untrusted.example", "POST", "{}", http.StatusForbidden},
		{"method", "127.0.0.1:2000", "Bearer private-control-token", "", "GET", "", http.StatusMethodNotAllowed},
		{"unknown_field", "127.0.0.1:2000", "Bearer private-control-token", "", "POST", "{\"automatic_consent\":true}", http.StatusBadRequest},
		{"trailing_json", "127.0.0.1:2000", "Bearer private-control-token", "", "POST", "{}{}", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "http://127.0.0.1:1234/v2/gateway-cloud/join", strings.NewReader(tc.body))
			req.RemoteAddr = tc.remote
			req.Header.Set("Authorization", tc.auth)
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("X-Redeven-Runtime-Control-Protocol", runtimeControlProtocolVersion)
			response := httptest.NewRecorder()
			s.routes().ServeHTTP(response, req)
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d", response.Code, tc.status)
			}
		})
	}
}

package localui

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/codeapp/appserver"
)

func TestTessivenControlRequiresOwnerAndStrictPayload(t *testing.T) {
	control := &runtimeControlServer{token: "fixture-owner", appServer: &appserver.Server{}}
	for _, tc := range []struct {
		name, remote, token, body string
		status                    int
	}{
		{"remote transport", "198.51.100.2:1234", "fixture-owner", `{}`, 403},
		{"missing owner", "127.0.0.1:1234", "", `{}`, 401},
		{"unknown field", "127.0.0.1:1234", "fixture-owner", `{"request":{"runtime_ref":"ssh:fixture","action":"inspect","command":"forbidden"}}`, 400},
		{"multiple values", "127.0.0.1:1234", "fixture-owner", `{} {}`, 400},
		{"bounded body", "127.0.0.1:1234", "fixture-owner", strings.Repeat(" ", 65537) + `{}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "http://localhost/v2/tessiven/resources", strings.NewReader(tc.body))
			req.RemoteAddr = tc.remote
			req.Header.Set("Authorization", "Bearer "+tc.token)
			response := httptest.NewRecorder()
			control.handleTessivenTarget(response, req)
			if response.Code != tc.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
func TestTessivenHostRejectsCrossOriginUpgrade(t *testing.T) {
	control := &runtimeControlServer{token: "fixture-owner", appServer: &appserver.Server{}}
	req := httptest.NewRequest(http.MethodGet, "http://localhost/v2/tessiven/host", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	for key, value := range map[string]string{
		"Authorization":         "Bearer fixture-owner",
		"Origin":                "https://untrusted.example",
		"Connection":            "Upgrade",
		"Upgrade":               "websocket",
		"Sec-WebSocket-Version": "13",
		"Sec-WebSocket-Key":     base64.StdEncoding.EncodeToString([]byte("tessiven fixture")),
	} {
		req.Header.Set(key, value)
	}
	response := httptest.NewRecorder()
	control.handleTessivenHost(response, req)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin owner bridge admitted: %d", response.Code)
	}
}

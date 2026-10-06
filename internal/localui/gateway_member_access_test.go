package localui

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/gatewaymembership"
)

func TestGatewayMemberOriginRemainsPublicAndPasswordProtected(t *testing.T) {
	service, _, err := gatewaymembership.NewServiceCertificate("runtime_test")
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "secret"}))
	if err := s.configureAcceptor(); err != nil {
		t.Fatal(err)
	}
	handler := s.gatewayMemberApplication(service.Origin).Handler
	for _, test := range []struct {
		path, origin, body string
		status             int
	}{
		{"/api/local/runtime", "", "", http.StatusLocked},
		{"/v2/gateway/join", service.Origin, `{}`, http.StatusNotFound},
		{"/api/local/access/unlock", "https://attacker.invalid", `{"password":"secret"}`, http.StatusForbidden},
		{"/api/local/access/unlock", service.Origin, `{"password":"wrong"}`, http.StatusUnauthorized},
		{"/api/local/access/unlock", service.Origin, `{"password":"secret"}`, http.StatusOK},
	} {
		t.Run(test.path+test.origin+test.body, func(t *testing.T) {
			method := http.MethodGet
			if test.body != "" {
				method = http.MethodPost
			}
			request := httptest.NewRequest(method, service.Origin+test.path, strings.NewReader(test.body))
			request.TLS = &tls.ConnectionState{}
			request.Header.Set("Origin", test.origin)
			request.Header.Set("X-Redeven-Desktop-Bridge-Token", "untrusted")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.status, response.Body.String())
			}
			if test.status == http.StatusOK && len(response.Result().Cookies()) == 0 {
				t.Fatal("member origin did not receive the normal access cookie")
			}
		})
	}
	request := httptest.NewRequest(http.MethodGet, service.Origin+"/", nil)
	request.TLS = &tls.ConnectionState{}
	request.Host = "attacker.invalid"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusMisdirectedRequest {
		t.Fatal("member accepted another Host")
	}
}

func TestGatewayMemberWebSocketRequiresExactOrigin(t *testing.T) {
	service, _, err := gatewaymembership.NewServiceCertificate("runtime_test")
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{service.Origin, "", "https://attacker.invalid", service.Origin + ".attacker.invalid"} {
		request := httptest.NewRequest(http.MethodGet, service.Origin+"/direct", nil)
		request.TLS = &tls.ConnectionState{}
		request = request.WithContext(context.WithValue(request.Context(), gatewayMemberOriginKey{}, service.Origin))
		request.Header.Set("Origin", origin)
		if strictSameOriginWSRequest(request, true) != (origin == service.Origin) {
			t.Fatalf("incorrect origin admission for %q", origin)
		}
		if isTrustedLocalUIBridge(request) {
			t.Fatal("reverse request escalated to trusted Desktop")
		}
	}
}

func TestGatewayOnlyApplicationOpensNoTCPListeners(t *testing.T) {
	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "secret"}))
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.StartGatewayOnly(ctx); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Port() != 0 || len(s.listeners) != 0 || s.desktopBridgeListener != nil || s.runtimeControl == nil || s.runtimeControl.ln != nil || s.LocalUIBridgeTokenForDesktop() != "" {
		t.Fatal("member application opened a public or trusted management listener")
	}
	service, _, err := gatewaymembership.NewServiceCertificate("runtime_test")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, service.Origin+"/api/local/runtime", nil)
	request.TLS = &tls.ConnectionState{}
	response := httptest.NewRecorder()
	s.gatewayMemberApplication(service.Origin).Handler.ServeHTTP(response, request)
	if response.Code != http.StatusLocked {
		t.Fatalf("member application bypassed password: %d", response.Code)
	}
}

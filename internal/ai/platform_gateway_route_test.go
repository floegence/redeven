package ai

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPlatformGatewayExplicitRouteCoversEveryRequestAndNeverFallsBack(t *testing.T) {
	var directCalls atomic.Int32
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		directCalls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer direct.Close()
	var routeErr error
	var routedCalls int
	var route http.RoundTripper = platformRouteTestTransport(func(request *http.Request) (*http.Response, error) {
		routedCalls++
		if request.URL.Scheme+"://"+request.URL.Host != direct.URL || request.Header.Get("Authorization") == "" {
			t.Error("explicit route lost the original target or authorization")
		}
		body := `{}`
		switch request.URL.Path {
		case "/api/ai/v1/catalog":
			body = `{"models":[]}`
		case "/api/ai/v1/leases/renew":
			body = `{"token":"renewed","renewal_token":"renewal","expires_at_unix":4102444800,"entitlement_version":1}`
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})
	gateway, err := platformGatewayWithTransport(func() (http.RoundTripper, error) { return route, routeErr }, direct.URL, "grant", "model", 1)
	if err != nil {
		t.Fatal(err)
	}
	p := gateway.(*platformGatewayProvider)
	operations := map[string]func() error{
		"catalog": func() error { _, err := p.catalog(t.Context()); return err },
		"lease":   func() error { return p.renew(t.Context()) },
		"inference": func() error {
			request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, direct.URL+"/v1/responses", strings.NewReader(`{"model":"model"}`))
			if err != nil {
				return err
			}
			response, err := (platformRequestTransport{provider: p, request: platformTestRequest()}).RoundTrip(request)
			if response != nil {
				_ = response.Body.Close()
			}
			return err
		},
	}
	for name, operation := range operations {
		if err := operation(); err != nil {
			t.Fatalf("%s failed on approved route: %v", name, err)
		}
	}
	if routedCalls != len(operations) {
		t.Fatal("a platform request bypassed the explicit route")
	}
	// The same provider must re-evaluate current route authority per request.
	for _, denied := range []error{errors.New("gateway revoked"), nil} {
		route, routeErr = nil, denied
		for name, operation := range operations {
			if err := operation(); err == nil {
				t.Errorf("%s accepted a missing or revoked route", name)
			}
		}
	}
	if directCalls.Load() != 0 || routedCalls != len(operations) {
		t.Fatal("revoked platform route fell back or reused an old transport")
	}
}

type platformRouteTestTransport func(*http.Request) (*http.Response, error)

func (f platformRouteTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

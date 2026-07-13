package config

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNormalizeControlplaneBaseURLRequiresHTTPSOrigin(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{
		"http://provider.example",
		"ws://provider.example",
		"https://user@provider.example",
		"https://provider.example/path",
		"https://provider.example?token=value",
		"https://provider.example/#fragment",
	} {
		if got, err := normalizeControlplaneBaseURL(raw); err == nil {
			t.Fatalf("normalizeControlplaneBaseURL(%q) = %q, want rejection", raw, got)
		}
	}

	got, err := normalizeControlplaneBaseURL(" HTTPS://Provider.Example:443/ ")
	if err != nil {
		t.Fatalf("normalizeControlplaneBaseURL() error = %v", err)
	}
	if got != "https://provider.example:443" {
		t.Fatalf("normalized URL = %q", got)
	}
}

func TestBootstrapRedirectCannotChangeOriginOrForwardTicket(t *testing.T) {
	t.Parallel()

	var redirectedRequests atomic.Int32
	destination := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirectedRequests.Add(1)
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("redirected request leaked Authorization: %q", auth)
		}
		http.Error(w, "unexpected redirected request", http.StatusInternalServerError)
	}))
	defer destination.Close()

	source := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	_, err := ResolveProviderLinkConfig(context.Background(), ProviderLinkBootstrapArgs{
		ConfigPath:          t.TempDir() + "/config.json",
		ProviderOrigin:      "https://provider.example",
		ControlplaneBaseURL: source.URL,
		EnvironmentID:       "env_test",
		BootstrapTicket:     "ticket-secret",
		HTTPClient:          source.Client(),
		RuntimeHostname:     "test-host",
		RuntimeGOOS:         "test-os",
		RuntimeGOARCH:       "test-arch",
	})
	if err == nil || !strings.Contains(err.Error(), "bootstrap redirect changed origin") {
		t.Fatalf("ResolveProviderLinkConfig() error = %v", err)
	}
	if got := redirectedRequests.Load(); got != 0 {
		t.Fatalf("cross-origin redirect requests = %d, want 0", got)
	}
}

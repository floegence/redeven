package localui

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestServer_handleFavicon_redirect(t *testing.T) {
	s := &Server{}

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/favicon.ico", nil)
	w := httptest.NewRecorder()
	s.handleFavicon(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if loc := res.Header.Get("Location"); loc != "/_redeven_proxy/env/favicon.svg" {
		t.Fatalf("location = %q, want %q", loc, "/_redeven_proxy/env/favicon.svg")
	}
}

func TestServer_handleLogo_redirect(t *testing.T) {
	s := &Server{}

	r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/logo.png", nil)
	w := httptest.NewRecorder()
	s.handleLogo(w, r)

	res := w.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", res.StatusCode, http.StatusFound)
	}
	if loc := res.Header.Get("Location"); loc != "/_redeven_proxy/env/logo.png" {
		t.Fatalf("location = %q, want %q", loc, "/_redeven_proxy/env/logo.png")
	}
}

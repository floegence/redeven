package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCapacityHTTPWorkloadUsesRefreshedCookie(t *testing.T) {
	cookiePath := filepath.Join(t.TempDir(), "cookie.txt")
	if err := os.WriteFile(cookiePath, []byte("session=first"), 0600); err != nil {
		t.Fatal(err)
	}
	observed := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case observed <- r.Header.Get("Cookie"):
		default:
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		capacityHTTPWorkload(ctx, capacityHTTP{Name: "environment_query", URL: server.URL, Method: http.MethodGet, RPS: 20, CookieFile: cookiePath}, nil, &capacityMetrics{})
	}()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("workload did not stop")
		}
	}()
	select {
	case cookie := <-observed:
		if cookie != "session=first" {
			t.Fatalf("initial cookie = %q", cookie)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no initial request")
	}
	replacement := cookiePath + ".next"
	if err := os.WriteFile(replacement, []byte("session=refreshed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(replacement, cookiePath); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case cookie := <-observed:
			if cookie == "session=refreshed" {
				return
			}
		case <-deadline.C:
			t.Fatal("workload retained an expired session cookie")
		}
	}
}

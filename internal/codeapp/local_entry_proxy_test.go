package codeapp

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLocalEntryProxyManager_StripsPWAServiceWorkerAllowedHeaderOnly(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Service-Worker-Allowed", "/")
		if strings.HasSuffix(strings.TrimSpace(r.URL.Path), codeServerPWASWSuffix) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("pwa-sw"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("normal"))
	}))
	t.Cleanup(backend.Close)

	u, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("url.Parse backend: %v", err)
	}
	backendPort, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("backend port: %v", err)
	}

	mgr := newLocalEntryProxyManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { _ = mgr.StopAll() })

	entryPort, err := mgr.Ensure(context.Background(), "rvxmp9yb2r2i", backendPort)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	client := &http.Client{Timeout: 2 * time.Second}

	pwaResp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/_static%s", entryPort, codeServerPWASWSuffix))
	if err != nil {
		t.Fatalf("GET pwa sw: %v", err)
	}
	defer pwaResp.Body.Close()
	if got := strings.TrimSpace(pwaResp.Header.Get("Service-Worker-Allowed")); got != "" {
		t.Fatalf("pwa sw Service-Worker-Allowed = %q, want empty", got)
	}

	normalResp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/healthz", entryPort))
	if err != nil {
		t.Fatalf("GET normal: %v", err)
	}
	defer normalResp.Body.Close()
	if got := strings.TrimSpace(normalResp.Header.Get("Service-Worker-Allowed")); got != "/" {
		t.Fatalf("normal Service-Worker-Allowed = %q, want %q", got, "/")
	}
}

func TestLocalEntryProxyManager_EnsureReusesAndRetargets(t *testing.T) {
	t.Parallel()

	backendOne := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("one"))
	}))
	t.Cleanup(backendOne.Close)

	backendTwo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("two"))
	}))
	t.Cleanup(backendTwo.Close)

	portOf := func(raw string) int {
		t.Helper()
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", raw, err)
		}
		p, err := strconv.Atoi(u.Port())
		if err != nil {
			t.Fatalf("port(%q): %v", raw, err)
		}
		return p
	}

	mgr := newLocalEntryProxyManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { _ = mgr.StopAll() })

	backendPortOne := portOf(backendOne.URL)
	backendPortTwo := portOf(backendTwo.URL)

	entryOne, err := mgr.Ensure(context.Background(), "rvxmp9yb2r2i", backendPortOne)
	if err != nil {
		t.Fatalf("Ensure(one): %v", err)
	}
	entryOneAgain, err := mgr.Ensure(context.Background(), "rvxmp9yb2r2i", backendPortOne)
	if err != nil {
		t.Fatalf("Ensure(one again): %v", err)
	}
	if entryOneAgain != entryOne {
		t.Fatalf("entry port reused = %d, want %d", entryOneAgain, entryOne)
	}

	client := &http.Client{Timeout: 2 * time.Second}
	respOne, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", entryOne))
	if err != nil {
		t.Fatalf("GET entry one: %v", err)
	}
	bodyOne, _ := io.ReadAll(respOne.Body)
	_ = respOne.Body.Close()
	if strings.TrimSpace(string(bodyOne)) != "one" {
		t.Fatalf("entry one body = %q, want %q", strings.TrimSpace(string(bodyOne)), "one")
	}

	entryTwo, err := mgr.Ensure(context.Background(), "rvxmp9yb2r2i", backendPortTwo)
	if err != nil {
		t.Fatalf("Ensure(two): %v", err)
	}
	respTwo, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", entryTwo))
	if err != nil {
		t.Fatalf("GET entry two: %v", err)
	}
	bodyTwo, _ := io.ReadAll(respTwo.Body)
	_ = respTwo.Body.Close()
	if strings.TrimSpace(string(bodyTwo)) != "two" {
		t.Fatalf("entry two body = %q, want %q", strings.TrimSpace(string(bodyTwo)), "two")
	}
}

func TestLocalEntryProxyManager_StopReleasesPort(t *testing.T) {
	t.Parallel()

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(backend.Close)

	u, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatalf("url.Parse backend: %v", err)
	}
	backendPort, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("backend port: %v", err)
	}

	mgr := newLocalEntryProxyManager(slog.New(slog.NewTextHandler(io.Discard, nil)))

	entryPort, err := mgr.Ensure(context.Background(), "rvxmp9yb2r2i", backendPort)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	if err := mgr.Stop("rvxmp9yb2r2i"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if _, ok := mgr.Port("rvxmp9yb2r2i"); ok {
		t.Fatalf("Port should be absent after Stop")
	}

	addr := fmt.Sprintf("127.0.0.1:%d", entryPort)
	_, err = net.DialTimeout("tcp", addr, 200*time.Millisecond)
	if err == nil {
		t.Fatalf("entry port should be closed: %s", addr)
	}
}

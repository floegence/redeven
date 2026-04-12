package accessproxy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionhop"
)

func TestServer_E2E_LockedUntilUnlock(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("upstream-ok:" + r.URL.Path))
	}))
	defer upstream.Close()

	gate := accessgate.New(accessgate.Options{Password: "secret"})
	meta := session.Meta{ChannelID: "ch-test"}
	gate.RegisterChannel(meta)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv, err := New(Options{Gate: gate, Meta: meta, Upstream: upstream.URL})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer func() { _ = srv.Close() }()
	if err := srv.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	statusResp, err := http.Get(srv.URL() + "/_redeven_proxy/api/access/status")
	if err != nil {
		t.Fatalf("GET status error = %v", err)
	}
	defer statusResp.Body.Close()
	var statusBody struct {
		OK   bool `json:"ok"`
		Data struct {
			PasswordRequired bool `json:"password_required"`
			Unlocked         bool `json:"unlocked"`
		} `json:"data"`
	}
	if err := json.NewDecoder(statusResp.Body).Decode(&statusBody); err != nil {
		t.Fatalf("decode status error = %v", err)
	}
	if !statusBody.OK || !statusBody.Data.PasswordRequired || statusBody.Data.Unlocked {
		t.Fatalf("unexpected status body: %#v", statusBody)
	}

	envResp, err := http.Get(srv.URL() + "/_redeven_proxy/env/")
	if err != nil {
		t.Fatalf("GET env shell error = %v", err)
	}
	defer envResp.Body.Close()
	if envResp.StatusCode != http.StatusOK {
		t.Fatalf("env shell status = %d, want %d", envResp.StatusCode, http.StatusOK)
	}

	lockedResp, err := http.Get(srv.URL() + "/blocked")
	if err != nil {
		t.Fatalf("GET blocked path error = %v", err)
	}
	defer lockedResp.Body.Close()
	if lockedResp.StatusCode != http.StatusLocked {
		t.Fatalf("blocked status = %d, want %d", lockedResp.StatusCode, http.StatusLocked)
	}

	unlockResp, err := http.Post(srv.URL()+"/_redeven_proxy/api/access/unlock", "application/json", strings.NewReader(`{"password":"secret"}`))
	if err != nil {
		t.Fatalf("POST unlock error = %v", err)
	}
	defer unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock status = %d, want %d", unlockResp.StatusCode, http.StatusOK)
	}

	allowedResp, err := http.Get(srv.URL() + "/blocked")
	if err != nil {
		t.Fatalf("GET unlocked path error = %v", err)
	}
	defer allowedResp.Body.Close()
	if allowedResp.StatusCode != http.StatusOK {
		t.Fatalf("unlocked status = %d, want %d", allowedResp.StatusCode, http.StatusOK)
	}
}

func TestServer_E2E_PreservesExternalOriginContextAndInjectsSessionChannel(t *testing.T) {
	t.Parallel()

	type seen struct {
		Host      string `json:"host"`
		Proto     string `json:"proto"`
		Origin    string `json:"origin"`
		ChannelID string `json:"channel_id"`
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(seen{
			Host:      r.Host,
			Proto:     r.Header.Get("X-Forwarded-Proto"),
			Origin:    r.Header.Get("Origin"),
			ChannelID: r.Header.Get(sessionhop.HeaderChannelID),
		})
	}))
	defer upstream.Close()

	meta := session.Meta{ChannelID: "ch-test"}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv, err := New(Options{Meta: meta, Upstream: upstream.URL})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer func() { _ = srv.Close() }()
	if err := srv.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL()+"/_redeven_proxy/env/", nil)
	if err != nil {
		t.Fatalf("NewRequest() error = %v", err)
	}
	req.Host = "env-demo.example.com"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Origin", "https://env-demo.example.com")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do() error = %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want %d, body=%q", resp.StatusCode, http.StatusOK, string(body))
	}

	var got seen
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Host != "env-demo.example.com" {
		t.Fatalf("upstream host = %q, want %q", got.Host, "env-demo.example.com")
	}
	if got.Proto != "https" {
		t.Fatalf("upstream proto = %q, want %q", got.Proto, "https")
	}
	if got.Origin != "https://env-demo.example.com" {
		t.Fatalf("upstream origin = %q, want %q", got.Origin, "https://env-demo.example.com")
	}
	if got.ChannelID != meta.ChannelID {
		t.Fatalf("upstream channel_id = %q, want %q", got.ChannelID, meta.ChannelID)
	}
}

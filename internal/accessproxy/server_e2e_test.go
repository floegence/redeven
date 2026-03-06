package accessproxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/session"
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

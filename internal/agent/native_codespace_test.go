package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
)

func TestNativeCodeSpaceAuthorizationAndRequestBoundary(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "native-secret"})
	meta := &session.Meta{ChannelID: "code-channel", UserPublicID: "user", FloeApp: "com.floegence.redeven.code", CodeSpaceID: "demo", SessionKind: "codeapp", CanRead: true, CanWrite: true, CanExecute: true}
	gate.RegisterChannel(*meta)
	defer gate.UnregisterChannel(meta.ChannelID)
	env := *meta
	env.ChannelID = "env-channel"
	env.FloeApp = "com.floegence.redeven.env"
	env.CodeSpaceID = ""
	env.SessionKind = "envapp"
	gate.RegisterChannel(env)
	defer gate.UnregisterChannel(env.ChannelID)
	if _, err := gate.UnlockChannel(env.ChannelID, "native-secret"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	handler := nativeCodeSpaceRequestGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("X-Redeven-Code-Origin") != "" {
			t.Error("presentation header reached editor")
		}
		w.WriteHeader(http.StatusNoContent)
	}), meta, gate, "127.0.0.1:45678")
	request := func(authority, target string) int {
		req := httptest.NewRequest(http.MethodGet, "/terminal", nil)
		req.Host = authority
		req.RequestURI = target
		req.Header.Set("X-Redeven-Code-Origin", "internal")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		return res.Code
	}
	if got := request("127.0.0.1:45678", "/terminal"); got != 423 {
		t.Fatalf("Env App unlock promoted into Code App: %d", got)
	}
	for _, values := range []map[string]any{{"password": true}, {"password": strings.Repeat("x", 1025)}, {"resume_token": "env-token"}, {"password": "native-secret", "code_space_id": "other"}} {
		if _, err := nativeCodeSpaceAuthorization(gate, meta, values); err == nil {
			t.Fatal("invalid native authorization metadata accepted")
		}
	}
	for _, password := range []string{"", "wrong", "native-secret"} {
		body, err := nativeCodeSpaceAuthorization(gate, meta, map[string]any{"password": password})
		if err != nil {
			t.Fatal(err)
		}
		var status struct {
			Unlocked bool `json:"unlocked"`
		}
		if err := json.Unmarshal(body, &status); err != nil {
			t.Fatal(err)
		}
		if status.Unlocked != (password == "native-secret") {
			t.Fatalf("authorization result: %s", body)
		}
	}
	for _, field := range []*bool{&meta.CanRead, &meta.CanWrite, &meta.CanExecute} {
		*field = false
		if got := request("127.0.0.1:45678", "/terminal"); got != 403 {
			t.Fatalf("missing effective permission accepted: %d", got)
		}
		*field = true
	}
	for _, pair := range [][2]string{{"localhost:45678", "/terminal"}, {"127.0.0.1:45678", "//foreign/terminal"}, {"127.0.0.1:45678", "http://foreign/terminal"}} {
		if got := request(pair[0], pair[1]); got != 400 {
			t.Fatalf("ambiguous authority accepted: %d", got)
		}
	}
	if calls != 0 {
		t.Fatal("rejected request reached editor")
	}
	if got := request("127.0.0.1:45678", "/terminal"); got != 204 || calls != 1 {
		t.Fatalf("authorized request failed: %d, %d calls", got, calls)
	}
	gate.UnregisterChannel(meta.ChannelID)
	if got := request("127.0.0.1:45678", "/terminal"); got != 423 || calls != 1 {
		t.Fatalf("revoked channel admitted: %d", got)
	}
}

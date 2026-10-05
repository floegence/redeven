package gatewayservice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeidentity"
)

func TestProfileCheckDoesNotPublishAndRequiresIndependentPermission(t *testing.T) {
	nonce := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/local/runtime/health" || r.Header.Get("X-Redeven-Runtime-Identity-Challenge") != nonce {
			t.Error("incorrect selected target health request")
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("forwarded credentials")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"status":"online","password_required":true}}`))
	}))
	req := map[string]any{"protocol_version": protocol.Version, "target_url": "http://runtime.example/", "client_nonce": nonce}
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusOK, nil)
	f.post(t, f.pair(t, false), "/gateway/v3/env-profiles/check", req, http.StatusForbidden, nil)
	catalog, err := f.server.profileStore().List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 1 {
		t.Fatal("preview published an environment")
	}
	if len(f.server.profileSessions) != 0 {
		t.Fatal("preview leaked a session")
	}
	req["target_url"] = "http://127.0.0.1/"
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusBadRequest, nil)
}

func TestProfileCheckRejectsRedirectAndNonRuntime(t *testing.T) {
	for _, code := range []int{http.StatusFound, http.StatusOK} {
		f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "http://127.0.0.1/private")
			w.WriteHeader(code)
			_, _ = w.Write([]byte("not runtime health"))
		}))
		f.post(t, f.client, "/gateway/v3/env-profiles/check", map[string]any{"protocol_version": protocol.Version, "target_url": "http://runtime.example/", "client_nonce": base64.RawURLEncoding.EncodeToString(make([]byte, 32))}, http.StatusBadGateway, nil)
	}
}

func TestProfileCheckIdentityAndBoundedInputs(t *testing.T) {
	identity, err := runtimeidentity.LoadAccessIdentity(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	nonce := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	f := newAccessTestFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "oversized.example" {
			_, _ = w.Write([]byte(strings.Repeat(" ", 65537)))
			return
		}
		proof, err := identity.Prove(r.Header.Get("X-Redeven-Runtime-Identity-Challenge"))
		if err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"status": "online", "password_required": true, "access_identity": proof}})
	}))
	req := protocol.EnvProfileCheckRequest{ProtocolVersion: protocol.Version, TargetURL: "http://runtime.example/", ClientNonce: nonce}
	var checked protocol.EnvProfileCheckResponse
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusOK, &checked)
	want, _ := identity.Prove(nonce)
	if checked.AccessIdentity == nil || *checked.AccessIdentity != want {
		t.Fatal("Gateway changed the Runtime proof")
	}
	for _, invalid := range []string{"", "bad", nonce + "="} {
		req.ClientNonce = invalid
		f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusBadRequest, nil)
	}
	req.ClientNonce = nonce
	req.ProtocolVersion = "redeven-gateway-v2"
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusBadRequest, nil)
	req.ProtocolVersion = protocol.Version
	req.TargetURL = "http://oversized.example/"
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusBadGateway, nil)
	f.server.profileWriteEnabled = false
	f.post(t, f.client, "/gateway/v3/env-profiles/check", req, http.StatusForbidden, nil)
}

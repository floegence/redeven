package localui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
	"github.com/gorilla/websocket"
)

func TestNativeAcquisitionRetainsOnlyPrivateEphemeralTessivenSource(t *testing.T) {
	broker := &tessiven.Broker{}
	cfg := writeTestConfig(t)
	app, err := appserver.New(appserver.Options{ResolveSessionMeta: func(string) (*session.Meta, bool) { return nil, false }, Backend: localUITestBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}}, ConfigPath: cfg, TessivenResources: &tessiven.ResourceBackend{Broker: broker}})
	if err != nil {
		t.Fatal(err)
	}
	s := newTestServerWithAppServer(t, nil, app, cfg)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err == nil {
			_ = broker.Serve(r.Context(), conn, "private-source")
		}
	}))
	defer host.Close()
	defer broker.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(host.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	deadline := time.Now().Add(time.Second)
	for !broker.SourceActive("private-source") {
		if time.Now().After(deadline) {
			t.Fatal("host unavailable")
		}
		time.Sleep(time.Millisecond)
	}
	for _, trusted := range []bool{false, true} {
		req := httptest.NewRequest("POST", "http://127.0.0.1:23998/api/local/direct/connect_artifact", strings.NewReader(`{}`))
		req.Header.Set("X-Redeven-Tessiven-Source", "private-source")
		req = withTrustedLocalUIBridge(req)
		if trusted {
			req = app.WithTessivenDesktopSource(req, "private-source")
		}
		w := httptest.NewRecorder()
		s.handleConnectArtifact(w, req)
		if w.Code != http.StatusOK {
			t.Fatal(w.Code, w.Body.String())
		}
		var envelope connectArtifactEnvelope
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		pending := s.pending[envelope.ChannelID]
		want := ""
		if trusted {
			want = "private-source"
		}
		if pending.meta.DesktopSource != want {
			t.Fatalf("source = %q, want %q", pending.meta.DesktopSource, want)
		}
		var lookup string
		var encrypted []byte
		var keyVersion int
		var generation int64
		if err := s.authStore.db.QueryRow("SELECT lookup_key, record_ciphertext, key_version, generation FROM local_authorization_records WHERE channel_id = ?", envelope.ChannelID).Scan(&lookup, &encrypted, &keyVersion, &generation); err != nil {
			t.Fatal(err)
		}
		plain, err := s.authStore.decrypt(lookup, generation, envelope.ChannelID, pending.accessSessionID, pending.initExpireAtUnixS, keyVersion, encrypted)
		if err != nil {
			t.Fatal(err)
		}
		var stored localAuthorizationSecret
		if err := json.Unmarshal(plain, &stored); err != nil || stored.Binding.Meta.DesktopSource != "" {
			t.Fatal("durable authorization restored Desktop source authority", err)
		}
		data, _ := json.Marshal(pending.meta)
		var restored session.Meta
		_ = json.Unmarshal(data, &restored)
		if restored.DesktopSource != "" || strings.Contains(w.Body.String(), "private-source") {
			t.Fatal("ephemeral source leaked into a durable or public contract")
		}
	}
}

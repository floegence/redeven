package appserver

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
	"github.com/gorilla/websocket"
)

func TestTessivenSourceCannotBeDeclaredByPublicHeaderOrReusedAfterDisconnect(t *testing.T) {
	broker := &tessiven.Broker{}
	cap := config.PermissionSet{Read: true, Write: true, Execute: true}
	srv := &Server{localPermissionCap: &cap, tessivenResources: &tessiven.ResourceBackend{Broker: broker}}
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		_ = broker.Serve(r.Context(), conn, "private-source")
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
			t.Fatal("source did not register")
		}
		time.Sleep(time.Millisecond)
	}
	req := httptest.NewRequest(http.MethodGet, "http://localhost/_redeven_proxy/api/tessiven/runtimes", nil)
	req.Header.Set("X-Redeven-Tessiven-Source", "private-source")
	if desktopSourceFromRequest(req) != "" {
		t.Fatal("public header became authority")
	}
	trusted := srv.WithTessivenDesktopSource(req, "private-source")
	if desktopSourceFromRequest(trusted) != "private-source" {
		t.Fatal("private admission failed")
	}
	scope := tessiven.DesktopSourceScope{UserPublicID: localUserPublicID, FloeApp: localFloeAppAgent}
	rights := tessiven.ResourcePermissions{Read: true, Write: true, Execute: true, Admin: true}
	if err := srv.PreflightTessivenSource("private-source", scope, rights, "lifecycle"); err != nil {
		t.Fatal(err)
	}
	broker.Authorize = func(meta *session.Meta) *session.Meta { copy := *meta; copy.CanWrite = false; return &copy }
	if err := srv.PreflightTessivenSource("private-source", scope, rights, "lifecycle"); !errors.Is(err, tessiven.ErrPermissionDenied) {
		t.Fatal("native confirmation used revoked policy", err)
	}
	broker.Close()
	if desktopSourceFromRequest(srv.WithTessivenDesktopSource(req, "private-source")) != "" {
		t.Fatal("disconnected source admitted")
	}
	if err := srv.PreflightTessivenSource("private-source", scope, rights, "lifecycle"); !errors.Is(err, tessiven.ErrTargetUnavailable) {
		t.Fatal("retired source admitted", err)
	}
}

package appserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gitruntime"
	"github.com/floegence/redeven/internal/session"
)

func TestServerFSMkdir(t *testing.T) {
	home := t.TempDir()
	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true, CanWrite: true}, nil, gitruntime.New())
	target := filepath.Join(home, "new project")
	body, _ := json.Marshal(map[string]any{"path": target})
	rr := performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, string(body))
	if rr.Code != http.StatusOK {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	info, err := os.Stat(target)
	if err != nil || !info.IsDir() {
		t.Fatalf("created directory: %v %v", info, err)
	}
	rr = performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, string(body))
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate: %d %s", rr.Code, rr.Body.String())
	}
	for _, invalid := range []string{
		"{}", "{\"path\":\"relative\"}",
		string(body) + " {}", "{\"path\":\"/tmp/no-write\",\"create_parents\":true}",
	} {
		rr = performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, invalid)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid %s: %d %s", invalid, rr.Code, rr.Body.String())
		}
	}
	outside := filepath.Join(t.TempDir(), "forbidden")
	body, _ = json.Marshal(map[string]any{"path": outside})
	rr = performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, string(body))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("outside: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatalf("outside directory changed: %v", err)
	}
}

func TestServerFSMkdirRequiresWritePermission(t *testing.T) {
	home := t.TempDir()
	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true, CanWrite: false}, nil)
	target := filepath.Join(home, "forbidden")
	body, _ := json.Marshal(map[string]any{"path": target})
	rr := performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, string(body))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("write admission: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("read-only directory changed: %v", err)
	}
}

func TestServerFSMkdirHonorsLocalPolicyAndCoordinator(t *testing.T) {
	home := t.TempDir()
	target := filepath.Join(home, "blocked")
	body, _ := json.Marshal(map[string]any{"path": target})
	noWrite := config.PermissionSet{Read: true, Write: false, Execute: true}
	srv, _ := newFSFileTestServer(t, home, session.Meta{CanRead: true, CanWrite: true}, &config.PermissionPolicy{SchemaVersion: 1, LocalMax: &noWrite})
	req := WithLocalUIEnvRoute(httptest.NewRequest(http.MethodPost, "/_redeven_proxy/api/fs/mkdir", strings.NewReader(string(body))))
	rr := httptest.NewRecorder()
	srv.serveHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("local cap: %d %s", rr.Code, rr.Body.String())
	}
	srv, origin := newFSFileTestServer(t, home, session.Meta{CanRead: true, CanWrite: true}, nil)
	rr = performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", origin, string(body))
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing coordinator: %d %s", rr.Code, rr.Body.String())
	}
	rr = performFSAPIRequest(srv, http.MethodPost, "/_redeven_proxy/api/fs/mkdir", "https://untrusted.invalid", string(body))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("origin: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("target changed: %v", err)
	}
}

package appserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/hostapps"
	"github.com/floegence/redeven/internal/session"
)

type hostAppsStub struct {
	owner string
	calls int
}

func (s *hostAppsStub) Catalog(context.Context, string, string) (hostapps.Catalog, error) {
	s.calls++
	return hostapps.Catalog{}, nil
}
func (s *hostAppsStub) Sessions(string) []hostapps.Session { s.calls++; return nil }
func (s *hostAppsStub) Launch(_ context.Context, owner string, _ hostapps.LaunchRequest) (hostapps.Session, error) {
	s.calls++
	s.owner = owner
	return hostapps.Session{}, nil
}
func (s *hostAppsStub) Stop(_ context.Context, owner, _ string) error {
	s.calls++
	s.owner = owner
	return nil
}
func (s *hostAppsStub) Add(context.Context, hostapps.AddRequest) error { s.calls++; return nil }
func (s *hostAppsStub) ForTarget(target string) (hostapps.Session, string, bool) {
	return hostapps.Session{ID: "one", State: "running"}, "alice", target == "http://127.0.0.1:40000"
}
func (s *hostAppsStub) Permissions(context.Context, string) error { s.calls++; return nil }
func (s *hostAppsStub) Password(string) string                    { return "private-password" }

func TestHostApplicationPermissionsAndAuthoritativeOwner(t *testing.T) {
	for _, full := range []bool{false, true} {
		backend := &hostAppsStub{}
		server := &Server{hostApps: backend, resolveSessionMeta: resolveMetaForTest("ch_hostapps", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: full, CanExecute: full})}
		for _, path := range []string{hostApplicationsAPI, hostApplicationsAPI + "/sessions"} {
			r := httptest.NewRequest(http.MethodGet, path, nil)
			r.Header.Set("Origin", envOriginWithChannel("ch_hostapps"))
			w := httptest.NewRecorder()
			server.handleHostApplicationsAPI(w, r)
			if w.Code != 200 {
				t.Fatalf("read catalog: %d", w.Code)
			}
		}
		backend.calls = 0
		for _, test := range []struct{ method, path string }{{"POST", hostApplicationsAPI}, {"POST", hostApplicationsAPI + "/sessions"}, {"POST", hostApplicationsAPI + "/permissions"}, {"DELETE", hostApplicationsAPI + "/sessions/one"}} {
			r := httptest.NewRequest(test.method, test.path, strings.NewReader(`{}`))
			r.Header.Set("Origin", envOriginWithChannel("ch_hostapps"))
			w := httptest.NewRecorder()
			server.handleHostApplicationsAPI(w, r)
			if !full && w.Code != http.StatusForbidden {
				t.Fatalf("read-only mutation allowed: %s %d", test.method, w.Code)
			}
			if full && w.Code >= 300 {
				t.Fatalf("authorized mutation: %s %d %s", test.method, w.Code, w.Body.String())
			}
		}
		if !full && backend.calls != 0 {
			t.Fatal("unauthorized request reached backend")
		}
		if full && backend.owner != "alice" {
			t.Fatal("session owner did not come from authorized metadata")
		}
	}
}

func TestHostApplicationForwardProtectsBootstrapAndWebSocket(t *testing.T) {
	for _, test := range []struct {
		owner   string
		full    bool
		allowed bool
	}{{"alice", true, true}, {"alice", false, false}, {"bob", true, false}} {
		server := &Server{hostApps: &hostAppsStub{}, resolveSessionMeta: resolveMetaForTest("ch_hostapps", session.Meta{UserPublicID: test.owner, CanRead: true, CanWrite: test.full, CanExecute: test.full})}
		for _, path := range []string{"/_redeven_host_app/state", "/index.html", "/"} {
			r := httptest.NewRequest(http.MethodGet, path, nil)
			r.Header.Set("Origin", envOriginWithChannel("ch_hostapps"))
			r.Header.Set("Upgrade", "websocket")
			w := httptest.NewRecorder()
			handled := server.guardHostApplicationForward(w, r, "http://127.0.0.1:40000", "")
			if !test.allowed && (!handled || w.Code != http.StatusForbidden || strings.Contains(w.Body.String(), "private-password")) {
				t.Fatalf("forward permission bypass: %+v %s %d", test, path, w.Code)
			}
			if test.allowed && path == "/_redeven_host_app/state" && (!handled || !strings.Contains(w.Body.String(), "private-password") || w.Header().Get("Cache-Control") != "no-store") {
				t.Fatal("authorized bootstrap did not receive private credentials")
			}
		}
	}
}

func TestHostApplicationBootstrapEscapesUntrustedNamesAndCopy(t *testing.T) {
	server := &Server{}
	w := httptest.NewRecorder()
	payload := `</script><script>alert(1)</script>`
	server.serveHostApplicationBoot(w, httptest.NewRequest("GET", "/", nil), hostapps.Session{Application: hostapps.Application{Name: payload}, Presentation: hostapps.Presentation{Starting: payload}}, "/pf/example")
	if strings.Contains(w.Body.String(), payload) {
		t.Fatal("bootstrap allows script injection")
	}
	if !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("bootstrap lacks security headers")
	}
	if !strings.Contains(w.Body.String(), `"base":"/pf/example"`) {
		t.Fatal("path-prefixed forward lost its base")
	}
}

func (s *hostAppsStub) SetupStatus(owner string) (hostapps.SetupStatus, error) {
	s.calls++
	s.owner = owner
	return hostapps.SetupStatus{}, nil
}
func (s *hostAppsStub) WatchSetup() (<-chan struct{}, func(), error) {
	ch := make(chan struct{}, 1)
	ch <- struct{}{}
	return ch, func() {}, nil
}
func (s *hostAppsStub) StartSetup(owner, request, source string, size int64) (hostapps.SetupStatus, error) {
	return s.SetupStatus(owner)
}
func (s *hostAppsStub) CancelSetup(owner, id string) (hostapps.SetupStatus, error) {
	return s.SetupStatus(owner)
}
func (s *hostAppsStub) WriteSetup(owner, id string, offset int64, data []byte) (hostapps.SetupStatus, error) {
	return s.SetupStatus(owner)
}
func (s *hostAppsStub) CompleteSetup(owner, id string) (hostapps.SetupStatus, error) {
	return s.SetupStatus(owner)
}

func TestHostApplicationSetupPermissionAndOwner(t *testing.T) {
	for _, full := range []bool{false, true} {
		backend := &hostAppsStub{}
		server := &Server{hostApps: backend, resolveSessionMeta: resolveMetaForTest("ch_hostapps", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: full, CanExecute: full})}
		for _, test := range []struct{ method, path, body string }{{"GET", "/setup", ""}, {"POST", "/setup", `{"request_id":"request","source":"download","owner":"bob"}`}, {"DELETE", "/setup/id", ""}, {"PUT", "/setup/id/content?offset=0", "data"}, {"POST", "/setup/id/complete", ""}} {
			backend.calls = 0
			backend.owner = ""
			request := httptest.NewRequest(test.method, hostApplicationsAPI+test.path, strings.NewReader(test.body))
			request.Header.Set("Origin", envOriginWithChannel("ch_hostapps"))
			response := httptest.NewRecorder()
			server.handleHostApplicationsAPI(response, request)
			if !full && test.method != "GET" {
				if response.Code != http.StatusForbidden || backend.calls != 0 {
					t.Fatalf("mutation bypassed permissions: %s %d", test.path, response.Code)
				}
				continue
			}
			// Unknown request fields are rejected before adapter admission.
			if test.method == "POST" && test.path == "/setup" && response.Code == http.StatusBadRequest {
				continue
			}
			if response.Code != 200 || backend.owner != "alice" {
				t.Fatalf("setup owner mapping: %s %d %q", test.path, response.Code, backend.owner)
			}
		}
	}
}

func TestHostApplicationSetupRejectsUnboundedTransferBeforeAdmission(t *testing.T) {
	backend := &hostAppsStub{}
	server := &Server{hostApps: backend, resolveSessionMeta: resolveMetaForTest("ch_hostapps", session.Meta{UserPublicID: "alice", CanRead: true, CanWrite: true, CanExecute: true})}
	for _, test := range []struct{ query, body string }{
		{"offset=-1", "x"}, {"offset=invalid", "x"}, {"offset=0", strings.Repeat("x", (256<<10)+1)},
	} {
		request := httptest.NewRequest(http.MethodPut, hostApplicationsAPI+"/setup/id/content?"+test.query, strings.NewReader(test.body))
		request.Header.Set("Origin", envOriginWithChannel("ch_hostapps"))
		response := httptest.NewRecorder()
		server.handleHostApplicationsAPI(response, request)
		if response.Code != http.StatusBadRequest || backend.calls != 0 {
			t.Fatalf("invalid transfer admitted: status=%d calls=%d", response.Code, backend.calls)
		}
	}
}

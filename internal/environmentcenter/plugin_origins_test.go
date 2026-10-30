package environmentcenter

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/pluginorigin"
)

type controlledPluginProbe struct {
	started chan context.Context
	resume  chan struct{}
	code    int
}

func (p *controlledPluginProbe) Close() {}
func (p *controlledPluginProbe) RoundTrip(r *http.Request) (*http.Response, error) {
	p.started <- r.Context()
	select {
	case <-p.resume:
		return &http.Response{StatusCode: p.code, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
	case <-r.Context().Done():
		return nil, r.Context().Err()
	}
}

func preparePluginOrigin(a *webAccess, parent *openOperation, child, credential string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"origin": child})
	r := httptest.NewRequest(http.MethodPost, parent.route.Origin+"/__center/plugin-origins", strings.NewReader(string(body)))
	r.Header.Set("Origin", parent.route.Origin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Redeven-Center", "1")
	r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: credential})
	w := httptest.NewRecorder()
	a.pluginOrigin(w, r, parent)
	return w
}

func TestPluginOriginPendingAdmissionAndCleanup(t *testing.T) {
	for _, outcome := range []string{"failed-probe", "parent-canceled"} {
		t.Run(outcome, func(t *testing.T) {
			c, _, _, codes := configuredCenter(t)
			login := loginRecovery(t, c, "browser", codes[0])
			s := NewServer(c, nil)
			defer s.Close()
			parent := admissionFixture(t, c, s.access, login.Token, "parent")
			child, _ := pluginorigin.Child(parent.route.Origin, strings.Repeat("c", 48))
			connection := &controlledPluginProbe{started: make(chan context.Context, 1), resume: make(chan struct{}), code: http.StatusUnauthorized}
			parent.connection = connection
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { done <- preparePluginOrigin(s.access, parent, child, "runtime-login") }()
			var probeContext context.Context
			select {
			case probeContext = <-connection.started:
			case <-time.After(5 * time.Second):
				t.Fatal("probe did not start")
			}
			if w := preparePluginOrigin(s.access, parent, child, "runtime-login"); w.Code == http.StatusOK {
				t.Fatal("concurrent preparation was admitted")
			}
			if outcome == "parent-canceled" {
				parent.cancel()
				select {
				case <-probeContext.Done():
				case <-time.After(5 * time.Second):
					t.Fatal("parent cancellation did not stop the probe")
				}
			} else {
				close(connection.resume)
			}
			select {
			case w := <-done:
				if w.Code == http.StatusOK {
					t.Fatal("failed preparation reported success")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("preparation did not finish")
			}
			s.access.mu.Lock()
			remaining := len(s.access.pluginPreparations) + len(s.access.pluginRoutes)
			s.access.mu.Unlock()
			if remaining != 0 {
				t.Fatal("failed preparation retained route capacity")
			}
			if outcome == "failed-probe" {
				parent.connection = &pluginProbeConnection{t: t, child: child}
				if w := preparePluginOrigin(s.access, parent, child, "runtime-login"); w.Code != http.StatusOK {
					t.Fatalf("retry: %d %s", w.Code, w.Body.String())
				}
				if w := preparePluginOrigin(s.access, parent, child, "different-login"); w.Code == http.StatusOK {
					t.Fatal("existing route accepted different credentials")
				}
			}
		})
	}
}

func TestPluginOriginPendingPreparationsConsumeCapacity(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	s := NewServer(c, nil)
	defer s.Close()
	parent := admissionFixture(t, c, s.access, login.Token, "parent")
	connection := &controlledPluginProbe{started: make(chan context.Context, 32), resume: make(chan struct{}), code: http.StatusOK}
	parent.connection = connection
	var pending sync.WaitGroup
	defer pending.Wait()
	defer parent.cancel()
	for i := range 32 {
		child, _ := pluginorigin.Child(parent.route.Origin, fmt.Sprintf("%048x", i))
		pending.Add(1)
		go func() {
			defer pending.Done()
			preparePluginOrigin(s.access, parent, child, "runtime-login")
		}()
	}
	for range 32 {
		select {
		case <-connection.started:
		case <-time.After(5 * time.Second):
			t.Fatal("pending probes did not reserve capacity")
		}
	}
	child, _ := pluginorigin.Child(parent.route.Origin, strings.Repeat("f", 48))
	if w := preparePluginOrigin(s.access, parent, child, "runtime-login"); w.Code == http.StatusOK {
		t.Fatal("pending requests bypassed the per-parent capacity")
	}
}

type pluginProbeConnection struct {
	t         *testing.T
	child     string
	resources int
}

type delayedPluginProbe struct {
	pluginProbeConnection
	started chan struct{}
	resume  chan struct{}
	calls   atomic.Int32
}

func (p *delayedPluginProbe) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Path == "/api/local/runtime" && p.calls.Add(1) == 1 {
		close(p.started)
		<-p.resume
	}
	return p.pluginProbeConnection.RoundTrip(r)
}

func TestPluginOriginDeleteFencesPendingPreparation(t *testing.T) {
	for _, reopen := range []bool{false, true} {
		t.Run(map[bool]string{false: "closed", true: "reopened"}[reopen], func(t *testing.T) {
			c, _, _, codes := configuredCenter(t)
			login := loginRecovery(t, c, "browser", codes[0])
			s := NewServer(c, nil)
			defer s.Close()
			parent := admissionFixture(t, c, s.access, login.Token, "parent")
			child, _ := pluginorigin.Child(parent.route.Origin, strings.Repeat("b", 48))
			connection := &delayedPluginProbe{pluginProbeConnection: pluginProbeConnection{t: t, child: child}, started: make(chan struct{}), resume: make(chan struct{})}
			parent.connection = connection
			prepare := func(method string) *httptest.ResponseRecorder {
				body, _ := json.Marshal(map[string]string{"origin": child})
				r := httptest.NewRequest(method, parent.route.Origin+"/__center/plugin-origins", strings.NewReader(string(body)))
				r.Header.Set("Origin", parent.route.Origin)
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-Redeven-Center", "1")
				r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"})
				w := httptest.NewRecorder()
				s.access.pluginOrigin(w, r, parent)
				return w
			}
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() { done <- prepare(http.MethodPost) }()
			select {
			case <-connection.started:
			case <-time.After(5 * time.Second):
				t.Fatal("probe did not start")
			}
			if w := prepare(http.MethodDelete); w.Code != http.StatusOK {
				t.Fatalf("delete: %d", w.Code)
			}
			var fresh *accessSession
			if reopen {
				if w := prepare(http.MethodPost); w.Code != http.StatusOK {
					t.Fatalf("reopen: %d %s", w.Code, w.Body.String())
				}
				s.access.mu.Lock()
				fresh = s.access.pluginRoutes[child]
				s.access.mu.Unlock()
			}
			close(connection.resume)
			select {
			case w := <-done:
				if w.Code == http.StatusOK {
					t.Error("deleted in-flight preparation reported success")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("old preparation did not finish")
			}
			s.access.mu.Lock()
			current := s.access.pluginRoutes[child]
			s.access.mu.Unlock()
			if current != fresh {
				t.Fatal("old preparation created or replaced the route after deletion")
			}
		})
	}
}

func (p *pluginProbeConnection) Close() {}
func (p *pluginProbeConnection) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Host != "env.example.test" {
		p.t.Fatalf("unbound upstream host: %s", r.Host)
	}
	cookie, err := r.Cookie("redeven_local_access_fixture")
	if err != nil || cookie.Value != "runtime-login" {
		p.t.Fatal("missing exact parent Runtime login")
	}
	if r.URL.Path != "/api/local/runtime" {
		p.resources++
		if !strings.HasPrefix(r.URL.Path, "/api/local/web-applications/plugin/") || r.Header.Get("X-Redeven-Web-App-Origin") != p.child {
			p.t.Fatalf("wrong child route: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-Redeven-Plugin-Session") != "" {
			p.t.Fatal("browser authority reached child adapter")
		}
		if cookie, err := r.Cookie("__Host-rdp-surface"); err != nil || cookie.Value != "resource" {
			p.t.Fatal("platform resource cookie lost")
		}
	}
	header := make(http.Header)
	header.Set("Set-Cookie", "__Host-rdp-surface=next; Secure; HttpOnly; SameSite=None; Partitioned; Path=/")
	header.Set("Content-Security-Policy", "frame-ancestors https://env.example.test")
	return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
}

func TestPluginOriginPreparationAndParentRevocation(t *testing.T) {
	c, _, _, codes := configuredCenter(t)
	login := loginRecovery(t, c, "browser", codes[0])
	s := NewServer(c, nil)
	defer s.Close()
	parent := admissionFixture(t, c, s.access, login.Token, "parent")
	child, _ := pluginorigin.Child(parent.route.Origin, strings.Repeat("a", 48))
	connection := &pluginProbeConnection{t: t, child: child}
	parent.connection = connection
	prepare := func(origin string, method string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"origin": child})
		r := httptest.NewRequest(method, parent.route.Origin+"/__center/plugin-origins", strings.NewReader(string(body)))
		r.TLS = &tls.ConnectionState{}
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Redeven-Center", "1")
		r.AddCookie(&http.Cookie{Name: accessCookie, Value: parent.accessToken})
		r.AddCookie(&http.Cookie{Name: "redeven_local_access_fixture", Value: "runtime-login"})
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	if w := prepare(child, http.MethodPost); w.Code != http.StatusForbidden {
		t.Fatalf("child prepared parent route: %d", w.Code)
	}
	for range 2 {
		if w := prepare(parent.route.Origin, http.MethodPost); w.Code != 200 {
			t.Fatalf("prepare: %d %s", w.Code, w.Body.String())
		}
	}
	resource := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, child+path, nil)
		r.TLS = &tls.ConnectionState{}
		r.AddCookie(&http.Cookie{Name: "__Host-rdp-surface", Value: "resource"})
		r.Header.Set("Authorization", "forged")
		r.Header.Set("X-Redeven-Plugin-Session", "forged")
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w
	}
	w := resource("/assets/app.js")
	if w.Code != 200 || connection.resources != 1 {
		t.Fatalf("resource: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Frame-Options") != "" || w.Header().Get("Content-Security-Policy") != "frame-ancestors https://env.example.test" {
		t.Fatal("platform embedding policy lost")
	}
	if len(w.Result().Cookies()) != 1 || !w.Result().Cookies()[0].Partitioned {
		t.Fatal("platform cookie changed")
	}
	for _, path := range []string{"/__center/session", "/__center/plugin-origins", "/__center/activity"} {
		if w := resource(path); w.Code != 403 {
			t.Fatalf("child entered center %s: %d", path, w.Code)
		}
	}
	if w := prepare(parent.route.Origin, http.MethodDelete); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := resource("/assets/app.js"); w.Code != 401 {
		t.Fatalf("deleted route survived: %d", w.Code)
	}
	if w := prepare(parent.route.Origin, http.MethodPost); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	parent.cancel()
	if w := resource("/assets/app.js"); w.Code != 401 {
		t.Fatalf("canceled parent survived: %d", w.Code)
	}
}

package localui

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	appserverpkg "github.com/floegence/redeven/internal/codeapp/appserver"
)

type nativeTestBackend struct {
	localUITestBackend
	binding appserverpkg.NativeCodeSpaceBinding
	calls   *int
}

func (b nativeTestBackend) BindRunningCodeSpace(_ context.Context, id string) (appserverpkg.NativeCodeSpaceBinding, error) {
	*b.calls++
	return b.binding, nil
}

func TestNativeCodeSpaceLocalAccessAndGeneration(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "127.0.0.1:43210" || r.URL.RequestURI() != "/echo?x=%2F&x=2" || r.Header.Get("X-Redeven-Code-Access") != "" || r.Header.Get("X-Redeven-Code-Origin") != "" {
			t.Errorf("native request boundary: %s %s %v", r.Host, r.URL.RequestURI(), r.Header)
		}
		for _, c := range r.Cookies() {
			if c.Name == accessgate.LocalSessionCookieName {
				t.Error("runtime credential reached editor")
			}
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		if _, err := io.Copy(w, r.Body); err != nil {
			t.Errorf("copy native response: %v", err)
		}
	}))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cfg := writeTestConfig(t)
	binding := appserverpkg.NativeCodeSpaceBinding{CodeSpaceID: "demo", InstanceID: "generation", Port: upstream.Listener.Addr().(*net.TCPAddr).Port, Context: ctx}
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	s := newTestServerWithAppServer(t, gate, newTestAppServerWithBackend(t, cfg, nativeTestBackend{binding: binding, calls: &calls}), cfg)
	s.localUIBridgeToken = "native-test-bridge-secret"
	request := func(credential, instance string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "http://localhost:23998/api/local/codespaces/demo/"+instance+"/echo?x=%2F&x=2", bytes.NewBufferString("native\x00body"))
		req.Header.Set(localDesktopBridgeTokenHeader, s.localUIBridgeToken)
		req.Header.Set("Origin", "null")
		req.Header.Set("X-Redeven-Code-Origin", "http://127.0.0.1:43210")
		req.Header.Set("X-Redeven-Code-Access", credential)
		req.AddCookie(&http.Cookie{Name: "editor", Value: "preserved"})
		req.AddCookie(&http.Cookie{Name: accessgate.LocalSessionCookieName, Value: "editor-controlled"})
		res := httptest.NewRecorder()
		s.HandlerForDesktopBridge().ServeHTTP(res, req)
		return res
	}
	if res := request("", "generation"); res.Code != 423 || calls != 0 {
		t.Fatalf("locked request reached binding: %d %d", res.Code, calls)
	}
	unlock := httptest.NewRecorder()
	s.handleAccessUnlock(unlock, httptest.NewRequest("POST", "http://localhost:23998/api/local/access/unlock", bytes.NewBufferString(`{"password":"secret"}`)))
	credential := ""
	for _, cookie := range unlock.Result().Cookies() {
		if cookie.Name == accessgate.LocalSessionCookieName {
			credential = cookie.Value
		}
	}
	if credential == "" {
		t.Fatal("no local access cookie")
	}
	if res := request(credential, "obsolete"); res.Code != 410 {
		t.Fatalf("stale generation admitted: %d %s", res.Code, res.Body.String())
	}
	if res := request(credential, "generation"); res.Code != 200 || res.Body.String() != "native\x00body" {
		t.Fatalf("native request: %d %s", res.Code, res.Body.String())
	}
	res := request(credential, "generation")
	if !reflect.DeepEqual(res.Header().Values("Content-Security-Policy"), []string{"default-src 'self'"}) || res.Header().Get("X-Frame-Options") != "" {
		t.Fatalf("Local UI changed native editor response policy: %v", res.Header())
	}
	logout := httptest.NewRequest("POST", "http://localhost:23998/api/local/access/logout", nil)
	logout.AddCookie(&http.Cookie{Name: accessgate.LocalSessionCookieName, Value: credential})
	s.handleAccessLogout(httptest.NewRecorder(), logout)
	if res := request(credential, "generation"); res.Code != 423 {
		t.Fatalf("revoked access admitted: %d", res.Code)
	}
}

func TestNativeCodeSpaceAccessCancellation(t *testing.T) {
	s := &Server{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	resource := &nativeCodeAccess{id: "owner", cancel: cancel}
	s.nativeAccess.Store(resource, struct{}{})
	s.closePluginAccessSession("other")
	if ctx.Err() != nil {
		t.Fatal("other access session canceled native editor")
	}
	s.closePluginAccessSession("owner")
	if ctx.Err() == nil {
		t.Fatal("native resource outlived access logout without a plugin session")
	}
}

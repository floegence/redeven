package localui

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
)

func TestLocalAuthCookieScope(t *testing.T) {
	for _, test := range []struct{ url, suffix string }{
		{"http://localhost:23998/", "http_23998"},
		{"https://localhost:23998/", "https_23998"},
		{"http://192.168.1.20:24000/", "http_24000"},
		{"https://192.168.1.20:24000/", "https_24000"},
		{"http://localhost/", "http_80"},
		{"https://localhost/", "https_443"},
		{"http://[::1]/", "http_80"},
		{"https://[fd00::1]:23998/", "https_23998"},
	} {
		t.Run(test.url, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, test.url, nil)
			r.Header.Set("X-Forwarded-Proto", "https")
			r.Header.Set("X-Forwarded-Port", "12345")
			if got := localAccessCookieName(r); got != "redeven_local_access_"+test.suffix {
				t.Fatalf("access cookie = %q", got)
			}
			if got := localAuthCookieName(r, localChallengeCookiePrefix); got != "redeven_auth_challenge_"+test.suffix {
				t.Fatalf("challenge cookie = %q", got)
			}
			s := &Server{}
			response := httptest.NewRecorder()
			expires := time.Now().Add(time.Hour).Truncate(time.Second)
			s.setLocalAccessCookie(response, r, "session", expires.UnixMilli())
			cookie := response.Result().Cookies()[0]
			if cookie.Domain != "" || cookie.Path != "/" || !cookie.HttpOnly || cookie.Secure != (r.TLS != nil) || cookie.SameSite != http.SameSiteLaxMode || !cookie.Expires.Equal(expires) {
				t.Fatal("access cookie lost its transport or lifetime protection")
			}
			cleared := httptest.NewRecorder()
			s.clearLocalAccessCookie(cleared, r)
			deletion := cleared.Result().Cookies()[0]
			if deletion.Name != cookie.Name || deletion.Path != cookie.Path || deletion.Secure != cookie.Secure || deletion.MaxAge != -1 {
				t.Fatal("logout did not clear the exact session cookie")
			}
		})
	}
}

func TestLocalAuthCookieRejectsInvalidAuthority(t *testing.T) {
	for _, host := range []string{"", "localhost:0", "localhost:080", "localhost:65536", "untrusted.example:23998"} {
		r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/", nil)
		r.Host = host
		if got := localAccessCookieName(r); got != "" {
			t.Fatalf("unvalidated authority %q produced a cookie", host)
		}
		response := httptest.NewRecorder()
		(&Server{}).setLocalAccessCookie(response, r, "session", time.Now().Add(time.Hour).UnixMilli())
		if len(response.Result().Cookies()) != 0 {
			t.Fatal("invalid authority received an access cookie")
		}
	}
}

func TestLocalAccessIgnoresRetiredAndForeignCookieNames(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	defer gate.Close()
	login, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{accessGate: gate}
	for _, name := range []string{"redeven_local_access", "redeven_local_access_https_23998", "redeven_local_access_http_24000"} {
		r := httptest.NewRequest(http.MethodGet, "http://localhost:23998/", nil)
		r.AddCookie(&http.Cookie{Name: name, Value: login.SessionToken})
		if s.hasLocalAccess(r) || s.ensureLocalAccessHTTPResponse(httptest.NewRecorder(), r) {
			t.Fatalf("cookie from another scope authenticated: %s", name)
		}
		r.AddCookie(&http.Cookie{Name: "redeven_local_access_http_23998", Value: login.SessionToken})
		if !s.hasLocalAccess(r) {
			t.Fatal("foreign cookies shadowed the current authenticated session")
		}
	}
}

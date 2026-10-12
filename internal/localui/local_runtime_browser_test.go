package localui

import (
	"crypto/tls"
	"encoding/json"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestLocalRuntimeBrowserHandoffRequiresNativeLocalOwner(t *testing.T) {
	s := newTestServer(t, nil)
	s.localUIBridgeToken = "private-native-token"
	s.publicAccess.urls = []string{"https://127.0.0.1:23998/"}
	for _, verified := range []bool{false, true} {
		req := httptest.NewRequest("POST", "http://127.0.0.1:24000"+localRuntimeBrowserMintPath, strings.NewReader(`{"entry_url":"https://127.0.0.1:23998/"}`))
		req.Header.Set(localDesktopBridgeTokenHeader, s.localUIBridgeToken)
		if verified {
			req.Header.Set("X-Redeven-Host-Access", "local_host")
		}
		response := httptest.NewRecorder()
		s.HandlerForDesktopBridge().ServeHTTP(response, req)
		if !verified {
			if response.Code != 403 {
				t.Fatalf("remote native admitted: %d", response.Code)
			}
			continue
		}
		if response.Code != 200 {
			t.Fatalf("local mint: %d %s", response.Code, response.Body.String())
		}
		var entry desktopBrowserHandoffMintResponse
		json.Unmarshal(response.Body.Bytes(), &entry)
		redeem := httptest.NewRecorder()
		s.handler().ServeHTTP(redeem, httptest.NewRequest("GET", entry.EntryURL, nil))
		if redeem.Code != 303 {
			t.Fatalf("redeem: %d", redeem.Code)
		}
		cookies := redeem.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != localRuntimeBrowserCookie || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatal("missing scoped browser cookie")
		}
		var owner string
		handler := s.withLocalRuntimeBrowserAccess(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { owner = appserver.VerifiedLocalHost(r) }))
		clean := httptest.NewRequest("GET", "https://127.0.0.1:23998/", nil)
		clean.Header.Set("X-Redeven-Host-Access", "local_host")
		handler.ServeHTTP(httptest.NewRecorder(), clean)
		if owner != "" {
			t.Fatal("frontend header granted locality")
		}
		clean.AddCookie(cookies[0])
		handler.ServeHTTP(httptest.NewRecorder(), clean)
		if owner == "" {
			t.Fatal("verified browser lacks capability")
		}
		acquire := httptest.NewRequest("POST", "https://127.0.0.1:23998/api/local/direct/connect_artifact", strings.NewReader(`{}`))
		acquire.TLS = &tls.ConnectionState{}
		acquire.AddCookie(cookies[0])
		admitted := httptest.NewRecorder()
		s.handler().ServeHTTP(admitted, acquire)
		if admitted.Code != 200 {
			t.Fatalf("verified browser acquisition: %d %s", admitted.Code, admitted.Body.String())
		}
		var envelope connectArtifactEnvelope
		if err := json.Unmarshal(admitted.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		pending := s.pending[envelope.ChannelID]
		if pending.meta.LocalHostAccess == "" {
			t.Fatal("browser proof lost at authenticated artifact admission")
		}
		serialized, _ := json.Marshal(pending.meta)
		if strings.Contains(string(serialized), "local_host_access") || strings.Contains(string(serialized), pending.meta.LocalHostAccess) {
			t.Fatal("local proof became durable metadata")
		}
		other := httptest.NewRequest("GET", "https://localhost:23998/", nil)
		other.AddCookie(cookies[0])
		handler.ServeHTTP(httptest.NewRecorder(), other)
		if owner != "" {
			t.Fatal("cookie crossed authority")
		}
		reuse := httptest.NewRecorder()
		s.handler().ServeHTTP(reuse, httptest.NewRequest("GET", entry.EntryURL, nil))
		if reuse.Code != 401 {
			t.Fatal("handoff reused")
		}
		u, _ := url.Parse(entry.EntryURL)
		if u.Scheme != "https" {
			t.Fatal("public TLS downgraded")
		}
		s.desktopBrowserHandoffs.reset()
		handler.ServeHTTP(httptest.NewRecorder(), clean)
		if owner != "" {
			t.Fatal("browser proof survived Runtime reset")
		}
	}
}

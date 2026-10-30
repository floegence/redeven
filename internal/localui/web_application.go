package localui

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/pluginorigin"
	"github.com/floegence/redeven/internal/webbinding"
)

const webApplicationPath = "/api/local/web-applications/"

// This endpoint is reachable only after the exact Env binding's client key has
// been verified. It serves one app without exposing the Env router to that app.
func (s *Server) handleWebApplication(w http.ResponseWriter, r *http.Request) {
	lease := webEntry(r)
	if lease == nil || s.appServer == nil {
		http.Error(w, "Web application access denied", http.StatusForbidden)
		return
	}
	if !s.requireLocalAccessAPI(w, r) {
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, webApplicationPath), "/", 3)
	if len(parts) != 3 {
		http.NotFound(w, r)
		return
	}
	kind, id := parts[0], parts[1]
	origin, err := webbinding.ApplicationOrigin(lease.Binding.Origin, kind, id)
	if kind == "plugin" {
		origin, err = pluginorigin.Child(lease.Binding.Origin, id)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if r.Header.Get("X-Redeven-Web-App-Origin") != origin {
		http.Error(w, "Web application origin denied", http.StatusForbidden)
		return
	}
	parsed, _ := url.Parse(origin)
	next := r.Clone(r.Context())
	u := *r.URL
	next.URL = &u
	next.URL.Path, next.URL.RawPath = "/"+parts[2], ""
	next.Host = parsed.Host
	next.Header.Set("Origin", origin)
	next.Header.Del("X-Redeven-Web-App-Origin")
	next.Header.Del("X-Redeven-Web-App-Instance")
	next.Header.Del(localAccessResumeHeader)
	// Bootstrap and carrier use the published window protocol. Each artifact is
	// bound to the child origin/resource; the parent Runtime login stays private.
	if kind == "pf" && strings.HasPrefix(next.URL.Path, appserver.WindowTransportPath) {
		ctx := context.WithValue(next.Context(), gatewayMemberOriginKey{}, origin)
		ctx = context.WithValue(ctx, webApplicationKey{}, kind+":"+id)
		next = next.WithContext(ctx)
		s.handleWindowTransport(w, next, id, "")
		return
	}

	// Runtime authorization cookies stay at the trusted boundary, never at apps.
	next.Header.Del("Cookie")
	for _, cookie := range r.Cookies() {
		if !isLocalAuthCookie(cookie.Name) && !strings.HasPrefix(cookie.Name, "__Host-redeven-") {
			next.AddCookie(cookie)
		}
	}
	accessID, _, active := s.activeLocalAccessSession(r)
	if !active {
		http.Error(w, "access expired", http.StatusLocked)
		return
	}
	lifetime, release := s.trackLocalAccessLifetime(r.Context(), accessID)
	defer release()
	if _, _, active = s.activeLocalAccessSession(r); !active {
		http.Error(w, "access expired", http.StatusLocked)
		return
	}
	next = next.WithContext(lifetime)
	if kind == "plugin" {
		s.servePluginWebSurface(w, next, origin)
		return
	}
	if kind == "cs" {
		binding, ok := s.appServer.LocalNativeCodeSpaceBinding(w, r, id)
		if !ok {
			return
		}
		if r.Header.Get("X-Redeven-Web-App-Instance") != binding.InstanceID {
			http.Error(w, "codespace instance closed", http.StatusGone)
			return
		}
		bindingLifetime, stop := context.WithCancel(binding.Context)
		detach := context.AfterFunc(lifetime, stop)
		defer detach()
		defer stop()
		binding.Context = bindingLifetime
		handler, closeHandler, err := appserver.NewNativeCodeSpaceHandler(binding)
		if err != nil {
			http.Error(w, "codespace unavailable", 503)
			return
		}
		defer closeHandler()
		handler.ServeHTTP(w, next)
		return
	}
	// Appserver applies the existing forward permission and resource lifecycle.
	// Product APIs and other resource prefixes never enter its Env router.
	for _, prefix := range []string{"/api/local", "/_redeven_proxy/api", "/cs/", "/pf/"} {
		if strings.HasPrefix(next.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
	}
	s.appServer.ServeHTTP(w, appserver.WithLocalUIPortForwardOrigin(next, id))
}

// The SDK-owned TLS server must handle the carrier at its canonical path. The
// verified Connector maps a child to it without invoking Acceptor.Handler as an
// ordinary application handler (which deliberately rejects that use).
func bindWebApplicationCarrier(r *http.Request) bool {
	id, suppliedOrigin := r.Header.Get("X-Redeven-Web-App-ID"), r.Header.Get("X-Redeven-Web-App-Origin")
	if id == "" && suppliedOrigin == "" {
		return true
	}
	lease := webEntry(r)
	if lease == nil || id == "" || r.URL.Path != "/flowersec/v3/direct" {
		return false
	}
	origin, err := webbinding.ApplicationOrigin(lease.Binding.Origin, "pf", id)
	if err != nil || origin != suppliedOrigin {
		return false
	}
	parsed, _ := url.Parse(origin)
	ctx := context.WithValue(r.Context(), gatewayMemberOriginKey{}, origin)
	ctx = context.WithValue(ctx, webApplicationKey{}, "pf:"+id)
	*r = *r.WithContext(ctx)
	r.Host = parsed.Host
	r.Header.Set("Origin", origin)
	r.Header.Del("X-Redeven-Web-App-ID")
	r.Header.Del("X-Redeven-Web-App-Origin")
	r.Header.Del("X-Redeven-Web-App-Instance")
	return true
}

package localui

import (
	"context"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/codeapp"
	"github.com/floegence/redeven/internal/codeapp/appserver"
)

// Native requests use the same authenticated Local UI listener and Code App cap.
// Only this router consumes the internal prefix and presentation header.
func (s *Server) handleNativeCodeSpace(w http.ResponseWriter, r *http.Request) {
	if s.appServer == nil {
		http.NotFound(w, r)
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/api/local/codespaces/"), "/", 3)
	if len(parts) < 1 || !codeapp.IsValidCodeSpaceID(parts[0]) {
		http.NotFound(w, r)
		return
	}
	if credential := r.Header.Get("X-Redeven-Code-Access"); credential != "" {
		r = r.Clone(r.Context())
		r.Header.Del("X-Redeven-Code-Access")
		cookies := r.Cookies()
		r.Header.Del("Cookie")
		for _, cookie := range cookies {
			if !isLocalAuthCookie(cookie.Name) {
				r.AddCookie(cookie)
			}
		}
		r.AddCookie(&http.Cookie{Name: localAccessCookieName(r), Value: credential})
	}
	if s.accessEnabled() && !s.ensureLocalAccessHTTPResponse(w, r) {
		http.Error(w, "access password required", http.StatusLocked)
		return
	}
	binding, ok := s.appServer.LocalNativeCodeSpaceBinding(w, r, parts[0])
	if !ok {
		return
	}
	if len(parts) == 1 {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]string{"instance_id": binding.InstanceID, "access_cookie_name": localAccessCookieName(r)}})
		return
	}
	if len(parts) != 3 || parts[1] != binding.InstanceID {
		http.Error(w, "codespace instance closed", http.StatusGone)
		return
	}
	presentation, valid := appserver.NativeCodeSpaceOrigin(r.Header.Get("X-Redeven-Code-Origin"))
	if !valid {
		http.Error(w, "invalid codespace origin", http.StatusBadRequest)
		return
	}
	next := r.Clone(r.Context())
	next.Host = presentation.Host
	next.Header.Set("Origin", presentation.String())
	next.Header.Del("X-Redeven-Code-Origin")
	next.Header.Del(localAccessResumeHeader)
	next.Header.Del("Cookie")
	for _, cookie := range r.Cookies() {
		if !isLocalAuthCookie(cookie.Name) {
			next.AddCookie(cookie)
		}
	}
	prefix := "/api/local/codespaces/" + parts[0] + "/" + parts[1]
	if !strings.HasPrefix(r.URL.EscapedPath(), prefix+"/") {
		http.Error(w, "invalid codespace path", http.StatusBadRequest)
		return
	}
	next.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
	if r.URL.RawPath != "" {
		next.URL.RawPath = strings.TrimPrefix(r.URL.RawPath, prefix)
	}
	accessID, _, active := s.activeLocalAccessSession(r)
	if !active {
		http.Error(w, "access expired", http.StatusLocked)
		return
	}
	lifetime, release := s.trackLocalAccessLifetime(binding.Context, accessID)
	defer release()
	// Recheck after registration so a concurrent logout cannot escape cancellation.
	if _, _, active = s.activeLocalAccessSession(r); !active {
		http.Error(w, "access expired", http.StatusLocked)
		return
	}
	binding.Context = lifetime
	handler, closeHandler, err := appserver.NewNativeCodeSpaceHandler(binding)
	if err != nil {
		http.Error(w, "codespace unavailable", http.StatusServiceUnavailable)
		return
	}
	defer closeHandler()
	handler.ServeHTTP(w, next)
}

type nativeCodeAccess struct {
	id     string
	cancel context.CancelFunc
}

// Both native editor and desktop proxy requests end with their access session.
// Callers recheck access after registration to close the concurrent logout race.
func (s *Server) trackLocalAccessLifetime(parent context.Context, id string) (context.Context, func()) {
	lifetime, cancel := context.WithCancel(parent)
	resource := &nativeCodeAccess{id: id, cancel: cancel}
	s.nativeAccess.Store(resource, struct{}{})
	return lifetime, func() { cancel(); s.nativeAccess.Delete(resource) }
}

func (s *Server) closeNativeCodeAccess(id string) {
	s.nativeAccess.Range(func(key, _ any) bool {
		resource := key.(*nativeCodeAccess)
		if id == "" || resource.id == id {
			resource.cancel()
			s.nativeAccess.Delete(resource)
		}
		return true
	})
}

package localui

import (
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	localAccessCookiePrefix    = "redeven_local_access"
	localChallengeCookiePrefix = "redeven_auth_challenge"
)

// Cookies share a host across ports and schemes. Scope the name so an HTTPS
// cookie cannot block HTTP login or overwrite another Runtime's session.
func localAuthCookieName(r *http.Request, prefix string) string {
	if r == nil {
		return ""
	}
	protocol := requestProtocol(r)
	authority, err := canonicalRequestAuthority(r, r.Host)
	if err != nil {
		return ""
	}
	_, port, err := net.SplitHostPort(authority)
	if err != nil {
		return ""
	}
	return prefix + "_" + protocol + "_" + port
}

func localAccessCookieName(r *http.Request) string {
	return localAuthCookieName(r, localAccessCookiePrefix)
}

// Reserved authentication cookies, including retired names, must never reach
// the editor. Recognition here strips credentials; it never authenticates them.
func isLocalAuthCookie(name string) bool {
	for _, prefix := range []string{localAccessCookiePrefix, localChallengeCookiePrefix} {
		if name == prefix || strings.HasPrefix(name, prefix+"_") {
			return true
		}
	}
	return false
}

func localAccessCookie(r *http.Request) *http.Cookie {
	name := localAccessCookieName(r)
	if name == "" {
		return nil
	}
	return &http.Cookie{
		Name:     name,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *Server) setLocalAccessCookie(w http.ResponseWriter, r *http.Request, token string, expiresAtUnixMs int64) {
	if w == nil || token == "" {
		return
	}
	cookie := localAccessCookie(r)
	if cookie == nil {
		return
	}
	cookie.Value = token
	cookie.Expires = time.UnixMilli(expiresAtUnixMs)
	http.SetCookie(w, cookie)
}

func (s *Server) clearLocalAccessCookie(w http.ResponseWriter, r *http.Request) {
	if w == nil {
		return
	}
	cookie := localAccessCookie(r)
	if cookie == nil {
		return
	}
	cookie.MaxAge = -1
	cookie.Expires = time.Unix(0, 0)
	http.SetCookie(w, cookie)
}

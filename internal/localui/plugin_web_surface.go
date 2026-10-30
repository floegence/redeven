package localui

import (
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/pluginorigin"
	"github.com/floegence/redeven/internal/sessionhop"
)

// Public loopback children select only the platform resource handler. The
// current parent listener and exact port must still exist; this does not add a
// management authority or grant a parent session to the child.
func (s *Server) publicPluginWebOrigin(authority string) (string, bool) {
	if s.protocol != "http" {
		return "", false
	}
	origin := "http://" + authority
	for parent := range s.publicAccessSnapshot().authorities {
		if pluginorigin.IsChild("http://"+publicURLAuthority(parent, "http"), origin) {
			return origin, true
		}
	}
	return "", false
}

// The private listener also serves distinct plugin origins. Recognizing an
// origin only selects the resource handler; it grants no management authority.
func desktopPluginWebOrigin(authority string) (string, bool) {
	host, port, err := net.SplitHostPort(authority)
	if err != nil || !strings.HasSuffix(host, ".localhost") {
		return "", false
	}
	label := strings.TrimSuffix(host, ".localhost")
	if len(label) != 48 || strings.Trim(label, "0123456789abcdef") != "" {
		return "", false
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port || net.JoinHostPort(host, port) != authority {
		return "", false
	}
	return "http://" + authority, true
}

func (s *Server) servePluginWebSurface(w http.ResponseWriter, r *http.Request, origin string) {
	if s.appServer == nil {
		http.NotFound(w, r)
		return
	}
	next := r.Clone(r.Context())
	for _, name := range []string{localDesktopBridgeTokenHeader, localAccessResumeHeader,
		"Authorization", "Proxy-Authorization", "X-Redeven-Tessiven-Source", "X-Redeven-Host-Access", sessionhop.HeaderChannelID} {
		next.Header.Del(name)
	}
	next.Header.Del("Cookie")
	for _, cookie := range r.Cookies() {
		if !isLocalAuthCookie(cookie.Name) && !strings.HasPrefix(cookie.Name, "__Host-redeven-") && !strings.HasPrefix(cookie.Name, "__redeven_") {
			next.AddCookie(cookie)
		}
	}
	s.appServer.ServePluginWebSurface(w, next, origin)
}

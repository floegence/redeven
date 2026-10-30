package appserver

import (
	"net/http"
	"net/url"

	"github.com/floegence/redeven/internal/redevpluginintegration"
)

// ServePluginWebSurface is called only by an authenticated listener or proxy
// binding. Resource requests never enter the management router or acquire a
// management session; the released platform owns resource authorization.
func (g *Server) ServePluginWebSurface(w http.ResponseWriter, r *http.Request, origin string) {
	if g == nil || g.pluginWebSurface == nil || r == nil {
		http.NotFound(w, r)
		return
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host != r.Host {
		http.Error(w, "Plugin application origin denied", http.StatusForbidden)
		return
	}
	next, err := redevpluginintegration.WithTrustedOrigin(r, origin)
	if err != nil {
		http.Error(w, "Plugin application origin denied", http.StatusForbidden)
		return
	}
	g.pluginWebSurface.ServeHTTP(w, next)
}

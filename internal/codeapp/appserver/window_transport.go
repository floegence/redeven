package appserver

import (
	"context"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/session"
)

const WindowTransportPath = "/_redeven_window/"
const windowTransportScript = "/_redeven_proxy/window-transport.js"

type windowTransportConfig struct {
	Kind      string `json:"kind"`
	ForwardID string `json:"forward_id"`
	Base      string `json:"base"`
}

func graphicalWindowTransport(r *http.Request, forwardID, base string) windowTransportConfig {
	kind := "tunnel"
	if route, ok := localUIRouteFromRequest(r); ok {
		kind = "direct"
		if route.privateWindowTransport {
			kind = "private"
		}
	}
	return windowTransportConfig{Kind: kind, ForwardID: forwardID, Base: base}
}

// LocalWindowSessionMeta admits only product-owned graphical resources after
// Local UI authenticates the request, before issuing a resource-scoped lease.
func (g *Server) LocalWindowSessionMeta(w http.ResponseWriter, r *http.Request, id string) (*session.Meta, bool) {
	meta, ok := g.requirePermission(w, WithLocalUIPortForwardOrigin(r, id), requiredPermissionFull)
	if !ok {
		return nil, false
	}
	owner := ""
	if g.remoteDesktop != nil {
		if _, user, found := g.remoteDesktop.ForForward(id); found {
			owner = user
		}
	}
	if owner == "" && g.hostApps != nil {
		if _, user, found := g.hostApps.ForForward(id); found {
			owner = user
		}
	}
	if owner == "" || owner != meta.UserPublicID {
		http.Error(w, "graphical window unavailable", http.StatusForbidden)
		return nil, false
	}
	copy := *meta
	copy.CanAdmin = false
	return &copy, true
}

// The authenticated internal hop binds routing only. It must never install the
// local-UI permission shortcut on a native Flowersec request.
type windowSessionRouteKey struct{}

func withWindowSessionRoute(r *http.Request, id string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), windowSessionRouteKey{}, id))
}
func windowSessionRoute(r *http.Request) string {
	if r == nil {
		return ""
	}
	id, _ := r.Context().Value(windowSessionRouteKey{}).(string)
	return id
}

func requireWindowSessionTransport(w http.ResponseWriter, r *http.Request, path string) bool {
	if _, local := localUIRouteFromRequest(r); !local {
		return true
	}
	// Only documents and program assets bootstrap outside the Flowersec session.
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		(path == "/_redeven_host_app/" || path == "/_redeven_desktop/" || path == windowTransportScript || path == "/index.html" || path == "/default-settings.txt" || strings.HasPrefix(path, "/_redeven_desktop/assets/")) {
		return true
	}
	http.Error(w, "Flowersec window transport required", http.StatusForbidden)
	return false
}

// WithPrivateWindowTransport marks a request already authenticated by the
// numeric-loopback Desktop bridge. Public requests cannot supply this marker.
func WithPrivateWindowTransport(r *http.Request) *http.Request {
	route, ok := localUIRouteFromRequest(r)
	if !ok {
		return r
	}
	route.privateWindowTransport = true
	return withLocalUIRoute(r, route)
}

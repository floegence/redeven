package environmentcenter

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/pluginorigin"
)

type pluginOriginPreparation struct {
	parent *openOperation
	cancel context.CancelFunc
}

// Plugin routing has no browser admission cookie or redirect. The authenticated
// parent prepares the route before the platform navigates its iframe, and the
// platform's entry/resource credential remains the only child authorization.
func (a *webAccess) pluginOrigin(w http.ResponseWriter, r *http.Request, parent *openOperation) {
	if (r.Method != http.MethodPost && r.Method != http.MethodDelete) || parent.parent != nil || r.Header.Get("Origin") != parent.route.Origin || r.Header.Get("X-Redeven-Center") != "1" {
		writeJSON(w, nil, ErrDenied)
		return
	}
	var input struct {
		Origin string `json:"origin"`
	}
	if readJSON(w, r, &input) != nil || !pluginorigin.IsChild(parent.route.Origin, input.Origin) {
		writeJSON(w, nil, ErrDenied)
		return
	}
	if r.Method == http.MethodDelete {
		a.mu.Lock()
		if pending := a.pluginPreparations[input.Origin]; pending != nil && pending.parent == parent {
			pending.cancel()
			delete(a.pluginPreparations, input.Origin)
		}
		if route := a.pluginRoutes[input.Origin]; route != nil && route.operation.parent == parent {
			route.operation.cancel()
			delete(a.pluginRoutes, input.Origin)
		}
		a.mu.Unlock()
		writeJSON(w, struct{}{}, nil)
		return
	}
	if a.validateOrigin != nil {
		if err := a.validateOrigin(input.Origin); err != nil {
			writeJSON(w, nil, err)
			return
		}
	}
	var credentials []*http.Cookie
	for _, cookie := range r.Cookies() {
		if strings.HasPrefix(cookie.Name, "redeven_local_access_") {
			credentials = append(credentials, cookie)
		}
	}
	if len(credentials) != 1 || credentials[0].Value == "" || len(credentials[0].Value) > 4096 || parent.connection == nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	ctx, stopProbe := context.WithTimeout(r.Context(), 10*time.Second)
	defer stopProbe()
	stopParentWatch := context.AfterFunc(parent.ctx, stopProbe)
	defer stopParentWatch()
	preparation := &pluginOriginPreparation{parent: parent, cancel: stopProbe}
	a.mu.Lock()
	if a.closed || parent.ctx.Err() != nil || ctx.Err() != nil {
		a.mu.Unlock()
		writeJSON(w, nil, ErrDenied)
		return
	}
	if a.pluginPreparations[input.Origin] != nil {
		a.mu.Unlock()
		writeJSON(w, nil, ErrBusy)
		return
	}
	if existing := a.pluginRoutes[input.Origin]; existing != nil {
		owner := existing.operation
		if owner.parent != parent || owner.runtimeCookie.Name != credentials[0].Name || owner.runtimeCookie.Value != credentials[0].Value || owner.ctx.Err() != nil {
			a.mu.Unlock()
			writeJSON(w, nil, ErrConflict)
			return
		}
	} else {
		count, total := 0, len(a.pluginRoutes)
		for _, route := range a.pluginRoutes {
			if route.operation.parent == parent {
				count++
			}
		}
		for origin, pending := range a.pluginPreparations {
			if a.pluginRoutes[origin] == nil {
				total++
				if pending.parent == parent {
					count++
				}
			}
		}
		if count >= 32 || total >= 256 {
			a.mu.Unlock()
			writeJSON(w, nil, ErrBusy)
			return
		}
	}
	// Reserve before the unlocked probe so DELETE fences an in-flight POST.
	a.pluginPreparations[input.Origin] = preparation
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if a.pluginPreparations[input.Origin] == preparation {
			delete(a.pluginPreparations, input.Origin)
		}
	}()
	probe, err := http.NewRequestWithContext(ctx, http.MethodGet, gatewaymembership.ServiceOrigin(parent.route.RuntimeID)+"/api/local/runtime", nil)
	if err != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	probe.Host = strings.TrimPrefix(parent.route.Origin, "https://")
	probe.AddCookie(credentials[0])
	response, err := parent.connection.RoundTrip(probe)
	if err != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeJSON(w, nil, ErrDenied)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || parent.ctx.Err() != nil || ctx.Err() != nil || a.pluginPreparations[input.Origin] != preparation {
		writeJSON(w, nil, ErrDenied)
		return
	}
	if existing := a.pluginRoutes[input.Origin]; existing != nil {
		owner := existing.operation
		if owner.parent != parent || owner.runtimeCookie.Name != credentials[0].Name || owner.runtimeCookie.Value != credentials[0].Value || owner.ctx.Err() != nil {
			writeJSON(w, nil, ErrConflict)
			return
		}
		writeJSON(w, struct{}{}, nil)
		return
	}
	routeContext, cancel := context.WithCancel(parent.ctx)
	route := parent.route
	route.Origin = input.Origin
	u, _ := url.Parse(input.Origin)
	key, _, _ := strings.Cut(u.Hostname(), ".")
	op := &openOperation{parent: parent, route: route, session: parent.session, device: parent.device, connection: parent.connection, runtimeCookie: *credentials[0], appKind: "plugin", appID: key, ctx: routeContext, cancel: cancel}
	a.pluginRoutes[input.Origin] = &accessSession{operation: op, ctx: routeContext}
	context.AfterFunc(routeContext, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if current := a.pluginRoutes[input.Origin]; current != nil && current.operation == op {
			delete(a.pluginRoutes, input.Origin)
		}
	})
	writeJSON(w, struct{}{}, nil)
}

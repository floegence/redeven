package environmentcenter

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/webbinding"
)

type ApplicationRequest struct {
	RequestID string `json:"request_id"`
	Kind      string `json:"kind"`
	ID        string `json:"id"`
	Path      string `json:"path"`
}

func (a *webAccess) application(w http.ResponseWriter, r *http.Request, parent *openOperation) {
	if r.Method != "POST" || r.Header.Get("Origin") != parent.route.Origin || r.Header.Get("X-Redeven-Center") != "1" || parent.parent != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	var input ApplicationRequest
	if err := readJSON(w, r, &input); err != nil {
		writeJSON(w, nil, err)
		return
	}
	if len(input.RequestID) < 16 || len(input.RequestID) > 100 {
		writeJSON(w, nil, ErrDenied)
		return
	}
	origin, err := webbinding.ApplicationOrigin(parent.route.Origin, input.Kind, input.ID)
	if err != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	if a.validateOrigin != nil {
		if err = a.validateOrigin(origin); err != nil {
			writeJSON(w, nil, err)
			return
		}
	}
	if input.Path == "" {
		input.Path = "/"
	}
	path, err := url.ParseRequestURI(input.Path)
	if err != nil || path.IsAbs() || path.Host != "" || !strings.HasPrefix(input.Path, "/") || strings.HasPrefix(input.Path, "//") || strings.ContainsAny(input.Path, "\\\r\n") || len(input.Path) > 4096 {
		writeJSON(w, nil, ErrDenied)
		return
	}
	var credentials []*http.Cookie
	for _, cookie := range r.Cookies() {
		if strings.HasPrefix(cookie.Name, "redeven_local_access_") {
			credentials = append(credentials, cookie)
		}
	}
	if len(credentials) != 1 || len(credentials[0].Value) > 4096 {
		writeJSON(w, nil, ErrDenied)
		return
	}
	// Validate Runtime authentication on its own public application API first.
	probe, _ := http.NewRequestWithContext(r.Context(), "GET", gatewaymembership.ServiceOrigin(parent.route.RuntimeID)+"/api/local/runtime", nil)
	probe.Host = strings.TrimPrefix(parent.route.Origin, "https://")
	probe.AddCookie(credentials[0])
	response, err := parent.connection.RoundTrip(probe)
	if err != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		writeJSON(w, nil, ErrDenied)
		return
	}
	instance := ""
	if input.Kind == "cs" {
		request, _ := http.NewRequestWithContext(r.Context(), "GET", gatewaymembership.ServiceOrigin(parent.route.RuntimeID)+"/api/local/codespaces/"+input.ID, nil)
		request.Host = strings.TrimPrefix(parent.route.Origin, "https://")
		request.AddCookie(credentials[0])
		response, err := parent.connection.RoundTrip(request)
		if err != nil {
			writeJSON(w, nil, ErrDenied)
			return
		}
		var result struct {
			OK   bool
			Data struct {
				Instance string `json:"instance_id"`
			}
		}
		err = json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&result)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || !result.OK || len(result.Data.Instance) < 16 || len(result.Data.Instance) > 128 {
			writeJSON(w, nil, ErrDenied)
			return
		}
		instance = result.Data.Instance
	}
	a.mu.Lock()
	count, receipts := 0, 0
	for id, previous := range a.operations {
		if time.Now().After(previous.expires) && (previous.ctx.Err() != nil || !previous.consumed || previous.accessOwner != nil) {
			previous.cancel()
			a.releaseLocked(previous)
			delete(a.operations, id)
			continue
		}
		if previous.session == parent.session {
			receipts++
			if previous.ctx.Err() == nil && previous.accessOwner == nil {
				count++
			}
		}
		if previous.session == parent.session && previous.RequestID == input.RequestID {
			if previous.parent != parent || previous.appKind != input.Kind || previous.appID != input.ID || previous.appPath != input.Path || previous.appInstance != instance || previous.runtimeCookie.Value != credentials[0].Value {
				a.mu.Unlock()
				writeJSON(w, nil, ErrConflict)
				return
			}
			if previous.ctx.Err() != nil {
				a.mu.Unlock()
				writeJSON(w, nil, ErrDenied)
				return
			}
			destination := previous.Destination
			a.mu.Unlock()
			writeJSON(w, ApplicationResult{Destination: destination, Origin: origin}, nil)
			return
		}
	}
	// Reopening one resource is a new handoff, not a new authority. Preserve
	// exact parent, resource, Runtime instance and authenticated login identity.
	var existing *openOperation
	for _, access := range a.access {
		owner := access.operation
		if access.ctx.Err() == nil && owner.parent == parent && owner.appKind == input.Kind && owner.appID == input.ID && owner.appInstance == instance && owner.runtimeCookie.Name == credentials[0].Name && owner.runtimeCookie.Value == credentials[0].Value {
			existing = owner
			break
		}
	}
	if count >= 16 && existing == nil || receipts >= 32 {
		a.mu.Unlock()
		writeJSON(w, nil, ErrBusy)
		return
	}
	if parent.ctx.Err() != nil || len(a.operations) >= 128 || a.closed {
		a.mu.Unlock()
		writeJSON(w, nil, ErrBusy)
		return
	}
	ctx, cancel := context.WithCancel(parent.ctx)
	route := parent.route
	route.Origin = origin
	op := &openOperation{Sequence: 1, ID: randomID(), RequestID: input.RequestID, RouteID: parent.RouteID, Status: "ready", route: route, session: parent.session, device: parent.device, ctx: ctx, cancel: cancel, expires: time.Now().Add(5 * time.Minute), connection: parent.connection, parent: parent, appInstance: instance, appKind: input.Kind, appID: input.ID, appPath: input.Path, runtimeCookie: *credentials[0]}
	op.accessOwner = existing
	op.Destination = origin + "/__center/start?operation=" + url.QueryEscape(op.ID)
	a.operations[op.ID] = op
	context.AfterFunc(ctx, func() { a.mu.Lock(); defer a.mu.Unlock(); a.releaseLocked(op) })
	time.AfterFunc(5*time.Minute, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !op.consumed {
			op.cancel()
			a.releaseLocked(op)
		}
	})
	a.mu.Unlock()
	writeJSON(w, ApplicationResult{Destination: op.Destination, Origin: origin}, nil)
}

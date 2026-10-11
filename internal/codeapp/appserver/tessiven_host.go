package appserver

import (
	"context"
	"net/http"

	"github.com/floegence/redeven/internal/tessiven"
	"github.com/gorilla/websocket"
)

// These methods are mounted only by authenticated Runtime control. They are
// intentionally absent from the renderer's Env API route table.
func (g *Server) ServeTessivenHost(ctx context.Context, conn *websocket.Conn, source string) error {
	if g.tessivenResources == nil || g.tessivenResources.Broker == nil {
		return tessiven.ErrTargetUnavailable
	}
	return g.tessivenResources.Broker.Serve(ctx, conn, source)
}
func (g *Server) ExecuteTessivenTarget(ctx context.Context, req tessiven.TargetResourceRequest) (tessiven.ResourceResult, error) {
	if g.tessivenResources == nil {
		return tessiven.ResourceResult{}, tessiven.ErrTargetUnavailable
	}
	switch req.Request.Action {
	case "list", "inspect", "logs", "operation", "open", "start", "stop", "restart":
	default:
		return tessiven.ResourceResult{}, tessiven.ErrInvalidRequest
	}
	// Canvas and latest-version authority were checked at the owning library.
	// The target rechecks actual resource identity and its original manager rights.
	meta := g.localSessionMeta(localUIRoute{kind: localUIRouteEnv})
	meta.CanRead = meta.CanRead && req.Permissions.Read
	meta.CanWrite = meta.CanWrite && req.Permissions.Write
	meta.CanExecute = meta.CanExecute && req.Permissions.Execute
	meta.CanAdmin = meta.CanAdmin && req.Permissions.Admin
	return g.tessivenResources.ExecuteLocal(ctx, meta, req.Request)
}

// WithTessivenDesktopSource is called only after private Desktop bridge admission.
// Public headers and control-plane DTO fields never establish this context.
func (g *Server) WithTessivenDesktopSource(r *http.Request, source string) *http.Request {
	if g.tessivenResources == nil || g.tessivenResources.Broker == nil || !g.tessivenResources.Broker.SourceActive(source) {
		return r
	}
	return r.WithContext(context.WithValue(r.Context(), tessivenDesktopSourceKey{}, source))
}

type tessivenDesktopSourceKey struct{}

// TessivenDesktopSource returns only active private-channel attribution. It is
// used for fresh local acquisition metadata, never durable session recovery.
func (g *Server) TessivenDesktopSource(r *http.Request) string {
	if g == nil || g.tessivenResources == nil || g.tessivenResources.Broker == nil {
		return ""
	}
	source := desktopSourceFromRequest(r)
	if !g.tessivenResources.Broker.SourceActive(source) {
		return ""
	}
	return source
}

func desktopSourceFromRequest(r *http.Request) string {
	source, _ := r.Context().Value(tessivenDesktopSourceKey{}).(string)
	return source
}

// PreflightTessivenSource rechecks the same private Desktop source after native
// confirmation. Caller rights can only narrow the current local owner policy.
func (g *Server) PreflightTessivenSource(source string, scope tessiven.DesktopSourceScope, permissions tessiven.ResourcePermissions, effect string) error {
	if g.tessivenResources == nil || g.tessivenResources.Broker == nil || !g.tessivenResources.Broker.SourceActive(source) {
		return tessiven.ErrTargetUnavailable
	}
	if scope.UserPublicID != localUserPublicID || (scope.FloeApp != localFloeAppAgent && scope.FloeApp != localFloeAppCode) {
		return tessiven.ErrPermissionDenied
	}
	var route localUIRoute
	route.kind = localUIRouteEnv
	if scope.FloeApp == localFloeAppCode {
		route.kind = localUIRouteCodeSpace
	}
	meta := g.localSessionMeta(route)
	meta.DesktopSource = source
	if g.tessivenResources.Broker.Authorize != nil {
		meta = g.tessivenResources.Broker.Authorize(meta)
	}
	if effect != "read" && effect != "resource" && effect != "connect" && effect != "lifecycle" {
		return tessiven.ErrInvalidRequest
	}
	if meta == nil || !meta.CanRead || !permissions.Read || effect != "read" && (!meta.CanWrite || !meta.CanExecute || !permissions.Write || !permissions.Execute) || effect == "lifecycle" && (!meta.CanAdmin || !permissions.Admin) {
		return tessiven.ErrPermissionDenied
	}
	return nil
}

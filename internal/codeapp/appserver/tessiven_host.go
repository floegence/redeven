package appserver

import (
	"context"
	"github.com/floegence/redeven/internal/tessiven"
	"github.com/gorilla/websocket"
)

// These methods are mounted only by authenticated Runtime control. They are
// intentionally absent from the renderer's Env API route table.
func (g *Server) ServeTessivenHost(ctx context.Context, conn *websocket.Conn) error {
	if g.tessivenResources == nil || g.tessivenResources.Broker == nil {
		return tessiven.ErrTargetUnavailable
	}
	return g.tessivenResources.Broker.Serve(ctx, conn)
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
	return g.tessivenResources.ExecuteLocal(ctx, req.Permissions.Meta(), req.Request)
}

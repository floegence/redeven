package agent

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/ai"
	"github.com/gorilla/websocket"
)

func (a *Agent) PrepareDesktopModelSource(session ai.DesktopModelSourceSession) (*ai.AIRuntimeStatus, error) {
	if a == nil || a.code == nil || a.code.AI() == nil {
		return nil, errors.New("ai service not ready")
	}
	return a.code.AI().PrepareDesktopModelSource(session)
}

func (a *Agent) ServeDesktopModelSourceRPC(ctx context.Context, session ai.DesktopModelSourceSession, conn *websocket.Conn, onChange func()) error {
	if a == nil || a.code == nil || a.code.AI() == nil {
		if conn != nil {
			_ = conn.Close()
		}
		return errors.New("ai service not ready")
	}
	return a.code.AI().ServeDesktopModelSourceRPC(ctx, session, conn, onChange)
}

func (a *Agent) DisconnectDesktopModelSource() *ai.AIRuntimeStatus {
	if a == nil || a.code == nil || a.code.AI() == nil {
		return &ai.AIRuntimeStatus{}
	}
	return a.code.AI().DisconnectDesktopModelSource()
}

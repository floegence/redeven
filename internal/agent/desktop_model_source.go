package agent

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/ai"
	"github.com/gorilla/websocket"
)

var errAIServiceUnavailable = errors.New("AI service is unavailable")

func (a *Agent) PrepareDesktopModelSource(session ai.DesktopModelSourceSession) (*ai.AIRuntimeStatus, error) {
	if a == nil || a.code == nil {
		return nil, errAIServiceUnavailable
	}
	aiSvc, _, _, release, err := a.code.AcquireAIService(context.Background())
	if err != nil || aiSvc == nil || release == nil {
		return nil, errAIServiceUnavailable
	}
	defer release()
	return aiSvc.PrepareDesktopModelSource(session)
}

func (a *Agent) ServeDesktopModelSourceRPC(ctx context.Context, session ai.DesktopModelSourceSession, conn *websocket.Conn, onChange func()) error {
	if a == nil || a.code == nil {
		if conn != nil {
			_ = conn.Close()
		}
		return errAIServiceUnavailable
	}
	aiSvc, leaseCtx, _, release, err := a.code.AcquireAIService(ctx)
	if err != nil || aiSvc == nil || release == nil {
		if conn != nil {
			_ = conn.Close()
		}
		return errAIServiceUnavailable
	}
	defer release()
	return aiSvc.ServeDesktopModelSourceRPC(leaseCtx, session, conn, onChange)
}

func (a *Agent) DisconnectDesktopModelSource() *ai.AIRuntimeStatus {
	if a == nil || a.code == nil {
		return &ai.AIRuntimeStatus{}
	}
	aiSvc, _, _, release, err := a.code.AcquireAIService(context.Background())
	if err != nil || aiSvc == nil || release == nil {
		return &ai.AIRuntimeStatus{}
	}
	defer release()
	return aiSvc.DisconnectDesktopModelSource()
}

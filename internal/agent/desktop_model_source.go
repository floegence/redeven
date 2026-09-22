package agent

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/gorilla/websocket"
)

// DesktopModelSourceUnavailable distinguishes a preparing service from a service
// requiring user intervention without creating a second readiness controller.
type DesktopModelSourceUnavailable struct{ Blocked bool }

func (e *DesktopModelSourceUnavailable) Error() string {
	if e.Blocked {
		return "AI service requires attention"
	}
	return "AI service is unavailable"
}

type DesktopModelSourceLease struct {
	service *ai.Service
	ctx     context.Context
	release func()
}

func (l *DesktopModelSourceLease) Release() { l.release() }
func (l *DesktopModelSourceLease) Serve(session ai.DesktopModelSourceSession, conn *websocket.Conn, onChange func()) error {
	return l.service.ServeDesktopModelSourceRPC(l.ctx, session, conn, onChange)
}

// Acquire before upgrading the connection, so HTTP admission reports readiness
// accurately and the established socket retains the same service generation.
func (a *Agent) AcquireDesktopModelSource(ctx context.Context) (*DesktopModelSourceLease, error) {
	if a == nil || a.code == nil {
		return nil, &DesktopModelSourceUnavailable{}
	}
	service, leaseCtx, _, release, err := a.code.AcquireAIService(ctx)
	if err != nil {
		if !errors.Is(err, appserver.ErrAIServiceUnavailable) {
			return nil, err
		}
		return nil, &DesktopModelSourceUnavailable{Blocked: a.code.AIReadiness().State == appserver.AIReadinessBlocked}
	}
	return &DesktopModelSourceLease{service: service, ctx: leaseCtx, release: release}, nil
}

func (a *Agent) PrepareDesktopModelSource(session ai.DesktopModelSourceSession) (*ai.AIRuntimeStatus, error) {
	lease, err := a.AcquireDesktopModelSource(context.Background())
	if err != nil {
		return nil, err
	}
	defer lease.Release()
	return lease.service.PrepareDesktopModelSource(session)
}

func (a *Agent) DisconnectDesktopModelSource() *ai.AIRuntimeStatus {
	lease, err := a.AcquireDesktopModelSource(context.Background())
	if err != nil {
		return &ai.AIRuntimeStatus{}
	}
	defer lease.Release()
	return lease.service.DisconnectDesktopModelSource()
}

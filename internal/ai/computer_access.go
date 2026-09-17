package ai

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

type ComputerAccess = threadstore.ComputerAccess

func (s *Service) ComputerAccess(ctx context.Context, meta *session.Meta, threadID string) (ComputerAccess, error) {
	if meta == nil || !meta.CanRead {
		return ComputerAccess{}, errors.New("computer access denied")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return ComputerAccess{}, err
	}
	return s.snapshotThreadStore().GetComputerAccess(ctx, threadID)
}

func (s *Service) SetComputerAccess(ctx context.Context, meta *session.Meta, threadID string, access ComputerAccess) error {
	if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
		return errors.New("computer access denied")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return err
	}
	if err := access.Validate(); err != nil {
		return err
	}
	if err := s.snapshotThreadStore().SetComputerAccess(ctx, threadID, access); err != nil {
		return err
	}
	// Permission changes invalidate active scripts independently of the action
	// gate. The next invocation reads the sole durable policy source again.
	if runtime, ok := s.targetToolExecutor.(*ComputerUseRuntime); ok {
		runtime.releaseScripts(func(key computerScriptKey) bool { return key.thread == threadID })
	}
	return nil
}

func (r *ComputerUseRuntime) computerAccess(ctx context.Context, threadID string) (ComputerAccess, error) {
	r.mu.RLock()
	bindings := r.bindings
	r.mu.RUnlock()
	store, ok := bindings.(interface {
		GetComputerAccess(context.Context, string) (ComputerAccess, error)
	})
	if !ok {
		return ComputerAccess{}, errors.New("computer access store is unavailable")
	}
	return store.GetComputerAccess(ctx, threadID)
}

func (r *ComputerUseRuntime) authorizeComputerCall(ctx context.Context, call *TargetToolCall) error {
	if call.revalidate != nil {
		if err := call.revalidate(ctx); err != nil {
			return err
		}
	}
	if call.ThreadID == "" || r.targetBindings() == nil {
		return ctx.Err()
	}
	access, err := r.computerAccess(ctx, call.ThreadID)
	if err != nil {
		return err
	}
	call.allowedOrigins, call.allowedApps, call.allowForeground = access.Origins, access.Apps, access.AllowForeground
	return ctx.Err()
}

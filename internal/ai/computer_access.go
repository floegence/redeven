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

func (r *ComputerUseRuntime) authorizeComputerCall(ctx context.Context, call *TargetToolCall) error {
	if call.revalidate != nil {
		if err := call.revalidate(ctx); err != nil {
			return err
		}
	}
	if call.ThreadID == "" || r.targetBindings() == nil {
		return ctx.Err()
	}
	store, ok := r.targetBindings().(interface {
		GetThreadSettingsByCanonicalThreadID(context.Context, string) (*threadstore.ThreadSettings, error)
		GetComputerAccess(context.Context, string) (ComputerAccess, error)
	})
	if !ok {
		return errors.New("computer access store is unavailable")
	}
	settings, err := store.GetThreadSettingsByCanonicalThreadID(ctx, call.ThreadID)
	if err != nil {
		return err
	}
	if settings == nil {
		return errors.New("computer thread settings are unavailable")
	}
	permissionType := settings.PermissionType
	// User control carries TurnID only for interaction provenance. Its policy
	// comes from the saved setting; model calls require their invocation proof.
	if call.TurnID != "" && !call.userInput && !call.controlReturn {
		snapshot, ok := toolAuthorizationSnapshotFromContext(ctx)
		if !ok {
			return errors.New("computer invocation permission snapshot is unavailable")
		}
		permissionType = permissionTypeString(snapshot.PermissionType)
	}

	permission, err := parsePermissionType(permissionType)
	if err != nil {
		return err
	}
	// Full access is the existing task authorization. Per-resource grants only
	// constrain other modes; never persist synthetic grants for full access.
	call.fullAccess = permission == FlowerPermissionFullAccess
	call.allowedOrigins, call.allowedApps, call.allowForeground = nil, nil, call.fullAccess
	if call.fullAccess {
		return ctx.Err()
	}
	access, err := store.GetComputerAccess(ctx, call.ThreadID)
	if err != nil {
		return err
	}
	call.allowedOrigins, call.allowedApps, call.allowForeground = access.Origins, access.Apps, access.AllowForeground
	return ctx.Err()
}

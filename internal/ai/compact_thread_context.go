package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

type CompactThreadContextRequest struct {
	StorageGeneration string `json:"storage_generation"`
	ClientRequestID   string `json:"client_request_id"`
	ContinueGoal      bool   `json:"continue_goal,omitempty"`
}

// CompactThreadContext freezes product configuration and authorizes admission.
// Floret owns execution, deduplication, cancellation, recovery, and installation.
func (s *Service) CompactThreadContext(ctx context.Context, meta *session.Meta, threadID string, req CompactThreadContextRequest) (flruntime.ThreadView, error) {
	if s == nil || s.threadRuntime == nil || s.floretEffects == nil {
		return flruntime.ThreadView{}, errors.New("flower thread runtime is unavailable")
	}
	if err := requireRWX(meta); err != nil {
		return flruntime.ThreadView{}, err
	}
	if req.StorageGeneration != s.storageGeneration {
		return flruntime.ThreadView{}, ErrFlowerStorageRestored
	}
	threadID, req.ClientRequestID = strings.TrimSpace(threadID), strings.TrimSpace(req.ClientRequestID)
	if threadID == "" || !validClientRequestID(req.ClientRequestID) {
		return flruntime.ThreadView{}, errors.New("invalid context compaction identity")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return flruntime.ThreadView{}, err
	}
	_, settings, unlock, err := s.lockCanonicalThreadSettingsMutation(ctx, meta.EndpointID, threadID)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	defer unlock()
	permission, err := threadPermissionType(settings)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	frozen := SendUserTurnRequest{ThreadID: threadID, ClientRequestID: req.ClientRequestID, Model: settings.ModelID, Options: RunOptions{PermissionType: permissionTypeString(permission)}}
	if err := s.requireDesktopModelSourceForSend(ctx, meta, frozen); err != nil {
		return flruntime.ThreadView{}, err
	}
	compactor, ok := s.threadRuntime.(flruntime.ThreadContextCompactor)
	if !ok {
		return flruntime.ThreadView{}, errors.New("published Floret runtime does not expose context compaction")
	}
	if err := s.persistExecutionAuthority(ctx, meta, threadID, req.ClientRequestID, "", frozen.Options.PermissionType); err != nil {
		return flruntime.ThreadView{}, err
	}
	s.floretEffects.put(identity.ThreadID(threadID), req.ClientRequestID, floretEffectRequest{meta: *meta, req: frozen})
	view, err := compactor.CompactContext(ctxOrBackground(ctx), flruntime.CompactContextInput{ThreadID: identity.ThreadID(threadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ContinueGoal: req.ContinueGoal})
	if err != nil {
		s.floretEffects.drop(identity.ThreadID(threadID), req.ClientRequestID)
	} else {
		// The factory binds authority before preparing the model. A replay can
		// arrive after that input was consumed; never retain it as a second inbox.
		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		authority, readErr := db.GetExecutionAuthority(ctxOrBackground(ctx), req.ClientRequestID)
		if view.Activity == flruntime.ThreadActivityIdle || (readErr == nil && authority != nil && authority.TurnID != "") {
			s.floretEffects.drop(identity.ThreadID(threadID), req.ClientRequestID)
		}
	}
	return view, err
}

package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// ErrThreadGoalOutcomeUnknown keeps the original request replayable when a
// mutation or its subsequent current-view read cannot be confirmed.
var ErrThreadGoalOutcomeUnknown = errors.New("goal mutation outcome is unknown")

const ThreadGoalOutcomeUnknownErrorCode = "AI_GOAL_OUTCOME_UNKNOWN"

type ThreadGoalRequest struct {
	StorageGeneration string               `json:"storage_generation"`
	ClientRequestID   string               `json:"client_request_id"`
	ThreadID          string               `json:"thread_id,omitempty"`
	ExpectedVersion   int64                `json:"expected_version"`
	Operation         string               `json:"operation"`
	Text              string               `json:"text,omitempty"`
	NewThread         *CreateThreadRequest `json:"new_thread,omitempty"`
}

// ManageThreadGoal authorizes product access and delegates every Goal fact to Floret.
// Creating an empty conversation here never admits user input or provider work.
func (s *Service) ManageThreadGoal(ctx context.Context, meta *session.Meta, req ThreadGoalRequest) (flruntime.GoalMutationResult, flruntime.ThreadView, error) {
	if s == nil || s.threadRuntime == nil {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, errors.New("flower thread runtime is unavailable")
	}
	if err := requireRWX(meta); err != nil {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, err
	}
	if req.StorageGeneration != s.storageGeneration {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, ErrFlowerStorageRestored
	}
	req.ThreadID = strings.TrimSpace(req.ThreadID)
	req.ClientRequestID = strings.TrimSpace(req.ClientRequestID)
	if !validClientRequestID(req.ClientRequestID) || req.ExpectedVersion < 0 || req.ThreadID != "" && req.NewThread != nil || (req.Operation != "set" && req.Operation != "delete") || req.Operation == "set" && strings.TrimSpace(req.Text) == "" {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, errors.New("invalid goal request")
	}
	if req.ThreadID == "" {
		if req.Operation != "set" || req.ExpectedVersion != 0 || req.NewThread == nil {
			return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, errors.New("new goal requires conversation settings")
		}
		create := *req.NewThread
		digest := sha256.Sum256([]byte("flower-goal-thread\x00" + req.ClientRequestID))
		create.ClientRequestID = "goal-thread:" + hex.EncodeToString(digest[:])
		thread, err := s.CreateThreadWithOptions(ctx, meta, create)
		if err != nil {
			if !errors.Is(err, flruntime.ErrRequestConflict) {
				err = fmt.Errorf("%w: %w", ErrThreadGoalOutcomeUnknown, err)
			}
			return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, err
		}
		req.ThreadID = thread.ThreadID
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, req.ThreadID); err != nil {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, err
	}
	controller, ok := s.threadRuntime.(flruntime.ThreadGoalController)
	if !ok {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, errors.New("published Floret runtime does not expose goal management")
	}
	var result flruntime.GoalMutationResult
	var err error
	if req.Operation == "set" {
		result, err = controller.SetGoal(ctx, flruntime.SetGoalInput{ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ExpectedVersion: req.ExpectedVersion, Text: req.Text})
	} else {
		result, err = controller.DeleteGoal(ctx, flruntime.DeleteGoalInput{ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ExpectedVersion: req.ExpectedVersion})
	}
	if err != nil {
		if !errors.Is(err, flruntime.ErrRequestConflict) {
			err = fmt.Errorf("%w: %w", ErrThreadGoalOutcomeUnknown, err)
		}
		return result, flruntime.ThreadView{}, err
	}
	view, err := s.threadRuntime.View(ctx, identity.ThreadID(req.ThreadID))
	if err != nil {
		return result, view, fmt.Errorf("%w: %w", ErrThreadGoalOutcomeUnknown, err)
	}
	return result, view, nil
}

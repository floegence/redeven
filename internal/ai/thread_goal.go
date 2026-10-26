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
// Save-only edits and deletion never execute; explicit submission delegates
// idle-only admission to the same canonical Floret owner.
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
	if !validClientRequestID(req.ClientRequestID) || req.ExpectedVersion < 0 || req.ThreadID != "" && req.NewThread != nil || (req.Operation != "set" && req.Operation != "submit" && req.Operation != "delete") || req.Operation != "delete" && strings.TrimSpace(req.Text) == "" {
		return flruntime.GoalMutationResult{}, flruntime.ThreadView{}, errors.New("invalid goal request")
	}
	if req.ThreadID == "" {
		if req.Operation == "delete" || req.ExpectedVersion != 0 || req.NewThread == nil {
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
	var leaseKey string
	var newlyAdmitted bool
	var execution flruntime.GoalExecution
	if req.Operation == "submit" {
		submitter, ok := s.threadRuntime.(flruntime.ThreadGoalSubmitter)
		if !ok {
			return result, flruntime.ThreadView{}, errors.New("published Floret runtime does not expose goal submission")
		}
		if err := s.authorizeGoalSubmission(ctx, meta, req); err != nil {
			return result, flruntime.ThreadView{}, err
		}
		leaseKey, newlyAdmitted, err = s.admitAIUserTurn(meta.EndpointID, req.ThreadID, req.ClientRequestID)
		if err != nil {
			return result, flruntime.ThreadView{}, err
		}
		submitted, submitErr := submitter.SubmitGoal(ctx, flruntime.SetGoalInput{ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ExpectedVersion: req.ExpectedVersion, Text: req.Text})
		result, err, execution = submitted.GoalMutationResult, submitErr, submitted.Execution
	} else if req.Operation == "set" {
		result, err = controller.SetGoal(ctx, flruntime.SetGoalInput{ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ExpectedVersion: req.ExpectedVersion, Text: req.Text})
	} else {
		result, err = controller.DeleteGoal(ctx, flruntime.DeleteGoalInput{ThreadID: identity.ThreadID(req.ThreadID), RequestKey: flruntime.RequestKey(req.ClientRequestID), ExpectedVersion: req.ExpectedVersion})
	}
	if err != nil {
		s.rejectAIUserTurnLease(leaseKey, newlyAdmitted)
		if !errors.Is(err, flruntime.ErrRequestConflict) {
			err = fmt.Errorf("%w: %w", ErrThreadGoalOutcomeUnknown, err)
		}
		return result, flruntime.ThreadView{}, err
	}
	view, err := s.threadRuntime.View(ctx, identity.ThreadID(req.ThreadID))
	if err != nil {
		s.rejectAIUserTurnLease(leaseKey, newlyAdmitted)
		return result, view, fmt.Errorf("%w: %w", ErrThreadGoalOutcomeUnknown, err)
	}
	if execution == flruntime.GoalExecutionStarted {
		s.acceptAIUserTurnReceipt(ctx, leaseKey, req.ThreadID)
	} else {
		s.rejectAIUserTurnLease(leaseKey, newlyAdmitted)
	}
	return result, view, nil
}

// Reuse the ordinary durable authorization contract. Floret alone decides whether
// this submission starts work; no pending execution inbox is needed for text.
func (s *Service) authorizeGoalSubmission(ctx context.Context, meta *session.Meta, req ThreadGoalRequest) error {
	_, settings, unlock, err := s.lockCanonicalThreadSettingsMutation(ctx, meta.EndpointID, req.ThreadID)
	if err != nil {
		return err
	}
	defer unlock()
	key := string(flruntime.GoalSubmissionRequestKey(flruntime.RequestKey(req.ClientRequestID)))
	db := s.snapshotThreadStore()
	if db == nil {
		return errors.New("threads store not ready")
	}
	existing, err := db.GetExecutionAuthority(ctx, key)
	if err != nil {
		return err
	}
	if existing != nil {
		if existing.ThreadID != req.ThreadID || existing.EndpointID != meta.EndpointID || existing.UserPublicID != meta.UserPublicID {
			return flruntime.ErrRequestConflict
		}
		return nil
	}
	permission, err := threadPermissionType(settings)
	if err != nil {
		return err
	}
	frozen := SendUserTurnRequest{ThreadID: req.ThreadID, Model: settings.ModelID}
	if err := s.requireDesktopModelSourceForSend(ctx, meta, frozen); err != nil {
		return err
	}
	return s.persistExecutionAuthority(ctx, meta, req.ThreadID, key, "", permissionTypeString(permission))
}

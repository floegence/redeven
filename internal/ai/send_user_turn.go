package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/session"
)

var ErrRunChanged = errors.New("run changed")
var ErrWaitingPromptChanged = errors.New("waiting prompt changed")
var ErrWaitingUserQueueConflict = errors.New("waiting-user queue request conflicts with waiting response")
var ErrFollowupsRevisionChanged = errors.New("followups revision changed")
var ErrInvalidFollowupLane = errors.New("invalid followup lane")
var ErrReadOnlyThread = errors.New("thread is read only")
var ErrCompactAlreadyPending = errors.New("context compaction already pending")
var ErrNoCompactableContext = errors.New("no compactable context")

const compactThreadContextSourceSlashCommand = "slash_command"

type SendUserTurnRequest struct {
	ThreadID              string     `json:"thread_id"`
	Model                 string     `json:"model,omitempty"`
	Input                 RunInput   `json:"input"`
	Options               RunOptions `json:"options"`
	ExpectedRunID         string     `json:"expected_run_id,omitempty"`
	QueueAfterWaitingUser bool       `json:"queue_after_waiting_user,omitempty"`
	SourceFollowupID      string     `json:"source_followup_id,omitempty"`
}

type SendUserTurnResponse struct {
	RunID                   string `json:"run_id"`
	TurnID                  string `json:"turn_id"`
	Kind                    string `json:"kind"` // "start" | "queued"
	QueueID                 string `json:"queue_id,omitempty"`
	QueuePosition           int    `json:"queue_position,omitempty"`
	ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string `json:"applied_permission_type,omitempty"`
}

type CompactThreadContextRequest struct {
	ThreadID    string `json:"thread_id"`
	ActiveRunID string `json:"active_run_id,omitempty"`
}

type CompactThreadContextResponse struct {
	RequestID string `json:"request_id,omitempty"`
	Kind      string `json:"kind"`
	ErrorCode string `json:"error_code,omitempty"`
}

type admittedUserTurn struct {
	TurnID string
	RunID  string
}

type preparedUserTurn struct {
	TurnID          string
	CreatedAtUnixMs int64
	UploadIDs       []string
}

func (s *Service) SendUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if s == nil {
		return SendUserTurnResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SendUserTurnResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return SendUserTurnResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return SendUserTurnResponse{}, errors.New("thread actor not ready")
	}
	return actor.SendUserTurn(ctx, meta, req)
}

func (s *Service) CompactThreadContext(ctx context.Context, meta *session.Meta, req CompactThreadContextRequest) (CompactThreadContextResponse, error) {
	if s == nil {
		return CompactThreadContextResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return CompactThreadContextResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return CompactThreadContextResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return CompactThreadContextResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return CompactThreadContextResponse{}, errors.New("thread actor not ready")
	}
	return actor.CompactThreadContext(ctx, meta, req)
}

func (s *Service) SubmitRequestUserInputResponse(ctx context.Context, meta *session.Meta, req SubmitRequestUserInputResponseRequest) (SubmitRequestUserInputResponseResponse, error) {
	if s == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return SubmitRequestUserInputResponseResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread actor not ready")
	}
	return actor.SubmitRequestUserInputResponse(ctx, meta, req)
}

func isSafeClientTurnID(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	if len(raw) > 128 {
		return false
	}
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		switch {
		case ch >= 'a' && ch <= 'z':
			continue
		case ch >= 'A' && ch <= 'Z':
			continue
		case ch >= '0' && ch <= '9':
			continue
		case ch == '_' || ch == '-':
			continue
		default:
			return false
		}
	}
	return true
}

func normalizeOrCreateTurnID(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return newTurnID()
	}
	if !isSafeClientTurnID(raw) {
		return "", errors.New("invalid turn_id")
	}
	return raw, nil
}

func (s *Service) prepareUserTurn(ctx context.Context, meta *session.Meta, endpointID string, threadID string, input RunInput) (preparedUserTurn, RunInput, error) {
	if s == nil {
		return preparedUserTurn{}, input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if meta == nil || endpointID == "" || threadID == "" {
		return preparedUserTurn{}, input, errors.New("invalid request")
	}

	turnID, err := normalizeOrCreateTurnID(input.TurnID)
	if err != nil {
		return preparedUserTurn{}, input, err
	}
	input.TurnID = turnID
	input, _, uploadIDs, err := s.normalizeInputAttachments(ctx, endpointID, input)
	if err != nil {
		return preparedUserTurn{}, input, err
	}
	return preparedUserTurn{
		TurnID: turnID, CreatedAtUnixMs: time.Now().UnixMilli(), UploadIDs: uploadIDs,
	}, input, nil
}

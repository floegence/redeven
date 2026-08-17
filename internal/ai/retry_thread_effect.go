package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

func (s *Service) RetryThreadEffect(ctx context.Context, meta *session.Meta, threadID string, req RetryThreadEffectRequest) (RetryThreadEffectResponse, error) {
	if s == nil {
		return RetryThreadEffectResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return RetryThreadEffectResponse{}, err
	}
	threadID = strings.TrimSpace(threadID)
	effectAttemptID := strings.TrimSpace(req.EffectAttemptID)
	toolCallID := strings.TrimSpace(req.ToolCallID)
	if meta == nil || strings.TrimSpace(meta.EndpointID) == "" || threadID == "" || effectAttemptID == "" || toolCallID == "" || !req.AcknowledgeUnknownRisk {
		return RetryThreadEffectResponse{}, errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return RetryThreadEffectResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	view, err := typed.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	requestID, err := newProductRequestID("retry_effect_")
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return RetryThreadEffectResponse{}, errors.New("threads store not ready")
	}
	sourceTurn := view.TurnID.String()
	for _, interaction := range view.Interactions {
		if interaction.Kind == flruntime.ThreadInteractionEffectRetry && interaction.EffectRetry != nil && interaction.EffectRetry.EffectAttemptID == effectAttemptID {
			sourceTurn = interaction.TurnID.String()
			break
		}
	}
	authority, err := db.GetExecutionAuthorityByTurn(ctx, threadID, sourceTurn)
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	if err := s.persistExecutionAuthorityRecord(ctx, authority, requestID, sourceTurn); err != nil {
		return RetryThreadEffectResponse{}, err
	}
	_, err = typed.RetryEffect(ctx, flruntime.RetryEffectInput{
		ThreadID: identity.ThreadID(threadID), EffectAttemptID: effectAttemptID,
		ToolCallID: toolCallID, AcknowledgeUnknownRisk: true,
		RequestKey: flruntime.RequestKey(requestID),
	})
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	return RetryThreadEffectResponse{OK: true}, nil
}

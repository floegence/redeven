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
	if _, err := s.GetThread(ctx, meta, threadID); err != nil {
		return RetryThreadEffectResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return RetryThreadEffectResponse{}, err
	}
	requestID, err := newProductRequestID("retry_effect_")
	if err != nil {
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

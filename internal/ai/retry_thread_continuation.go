package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

var ErrThreadContinuationRetryUnavailable = errors.New("thread continuation retry unavailable")

func (s *Service) RetryThreadContinuation(ctx context.Context, meta *session.Meta, threadID string) (RetryThreadContinuationResponse, error) {
	if s == nil {
		return RetryThreadContinuationResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	threadID = strings.TrimSpace(threadID)
	endpointID := ""
	if meta != nil {
		endpointID = strings.TrimSpace(meta.EndpointID)
	}
	if endpointID == "" || threadID == "" {
		return RetryThreadContinuationResponse{}, errors.New("invalid request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, endpointID, threadID); err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	view, err := typed.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	if view.LastOutcome == nil || *view.LastOutcome != flruntime.TurnOutcomeFailed || view.TurnID == "" {
		return RetryThreadContinuationResponse{}, ErrThreadContinuationRetryUnavailable
	}
	requestID, err := newProductRequestID("retry_")
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	requestKey := flruntime.RequestKey(requestID)
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return RetryThreadContinuationResponse{}, errors.New("threads store not ready")
	}
	authority, err := db.GetExecutionAuthorityByTurn(ctx, threadID, view.TurnID.String())
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	if err := s.persistExecutionAuthorityRecord(ctx, authority, requestID, view.TurnID.String()); err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	retryView, err := typed.Retry(ctx, flruntime.RetryInput{ThreadID: identity.ThreadID(threadID), SourceTurnID: view.TurnID, RequestKey: requestKey})
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	if retryView.TurnID == "" {
		return RetryThreadContinuationResponse{}, errors.New("retry turn authority is unavailable")
	}
	persistCtx, cancelPersist := context.WithTimeout(context.Background(), s.persistTimeout())
	defer cancelPersist()
	if err := s.persistExecutionAuthorityRecord(persistCtx, authority, requestID, retryView.TurnID.String()); err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	return RetryThreadContinuationResponse{OK: true}, nil
}

package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// StopThread asks Floret's single thread runtime owner to cancel the current
// execution. Exact requests retain their target and request identity across
// transport retries; the upstream owner rejects stale execution targets.
func (s *Service) StopThread(ctx context.Context, meta *session.Meta, threadID string, requests ...StopThreadRequest) (StopThreadResponse, error) {
	if s == nil {
		return StopThreadResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return StopThreadResponse{}, err
	}
	threadID = strings.TrimSpace(threadID)
	if strings.TrimSpace(meta.EndpointID) == "" || threadID == "" {
		return StopThreadResponse{}, errors.New("invalid request")
	}
	if err := s.requireInteractiveThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return StopThreadResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return StopThreadResponse{}, err
	}
	if len(requests) > 1 {
		return StopThreadResponse{}, errors.New("invalid stop request")
	}
	var request StopThreadRequest
	if len(requests) == 1 {
		request = requests[0]
	}
	request.ExpectedTurnID = strings.TrimSpace(request.ExpectedTurnID)
	request.ExpectedRunID = strings.TrimSpace(request.ExpectedRunID)
	request.ClientRequestID = strings.TrimSpace(request.ClientRequestID)
	exact := request.ExpectedTurnID != "" || request.ExpectedRunID != "" || request.ClientRequestID != ""
	if exact && (request.ExpectedTurnID == "" || request.ExpectedRunID == "" || request.ClientRequestID == "") {
		return StopThreadResponse{}, errors.New("stop requires expected_turn_id, expected_run_id and client_request_id together")
	}
	requestID := "stop:" + request.ClientRequestID
	if !exact {
		requestID, err = newProductRequestID("stop_")
		if err != nil {
			return StopThreadResponse{}, err
		}
	}
	requestKey := flruntime.RequestKey(requestID)
	_, err = typed.Cancel(ctx, flruntime.CancelInput{ThreadID: identity.ThreadID(threadID), ExpectedTurnID: identity.TurnID(request.ExpectedTurnID), ExpectedRunID: identity.RunID(request.ExpectedRunID), RequestKey: requestKey, Mode: flruntime.CancelModeGraceful, IncludeDescendants: true})
	if err != nil && !errors.Is(err, flruntime.ErrThreadNotFound) && !errors.Is(err, flruntime.ErrThreadDeleted) {
		return StopThreadResponse{}, err
	}
	return StopThreadResponse{OK: true}, nil
}

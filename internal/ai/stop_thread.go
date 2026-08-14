package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/session"
)

// StopThread asks Floret's single thread runtime owner to cancel the current
// turn. Cancel is idempotent for every known thread, including a thread whose
// provider effect adapter is not resident in this process.
func (s *Service) StopThread(ctx context.Context, meta *session.Meta, threadID string) (StopThreadResponse, error) {
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
	if _, err := s.GetThread(ctx, meta, threadID); err != nil {
		return StopThreadResponse{}, err
	}
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return StopThreadResponse{}, err
	}
	requestID, err := newProductRequestID("stop_")
	if err != nil {
		return StopThreadResponse{}, err
	}
	requestKey := flruntime.RequestKey(requestID)
	if _, err := typed.Cancel(ctx, flruntime.CancelInput{ThreadID: identity.ThreadID(threadID), RequestKey: requestKey}); err != nil && !errors.Is(err, flruntime.ErrThreadNotFound) && !errors.Is(err, flruntime.ErrThreadDeleted) {
		return StopThreadResponse{}, err
	}
	return StopThreadResponse{OK: true}, nil
}

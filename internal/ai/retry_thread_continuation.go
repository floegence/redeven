package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/session"
)

var ErrThreadContinuationRetryUnavailable = errors.New("thread continuation retry unavailable")

const continuationRetryReason = "retry provider continuation"

func continuationRetryLogicalRequestID(threadID string, turn *flruntime.ThreadTurnSnapshot) (identity.LogicalRequestID, string, error) {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" || turn == nil || turn.TurnID == "" || turn.RunID == "" || !turn.CanRetry ||
		(turn.Status != flruntime.TurnStatusFailed && turn.Status != flruntime.TurnStatusInterrupted) {
		return "", "", ErrThreadContinuationRetryUnavailable
	}
	source := strings.Join([]string{threadID, turn.TurnID.String(), turn.RunID.String()}, "\x00")
	digest := sha256.Sum256([]byte("redeven-floret-continuation-retry-v1\x00" + source))
	requestID, err := identity.ParseLogicalRequestID("redeven-retry-" + hex.EncodeToString(digest[:16]))
	if err != nil {
		return "", "", fmt.Errorf("derive continuation retry identity: %w", err)
	}
	return requestID, "continuation-retry-" + hex.EncodeToString(digest[:16]), nil
}

func canonicalContinuationRetryAlreadyAccepted(snapshot flruntime.ThreadSnapshot, latest *flruntime.ThreadTurnSnapshot) bool {
	if latest == nil || latest.RetrySource == nil {
		return false
	}
	switch snapshot.Status {
	case flruntime.ThreadStatusRunning, flruntime.ThreadStatusWaiting, flruntime.ThreadStatusCompleted:
		return true
	default:
		return false
	}
}

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

	snapshot, latest, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	if canonicalContinuationRetryAlreadyAccepted(snapshot, latest) {
		return RetryThreadContinuationResponse{OK: true}, nil
	}
	requestID, executionKey, err := continuationRetryLogicalRequestID(threadID, latest)
	if err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	prepared, err := s.prepareRun(meta, executionKey, RunStartRequest{
		ThreadID: threadID,
		Retry: &FloretContinuationRetry{
			LogicalRequestID: requestID,
			Reason:           continuationRetryReason,
		},
	}, nil)
	if err != nil {
		if errors.Is(err, ErrThreadBusy) && s.continuationRetryExecutionActive(endpointID, threadID, executionKey) {
			return RetryThreadContinuationResponse{OK: true}, nil
		}
		return RetryThreadContinuationResponse{}, err
	}
	go func() {
		if runErr := s.executePreparedRun(context.Background(), prepared); runErr != nil && s.log != nil {
			s.log.Warn("ai detached continuation retry failed", "thread_id", threadID, "error", runErr)
		}
	}()

	// RetryTurn allocates the canonical retry turn before provider dispatch. Wait
	// only for that in-memory admission boundary so the subsequent bootstrap can
	// observe running without waiting for provider TTFB or completion.
	waitCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := waitForFloretRetryAdmission(waitCtx, prepared.r); err != nil {
		return RetryThreadContinuationResponse{}, err
	}
	return RetryThreadContinuationResponse{OK: true}, nil
}

func (s *Service) continuationRetryExecutionActive(endpointID string, threadID string, executionKey string) bool {
	if s == nil {
		return false
	}
	key := runThreadKey(endpointID, threadID)
	s.mu.Lock()
	defer s.mu.Unlock()
	return key != "" && strings.TrimSpace(s.activeRunByTh[key]) == strings.TrimSpace(executionKey) && s.runs[executionKey] != nil
}

func waitForFloretRetryAdmission(ctx context.Context, r *run) error {
	if r == nil {
		return errors.New("continuation retry owner is unavailable")
	}
	ticker := time.NewTicker(2 * time.Millisecond)
	defer ticker.Stop()
	for {
		runID, threadID, turnID := r.floretCanonicalIdentity()
		if runID != "" && threadID != "" && turnID != "" {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for continuation retry admission: %w", ctx.Err())
		case <-r.doneCh:
			runID, threadID, turnID = r.floretCanonicalIdentity()
			if runID != "" && threadID != "" && turnID != "" {
				return nil
			}
			return ErrThreadContinuationRetryUnavailable
		case <-ticker.C:
		}
	}
}

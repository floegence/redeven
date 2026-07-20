package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const floretStartupRecoveryRetryInterval = time.Second

type floretStartupRecoveryResult struct {
	recovered int
	pending   bool
}

type floretStartupRecoveryTarget struct {
	description string
	factory     floretInterruptedTurnRecoveryHostFactory
}

func (s *Service) recoverPreTurnStartupOperations(ctx context.Context) error {
	for {
		completed, err := s.replayPendingThreadCreateOperations(ctxOrBackground(ctx))
		if err != nil {
			return fmt.Errorf("recover pending thread creates: %w", err)
		}
		if completed == 0 {
			return nil
		}
	}
}

func buildFloretStartupRecoveryTargets(ctx context.Context, db interface {
	ListAllThreadSettingsForRecovery(context.Context) ([]threadstore.ThreadSettings, error)
}, capabilities floretStartupRecoveryCapabilities) ([]floretStartupRecoveryTarget, error) {
	if db == nil || capabilities.root == nil || capabilities.subagent == nil || capabilities.listSubagents == nil {
		return nil, errors.New("Floret startup recovery capability is unavailable")
	}
	settings, err := db.ListAllThreadSettingsForRecovery(ctx)
	if err != nil {
		return nil, fmt.Errorf("list recovery thread settings: %w", err)
	}
	targets := make([]floretStartupRecoveryTarget, 0, len(settings))
	for _, item := range settings {
		threadID := strings.TrimSpace(item.ThreadID)
		if threadID == "" {
			return nil, errors.New("recovery thread settings contain an empty thread identity")
		}
		rootThreadID := flruntime.ThreadID(threadID)
		rootFactory, err := capabilities.root(ctx, rootThreadID)
		switch {
		case errors.Is(err, flruntime.ErrInterruptedTurnNotFound):
		case err != nil:
			return nil, fmt.Errorf("bind root recovery target %q: %w", threadID, err)
		case rootFactory == nil:
			return nil, fmt.Errorf("bind root recovery target %q: empty factory", threadID)
		default:
			targets = append(targets, floretStartupRecoveryTarget{
				description: fmt.Sprintf("root thread %q", threadID),
				factory:     rootFactory,
			})
		}

		readHost, err := capabilities.listSubagents(ctx, rootThreadID)
		if err != nil {
			return nil, fmt.Errorf("bind SubAgent recovery read for %q: %w", threadID, err)
		}
		children, err := readHost.ListSubAgents(ctx, rootThreadID)
		if err != nil {
			return nil, fmt.Errorf("list SubAgents for recovery parent %q: %w", threadID, err)
		}
		for _, child := range children {
			childThreadID := strings.TrimSpace(string(child.ThreadID))
			if childThreadID == "" || strings.TrimSpace(string(child.ParentThreadID)) != threadID {
				return nil, errors.New("Floret SubAgent recovery identity is invalid")
			}
			parentID := rootThreadID
			childID := flruntime.ThreadID(childThreadID)
			childFactory, err := capabilities.subagent(ctx, parentID, childID)
			switch {
			case errors.Is(err, flruntime.ErrInterruptedTurnNotFound):
				continue
			case err != nil:
				return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: %w", childThreadID, threadID, err)
			case childFactory == nil:
				return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: empty factory", childThreadID, threadID)
			default:
				targets = append(targets, floretStartupRecoveryTarget{
					description: fmt.Sprintf("SubAgent %q under %q", childThreadID, threadID),
					factory:     childFactory,
				})
			}
		}
	}
	return targets, nil
}

func (s *Service) startFloretStartupRecovery(targets []floretStartupRecoveryTarget) error {
	if s == nil {
		return errors.New("Floret startup recovery coordinator is unavailable")
	}
	targets = append([]floretStartupRecoveryTarget(nil), targets...)
	for _, target := range targets {
		if strings.TrimSpace(target.description) == "" || target.factory == nil {
			return errors.New("Floret startup recovery target is invalid")
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
	result, err := recoverInterruptedFloretTurns(ctx, targets)
	if err != nil {
		cancel()
		s.setFloretStartupRecoveryState(false, err)
		return err
	}
	if !result.pending {
		if err := s.recoverPostTurnStartupOperations(ctx); err != nil {
			cancel()
			s.setFloretStartupRecoveryState(false, err)
			return err
		}
		cancel()
		s.setFloretStartupRecoveryState(false, nil)
		return nil
	}
	cancel()
	s.setFloretStartupRecoveryState(true, nil)
	s.recoveryWG.Add(1)
	go func() {
		defer s.recoveryWG.Done()
		ticker := time.NewTicker(floretStartupRecoveryRetryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), s.persistTimeout())
				result, err := recoverInterruptedFloretTurns(ctx, targets)
				if err != nil {
					cancel()
					s.setFloretStartupRecoveryState(false, err)
					if s.log != nil {
						s.log.Error("ai: Floret startup recovery failed", "error", err)
					}
					return
				}
				if result.pending {
					cancel()
					continue
				}
				if err := s.recoverPostTurnStartupOperations(ctx); err != nil {
					cancel()
					s.setFloretStartupRecoveryState(false, err)
					if s.log != nil {
						s.log.Error("ai: post-turn startup recovery failed", "error", err)
					}
					return
				}
				cancel()
				s.setFloretStartupRecoveryState(false, nil)
				s.scheduleQueuedTurnRecovery()
				return
			case <-s.recoveryStopCh:
				return
			}
		}
	}()
	return nil
}

func (s *Service) recoverPostTurnStartupOperations(ctx context.Context) error {
	if s == nil {
		return errors.New("post-turn startup recovery coordinator is unavailable")
	}
	return recoverPostTurnStartupOperations(
		ctxOrBackground(ctx),
		func(ctx context.Context) (int, error) { return s.replayPendingThreadForkOperations(ctx) },
		func(ctx context.Context) (int, error) { return s.replayPendingSubAgentPublications(ctx) },
	)
}

func recoverPostTurnStartupOperations(
	ctx context.Context,
	replayForkBatch func(context.Context) (int, error),
	replayPublications func(context.Context) (int, error),
) error {
	if replayForkBatch == nil || replayPublications == nil {
		return errors.New("post-turn startup recovery coordinator is incomplete")
	}
	for {
		completed, err := replayForkBatch(ctxOrBackground(ctx))
		if err != nil {
			return fmt.Errorf("recover pending thread forks: %w", err)
		}
		if completed == 0 {
			break
		}
	}
	if _, err := replayPublications(ctxOrBackground(ctx)); err != nil {
		return fmt.Errorf("recover pending SubAgent publications: %w", err)
	}
	return nil
}

func recoverInterruptedFloretTurns(ctx context.Context, targets []floretStartupRecoveryTarget) (floretStartupRecoveryResult, error) {
	result := floretStartupRecoveryResult{}
	for _, target := range targets {
		if strings.TrimSpace(target.description) == "" || target.factory == nil {
			return floretStartupRecoveryResult{}, errors.New("Floret startup recovery target is invalid")
		}
		recovered, pending, err := recoverOneInterruptedFloretTurn(ctx, target.factory)
		if err != nil {
			return floretStartupRecoveryResult{}, fmt.Errorf("recover %s: %w", target.description, err)
		}
		if recovered {
			result.recovered++
		}
		result.pending = result.pending || pending
	}
	return result, nil
}

func recoverOneInterruptedFloretTurn(ctx context.Context, factory floretInterruptedTurnRecoveryHostFactory) (bool, bool, error) {
	if factory == nil {
		return false, false, errors.New("Floret interrupted-turn recovery factory is unavailable")
	}
	host, err := factory.NewHost(ctx)
	if errors.Is(err, flruntime.ErrRecoveryTargetResolved) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	_, err = host.RecoverInterruptedTurn(ctx)
	switch {
	case err == nil:
		return true, false, nil
	case errors.Is(err, flruntime.ErrRecoveryTargetResolved):
		return false, false, nil
	case errors.Is(err, flruntime.ErrThreadBusy), errors.Is(err, flruntime.ErrStaleAuthority):
		return false, true, nil
	default:
		return false, false, err
	}
}

func (s *Service) setFloretStartupRecoveryState(pending bool, err error) {
	if s == nil {
		return
	}
	s.recoveryMu.Lock()
	s.recoveryPending = pending
	s.recoveryErr = err
	s.recoveryMu.Unlock()
}

func (s *Service) requireFloretStartupRecoveryComplete() error {
	if s == nil {
		return errors.New("Floret startup recovery state is unavailable")
	}
	s.recoveryMu.RLock()
	pending := s.recoveryPending
	err := s.recoveryErr
	s.recoveryMu.RUnlock()
	if err != nil {
		return fmt.Errorf("Floret startup recovery failed: %w", err)
	}
	if pending {
		return errors.New("Floret startup recovery is still waiting for durable turn authority")
	}
	return nil
}

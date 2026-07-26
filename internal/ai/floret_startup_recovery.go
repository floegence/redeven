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

type floretRootThreadInventory interface {
	ListRootThreads(context.Context, flruntime.ListRootThreadsRequest) (flruntime.RootThreadsPage, error)
}

type floretStartupRecoverySettingsStore interface {
	ListThreadSettingsForRecoveryPage(context.Context, threadstore.ThreadSettingsRecoveryCursor, int) ([]threadstore.ThreadSettings, threadstore.ThreadSettingsRecoveryCursor, bool, error)
}

type floretRootThreadInventoryReconciliation struct {
	RootThreadIDs         []flruntime.ThreadID
	OrphanedRootThreadIDs []flruntime.ThreadID
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

func reconcileFloretRootThreadInventory(ctx context.Context, db floretStartupRecoverySettingsStore, inventory floretRootThreadInventory) (floretRootThreadInventoryReconciliation, error) {
	if db == nil || inventory == nil {
		return floretRootThreadInventoryReconciliation{}, errors.New("Floret root inventory reconciliation capability is unavailable")
	}
	ctx = ctxOrBackground(ctx)
	productRoots := make(map[flruntime.ThreadID]struct{})
	var settingsCursor threadstore.ThreadSettingsRecoveryCursor
	for {
		settings, next, hasMore, err := db.ListThreadSettingsForRecoveryPage(ctx, settingsCursor, 200)
		if err != nil {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("list recovery thread settings: %w", err)
		}
		for _, item := range settings {
			threadID := flruntime.ThreadID(strings.TrimSpace(item.ThreadID))
			if threadID == "" || string(threadID) != item.ThreadID {
				return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings contain an invalid thread identity")
			}
			if _, duplicate := productRoots[threadID]; duplicate {
				return floretRootThreadInventoryReconciliation{}, fmt.Errorf("recovery thread settings contain duplicate thread %q", threadID)
			}
			productRoots[threadID] = struct{}{}
		}
		if !hasMore {
			if next != (threadstore.ThreadSettingsRecoveryCursor{}) {
				return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings pagination returned an unexpected terminal cursor")
			}
			break
		}
		if next == (threadstore.ThreadSettingsRecoveryCursor{}) || next == settingsCursor {
			return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings pagination did not advance")
		}
		settingsCursor = next
	}

	result := floretRootThreadInventoryReconciliation{}
	canonicalRoots := make(map[flruntime.ThreadID]struct{})
	var cursor flruntime.ThreadInventoryCursor
	for {
		page, err := inventory.ListRootThreads(ctx, flruntime.ListRootThreadsRequest{Cursor: cursor, Limit: 200})
		if err != nil {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("list canonical Floret root threads: %w", err)
		}
		if err := page.Validate(); err != nil {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("validate canonical Floret root page: %w", err)
		}
		for _, thread := range page.Threads {
			if _, duplicate := canonicalRoots[thread.ID]; duplicate {
				return floretRootThreadInventoryReconciliation{}, fmt.Errorf("canonical Floret root inventory contains duplicate thread %q", thread.ID)
			}
			canonicalRoots[thread.ID] = struct{}{}
			result.RootThreadIDs = append(result.RootThreadIDs, thread.ID)
			if _, exists := productRoots[thread.ID]; !exists {
				result.OrphanedRootThreadIDs = append(result.OrphanedRootThreadIDs, thread.ID)
			}
		}
		if !page.HasMore {
			break
		}
		if page.NextCursor == "" || page.NextCursor == cursor {
			return floretRootThreadInventoryReconciliation{}, errors.New("canonical Floret root pagination did not advance")
		}
		cursor = page.NextCursor
	}
	for threadID := range productRoots {
		if _, exists := canonicalRoots[threadID]; !exists {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("product thread settings reference missing canonical Floret root %q", threadID)
		}
	}
	return result, nil
}

func buildFloretStartupRecoveryTargets(ctx context.Context, rootThreadIDs []flruntime.ThreadID, capabilities floretStartupRecoveryCapabilities) ([]floretStartupRecoveryTarget, error) {
	if capabilities.root == nil || capabilities.subagent == nil || capabilities.listSubagents == nil {
		return nil, errors.New("Floret startup recovery capability is unavailable")
	}
	targets := make([]floretStartupRecoveryTarget, 0, len(rootThreadIDs))
	seenRoots := make(map[flruntime.ThreadID]struct{}, len(rootThreadIDs))
	for _, rootThreadID := range rootThreadIDs {
		threadID := strings.TrimSpace(string(rootThreadID))
		if threadID == "" || threadID != string(rootThreadID) {
			return nil, errors.New("Floret startup recovery roots contain an invalid thread identity")
		}
		if _, duplicate := seenRoots[rootThreadID]; duplicate {
			return nil, fmt.Errorf("Floret startup recovery roots contain duplicate thread %q", rootThreadID)
		}
		seenRoots[rootThreadID] = struct{}{}
	}
	seenThreads := make(map[flruntime.ThreadID]struct{}, len(rootThreadIDs))
	for rootThreadID := range seenRoots {
		seenThreads[rootThreadID] = struct{}{}
	}
	for _, rootThreadID := range rootThreadIDs {
		threadID := strings.TrimSpace(string(rootThreadID))
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

		queue := []flruntime.ThreadID{rootThreadID}
		for len(queue) > 0 {
			parentID := queue[0]
			queue = queue[1:]
			parentThreadID := strings.TrimSpace(string(parentID))
			readHost, err := capabilities.listSubagents(ctx, parentID)
			if err != nil {
				return nil, fmt.Errorf("bind SubAgent recovery read for %q: %w", parentThreadID, err)
			}
			children, err := readHost.ListSubAgents(ctx, parentID)
			if err != nil {
				return nil, fmt.Errorf("list SubAgents for recovery parent %q: %w", parentThreadID, err)
			}
			for _, child := range children {
				childThreadID := strings.TrimSpace(string(child.ThreadID))
				if childThreadID == "" || strings.TrimSpace(string(child.ParentThreadID)) != parentThreadID {
					return nil, errors.New("Floret SubAgent recovery identity is invalid")
				}
				childID := flruntime.ThreadID(childThreadID)
				if _, duplicate := seenThreads[childID]; duplicate {
					return nil, fmt.Errorf("Floret SubAgent recovery hierarchy contains duplicate thread %q", childThreadID)
				}
				seenThreads[childID] = struct{}{}
				queue = append(queue, childID)
				childFactory, err := capabilities.subagent(ctx, parentID, childID)
				switch {
				case errors.Is(err, flruntime.ErrInterruptedTurnNotFound):
				case err != nil:
					return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: %w", childThreadID, parentThreadID, err)
				case childFactory == nil:
					return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: empty factory", childThreadID, parentThreadID)
				default:
					targets = append(targets, floretStartupRecoveryTarget{
						description: fmt.Sprintf("SubAgent %q under %q", childThreadID, parentThreadID),
						factory:     childFactory,
					})
				}
			}
		}
	}
	return targets, nil
}

func (s *Service) startFloretStartupRecovery(startupCtx context.Context, targets []floretStartupRecoveryTarget) error {
	if s == nil {
		return errors.New("Floret startup recovery coordinator is unavailable")
	}
	if startupCtx == nil || s.lifecycleCtx == nil {
		return errors.New("Floret startup recovery context is unavailable")
	}
	targets = append([]floretStartupRecoveryTarget(nil), targets...)
	for _, target := range targets {
		if strings.TrimSpace(target.description) == "" || target.factory == nil {
			return errors.New("Floret startup recovery target is invalid")
		}
	}
	ctx, cancel := context.WithTimeout(startupCtx, s.persistTimeout())
	result, err := recoverInterruptedFloretTurns(ctx, targets)
	if err != nil {
		cancel()
		s.setFloretStartupRecoveryState(false, err)
		return err
	}
	if !result.pending {
		queuedTargets, err := s.completePostTurnStartupRecovery(ctx)
		if err != nil {
			cancel()
			s.setFloretStartupRecoveryState(false, err)
			return err
		}
		cancel()
		s.setFloretStartupRecoveryState(false, nil)
		s.wakeQueuedTurnRecoveryTargets(queuedTargets)
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
				ctx, cancel := context.WithTimeout(s.lifecycleCtx, s.persistTimeout())
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
				queuedTargets, err := s.completePostTurnStartupRecovery(ctx)
				if err != nil {
					cancel()
					s.setFloretStartupRecoveryState(false, err)
					if s.log != nil {
						s.log.Error("ai: post-turn startup recovery failed", "error", err)
					}
					return
				}
				cancel()
				s.setFloretStartupRecoveryState(false, nil)
				s.wakeQueuedTurnRecoveryTargets(queuedTargets)
				return
			case <-s.recoveryStopCh:
				return
			}
		}
	}()
	return nil
}

func (s *Service) completePostTurnStartupRecovery(ctx context.Context) ([]queuedTurnRecoveryTarget, error) {
	if err := s.recoverPostTurnStartupOperations(ctx); err != nil {
		return nil, err
	}
	targets, err := s.recoverQueuedTurnCommandsForStartup(ctx)
	if err != nil {
		return nil, fmt.Errorf("recover queued turn admissions: %w", err)
	}
	return targets, nil
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

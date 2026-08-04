package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
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
	ListRootThreads(context.Context, floretListRootThreadsRequest) (floretRootThreadsPage, error)
}

type floretListRootThreadsRequest struct {
	Cursor string
	Limit  int
}

type floretRootThreadsPage struct {
	Threads            []flruntime.ThreadSnapshot
	LatestTurnByThread map[identity.ThreadID]*flruntime.ThreadTurnSnapshot
	NextCursor         string
	HasMore            bool
}

type floretStartupRecoverySettingsStore interface {
	ListThreadSettingsForRecoveryPage(context.Context, threadstore.ThreadSettingsRecoveryCursor, int) ([]threadstore.ThreadSettings, threadstore.ThreadSettingsRecoveryCursor, bool, error)
	ListPendingCanonicalRootOwnershipClaims(context.Context) ([]string, error)
}

type floretRootThreadInventoryReconciliation struct {
	RootThreadIDs         []identity.ThreadID
	OrphanedRootThreadIDs []identity.ThreadID
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
	return reconcileFloretRootThreadInventoryWithOperationTimeout(ctx, db, inventory, 0)
}

func reconcileFloretRootThreadInventoryWithOperationTimeout(
	ctx context.Context,
	db floretStartupRecoverySettingsStore,
	inventory floretRootThreadInventory,
	operationTimeout time.Duration,
) (floretRootThreadInventoryReconciliation, error) {
	if db == nil || inventory == nil {
		return floretRootThreadInventoryReconciliation{}, errors.New("Floret root inventory reconciliation capability is unavailable")
	}
	ctx = ctxOrBackground(ctx)
	productRoots := make(map[identity.ThreadID]struct{})
	pendingOwnershipClaims := make(map[identity.ThreadID]struct{})
	claims, err := runFloretStartupOperation(ctx, operationTimeout, db.ListPendingCanonicalRootOwnershipClaims)
	if err != nil {
		return floretRootThreadInventoryReconciliation{}, fmt.Errorf("list pending canonical root ownership claims: %w", err)
	}
	for _, rawThreadID := range claims {
		threadID := identity.ThreadID(strings.TrimSpace(rawThreadID))
		if threadID == "" || string(threadID) != rawThreadID {
			return floretRootThreadInventoryReconciliation{}, errors.New("pending canonical root ownership contains an invalid thread identity")
		}
		if _, duplicate := pendingOwnershipClaims[threadID]; duplicate {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("pending canonical root ownership contains duplicate thread %q", threadID)
		}
		pendingOwnershipClaims[threadID] = struct{}{}
	}
	var settingsCursor threadstore.ThreadSettingsRecoveryCursor
	for {
		type settingsPage struct {
			settings []threadstore.ThreadSettings
			next     threadstore.ThreadSettingsRecoveryCursor
			hasMore  bool
		}
		page, err := runFloretStartupOperation(ctx, operationTimeout, func(operationCtx context.Context) (settingsPage, error) {
			settings, next, hasMore, err := db.ListThreadSettingsForRecoveryPage(operationCtx, settingsCursor, 200)
			return settingsPage{settings: settings, next: next, hasMore: hasMore}, err
		})
		if err != nil {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("list recovery thread settings: %w", err)
		}
		for _, item := range page.settings {
			threadID := identity.ThreadID(strings.TrimSpace(item.ThreadID))
			if threadID == "" || string(threadID) != item.ThreadID {
				return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings contain an invalid thread identity")
			}
			if _, duplicate := productRoots[threadID]; duplicate {
				return floretRootThreadInventoryReconciliation{}, fmt.Errorf("recovery thread settings contain duplicate thread %q", threadID)
			}
			productRoots[threadID] = struct{}{}
		}
		if !page.hasMore {
			if page.next != (threadstore.ThreadSettingsRecoveryCursor{}) {
				return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings pagination returned an unexpected terminal cursor")
			}
			break
		}
		if page.next == (threadstore.ThreadSettingsRecoveryCursor{}) || page.next == settingsCursor {
			return floretRootThreadInventoryReconciliation{}, errors.New("recovery thread settings pagination did not advance")
		}
		settingsCursor = page.next
	}

	result := floretRootThreadInventoryReconciliation{}
	canonicalRoots := make(map[identity.ThreadID]struct{})
	var cursor string
	for {
		page, err := runFloretStartupOperation(ctx, operationTimeout, func(operationCtx context.Context) (floretRootThreadsPage, error) {
			return inventory.ListRootThreads(operationCtx, floretListRootThreadsRequest{Cursor: cursor, Limit: 200})
		})
		if err != nil {
			return floretRootThreadInventoryReconciliation{}, fmt.Errorf("list canonical Floret root threads: %w", err)
		}
		for _, thread := range page.Threads {
			if _, duplicate := canonicalRoots[thread.ID]; duplicate {
				return floretRootThreadInventoryReconciliation{}, fmt.Errorf("canonical Floret root inventory contains duplicate thread %q", thread.ID)
			}
			canonicalRoots[thread.ID] = struct{}{}
			result.RootThreadIDs = append(result.RootThreadIDs, thread.ID)
			_, hasSettings := productRoots[thread.ID]
			_, hasPendingOwnership := pendingOwnershipClaims[thread.ID]
			if !hasSettings && !hasPendingOwnership {
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

func buildFloretStartupRecoveryTargets(ctx context.Context, rootThreadIDs []identity.ThreadID, capabilities floretStartupRecoveryCapabilities) ([]floretStartupRecoveryTarget, error) {
	return buildFloretStartupRecoveryTargetsWithOperationTimeout(ctx, rootThreadIDs, capabilities, 0)
}

func buildFloretStartupRecoveryTargetsWithOperationTimeout(
	ctx context.Context,
	rootThreadIDs []identity.ThreadID,
	capabilities floretStartupRecoveryCapabilities,
	operationTimeout time.Duration,
) ([]floretStartupRecoveryTarget, error) {
	if capabilities.candidates == nil || capabilities.root == nil || capabilities.subagent == nil {
		return nil, errors.New("Floret startup recovery capability is unavailable")
	}
	targets := make([]floretStartupRecoveryTarget, 0, len(rootThreadIDs))
	seenRoots := make(map[identity.ThreadID]struct{}, len(rootThreadIDs))
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
	candidates, err := runFloretStartupOperation(ctx, operationTimeout, capabilities.candidates)
	if err != nil {
		return nil, fmt.Errorf("list Floret interrupted-turn recovery candidates: %w", err)
	}
	seenCandidates := make(map[identity.ThreadID]struct{}, len(candidates))
	for index, candidate := range candidates {
		threadID := identity.ThreadID(strings.TrimSpace(string(candidate.ThreadID)))
		parentThreadID := identity.ThreadID(strings.TrimSpace(string(candidate.ParentThreadID)))
		if threadID == "" || string(threadID) != string(candidate.ThreadID) {
			return nil, fmt.Errorf("Floret recovery candidate %d has an invalid thread identity", index)
		}
		if parentThreadID != "" && string(parentThreadID) != string(candidate.ParentThreadID) {
			return nil, fmt.Errorf("Floret recovery candidate %d has an invalid parent identity", index)
		}
		if _, duplicate := seenCandidates[threadID]; duplicate {
			return nil, fmt.Errorf("Floret recovery candidate hierarchy contains duplicate thread %q", threadID)
		}
		if parentThreadID != "" {
			if _, duplicate := seenRoots[threadID]; duplicate {
				return nil, fmt.Errorf("Floret recovery candidate hierarchy reuses root %q as a child", threadID)
			}
		}
		if parentThreadID != "" {
			if _, ok := seenRoots[parentThreadID]; !ok {
				return nil, fmt.Errorf("Floret recovery candidate %q has an unknown canonical parent %q", threadID, parentThreadID)
			}
		}
		seenCandidates[threadID] = struct{}{}
		var factory floretInterruptedTurnRecoveryHostFactory
		if parentThreadID == "" {
			if _, ok := seenRoots[threadID]; !ok {
				return nil, fmt.Errorf("Floret recovery candidate root %q is absent from canonical root inventory", threadID)
			}
			factory, err = runFloretStartupOperation(ctx, operationTimeout, func(operationCtx context.Context) (floretInterruptedTurnRecoveryHostFactory, error) {
				return capabilities.root(operationCtx, threadID)
			})
		} else {
			factory, err = runFloretStartupOperation(ctx, operationTimeout, func(operationCtx context.Context) (floretInterruptedTurnRecoveryHostFactory, error) {
				return capabilities.subagent(operationCtx, parentThreadID, threadID)
			})
		}
		switch {
		case errors.Is(err, flruntime.ErrInterruptedTurnNotFound):
		case err != nil:
			if parentThreadID == "" {
				return nil, fmt.Errorf("bind root recovery target %q: %w", threadID, err)
			}
			return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: %w", threadID, parentThreadID, err)
		case factory == nil:
			if parentThreadID == "" {
				return nil, fmt.Errorf("bind root recovery target %q: empty factory", threadID)
			}
			return nil, fmt.Errorf("bind SubAgent recovery target %q under %q: empty factory", threadID, parentThreadID)
		default:
			if parentThreadID == "" {
				targets = append(targets, floretStartupRecoveryTarget{description: fmt.Sprintf("root thread %q", threadID), factory: factory})
			} else {
				targets = append(targets, floretStartupRecoveryTarget{description: fmt.Sprintf("SubAgent %q under %q", threadID, parentThreadID), factory: factory})
			}
		}
	}
	return targets, nil
}

func runFloretStartupOperation[T any](
	parent context.Context,
	timeout time.Duration,
	operation func(context.Context) (T, error),
) (T, error) {
	var zero T
	if operation == nil {
		return zero, errors.New("Floret startup operation is unavailable")
	}
	parent = ctxOrBackground(parent)
	if timeout <= 0 {
		return operation(parent)
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	return operation(ctx)
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
	if _, err := s.ReconcileCanonicalRootOwnership(ctx); err != nil {
		return nil, fmt.Errorf("reconcile canonical roots after pending operation recovery: %w", err)
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
	_, err = host.Recover(ctx)
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

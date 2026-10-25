package ai

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/threadreadstate"
)

// serviceRecoveryAttempt publishes one immutable result when done closes.
// Waiters retain their attempt even if a later caller starts another retry.
type serviceRecoveryAttempt struct {
	done chan struct{}
	err  error
}

// ThreadReadState belongs to this service generation. Callers must retain their
// generation lease until all reads and writes through this handle complete.
func (s *Service) ThreadReadState() *threadreadstate.Store {
	if s == nil {
		return nil
	}
	return s.readState
}

// Recover each settings page independently. Keep only the first failure as the
// cleanup gate, while allowing unrelated threads and their queues to recover.
func (s *Service) prepareStartupThreads(ctx context.Context) error {
	summaries, ok := s.threadRuntime.(flruntime.ThreadSummaryReader)
	if !ok {
		return errors.New("published Floret thread summary reader is unavailable")
	}
	if s.floretThreadMediaInventory == nil {
		return errors.New("published Floret thread media inventory is unavailable")
	}
	var firstFailure error
	var cursor threadstore.ThreadSettingsRecoveryCursor
	for {
		settings, next, more, err := s.threadsDB.ListThreadSettingsForRecoveryPage(ctx, cursor, 200)
		if err != nil {
			return errors.Join(firstFailure, err)
		}
		for _, setting := range settings {
			if err := ctx.Err(); err != nil {
				return errors.Join(firstFailure, err)
			}
			err := s.prepareStartupThread(ctx, summaries, setting)
			if err == nil || errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
				continue
			}
			if firstFailure == nil {
				firstFailure = fmt.Errorf("prepare thread %q: %w", setting.ThreadID, err)
			}
			if s.log != nil {
				s.log.Warn("ai: thread recovery is pending", "thread_id", setting.ThreadID, "error", err)
			}
		}
		if !more {
			return errors.Join(firstFailure, ctx.Err())
		}
		cursor = next
	}
}

func (s *Service) prepareStartupThread(ctx context.Context, summaries flruntime.ThreadSummaryReader, setting threadstore.ThreadSettings) error {
	threadID := identity.ThreadID(setting.ThreadID)
	summary, err := summaries.Summary(ctx, threadID)
	if err != nil {
		return err
	}
	inventory, err := s.floretThreadMediaInventory(ctx, threadID)
	if err != nil {
		return err
	}
	attachments := make([]flruntime.MessageAttachment, 0, len(inventory.References))
	for _, reference := range inventory.References {
		attachments = append(attachments, reference.Attachment)
	}
	if err := s.retainCanonicalUploadDescriptors(ctx, setting.EndpointID, setting.ThreadID, attachments); err != nil {
		return err
	}
	if summary.Activity == flruntime.ThreadActivityIdle && summary.QueueCount > 0 && (summary.LastOutcome == nil || *summary.LastOutcome == flruntime.TurnOutcomeCompleted) {
		return s.resumeMigratedPendingInputs(ctx, []string{setting.ThreadID})
	}
	return nil
}

// Activate is the final preparation boundary. The controller calls it only
// after checking that the selected options still belong to its current attempt.
func (s *Service) Activate(ctx context.Context) error {
	if s == nil || ctx == nil {
		return errors.New("service activation requires a context")
	}
	s.activationMu.Lock()
	defer s.activationMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.serviceClosed {
		return errors.New("service is closed")
	}
	if s.activated {
		return nil
	}
	// A zero-value service is used by controller ownership tests.
	if s.activateFloret == nil {
		return nil
	}
	if err := s.activateFloret(ctx); err != nil {
		return err
	}
	if err := s.startFlowerRuntimeViewPump(); err != nil {
		return err
	}
	s.activated = true
	s.mu.Lock()
	s.maintenanceStopCh = make(chan struct{})
	s.maintenanceDoneCh = make(chan struct{})
	s.mu.Unlock()
	s.startBackgroundMaintenance()
	s.startUploadRecovery()
	s.startStartupPreparation()
	if !s.skipStorageMaintenance {
		if err := removeObsoleteFlowerUpgrade(s.stateDir); err != nil && s.log != nil {
			s.log.Warn("ai: obsolete upgrade record cleanup failed", "error", err)
		}
	}
	return nil
}

// ErrFlowerGenerationClose prevents another generation from opening storage
// whose previous owner could not be conclusively closed.
var ErrFlowerGenerationClose = errors.New("failed to close the Flower generation")

func flowerGenerationCloseError(err error) error {
	if err == nil {
		return nil
	}
	return errors.Join(ErrFlowerGenerationClose, err)
}

// startServiceWorker joins background product writes to the same generation.
func (s *Service) startServiceWorker(work func()) bool {
	s.mu.Lock()
	if s.serviceClosing {
		s.mu.Unlock()
		return false
	}
	s.serviceWorkers.Add(1)
	s.mu.Unlock()
	go func() { defer s.serviceWorkers.Done(); work() }()
	return true
}

func (s *Service) startUploadRecovery() {
	if s == nil {
		return
	}
	s.uploadRecoveryMu.Lock()
	if s.uploadRecoveryReady || s.uploadRecoveryRunning {
		s.uploadRecoveryMu.Unlock()
		return
	}
	s.uploadRecoveryRunning = true
	attempt := &serviceRecoveryAttempt{done: make(chan struct{})}
	s.uploadRecoveryAttempt = attempt
	s.uploadRecoveryMu.Unlock()
	finish := func(err error) {
		s.uploadRecoveryMu.Lock()
		s.uploadRecoveryRunning = false
		s.uploadRecoveryReady = err == nil
		attempt.err = err
		close(attempt.done)
		s.uploadRecoveryMu.Unlock()
	}
	if !s.startServiceWorker(func() {
		lifecycleCtx := s.lifecycleCtx
		if lifecycleCtx == nil {
			lifecycleCtx = context.Background()
		}
		ctx, cancel := context.WithTimeout(lifecycleCtx, 30*time.Second)
		defer cancel()
		if s.storeStartupProgress != nil {
			s.storeStartupProgress(FloretStoreStartupRecovering)
		}
		count, err := s.interruptUploadAttemptsFromPreviousProcess(ctx)
		if err != nil {
			finish(err)
			if !errors.Is(err, context.Canceled) && s.log != nil {
				s.log.Warn("ai: interrupted upload recovery is still pending", "error", err)
			}
			return
		}
		if count > 0 && s.log != nil {
			s.log.Info("ai: interrupted upload recovery completed", "count", count)
		}
		finish(nil)
	}) {
		finish(errors.New("service is closing"))
	}
}

func (s *Service) uploadRecoveryComplete() bool {
	if s == nil {
		return false
	}
	s.uploadRecoveryMu.Lock()
	defer s.uploadRecoveryMu.Unlock()
	return s.uploadRecoveryReady
}

func (s *Service) startStartupPreparation() {
	if s == nil || s.lifecycleCtx == nil {
		return
	}
	s.startupPreparationMu.Lock()
	if s.startupPreparationReady || s.startupPreparationRun {
		s.startupPreparationMu.Unlock()
		return
	}
	s.startupPreparationRun = true
	attempt := &serviceRecoveryAttempt{done: make(chan struct{})}
	s.startupPreparationAttempt = attempt
	s.startupPreparationMu.Unlock()
	finish := func(err error) {
		s.startupPreparationMu.Lock()
		s.startupPreparationRun = false
		attempt.err = err
		s.startupPreparationReady = err == nil
		close(attempt.done)
		s.startupPreparationMu.Unlock()
	}
	if !s.startServiceWorker(func() {
		ctx := s.lifecycleCtx
		if s.storeStartupProgress != nil {
			s.storeStartupProgress(FloretStoreStartupPreparing)
		}
		// Ownership review must not prevent an unrelated owned thread from
		// retaining its uploads or resuming an already admitted queue.
		preparationErr := s.prepareStartupThreads(ctx)
		var ownershipErr error
		if ctx.Err() == nil {
			_, ownershipErr = s.ReconcileCanonicalRootOwnership(ctx)
		}
		if err := errors.Join(preparationErr, ownershipErr, ctx.Err()); err != nil {
			if !errors.Is(err, context.Canceled) && s.log != nil {
				s.log.Warn("ai: startup recovery is pending", "error", err)
			}
			finish(err)
			return
		}
		finish(nil)
	}) {
		finish(errors.New("service is closing"))
	}
}

func (s *Service) waitForStartupPreparation(ctx context.Context) error {
	if s == nil || ctx == nil {
		return errors.New("startup preparation requires a service and context")
	}
	s.startStartupPreparation()
	s.startupPreparationMu.Lock()
	if s.startupPreparationReady {
		s.startupPreparationMu.Unlock()
		return nil
	}
	attempt := s.startupPreparationAttempt
	s.startupPreparationMu.Unlock()
	if attempt == nil {
		return errors.New("service recovery has not started")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-attempt.done:
	}
	return attempt.err
}

func (s *Service) waitForUploadRecovery(ctx context.Context) error {
	if s == nil || ctx == nil {
		return errors.New("upload recovery requires a service and context")
	}
	s.startUploadRecovery()
	s.uploadRecoveryMu.Lock()
	if s.uploadRecoveryReady {
		s.uploadRecoveryMu.Unlock()
		return nil
	}
	attempt := s.uploadRecoveryAttempt
	s.uploadRecoveryMu.Unlock()
	if attempt == nil {
		return errors.New("service recovery has not started")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-attempt.done:
	}
	return attempt.err
}

// Upgrade browsing preparation belongs to Floret. Product settings identify the
// admitted threads; the host owns source checks, migration, batching and repair.
// This runs before service publication, without activating execution or queues.
// Prepared stores only read readiness anchors; no history body is revisited.
// A failed thread keeps Floret's readiness/error and fails its own reads. It
// must not prevent unrelated prepared threads or new threads from being used.
func (s *Service) prepareDisplayThreads(ctx context.Context) error {
	if s.floretThreadReadiness == nil || s.prepareFloretDisplayThread == nil {
		return errors.New("published Floret display preparation is unavailable")
	}
	var cursor threadstore.ThreadSettingsRecoveryCursor
	for {
		settings, next, more, err := s.threadsDB.ListThreadSettingsForRecoveryPage(ctx, cursor, 200)
		if err != nil {
			return err
		}
		for _, setting := range settings {
			if err := ctx.Err(); err != nil {
				return err
			}
			id := identity.ThreadID(setting.ThreadID)
			ready, err := s.floretThreadReadiness(ctx, id)
			if err == nil && ready.DisplayReady {
				continue
			}
			if err == nil {
				reportFloretStorePhase(s.storeStartupProgress, FloretStoreStartupIndexing)
				err = s.prepareFloretDisplayThread(ctx, id)
			}
			if errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
				continue
			}
			if err == nil {
				ready, err = s.floretThreadReadiness(ctx, id)
				if err == nil && (!ready.DisplayReady || ready.DisplayError != "") {
					err = errors.New("canonical browsing preparation did not publish readiness")
				}
			}
			if err != nil && s.log != nil {
				s.log.Warn("ai: thread browsing preparation failed", "thread_id", id, "error", err)
			}
		}
		if !more {
			return ctx.Err()
		}
		cursor = next
	}
}

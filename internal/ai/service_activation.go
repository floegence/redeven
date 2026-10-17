package ai

import (
	"context"
	"errors"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/threadreadstate"
)

// ThreadReadState belongs to this service generation. Callers must retain their
// generation lease until all reads and writes through this handle complete.
func (s *Service) ThreadReadState() *threadreadstate.Store {
	if s == nil {
		return nil
	}
	return s.readState
}

func (s *Service) prepareStartupThreads(ctx context.Context) error {
	summaries, ok := s.threadRuntime.(flruntime.ThreadSummaryReader)
	if !ok {
		return errors.New("published Floret thread summary reader is unavailable")
	}
	inventory, err := s.floretMediaInventory(ctx)
	if err != nil {
		return err
	}
	descriptors := make(map[string][]flruntime.MessageAttachment)
	for _, reference := range inventory.References {
		id := reference.ThreadID.String()
		descriptors[id] = append(descriptors[id], reference.Attachment)
	}
	var cursor threadstore.ThreadSettingsRecoveryCursor
	for {
		settings, next, more, err := s.threadsDB.ListThreadSettingsForRecoveryPage(ctx, cursor, 200)
		if err != nil {
			return err
		}
		for _, setting := range settings {
			summary, err := summaries.Summary(ctx, identity.ThreadID(setting.ThreadID))
			if errors.Is(err, flruntime.ErrThreadNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			if err := s.retainCanonicalUploadDescriptors(ctx, setting.EndpointID, setting.ThreadID, descriptors[setting.ThreadID]); err != nil {
				return err
			}
			if summary.Activity == flruntime.ThreadActivityIdle && summary.QueueCount > 0 && (summary.LastOutcome == nil || *summary.LastOutcome == flruntime.TurnOutcomeCompleted) {
				s.pendingStartupThreads = append(s.pendingStartupThreads, setting.ThreadID)
			}
		}
		if !more {
			return ctx.Err()
		}
		cursor = next
	}
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
	s.activated = true
	s.mu.Lock()
	s.maintenanceStopCh = make(chan struct{})
	s.maintenanceDoneCh = make(chan struct{})
	s.mu.Unlock()
	s.startFlowerRuntimeViewPump()
	s.startBackgroundMaintenance()
	if err := s.resumeMigratedPendingInputs(s.lifecycleCtx, s.pendingStartupThreads); err != nil && !errors.Is(err, context.Canceled) && s.log != nil {
		s.log.Error("ai: pending input recovery failed", "error", err)
	}
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
func (s *Service) startServiceWorker(work func()) {
	s.mu.Lock()
	if s.serviceClosing {
		s.mu.Unlock()
		return
	}
	s.serviceWorkers.Add(1)
	s.mu.Unlock()
	go func() { defer s.serviceWorkers.Done(); work() }()
}

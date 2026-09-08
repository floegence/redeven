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
	var cursor threadstore.ThreadSettingsRecoveryCursor
	for {
		settings, next, more, err := s.threadsDB.ListThreadSettingsForRecoveryPage(ctx, cursor, 200)
		if err != nil {
			return err
		}
		for _, setting := range settings {
			view, err := s.threadRuntime.View(ctx, identity.ThreadID(setting.ThreadID))
			if errors.Is(err, flruntime.ErrThreadNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			if err := s.retainCanonicalUploadResources(ctx, setting.EndpointID, view); err != nil {
				return err
			}
			if view.Activity == flruntime.ThreadActivityIdle && len(view.Queue) > 0 && (view.LastOutcome == nil || *view.LastOutcome == flruntime.TurnOutcomeCompleted) {
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
	if !s.skipStorageMaintenance {
		if err := completeFlowerUpgrade(s.stateDir); err != nil {
			return flowerStorageError("backup", "verifying", err)
		}
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
	s.serviceWorkers.Add(1)
	go func() {
		defer s.serviceWorkers.Done()

		if !s.skipStorageMaintenance {
			if err := pruneFlowerSnapshots(s.lifecycleCtx, s.stateDir); err != nil && s.log != nil {
				s.log.Warn("ai: snapshot retention failed", "error", err)
			}
		}
	}()
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

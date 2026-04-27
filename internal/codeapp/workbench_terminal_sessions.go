package codeapp

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

func reconcileWorkbenchTerminalSessions(
	ctx context.Context,
	log *slog.Logger,
	layouts *workbenchlayout.Service,
	term *terminal.Manager,
) error {
	if layouts == nil || term == nil {
		return nil
	}

	updated, err := layouts.PruneTerminalSessions(ctx, term.VisibleSessionIDs())
	if err != nil {
		return fmt.Errorf("prune stale workbench terminal sessions: %w", err)
	}
	if len(updated) > 0 && log != nil {
		log.Info("pruned stale workbench terminal session refs", "widget_count", len(updated))
	}
	return nil
}

func registerWorkbenchTerminalSessionCleanup(
	log *slog.Logger,
	layouts *workbenchlayout.Service,
	term *terminal.Manager,
) func() {
	if layouts == nil || term == nil {
		return func() {}
	}

	ctx, cancel := context.WithCancel(context.Background())
	var mu sync.Mutex
	var wg sync.WaitGroup
	closed := false
	removeHook := term.AddSessionLifecycleHook(func(event terminal.SessionLifecycleEvent) {
		sessionID := strings.TrimSpace(event.SessionID)
		if sessionID == "" {
			return
		}
		if event.Lifecycle != terminal.SessionLifecycleClosed && !event.Hidden {
			return
		}

		mu.Lock()
		if closed {
			mu.Unlock()
			return
		}
		wg.Add(1)
		mu.Unlock()

		go func() {
			defer wg.Done()

			opCtx, opCancel := context.WithTimeout(ctx, 5*time.Second)
			defer opCancel()

			updated, err := layouts.RemoveTerminalSessionFromAllWidgets(opCtx, sessionID)
			if err != nil {
				if log != nil {
					log.Warn("failed to remove terminal session refs from workbench layout", "session_id", sessionID, "error", err)
				}
				return
			}
			if len(updated) > 0 && log != nil {
				log.Info("removed terminal session refs from workbench layout", "session_id", sessionID, "widget_count", len(updated))
			}
		}()
	})

	return func() {
		removeHook()
		mu.Lock()
		closed = true
		mu.Unlock()
		cancel()
		wg.Wait()
	}
}

package ai

import (
	"context"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

// Account watches retain only execution-time credential attribution and a
// cancellation handle. Floret views remain the authority for task lifecycle.
type accountTaskWatch struct {
	accountID string
	turnID    identity.TurnID
	stop      func()
}

func (s *Service) bindAccountTask(threadID string, turnID identity.TurnID, p config.AIProvider) error {
	if p.EffectiveAuthMethod() != config.AIAuthChatGPT || s.chatGPT == nil {
		return nil
	}
	stop, err := s.chatGPT.WatchSession(s.lifecycleCtx, p.AccountID, func(error) { s.cancelAccountTurn(threadID, turnID) })
	if err != nil {
		return err
	}
	s.accountMu.Lock()
	if s.accountTasks == nil {
		s.accountTasks = map[string]accountTaskWatch{}
	}
	if old, ok := s.accountTasks[threadID]; ok {
		old.stop()
	}
	s.accountTasks[threadID] = accountTaskWatch{p.AccountID, turnID, stop}
	s.accountMu.Unlock()
	return nil
}

func (s *Service) cancelAccountTurn(threadID string, turnID identity.TurnID) {
	ctx, cancel := context.WithTimeout(s.lifecycleCtx, s.persistTimeout())
	defer cancel()
	typed, err := s.typedFloretRuntime()
	if err != nil {
		return
	}
	// Credential changes may arrive while Floret is admitting the prepared turn.
	// Wait only for that canonical turn; never cancel a different turn.
	for {
		view, err := typed.View(ctx, identity.ThreadID(threadID))
		if err != nil {
			return
		}
		if view.TurnID == turnID {
			if view.Activity == flruntime.ThreadActivityIdle {
				return
			}
			break
		}
		s.accountMu.Lock()
		watch, exists := s.accountTasks[threadID]
		s.accountMu.Unlock()
		if exists && watch.turnID != turnID {
			return
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
	key, err := newProductRequestID("account_stop_")
	if err != nil {
		return
	}
	_, err = typed.Cancel(ctx, flruntime.CancelInput{ThreadID: identity.ThreadID(threadID), RequestKey: flruntime.RequestKey(key), Mode: flruntime.CancelModeImmediate, IncludeDescendants: true})
	if err != nil && s.log != nil {
		s.log.Warn("ai: cancel account execution", "thread_id", threadID, "error", err)
	}
}

func (s *Service) reconcileAccountWatches(threadID string, turnID identity.TurnID, activity flruntime.ThreadActivity) {
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	id := threadID
	if watch, ok := s.accountTasks[id]; ok && (turnID == watch.turnID && activity == flruntime.ThreadActivityIdle) {
		watch.stop()
		delete(s.accountTasks, id)
	}
}

func (s *Service) AccountTaskCount(id string) int {
	if s == nil {
		return 0
	}
	s.accountMu.Lock()
	defer s.accountMu.Unlock()
	count := 0
	for _, watch := range s.accountTasks {
		if watch.accountID == id {
			count++
		}
	}
	return count
}

// The private Desktop source shares current credential facts with the owning
// Runtime. It never owns, persists, or reconstructs that Runtime's task life.
func (s *Service) bindDesktopAccountTask(threadID string, turnID identity.TurnID, modelID string) {
	source := s.desktopModelSource
	if source == nil {
		return
	}
	initial := source.Snapshot()
	if initial == nil {
		return
	}
	accountID := ""
	for _, model := range initial.Models {
		if model.ID == modelID {
			accountID = model.AccountID
		}
	}
	if accountID == "" {
		return
	}
	original, ok := initial.Accounts[accountID]
	if !ok {
		return
	}
	ctx, stop := context.WithCancel(s.lifecycleCtx)
	s.accountMu.Lock()
	if s.accountTasks == nil {
		s.accountTasks = map[string]accountTaskWatch{}
	}
	if old, ok := s.accountTasks[threadID]; ok {
		old.stop()
	}
	s.accountTasks[threadID] = accountTaskWatch{turnID: turnID, stop: stop}
	s.accountMu.Unlock()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			snapshot := source.Snapshot()
			if snapshot == nil {
				continue
			}
			current, ok := snapshot.Accounts[accountID]
			if ok && (current.Revision != original.Revision || current.State == "signed_out" || current.State == "signing_out" || current.State == "authorization_required" || current.State == "storage_unavailable") {
				s.cancelAccountTurn(threadID, turnID)
				return
			}
		}
	}()
}

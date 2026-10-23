package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/logsafe"
)

// The actor owns cadence and mutations. This pump routes facts and changes;
// it never constructs a second current view or compares historical content.
func (s *Service) startFlowerRuntimeViewPump() error {
	if s == nil || s.threadRuntime == nil || s.lifecycleCtx == nil {
		return errors.New("Flower runtime update pump is unavailable")
	}
	source, ok := s.threadRuntime.(flruntime.ThreadFactsSource)
	if !ok {
		return errors.New("published Floret ThreadFactsSource contract is unavailable")
	}
	s.mu.Lock()
	if s.serviceClosing {
		s.mu.Unlock()
		return errors.New("Flower service is closing")
	}
	if s.flowerRuntimePumpRunning {
		s.mu.Unlock()
		return errors.New("Flower runtime update pump is already running")
	}
	subscription, err := source.SubscribeFacts(s.lifecycleCtx)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	s.flowerRuntimePumpRunning = true
	s.flowerSubagentRefreshPending = make(map[string]string)
	s.flowerSubagentRefreshWake = make(chan struct{}, 1)
	s.serviceWorkers.Add(1)
	go s.runFlowerSubagentRefreshes()
	s.serviceWorkers.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.serviceWorkers.Done()
		defer func() { s.mu.Lock(); s.flowerRuntimePumpRunning = false; s.mu.Unlock() }()
		defer func() {
			if subscription != nil {
				subscription.Close()
			}
		}()
		for {
			update, nextErr := subscription.Next(s.lifecycleCtx)
			if nextErr == nil {
				s.handleFlowerRuntimeUpdate(update)
				continue
			}
			subscription.Close()
			if s.lifecycleCtx.Err() != nil {
				return
			}
			s.mu.Lock()
			s.flowerRuntimeUpdatesUnavailable = true
			for _, subscriber := range s.flowerLiveSubscribers {
				subscriber.closeErr = ErrFlowerLiveSync
				closeFlowerLiveSubscriberLocked(s, subscriber, flowerLiveSubscriberCloseRuntime)
			}
			s.mu.Unlock()
			if s.log != nil {
				s.log.Warn("ai: re-establish Floret thread updates", "error", nextErr)
			}
			// Subscription failure invalidates the workspace connection. Rebinding
			// owns only the service subscription; LiveTransport owns browser recovery.
			for {
				subscription, err = source.SubscribeFacts(s.lifecycleCtx)
				if err == nil {
					err = s.reconcileFlowerRuntimeRecovery(s.lifecycleCtx)
					if err != nil {
						subscription.Close()
					}
				}
				if err == nil {
					s.mu.Lock()
					s.flowerRuntimeUpdatesUnavailable = false
					s.mu.Unlock()
					break
				}
				if errors.Is(err, flruntime.ErrHostClosed) {
					return
				}
				timer := time.NewTimer(100 * time.Millisecond)
				select {
				case <-s.lifecycleCtx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
		}
	}()
	return nil
}

// Rebind first, then read authoritative cleanup facts. This is a recovery
// boundary, never part of text publication or a second lifecycle state.
func (s *Service) reconcileFlowerRuntimeRecovery(ctx context.Context) error {
	reader, ok := s.threadRuntime.(flruntime.ThreadSummaryReader)
	if !ok {
		return errors.New("published Floret summary recovery contract is unavailable")
	}
	ids := map[string]struct{}{}
	s.accountMu.Lock()
	for id := range s.accountTasks {
		ids[id] = struct{}{}
	}
	s.accountMu.Unlock()
	s.workloadMu.Lock()
	for _, lease := range s.workloadLeases {
		if lease.accepted && lease.threadID != "" {
			ids[lease.threadID] = struct{}{}
		}
	}
	s.workloadMu.Unlock()
	computer, _ := s.targetToolExecutor.(*ComputerUseRuntime)
	controls := map[string][]string{}
	if computer != nil {
		computer.mu.RLock()
		for _, control := range computer.controls {
			control.mu.Lock()
			if control.threadID != "" {
				ids[control.threadID] = struct{}{}
				controls[control.threadID] = append(controls[control.threadID], control.runID)
			}
			control.mu.Unlock()
		}
		computer.mu.RUnlock()
	}
	for id := range ids {
		summary, err := reader.Summary(ctx, identity.ThreadID(id))
		if errors.Is(err, flruntime.ErrThreadNotFound) {
			summary = flruntime.ThreadSummary{ID: identity.ThreadID(id), Activity: flruntime.ThreadActivityIdle}
		} else if err != nil {
			return err
		}
		s.reconcileFlowerRuntimeFacts(flruntime.ThreadUpdate{ThreadID: summary.ID, TurnID: summary.TurnID, RunID: summary.RunID,
			Facts: flruntime.ThreadRuntimeFacts{Activity: summary.Activity, QueueCount: summary.QueueCount}})
		s.accountMu.Lock()
		if watch, exists := s.accountTasks[id]; exists && watch.turnID != summary.TurnID {
			watch.stop()
			delete(s.accountTasks, id)
		}
		s.accountMu.Unlock()
		for _, run := range controls[id] {
			if summary.Activity == flruntime.ThreadActivityIdle || run != summary.RunID.String() {
				computer.releaseComputerControl(id, run)
			}
		}
	}
	return nil
}

func (s *Service) reconcileFlowerRuntimeFacts(update flruntime.ThreadUpdate) {
	threadID := update.ThreadID.String()
	if update.Facts.Activity == flruntime.ThreadActivityIdle {
		if computer, ok := s.targetToolExecutor.(*ComputerUseRuntime); ok {
			computer.releaseComputerControl(threadID, update.RunID.String())
		}
	}
	s.reconcileAccountWatches(threadID, update.TurnID, update.Facts.Activity)
	s.reconcileAIWorkloadLeases(threadID, update.Facts.Activity, update.Facts.QueueCount)
}

func (s *Service) handleFlowerRuntimeUpdate(update flruntime.ThreadUpdate) {
	threadID := strings.TrimSpace(update.ThreadID.String())
	if threadID == "" {
		return
	}
	s.reconcileFlowerRuntimeFacts(update)
	if s.threadsDB == nil {
		return
	}
	lookupCtx, cancel := context.WithTimeout(s.lifecycleCtx, s.persistTimeout())
	endpointID, parentID, err := s.resolveFlowerRuntimeRoute(lookupCtx, threadID)
	cancel()
	if err != nil {
		if s.log != nil && !errors.Is(err, context.Canceled) {
			s.log.Warn("ai: resolve Flower runtime update owner", "thread_id", logsafe.Text(threadID, 256), "error", err)
		}
		return
	}
	s.broadcastFlowerRuntimeUpdate(endpointID, parentID, update)
	if parentID != "" {
		boundary := flowerSubagentFactsBoundary(update.TurnID.String(), update.Facts)
		s.mu.Lock()
		if s.flowerSubagentBoundaryByThread == nil {
			s.flowerSubagentBoundaryByThread = make(map[string]string)
		}
		changed := s.flowerSubagentBoundaryByThread[threadID] != boundary
		s.flowerSubagentBoundaryByThread[threadID] = boundary
		s.mu.Unlock()
		if changed {
			s.scheduleFlowerSubagentsPatch(endpointID, parentID)
		}
	}
}

func (s *Service) broadcastFlowerRuntimeUpdate(endpointID, parentID string, update flruntime.ThreadUpdate) {
	if s.flowerLiveSubscriberCount(endpointID) == 0 {
		return
	}
	// Global observation carries facts only. Reading subscriptions own all
	// presentation and pending controls, including the open child panel.
	facts := update
	facts.Window, facts.Items, facts.ItemOrder = nil, nil, nil
	facts.Context, facts.Goal, facts.ParentEvents = nil, nil, nil
	facts.Turns, facts.Queue, facts.Interactions = nil, nil, nil
	facts.RestoredInputs, facts.ToolCallPreviews = nil, nil
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: update.ThreadID.String(), Update: &facts, FactsOnly: true})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if !subscriber.closed && subscriber.endpointID == endpointID {
			enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
		}
	}
}

// One worker owns child inventory reads. Only dirty parent identities are retained;
// repeated boundaries coalesce without spawning goroutines or retaining views.
func (s *Service) scheduleFlowerSubagentsPatch(endpointID, parentID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.serviceClosing || s.flowerSubagentRefreshWake == nil || s.flowerLiveSubscribersByEndpoint[endpointID] == 0 {
		return
	}
	if _, exists := s.flowerSubagentRefreshPending[parentID]; !exists && len(s.flowerSubagentRefreshPending) >= 64 {
		for _, subscriber := range s.flowerLiveSubscribers {
			if subscriber.endpointID == endpointID {
				subscriber.closeErr = ErrFlowerLiveSync
				closeFlowerLiveSubscriberLocked(s, subscriber, flowerLiveSubscriberCloseSummaryRefresh)
			}
		}
		return
	}
	s.flowerSubagentRefreshPending[parentID] = endpointID
	select {
	case s.flowerSubagentRefreshWake <- struct{}{}:
	default:
	}
}

func (s *Service) runFlowerSubagentRefreshes() {
	defer s.serviceWorkers.Done()
	for {
		select {
		case <-s.lifecycleCtx.Done():
			return
		case <-s.flowerSubagentRefreshWake:
		}
		for {
			s.mu.Lock()
			var parentID, endpointID string
			for parent, endpoint := range s.flowerSubagentRefreshPending {
				parentID, endpointID = parent, endpoint
				delete(s.flowerSubagentRefreshPending, parent)
				break
			}
			s.mu.Unlock()
			if parentID == "" {
				break
			}
			if s.flowerLiveSubscriberCount(endpointID) == 0 {
				continue
			}
			ctx, cancel := context.WithTimeout(s.lifecycleCtx, s.persistTimeout())
			s.publishFlowerSubagentsPatch(ctx, endpointID, parentID)
			cancel()
		}
	}
}

package ai

import (
	"context"
	"errors"
	"sync"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/session"
)

// Each workspace has exactly two independently replaceable reading interests:
// the conversation and its optional child panel. Waiting honors cancellation.
type flowerHistoryInterest struct {
	mu           sync.Mutex
	gate         chan struct{}
	revision     uint64
	subscription *flruntime.ThreadUpdateSubscription
	cancel       context.CancelFunc
}

func (interest *flowerHistoryInterest) lock(ctx context.Context) (func(), error) {
	interest.mu.Lock()
	if interest.gate == nil {
		interest.gate = make(chan struct{}, 1)
	}
	gate := interest.gate
	interest.mu.Unlock()
	select {
	case gate <- struct{}{}:
		return func() { <-gate }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Service) readFlowerHistoryForObserver(ctx context.Context, meta *session.Meta, scope threadquery.Scope, request FlowerHistoryRequest, input flruntime.ThreadWindowInput) (flruntime.ThreadView, *FlowerHistoryWindow, error) {
	if request.ObserverID == "" {
		return readFlowerHistory(ctx, s.threadRuntime, scope, input)
	}
	s.mu.Lock()
	var subscriber *flowerLiveSubscriber
	for _, candidate := range s.flowerLiveSubscribers {
		if candidate.observerID == request.ObserverID && candidate.endpointID == meta.EndpointID && candidate.userPublicID == meta.UserPublicID && candidate.namespacePublicID == meta.NamespacePublicID && !candidate.closed {
			subscriber = candidate
			break
		}
	}
	s.mu.Unlock()
	if subscriber == nil || request.ReadingRevision == 0 {
		return flruntime.ThreadView{}, nil, errors.New("history observer is unavailable")
	}
	interest := &subscriber.history
	if request.ParentThreadID != "" {
		interest = &subscriber.subagentHistory
	}
	unlock, err := interest.lock(ctx)
	if err != nil {
		return flruntime.ThreadView{}, nil, err
	}
	defer unlock()
	s.mu.Lock()
	superseded := request.ReadingRevision <= interest.revision || subscriber.closed
	s.mu.Unlock()
	if superseded {
		return flruntime.ThreadView{}, nil, errors.New("history read was superseded")
	}
	source, ok := s.threadRuntime.(flruntime.ThreadWindowSource)
	if !ok {
		return flruntime.ThreadView{}, nil, errors.New("published Floret window contract is unavailable")
	}
	observerCtx, cancel := context.WithCancel(subscriber.observerContext)
	sub, err := source.SubscribeWindowUpdates(observerCtx, scope)
	if err != nil {
		cancel()
		return flruntime.ThreadView{}, nil, err
	}
	installed := false
	defer func() {
		if !installed {
			cancel()
			sub.Close()
		}
	}()
	if err := sub.SetWindow(ctx, scope, input); err != nil {
		return flruntime.ThreadView{}, nil, err
	}
	var current flruntime.ThreadView
	var window *FlowerHistoryWindow
	for {
		update, err := sub.Next(ctx)
		if err != nil {
			return current, nil, err
		}
		if update.Window != nil && update.Window.Value != nil {
			current, window = flowerHistoryCurrent(update)
			break
		}
	}
	if err := ctx.Err(); err != nil {
		return current, nil, err
	}
	s.mu.Lock()
	if request.ReadingRevision <= interest.revision {
		s.mu.Unlock()
		return current, nil, context.Canceled
	}
	if subscriber.closed || s.serviceClosing {
		s.mu.Unlock()
		return current, nil, ErrFlowerLiveSync
	}
	metaCopy := *meta
	clearFlowerHistoryInterestLocked(s, subscriber, interest, request.ParentThreadID != "")
	interest.revision = request.ReadingRevision
	interest.subscription, interest.cancel = sub, cancel
	s.serviceWorkers.Add(1)
	installed = true
	s.mu.Unlock()
	go func() {
		defer s.serviceWorkers.Done()
		defer sub.Close()
		for {
			update, err := sub.Next(observerCtx)
			if err != nil {
				if observerCtx.Err() == nil {
					s.mu.Lock()
					if interest.subscription == sub {
						invalidateFlowerHistoryInterestLocked(s, subscriber, interest, input.ThreadID.String(), request.ParentThreadID)
					}
					s.mu.Unlock()
				}
				return
			}
			// Authorization is refreshed for every delivered read observation.
			if _, err := s.flowerHistoryScope(observerCtx, &metaCopy, input.ThreadID.String()); err != nil {
				s.mu.Lock()
				if interest.subscription == sub {
					subscriber.closeErr = ErrFlowerLiveSync
					closeFlowerLiveSubscriberLocked(s, subscriber, flowerLiveSubscriberCloseRuntime)
				}
				s.mu.Unlock()
				return
			}
			envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: input.ThreadID.String(), Update: &update, ReadingRevision: request.ReadingRevision}
			if update.Window != nil && update.Window.Value != nil {
				baseline, bounds := flowerHistoryCurrent(update)
				envelope.Update, envelope.Current, envelope.Window = nil, &baseline, bounds
			}
			var interactions []flruntime.ThreadInteraction
			if update.Interactions != nil {
				interactions = update.Interactions.Value
			}
			evidence, err := s.flowerHistoryComputerEvidence(observerCtx, input.ThreadID, interactions)
			if err != nil {
				s.fenceFlowerLiveEndpoint(metaCopy.EndpointID)
				return
			}
			if evidence != nil {
				for _, status := range s.flowerComputerStatusesForCurrent(observerCtx, *evidence, "") {
					s.broadcastFlowerComputerStatus(metaCopy.EndpointID, status)
				}
			}
			if request.ParentThreadID != "" {
				envelope.ThreadID = request.ParentThreadID
				envelope.SubagentUpdate, envelope.SubagentCurrent = envelope.Update, envelope.Current
				envelope.Update, envelope.Current = nil, nil
			}
			envelope.updateEvidence = evidence
			batch := newFlowerLiveEncodedBatch(envelope)
			s.mu.Lock()
			if !subscriber.closed && interest.subscription == sub {
				enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
			}
			s.mu.Unlock()
		}
	}()
	return current, window, nil
}

// Release is revision-fenced and never waits for a slow window read. A pending
// read checks the same revision before it can publish or install its interest.
func (s *Service) ReleaseFlowerHistory(ctx context.Context, meta *session.Meta, threadID string, request FlowerHistoryRelease) error {
	if _, err := s.flowerHistoryScope(ctx, meta, threadID); err != nil {
		return err
	}
	if request.ObserverID == "" || request.ReadingRevision == 0 {
		return threadquery.ErrInvalidQuery
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.observerID != request.ObserverID || subscriber.closed || subscriber.endpointID != meta.EndpointID || subscriber.userPublicID != meta.UserPublicID || subscriber.namespacePublicID != meta.NamespacePublicID {
			continue
		}
		interest := &subscriber.history
		if request.Subagent {
			interest = &subscriber.subagentHistory
		}
		if request.ReadingRevision <= interest.revision {
			return nil
		}
		clearFlowerHistoryInterestLocked(s, subscriber, interest, request.Subagent)
		interest.revision = request.ReadingRevision
		return nil
	}
	return nil // Closing the workspace has already released its interests.
}

type FlowerHistoryRelease struct {
	ObserverID      string `json:"observer_id"`
	ReadingRevision uint64 `json:"reading_revision"`
	Subagent        bool   `json:"subagent,omitempty"`
}

func clearFlowerHistoryInterestLocked(s *Service, subscriber *flowerLiveSubscriber, interest *flowerHistoryInterest, child bool) {
	if interest.cancel != nil {
		interest.cancel()
	}
	interest.subscription, interest.cancel = nil, nil
	for route := range subscriber.covered {
		if route.subagent == child {
			delete(subscriber.covered, route)
			subscriber.queuedBytes -= route.bytes()
			s.flowerLiveQueuedBytes -= route.bytes()
		}
	}
	kept := subscriber.queue[:0]
	for _, batch := range subscriber.queue {
		if batch.readingRevision != 0 && batch.route.subagent == child {
			releaseFlowerLiveBatchLocked(s, subscriber, batch)
		} else {
			kept = append(kept, batch)
		}
	}
	clear(subscriber.queue[len(kept):])
	subscriber.queue = kept
}

// A failed bounded interest cannot invalidate unrelated workspace facts.
func invalidateFlowerHistoryInterestLocked(s *Service, subscriber *flowerLiveSubscriber, interest *flowerHistoryInterest, threadID, parentID string) {
	revision := interest.revision
	clearFlowerHistoryInterestLocked(s, subscriber, interest, parentID != "")
	notice := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: threadID, ReadingRevision: revision, HistoryInvalidated: &FlowerHistoryInvalidation{ThreadID: threadID, ParentThreadID: parentID}})
	notice.route = flowerLiveRoute{threadID: threadID, wireID: threadID, subagent: parentID != ""}
	appendFlowerLiveQueuedBatchLocked(s, subscriber, notice)
}

type FlowerHistoryInvalidation struct {
	ThreadID       string `json:"thread_id"`
	ParentThreadID string `json:"parent_thread_id,omitempty"`
}

package ai

import (
	"context"
	"errors"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/session"
)

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
	subscriber.historyMu.Lock()
	defer subscriber.historyMu.Unlock()
	if request.ReadingRevision <= subscriber.historyRevision {
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
	if subscriber.closed || s.serviceClosing {
		s.mu.Unlock()
		return current, nil, ErrFlowerLiveSync
	}
	if subscriber.historyCancel != nil {
		subscriber.historyCancel()
	}
	metaCopy := *meta
	subscriber.historyRevision = request.ReadingRevision
	// Coverage belongs to the previous interval, not the actor version alone.
	for route := range subscriber.covered {
		if route.subagent {
			continue
		}
		delete(subscriber.covered, route)
		subscriber.queuedBytes -= route.bytes()
		s.flowerLiveQueuedBytes -= route.bytes()
	}
	subscriber.history, subscriber.historyCancel = sub, cancel
	kept := subscriber.queue[:0]
	for _, batch := range subscriber.queue {
		if batch.readingRevision != 0 {
			releaseFlowerLiveBatchLocked(s, subscriber, batch)
		} else {
			kept = append(kept, batch)
		}
	}
	clear(subscriber.queue[len(kept):])
	subscriber.queue = kept
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
					if subscriber.history == sub {
						subscriber.closeErr = ErrFlowerLiveSync
						closeFlowerLiveSubscriberLocked(s, subscriber, flowerLiveSubscriberCloseRuntime)
					}
					s.mu.Unlock()
				}
				return
			}
			// Authorization is refreshed for every delivered read observation.
			if _, err := s.flowerHistoryScope(observerCtx, &metaCopy, input.ThreadID.String()); err != nil {
				s.mu.Lock()
				if subscriber.history == sub {
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
			envelope.updateEvidence = evidence
			batch := newFlowerLiveEncodedBatch(envelope)
			s.mu.Lock()
			if !subscriber.closed && subscriber.history == sub {
				enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
			}
			s.mu.Unlock()
		}
	}()
	return current, window, nil
}

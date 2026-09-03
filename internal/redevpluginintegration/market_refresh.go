package redevpluginintegration

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
)

const (
	defaultMarketRefreshTimeout  = 15 * time.Second
	defaultMarketRefreshInterval = 10 * time.Minute
	defaultMarketRefreshJitter   = time.Minute
)

var defaultMarketRetryDelays = []time.Duration{
	15 * time.Second,
	30 * time.Second,
	time.Minute,
	2 * time.Minute,
	5 * time.Minute,
}

type marketRefreshPolicy struct {
	timeout      time.Duration
	retryDelays  []time.Duration
	successDelay func() time.Duration
	now          func() time.Time
}

type marketRefreshRequest struct {
	result chan marketRefreshResult
}

type marketRefreshResult struct {
	snapshot pluginmarket.Snapshot
	err      error
}

func defaultMarketRefreshPolicy() marketRefreshPolicy {
	return marketRefreshPolicy{
		timeout:     defaultMarketRefreshTimeout,
		retryDelays: append([]time.Duration(nil), defaultMarketRetryDelays...),
		successDelay: func() time.Duration {
			span := int64(2*defaultMarketRefreshJitter) + 1
			return defaultMarketRefreshInterval + time.Duration(rand.Int64N(span)-int64(defaultMarketRefreshJitter))
		},
		now: time.Now,
	}
}

func normalizeMarketRefreshPolicy(policy marketRefreshPolicy) marketRefreshPolicy {
	if policy.timeout <= 0 {
		policy.timeout = defaultMarketRefreshTimeout
	}
	if len(policy.retryDelays) == 0 {
		policy.retryDelays = append([]time.Duration(nil), defaultMarketRetryDelays...)
	}
	if policy.successDelay == nil {
		policy.successDelay = func() time.Duration { return defaultMarketRefreshInterval }
	}
	if policy.now == nil {
		policy.now = time.Now
	}
	return policy
}

func (i *Integration) startMarketRefreshController(policy marketRefreshPolicy) {
	if i == nil || i.marketService == nil {
		return
	}
	policy = normalizeMarketRefreshPolicy(policy)
	ctx, cancel := context.WithCancel(context.Background())
	i.marketMu.Lock()
	if i.marketControllerDone != nil {
		i.marketMu.Unlock()
		cancel()
		return
	}
	i.marketRequests = make(chan marketRefreshRequest)
	i.marketResults = make(chan marketRefreshResult, 1)
	i.marketControllerDone = make(chan struct{})
	i.marketControllerCancel = cancel
	if i.marketSubscribers == nil {
		i.marketSubscribers = make(map[int]chan pluginmarket.RefreshEvent)
	}
	i.marketMu.Unlock()
	go i.runMarketRefreshController(ctx, policy)
}

func (i *Integration) runMarketRefreshController(ctx context.Context, policy marketRefreshPolicy) {
	defer close(i.marketControllerDone)
	results := i.marketResults
	timer := time.NewTimer(0)
	defer timer.Stop()
	timerActive := true
	inFlight := false
	retryIndex := 0
	waiters := make([]chan marketRefreshResult, 0)

	stopTimer := func() {
		if !timerActive {
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timerActive = false
	}
	resetTimer := func(delay time.Duration) {
		stopTimer()
		if delay < 0 {
			delay = 0
		}
		timer.Reset(delay)
		timerActive = true
	}
	startRefresh := func() {
		if inFlight {
			return
		}
		stopTimer()
		inFlight = true
		i.publishMarketRefreshEvent(pluginmarket.RefreshStateRefreshing, policy.now(), time.Time{})
		go func() {
			requestCtx, cancel := context.WithTimeout(ctx, policy.timeout)
			defer cancel()
			snapshot, err := i.marketService.Refresh(requestCtx)
			select {
			case results <- marketRefreshResult{snapshot: snapshot, err: err}:
			case <-ctx.Done():
			}
		}()
	}

	for {
		var timerCh <-chan time.Time
		if timerActive {
			timerCh = timer.C
		}
		select {
		case <-ctx.Done():
			result := marketRefreshResult{err: pluginmarket.ErrUnavailable}
			for _, waiter := range waiters {
				waiter <- result
			}
			return
		case request := <-i.marketRequests:
			waiters = append(waiters, request.result)
			startRefresh()
		case <-timerCh:
			timerActive = false
			startRefresh()
		case result := <-results:
			inFlight = false
			if result.err == nil {
				result.snapshot, result.err = i.acceptMarketSnapshot(result.snapshot)
			}
			now := policy.now().UTC()
			if result.err == nil {
				retryIndex = 0
				delay := policy.successDelay()
				resetTimer(delay)
				i.publishMarketRefreshEvent(pluginmarket.RefreshStateReady, now, now.Add(delay))
			} else {
				delay := policy.retryDelays[min(retryIndex, len(policy.retryDelays)-1)]
				if retryIndex < len(policy.retryDelays)-1 {
					retryIndex++
				}
				resetTimer(delay)
				i.publishMarketRefreshEvent(pluginmarket.RefreshStateFailed, now, now.Add(delay))
			}
			for _, waiter := range waiters {
				waiter <- marketRefreshResult{snapshot: result.snapshot.Clone(), err: result.err}
			}
			waiters = waiters[:0]
		}
	}
}

func (i *Integration) acceptMarketSnapshot(snapshot pluginmarket.Snapshot) (pluginmarket.Snapshot, error) {
	if snapshot.Stale || snapshot.Source != pluginmarket.SnapshotSourceRemote {
		return pluginmarket.Snapshot{}, fmt.Errorf("%w: refresh did not return a current remote catalog", pluginmarket.ErrInvalidResponse)
	}
	i.marketMu.RLock()
	current := i.marketSnapshot
	if current != nil && snapshot.Generation < current.Generation {
		i.marketMu.RUnlock()
		return pluginmarket.Snapshot{}, fmt.Errorf("%w: catalog generation moved backwards", pluginmarket.ErrInvalidResponse)
	}
	i.marketMu.RUnlock()
	if i.releaseProvider != nil {
		if err := i.releaseProvider.setSnapshot(snapshot); err != nil {
			return pluginmarket.Snapshot{}, err
		}
	}
	frozen := snapshot.Clone()
	i.marketMu.Lock()
	i.marketSnapshot = &frozen
	i.marketMu.Unlock()
	return frozen.Clone(), nil
}

// MarketSnapshot returns only already accepted local evidence. It never starts
// or waits for a remote request.
func (i *Integration) MarketSnapshot(ctx context.Context) (pluginmarket.Snapshot, error) {
	if i == nil || i.marketService == nil {
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	}
	if ctx == nil {
		return pluginmarket.Snapshot{}, errors.New("plugin market snapshot context is required")
	}
	if err := ctx.Err(); err != nil {
		return pluginmarket.Snapshot{}, err
	}
	i.marketMu.RLock()
	defer i.marketMu.RUnlock()
	if i.marketSnapshot == nil {
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	}
	return i.marketSnapshot.Clone(), nil
}

// RefreshMarket joins the controller's single remote refresh task and returns
// only a fresh accepted snapshot.
func (i *Integration) RefreshMarket(ctx context.Context) (pluginmarket.Snapshot, error) {
	if i == nil || i.marketService == nil || ctx == nil {
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	}
	i.marketMu.RLock()
	requests := i.marketRequests
	done := i.marketControllerDone
	i.marketMu.RUnlock()
	if requests == nil || done == nil {
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	}
	response := make(chan marketRefreshResult, 1)
	select {
	case requests <- marketRefreshRequest{result: response}:
	case <-done:
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	case <-ctx.Done():
		return pluginmarket.Snapshot{}, ctx.Err()
	}
	select {
	case result := <-response:
		return result.snapshot, result.err
	case <-done:
		return pluginmarket.Snapshot{}, pluginmarket.ErrUnavailable
	case <-ctx.Done():
		return pluginmarket.Snapshot{}, ctx.Err()
	}
}

func (i *Integration) SubscribeMarketRefresh(ctx context.Context, afterSeq int64) ([]pluginmarket.RefreshEvent, <-chan pluginmarket.RefreshEvent, error) {
	if i == nil || i.marketService == nil || ctx == nil {
		return nil, nil, pluginmarket.ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	if afterSeq < 0 {
		return nil, nil, errors.New("after sequence must not be negative")
	}
	ch := make(chan pluginmarket.RefreshEvent, 1)
	i.marketMu.Lock()
	done := i.marketControllerDone
	if done == nil {
		i.marketMu.Unlock()
		return nil, nil, pluginmarket.ErrUnavailable
	}
	select {
	case <-done:
		i.marketMu.Unlock()
		return nil, nil, pluginmarket.ErrUnavailable
	default:
	}
	baseline := make([]pluginmarket.RefreshEvent, 0, 1)
	if i.marketEvent.Seq > afterSeq {
		baseline = append(baseline, i.marketEvent)
	}
	i.marketNextSubID++
	subID := i.marketNextSubID
	i.marketSubscribers[subID] = ch
	i.marketMu.Unlock()
	go func() {
		select {
		case <-ctx.Done():
			i.removeMarketRefreshSubscriber(subID)
		case <-done:
		}
	}()
	return baseline, ch, nil
}

func (i *Integration) publishMarketRefreshEvent(state string, checkedAt, nextRefreshAt time.Time) {
	i.marketMu.Lock()
	i.marketEvent.Seq++
	i.marketEvent.State = state
	i.marketEvent.Generation = -1
	i.marketEvent.Stale = true
	if i.marketSnapshot != nil {
		i.marketEvent.Generation = i.marketSnapshot.Generation
		i.marketEvent.Stale = i.marketSnapshot.Stale
	}
	if checkedAt.IsZero() {
		i.marketEvent.CheckedAt = ""
	} else {
		i.marketEvent.CheckedAt = checkedAt.UTC().Format(time.RFC3339Nano)
	}
	if nextRefreshAt.IsZero() {
		i.marketEvent.NextRefreshAt = ""
	} else {
		i.marketEvent.NextRefreshAt = nextRefreshAt.UTC().Format(time.RFC3339Nano)
	}
	event := i.marketEvent
	for _, ch := range i.marketSubscribers {
		select {
		case ch <- event:
		default:
			select {
			case <-ch:
			default:
			}
			ch <- event
		}
	}
	i.marketMu.Unlock()
}

func (i *Integration) removeMarketRefreshSubscriber(id int) {
	i.marketMu.Lock()
	ch, ok := i.marketSubscribers[id]
	if ok {
		delete(i.marketSubscribers, id)
		close(ch)
	}
	i.marketMu.Unlock()
}

func (i *Integration) stopMarketRefreshController() {
	if i == nil {
		return
	}
	i.marketMu.RLock()
	cancel := i.marketControllerCancel
	done := i.marketControllerDone
	i.marketMu.RUnlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	i.marketMu.Lock()
	for id, ch := range i.marketSubscribers {
		delete(i.marketSubscribers, id)
		close(ch)
	}
	i.marketRequests = nil
	i.marketResults = nil
	i.marketControllerDone = nil
	i.marketControllerCancel = nil
	i.marketMu.Unlock()
}

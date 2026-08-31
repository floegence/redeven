package ai

import (
	"context"
	"strings"
	"sync"
	"time"
)

type flowerThreadSummaryPublishRequest struct {
	endpointID string
	threadID   string
}

type flowerThreadSummaryPublishState struct {
	request flowerThreadSummaryPublishRequest
	dirty   bool
}

// flowerThreadSummaryPublisher is the single owner of canonical summary reads
// requested by product mutations and Floret title events. It coalesces requests
// by thread and never stores a title or a second thread projection.
type flowerThreadSummaryPublisher struct {
	ctx     context.Context
	cancel  context.CancelFunc
	timeout time.Duration
	publish func(context.Context, string, string) error
	fail    func(string, string, error)

	mu     sync.Mutex
	states map[string]*flowerThreadSummaryPublishState
	wg     sync.WaitGroup
	closed bool
}

func newFlowerThreadSummaryPublisher(
	parent context.Context,
	timeout time.Duration,
	publish func(context.Context, string, string) error,
	fail func(string, string, error),
) *flowerThreadSummaryPublisher {
	if parent == nil {
		parent = context.Background()
	}
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	ctx, cancel := context.WithCancel(parent)
	return &flowerThreadSummaryPublisher{
		ctx: ctx, cancel: cancel, timeout: timeout, publish: publish, fail: fail,
		states: make(map[string]*flowerThreadSummaryPublishState),
	}
}

// Request schedules a canonical read outside the caller's stack.
//
// IMPORTANT: Floret title events may only request this asynchronous read. They
// must never re-enter ThreadService synchronously or ignore publication failure.
func (publisher *flowerThreadSummaryPublisher) Request(endpointID, threadID string) {
	if publisher == nil || publisher.publish == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	key := runThreadKey(endpointID, threadID)
	if key == "" {
		return
	}

	publisher.mu.Lock()
	if publisher.closed {
		publisher.mu.Unlock()
		return
	}
	if state := publisher.states[key]; state != nil {
		state.dirty = true
		publisher.mu.Unlock()
		return
	}
	state := &flowerThreadSummaryPublishState{request: flowerThreadSummaryPublishRequest{
		endpointID: endpointID,
		threadID:   threadID,
	}}
	publisher.states[key] = state
	publisher.wg.Add(1)
	publisher.mu.Unlock()

	go publisher.run(key, state)
}

func (publisher *flowerThreadSummaryPublisher) run(key string, state *flowerThreadSummaryPublishState) {
	defer publisher.wg.Done()
	for {
		ctx, cancel := context.WithTimeout(publisher.ctx, publisher.timeout)
		err := publisher.publish(ctx, state.request.endpointID, state.request.threadID)
		cancel()
		if err != nil && publisher.ctx.Err() == nil && publisher.fail != nil {
			publisher.fail(state.request.endpointID, state.request.threadID, err)
		}

		publisher.mu.Lock()
		if publisher.closed || publisher.ctx.Err() != nil {
			delete(publisher.states, key)
			publisher.mu.Unlock()
			return
		}
		if state.dirty {
			state.dirty = false
			publisher.mu.Unlock()
			continue
		}
		delete(publisher.states, key)
		publisher.mu.Unlock()
		return
	}
}

func (publisher *flowerThreadSummaryPublisher) Close() {
	if publisher == nil {
		return
	}
	publisher.mu.Lock()
	if publisher.closed {
		publisher.mu.Unlock()
		return
	}
	publisher.closed = true
	publisher.cancel()
	publisher.mu.Unlock()
	publisher.wg.Wait()
}

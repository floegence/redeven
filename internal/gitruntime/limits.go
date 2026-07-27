package gitruntime

import (
	"context"
	"errors"
	"sync"
)

const (
	MaxReadProcesses          = 8
	MaxWorkspaceCaptures      = 2
	MaxMutationProcesses      = 4
	MaxDestructiveScans       = 1
	MaxRequestDecodes         = 16
	MaxResponseBuilds         = 8
	MaxRPCStreams             = 4
	MaxConcurrentRPCRequests  = 4
	MaxQueuedRPCRequests      = 8
	MaxQueuedRPCNotifications = 4
	RequestReservation        = 8 << 20
	ResponseReservation       = 12 << 20
	StreamReservation         = 32 << 20
	CaptureReservation        = 8 << 20
	MaxRequestReservations    = MaxRequestDecodes * RequestReservation
	MaxResponseReservations   = MaxResponseBuilds * ResponseReservation
	MaxCaptureReservations    = MaxWorkspaceCaptures * CaptureReservation
	MaxRPCStreamReservations  = MaxRPCStreams * StreamReservation
	MaxPublishedSnapshotBytes = 128 << 20
	MaxRawRequestBytes        = 768 << 10
	MaxResponsePayload        = 768 << 10
	MaxSyntheticEnvelope      = 768 << 10
	MaxJSONDepth              = 32
	MaxJSONTokens             = 32_768
	MaxJSONRecords            = 8_192
	MaxJSONStringBytes        = 640 << 10
	MaxJSONTotalStringBytes   = 2 << 20
)

var (
	ErrResourceLimit          = errors.New("git runtime resource limit")
	ErrRequestBudget          = errors.New("git request budget exceeded")
	ErrResponseBudget         = errors.New("git response budget exceeded")
	ErrContainmentUnavailable = errors.New("git subprocess containment unavailable")
)

type limiter struct {
	mu     sync.Mutex
	limit  int
	active int
	wake   chan struct{}
}

type byteLimiter struct {
	mu    sync.Mutex
	limit int64
	used  int64
}

func newByteLimiter(limit int64) *byteLimiter { return &byteLimiter{limit: limit} }

func (l *byteLimiter) tryAcquire(bytes int64) (func(), bool) {
	if bytes <= 0 || bytes > l.limit {
		return nil, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.used > l.limit-bytes {
		return nil, false
	}
	l.used += bytes
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			l.used -= bytes
			l.mu.Unlock()
		})
	}, true
}

func newLimiter(limit int) *limiter {
	return &limiter{limit: limit, wake: make(chan struct{})}
}

func (l *limiter) acquire(ctx context.Context) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		l.mu.Lock()
		if l.active < l.limit {
			l.active++
			l.mu.Unlock()
			var once sync.Once
			return func() {
				once.Do(func() {
					l.mu.Lock()
					l.active--
					close(l.wake)
					l.wake = make(chan struct{})
					l.mu.Unlock()
				})
			}, nil
		}
		wake := l.wake
		l.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-wake:
		}
	}
}

func (l *limiter) tryAcquire() (func(), bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active >= l.limit {
		return nil, false
	}
	l.active++
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			l.active--
			close(l.wake)
			l.wake = make(chan struct{})
			l.mu.Unlock()
		})
	}, true
}

func (l *limiter) count() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.active
}

// Admission is an idempotently released runtime reservation.
type Admission struct {
	release func()
}

func (a *Admission) Release() {
	if a != nil && a.release != nil {
		a.release()
	}
}

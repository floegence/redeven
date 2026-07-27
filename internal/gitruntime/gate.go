package gitruntime

import (
	"context"
	"sync"
)

type gateWaiter struct {
	write   bool
	granted chan struct{}
}

// fairRWGate is a cancellation-aware FIFO read/write gate. Consecutive readers
// at the front of the queue are admitted together; readers never pass a writer.
type fairRWGate struct {
	mu      sync.Mutex
	readers int
	writer  bool
	waiters []*gateWaiter
}

func (g *fairRWGate) acquire(ctx context.Context, write bool) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	w := &gateWaiter{write: write, granted: make(chan struct{})}
	g.mu.Lock()
	if g.canAcquireImmediately(write) {
		g.markAcquired(write)
		g.mu.Unlock()
		return g.releaseFunc(write), nil
	}
	g.waiters = append(g.waiters, w)
	g.mu.Unlock()

	select {
	case <-w.granted:
		return g.releaseFunc(write), nil
	case <-ctx.Done():
		g.mu.Lock()
		for i, candidate := range g.waiters {
			if candidate == w {
				g.waiters = append(g.waiters[:i], g.waiters[i+1:]...)
				g.grantLocked()
				g.mu.Unlock()
				return nil, ctx.Err()
			}
		}
		g.mu.Unlock()
		// Grant won the race with cancellation. The caller owns the lease and
		// must release it before observing cancellation.
		<-w.granted
		release := g.releaseFunc(write)
		release()
		return nil, ctx.Err()
	}
}

func (g *fairRWGate) canAcquireImmediately(write bool) bool {
	if len(g.waiters) != 0 || g.writer {
		return false
	}
	return !write || g.readers == 0
}

func (g *fairRWGate) markAcquired(write bool) {
	if write {
		g.writer = true
	} else {
		g.readers++
	}
}

func (g *fairRWGate) releaseFunc(write bool) func() {
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			if write {
				g.writer = false
			} else {
				g.readers--
			}
			g.grantLocked()
			g.mu.Unlock()
		})
	}
}

func (g *fairRWGate) grantLocked() {
	if g.writer || g.readers != 0 || len(g.waiters) == 0 {
		return
	}
	if g.waiters[0].write {
		w := g.waiters[0]
		g.waiters = g.waiters[1:]
		g.writer = true
		close(w.granted)
		return
	}
	for len(g.waiters) > 0 && !g.waiters[0].write {
		w := g.waiters[0]
		g.waiters = g.waiters[1:]
		g.readers++
		close(w.granted)
	}
}

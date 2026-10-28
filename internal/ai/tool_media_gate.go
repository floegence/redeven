package ai

import (
	"context"
	"sync"
)

// One in-process gate protects pending media from collection. Interactive writers
// cancel maintenance, but never release its gate before the scan has settled.
type toolMediaGate struct {
	mu          sync.Mutex
	changed     chan struct{}
	held        bool
	writers     int
	maintenance context.CancelFunc
}

func newToolMediaGate() *toolMediaGate { return &toolMediaGate{changed: make(chan struct{})} }

func (g *toolMediaGate) write(ctx context.Context) (func(), error) {
	g.mu.Lock()
	g.writers++
	for {
		if err := ctx.Err(); err != nil {
			g.writers--
			g.mu.Unlock()
			return nil, err
		}
		if !g.held {
			g.writers--
			g.held = true
			g.mu.Unlock()
			return g.release, nil
		}
		if g.maintenance != nil {
			g.maintenance()
		}
		changed := g.changed
		g.mu.Unlock()
		select {
		case <-ctx.Done():
		case <-changed:
		}
		g.mu.Lock()
	}
}

func (g *toolMediaGate) collect(ctx context.Context) (context.Context, func(), bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if ctx.Err() != nil || g.held || g.writers > 0 {
		return nil, nil, false
	}
	scan, cancel := context.WithCancel(ctx)
	g.held, g.maintenance = true, cancel
	return scan, g.release, true
}

func (g *toolMediaGate) release() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.maintenance != nil {
		g.maintenance()
		g.maintenance = nil
	}
	g.held = false
	close(g.changed)
	g.changed = make(chan struct{})
}

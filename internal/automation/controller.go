package automation

import (
	"context"
	"sync"
	"time"
)

// Controller owns only workflow admission and reconciliation, never model turns.
// The bounded pool prevents one unavailable target from starving other runs.
type Controller struct {
	Engine *Engine
	Report func(error)
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
}

func (c *Controller) Start(parent context.Context) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	c.cancel = cancel
	c.done = make(chan struct{})
	go func() {
		defer close(c.done)
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			c.step(ctx)
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
}
func (c *Controller) step(ctx context.Context) {
	rows, err := c.Engine.Store.ActiveRuns(ctx)
	if err != nil {
		if c.Report != nil {
			c.Report(err)
		}
		return
	}
	var wg sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, item := range rows {
		select {
		case <-ctx.Done():
			wg.Wait()
			return
		case slots <- struct{}{}:
		}
		wg.Add(1)
		go func(item OwnedRun) {
			defer wg.Done()
			defer func() { <-slots }()
			stepCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
			defer cancel()
			if err := c.Engine.Step(stepCtx, item.Owner, item.Run.ID); err != nil && ctx.Err() == nil && c.Report != nil {
				c.Report(err)
			}
		}(item)
	}
	wg.Wait()
}
func (c *Controller) Close() {
	c.mu.Lock()
	cancel, done := c.cancel, c.done
	c.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
}

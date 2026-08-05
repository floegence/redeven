package ai

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestServiceCloseWaitsForActiveRunsBeforeClosingFloret(t *testing.T) {
	t.Parallel()

	runCtx, cancelRun := context.WithCancel(context.Background())
	activeRun := &run{
		doneCh:   make(chan struct{}),
		cancelFn: cancelRun,
	}
	go func() {
		<-runCtx.Done()
		activeRun.markDone()
	}()

	var floretClosed atomic.Bool
	svc := &Service{
		persistOpTO: time.Second,
		runs:        map[string]*run{"active": activeRun},
		closeFloret: func() error {
			select {
			case <-activeRun.doneCh:
				floretClosed.Store(true)
			default:
				t.Fatal("Floret closed before the active run finished")
			}
			return nil
		},
	}

	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	if !floretClosed.Load() {
		t.Fatal("Floret close callback was not called")
	}
}

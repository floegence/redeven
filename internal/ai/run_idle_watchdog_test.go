package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestRunIdleWatchdog_DoesNotTimeoutWhileWaitingApproval(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		Log:         slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{})),
		IdleTimeout: 80 * time.Millisecond,
	})

	r.mu.Lock()
	r.waitingApproval = true
	r.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		r.runIdleWatchdog(ctx)
		close(done)
	}()

	deadline := time.Now().Add(4 * r.idleTimeout)
	for time.Now().Before(deadline) {
		if got := r.getCancelReason(); got != "" {
			t.Fatalf("cancelReason=%q, want empty while waitingApproval", got)
		}
		time.Sleep(10 * time.Millisecond)
	}

	r.mu.Lock()
	r.waitingApproval = false
	r.mu.Unlock()

	deadline = time.Now().Add(4 * r.idleTimeout)
	for time.Now().Before(deadline) {
		if got := r.getCancelReason(); got == "timed_out" {
			cancel()
			<-done
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()
	<-done
	t.Fatalf("run did not time out after leaving waitingApproval state")
}

package ai

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestBrowserLeaseBlocksAIAndSharesTheTargetInputGate(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	lease, err := host.acquireBrowserLease(t.Context(), "page", "viewer", true, false, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !lease.control.browserObservationPermitted("viewer") || lease.control.browserObservationPermitted("other") {
		t.Fatal("private control did not isolate observation")
	}
	for _, call := range []TargetToolCall{
		{TargetID: "page", ThreadID: "thread", RunID: "run", ToolName: "computer.click"},
		{TargetID: "page", ThreadID: "thread", RunID: "run", ToolName: "computer.observe", liveFrame: true},
	} {
		if _, unlock, err := host.acquireComputerControl(t.Context(), call); err == nil {
			unlock()
			t.Fatal("AI entered a user-controlled page")
		}
	}
	var effects atomic.Int32
	if err := lease.run(t.Context(), func(context.Context) error { effects.Add(1); return nil }); err != nil {
		t.Fatal(err)
	}
	if err := lease.close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := lease.run(t.Context(), func(context.Context) error { effects.Add(1); return nil }); err == nil {
		t.Fatal("closed user control executed an input")
	}
	if effects.Load() != 1 {
		t.Fatal("stale input reached the source")
	}
	_, unlock, err := host.acquireComputerControl(t.Context(), TargetToolCall{TargetID: "page", ThreadID: "thread", RunID: "run"})
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestBrowserLeaseDrainFailureCannotAdmitNewInput(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	uncertain := errors.New("held input cleanup is unknown")
	first, err := host.acquireBrowserLease(t.Context(), "page", "first", false, false, func(context.Context) error { return uncertain })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.acquireBrowserLease(t.Context(), "page", "second", false, true, nil); !errors.Is(err, uncertain) {
		t.Fatalf("cleanup failure was hidden: %v", err)
	}
	if first.current() {
		t.Fatal("old input survived a failed takeover")
	}
	if _, err := host.acquireBrowserLease(t.Context(), "page", "third", false, true, nil); !errors.Is(err, uncertain) {
		t.Fatal("new control bypassed a failed cleanup")
	}
	if err := host.Close(); !errors.Is(err, uncertain) {
		t.Fatal("shutdown hid uncertain input cleanup")
	}
}

func TestBrowserTakeoverRevokesBeforeDrainAndDoesNotWaitForOtherPages(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	var released atomic.Int32
	first, err := host.acquireBrowserLease(t.Context(), "page", "first", false, false, func(context.Context) error { released.Add(1); return nil })
	if err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget("page")
	control.gate <- struct{}{}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := host.acquireBrowserLease(ctx, "page", "cancelled", false, true, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled admission: %v", err)
	}
	if !first.current() {
		t.Fatal("an already-cancelled request revoked its predecessor")
	}
	result := make(chan *browserTargetLease, 1)
	failure := make(chan error, 1)
	go func() {
		lease, err := host.acquireBrowserLease(t.Context(), "page", "second", true, true, nil)
		if err != nil {
			failure <- err
			return
		}
		result <- lease
	}()
	<-first.revoked
	if first.current() {
		t.Fatal("takeover left old input admission open while waiting")
	}
	healthy, err := host.acquireBrowserLease(t.Context(), "healthy", "other", false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := healthy.close(t.Context()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-result:
		t.Fatal("new input became ready before old input drained")
	default:
	}
	<-control.gate
	select {
	case lease := <-result:
		if released.Load() != 1 {
			t.Fatal("old held-input cleanup did not finish")
		}
		if err := lease.close(t.Context()); err != nil {
			t.Fatal(err)
		}
	case err := <-failure:
		t.Fatal(err)
	case <-t.Context().Done():
		t.Fatal("takeover did not finish")
	}
}

func TestBrowserLeaseCannotStealAIWithoutExplicitTakeover(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	call := TargetToolCall{TargetID: "page", ThreadID: "thread", TurnID: "turn", RunID: "run"}
	_, unlock, err := host.acquireComputerControl(t.Context(), call)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	if _, err := host.acquireBrowserLease(t.Context(), "page", "viewer", false, false, nil); err == nil {
		t.Fatal("opening a view implicitly stole AI control")
	}
	lease, err := host.acquireBrowserLease(t.Context(), "page", "viewer", true, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := lease.close(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, unlock, err := host.acquireComputerControl(t.Context(), call); err == nil {
		unlock()
		t.Fatal("closing user control resumed AI without a fresh observation")
	}
}

func TestBrowserAdmissionCancellationStillReleasesHeldInput(t *testing.T) {
	host := NewComputerUseRuntime(NewTargetRegistry(), nil, t.TempDir())
	t.Cleanup(func() { _ = host.Close() })
	var released atomic.Int32
	first, err := host.acquireBrowserLease(t.Context(), "page", "first", false, false, func(ctx context.Context) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		released.Add(1)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	first.control.gate <- struct{}{}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := host.acquireBrowserLease(ctx, "page", "second", true, true, nil); done <- err }()
	<-first.revoked
	cancel()
	<-first.control.gate
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled admission: %v", err)
	}
	if released.Load() != 1 {
		t.Fatal("request cancellation skipped held-input cleanup")
	}
	next, err := host.acquireBrowserLease(t.Context(), "page", "third", false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := next.close(t.Context()); err != nil {
		t.Fatal(err)
	}
}

package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

var errBrowserControlRevoked = errors.New("browser control has been revoked")

// A browser lease is another owner of the existing target gate, never a second
// input queue. The authenticated view registry must authorize the target before
// calling acquireBrowserLease. The lease and its cleanup outlive HTTP requests.
type browserTargetLease struct {
	host         *ComputerUseRuntime
	control      *computerTargetControl
	viewID       string
	private      bool
	managed      bool // Owned process termination can prove this lease terminal.
	ready        bool // guarded by control.mu
	previous     *browserTargetLease
	releaseInput func(context.Context) error
	revoked      chan struct{}
	revokeOnce   sync.Once
	drainOnce    sync.Once
	drainError   error
}

func (lease *browserTargetLease) revoke() { lease.revokeOnce.Do(func() { close(lease.revoked) }) }

func (lease *browserTargetLease) stopped() bool {
	select {
	case <-lease.revoked:
		return true
	default:
		return false
	}
}

func (lease *browserTargetLease) current() bool {
	lease.control.mu.Lock()
	defer lease.control.mu.Unlock()
	return lease.control.browser == lease && lease.ready && !lease.stopped()
}

// Call only while holding the target gate. A failed drain stays terminal for
// this source lifetime; no uncertain cleanup or old user input is replayed.
func (lease *browserTargetLease) drain(ctx context.Context) error {
	lease.drainOnce.Do(func() {
		if lease.previous != nil {
			lease.drainError = lease.previous.drain(ctx)
			lease.previous = nil
		}
		if lease.drainError == nil && lease.releaseInput != nil {
			lease.drainError = lease.releaseInput(ctx)
		}
	})
	return lease.drainError
}

func (r *ComputerUseRuntime) acquireBrowserLease(ctx context.Context, targetID, viewID string, private, takeover bool, releaseInput func(context.Context) error) (_ *browserTargetLease, resultErr error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r == nil || strings.TrimSpace(targetID) == "" || strings.TrimSpace(viewID) == "" {
		return nil, errors.New("browser control identity is required")
	}
	control := r.controlForTarget(targetID)
	r.mu.RLock()
	if r.closed {
		r.mu.RUnlock()
		return nil, errBrowserControlRevoked
	}
	control.mu.Lock()
	if !takeover && (control.browser != nil || control.threadID != "") {
		control.mu.Unlock()
		r.mu.RUnlock()
		return nil, errors.New("browser target is already controlled")
	}
	lease := &browserTargetLease{host: r, control: control, viewID: viewID, private: private, previous: control.browser, releaseInput: releaseInput, revoked: make(chan struct{})}
	if executor, ok := r.executors[targetID].(*PlaywrightTargetExecutor); ok {
		lease.managed = executor.ManagedAttachment
	}
	control.browser = lease
	if lease.previous != nil {
		lease.previous.revoke()
	}
	if control.threadID != "" {
		control.pauseForUser()
	}
	control.mu.Unlock()
	r.mu.RUnlock()
	defer func() {
		if resultErr == nil {
			return
		}
		// Request cancellation cannot cancel the source's held-input cleanup.
		// Failure leaves a revoked reservation at the target boundary and is
		// returned explicitly; later inputs cannot bypass an uncertain drain.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		resultErr = errors.Join(resultErr, lease.close(cleanup))
	}()

	// Publishing the reservation above rejects all new old-owner input before
	// waiting for this page's in-flight action and held-input cleanup.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-lease.revoked:
		return nil, errBrowserControlRevoked
	case control.gate <- struct{}{}:
	}
	defer func() { <-control.gate }()
	// Cancellation and gate availability can become ready together. Do not
	// consume the previous owner's one-shot drain with a canceled context.
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if lease.previous != nil {
		if err := lease.previous.drain(ctx); err != nil {
			lease.revoke()
			return nil, err
		}
		lease.previous = nil
	}
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.browser != lease || lease.stopped() {
		return nil, errBrowserControlRevoked
	}
	lease.ready = true
	return lease, nil
}

func (lease *browserTargetLease) run(ctx context.Context, operation func(context.Context) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-lease.revoked:
		return errBrowserControlRevoked
	case lease.control.gate <- struct{}{}:
	}
	defer func() { <-lease.control.gate }()
	lease.host.mu.RLock()
	closed := lease.host.closed
	lease.host.mu.RUnlock()
	if closed || !lease.current() {
		return errBrowserControlRevoked
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return operation(ctx)
}

func (lease *browserTargetLease) close(ctx context.Context) error {
	lease.revoke()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case lease.control.gate <- struct{}{}:
	}
	defer func() { <-lease.control.gate }()
	if err := lease.drain(ctx); err != nil {
		return err
	}
	lease.control.mu.Lock()
	if lease.control.browser == lease {
		lease.control.browser = nil
	}
	lease.control.mu.Unlock()
	return nil
}

// This is only the private-observation barrier. A view still needs its own
// authenticated source grant before receiving DOM, resources, files or media.
func (control *computerTargetControl) browserObservationPermitted(viewID string) bool {
	control.mu.Lock()
	defer control.mu.Unlock()
	lease := control.browser
	return lease == nil || !lease.private || lease.viewID == viewID
}

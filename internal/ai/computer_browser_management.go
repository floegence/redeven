package ai

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/session"
)

var errManagedBrowserInUse = errors.New("managed_browser_in_use")

// IsManagedBrowserInUse identifies a safe, actionable lifecycle rejection.
func IsManagedBrowserInUse(err error) bool { return errors.Is(err, errManagedBrowserInUse) }

const managedBrowserIdleTimeout = 10 * time.Minute

func closeManagedBrowserProfiles(profiles []*managedBrowserProfile) error {
	failures := make([]error, len(profiles))
	var wg sync.WaitGroup
	for i, p := range profiles {
		wg.Go(func() { failures[i] = p.closeResult() })
	}
	wg.Wait()
	return errors.Join(failures...)
}
func (r *ComputerUseRuntime) startManagedBrowserMaintenanceLocked() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if r.managedMaintenanceCancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.managedMaintenanceCancel = cancel
	r.managedMaintenanceDone = make(chan struct{})
	go func() {
		defer close(r.managedMaintenanceDone)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				r.releaseIdleManagedBrowsers(ctx, now)
			}
		}
	}()
}

// Reserve every target gate before inspecting ownership. Retirement and gate
// admission are atomic: queued work sees a closed adapter, never a replacement.
// The caller holds connectMu, so no new attachment can enter this profile.
func (r *ComputerUseRuntime) reserveManagedProfileLocked(p *managedBrowserProfile, retire bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	var gates []*computerTargetControl
	defer func() {
		for _, c := range gates {
			<-c.gate
		}
	}()
	var executors []*PlaywrightTargetExecutor
	for id, e := range r.executors {
		browser, ok := e.(*PlaywrightTargetExecutor)
		if !ok || !browser.ManagedAttachment || browser.CDPURL != p.endpoint {
			continue
		}
		c := r.controls[id]
		if c == nil {
			c = &computerTargetControl{gate: make(chan struct{}, 1)}
			if r.controls == nil {
				r.controls = make(map[string]*computerTargetControl)
			}
			r.controls[id] = c
		}
		select {
		case c.gate <- struct{}{}:
			gates = append(gates, c)
		default:
			return false
		}
		c.mu.Lock()
		busy := c.threadID != "" || c.browser != nil
		c.mu.Unlock()
		if busy {
			return false
		}
		for _, sampler := range r.liveFrames {
			if sampler.request.TargetID == id {
				return false
			}
		}
		executors = append(executors, browser)
	}
	if !retire {
		return true
	}
	for _, e := range executors {
		e.mu.Lock()
		e.closed = true
		e.mu.Unlock()
	}
	p.mu.Lock()
	p.retired = true
	p.mu.Unlock()
	return true
}

func (r *ComputerUseRuntime) releaseIdleManagedBrowsers(ctx context.Context, now time.Time) {
	if r.connectMu.LockContext(ctx) != nil {
		return
	}
	var retiring []*managedBrowserProfile
	for _, p := range r.managedProfiles {
		if ctx.Err() != nil {
			break
		}
		if p.stopped() {
			p.idleSince = time.Time{}
			continue
		}
		probe, cancel := context.WithTimeout(ctx, time.Second)
		reply, err := p.request(probe, "idle_status")
		cancel()
		if err != nil || reply.Idle == nil || !*reply.Idle || !r.reserveManagedProfileLocked(p, false) {
			p.idleSince = time.Time{}
			continue
		}
		if p.idleSince.IsZero() {
			p.idleSince = now
			continue
		}
		if now.Sub(p.idleSince) < managedBrowserIdleTimeout {
			continue
		}
		if !r.reserveManagedProfileLocked(p, true) {
			p.idleSince = time.Time{}
			continue
		}
		retiring = append(retiring, p)
	}
	r.connectMu.Unlock()
	for _, p := range retiring {
		err := p.closeResult()
		r.connectMu.Lock()
		for id, current := range r.managedProfiles {
			if current == p && err == nil {
				delete(r.managedProfiles, id)
			}
		}
		r.connectMu.Unlock()
		if err != nil {
			slog.Warn("managed browser idle cleanup incomplete")
		}
	}
}

// User-initiated lifecycle operations do not select a page or replay an action.
// Stop refuses a currently controlled target; the task must first be stopped or
// handed back through its existing control boundary.
func (s *Service) ManageBrowserProfile(ctx context.Context, meta *session.Meta, id, action string) ([]ComputerManagedProfile, error) {
	host, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer runtime unavailable")
	}
	return host.ManageBrowserProfile(ctx, meta, id, action)
}
func (r *ComputerUseRuntime) ManageBrowserProfile(ctx context.Context, meta *session.Meta, id, action string) ([]ComputerManagedProfile, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if action != "start" && action != "stop" {
		return nil, errors.New("invalid browser action")
	}
	if err := r.connectMu.LockContext(ctx); err != nil {
		return nil, err
	}
	profiles, err := r.managedProfilesLocked()
	if err != nil {
		r.connectMu.Unlock()
		return nil, err
	}
	if !slices.ContainsFunc(profiles, func(p ComputerManagedProfile) bool { return p.ID == id }) {
		r.connectMu.Unlock()
		return nil, errors.New("unknown managed profile")
	}
	if action == "start" {
		_, err = r.managedProfileLocked(ctx, id)
		r.connectMu.Unlock()
		if err != nil {
			return nil, err
		}
		return r.ManagedBrowserProfiles(ctx, meta, "")
	}
	p := r.managedProfiles[id]
	if p == nil {
		r.connectMu.Unlock()
		return r.ManagedBrowserProfiles(ctx, meta, "")
	}
	if !r.reserveManagedProfileLocked(p, true) {
		r.connectMu.Unlock()
		return nil, errManagedBrowserInUse
	}
	r.connectMu.Unlock()
	err = p.closeResult()
	r.connectMu.Lock()
	if err == nil && r.managedProfiles[id] == p {
		delete(r.managedProfiles, id)
	}
	r.connectMu.Unlock()
	if err != nil {
		return nil, err
	}
	return r.ManagedBrowserProfiles(ctx, meta, "")
}

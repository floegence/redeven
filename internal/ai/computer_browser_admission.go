package ai

import (
	"context"
	"crypto/rand"
	"sync"
)

type browserTraceRequestKey struct{}

func browserTraceRequest(ctx context.Context) string {
	if id, ok := ctx.Value(browserTraceRequestKey{}).(string); ok {
		return id
	}
	return rand.Text()
}

// Directory callers may have short request lifetimes. Waiting for the shared
// metadata boundary must respect them without leaving a waiter goroutine behind.
type browserConnectMutex struct {
	once sync.Once
	gate chan struct{}
}

func (m *browserConnectMutex) LockContext(ctx context.Context) error {
	m.once.Do(func() { m.gate = make(chan struct{}, 1) })
	if err := ctx.Err(); err != nil {
		return err
	}
	select {
	case m.gate <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *browserConnectMutex) Lock()   { _ = m.LockContext(context.Background()) }
func (m *browserConnectMutex) Unlock() { <-m.gate }

type extensionAdmissionGate struct {
	gate  chan struct{}
	users int
}

// One native tab has one admission/retirement owner, across all its viewers.
// Waiting callers own only their cancellation; they cannot cancel that owner.
func (r *ComputerUseRuntime) lockExtensionAdmission(ctx context.Context, client *computerExtensionClient, tab string) (func(), error) {
	key := client.profile.LibraryID + "/" + tab
	r.mu.Lock()
	if r.extensionAdmissions == nil {
		r.extensionAdmissions = make(map[string]*extensionAdmissionGate)
	}
	entry := r.extensionAdmissions[key]
	if entry == nil {
		entry = &extensionAdmissionGate{gate: make(chan struct{}, 1)}
		r.extensionAdmissions[key] = entry
	}
	entry.users++
	r.mu.Unlock()
	release := func(owned bool) {
		if owned {
			<-entry.gate
		}
		r.mu.Lock()
		entry.users--
		if entry.users == 0 {
			delete(r.extensionAdmissions, key)
		}
		r.mu.Unlock()
	}
	select {
	case entry.gate <- struct{}{}:
		if err := ctx.Err(); err != nil {
			release(true)
			return nil, err
		}
		return func() { release(true) }, nil
	case <-ctx.Done():
		release(false)
		return nil, ctx.Err()
	}
}

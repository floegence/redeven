package registry

import (
	"context"
	"errors"
)

// ForwardAccessContext binds in-flight proxy requests, including upgraded
// streams, to the continued existence of a persisted route. Registering and
// publishing revocations share one lock to close the read/subscribe race.
func (r *Registry) ForwardAccessContext(parent context.Context, id string) (context.Context, func(), error) {
	r.accessMu.Lock()
	forward, err := r.GetForward(parent, id)
	if err != nil || forward == nil {
		r.accessMu.Unlock()
		if err == nil {
			err = errors.New("port forward no longer exists")
		}
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	if r.access == nil {
		r.access = map[string]map[uint64]context.CancelFunc{}
	}
	if r.access[id] == nil {
		r.access[id] = map[uint64]context.CancelFunc{}
	}
	r.nextAccess++
	key := r.nextAccess
	r.access[id][key] = cancel
	r.accessMu.Unlock()
	release := func() {
		r.accessMu.Lock()
		delete(r.access[id], key)
		if len(r.access[id]) == 0 {
			delete(r.access, id)
		}
		r.accessMu.Unlock()
		cancel()
	}
	stop := context.AfterFunc(ctx, release)
	return ctx, func() { stop(); release() }, nil
}
func (r *Registry) revokeForwardAccess(id string) {
	r.accessMu.Lock()
	callbacks := r.access[id]
	delete(r.access, id)
	r.accessMu.Unlock()
	for _, cancel := range callbacks {
		cancel()
	}
}

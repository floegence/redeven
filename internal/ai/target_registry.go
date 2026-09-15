package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
)

var errTargetNotRegistered = errors.New("target is not registered")
var errTargetAmbiguous = errors.New("target kind has multiple bindings")

// TargetRegistry owns target identities and readiness snapshots. It has no
// mutable current target or thread bindings; the Computer Use Runtime resolves
// persisted thread selection through the product store.
type TargetRegistry struct {
	mu      sync.RWMutex
	targets map[string]TargetDescriptor
}

func NewTargetRegistry() *TargetRegistry {
	return &TargetRegistry{targets: make(map[string]TargetDescriptor)}
}

func (r *TargetRegistry) Register(target TargetDescriptor) error {
	if r == nil {
		return errors.New("target registry is unavailable")
	}
	target.ID = strings.TrimSpace(target.ID)
	if target.ID == "" {
		return errors.New("target id is required")
	}
	if target.DisplayName == "" {
		target.DisplayName = target.ID
	}
	r.mu.Lock()
	r.targets[target.ID] = target
	r.mu.Unlock()
	return nil
}

// Update replaces a target readiness snapshot without changing the current
// alias. Adapters call this when a helper disconnects or permissions change.
func (r *TargetRegistry) Update(target TargetDescriptor) error {
	if r == nil {
		return errors.New("target registry is unavailable")
	}
	target.ID = strings.TrimSpace(target.ID)
	if target.ID == "" {
		return errors.New("target id is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.targets[target.ID]; !ok {
		return errTargetNotRegistered
	}
	r.targets[target.ID] = target
	return nil
}

func (r *TargetRegistry) ResolveTarget(_ context.Context, alias string) (TargetDescriptor, error) {
	if r == nil {
		return TargetDescriptor{}, errors.New("target registry is unavailable")
	}
	alias = strings.TrimSpace(alias)
	r.mu.RLock()
	defer r.mu.RUnlock()
	if alias == "" || alias == "current" {
		alias = "browser.managed"
	}
	target, ok := r.targets[alias]
	if !ok {
		for _, candidate := range r.targets {
			if candidate.Kind != alias {
				continue
			}
			if ok {
				return TargetDescriptor{}, errTargetAmbiguous
			}
			target, ok = candidate, true
		}
		if !ok {
			return TargetDescriptor{}, errTargetNotRegistered
		}
	}
	return target, nil
}

func (r *TargetRegistry) Snapshot() []TargetDescriptor {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]TargetDescriptor, 0, len(r.targets))
	for _, target := range r.targets {
		out = append(out, target)
	}
	return out
}

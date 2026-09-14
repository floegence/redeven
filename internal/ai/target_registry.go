package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// TargetRegistry is the single in-process owner of target identity exposed to
// Flower. Executors remain responsible for lifecycle and bytes; this registry
// only provides safe alias resolution and readiness snapshots.
type TargetRegistry struct {
	mu       sync.RWMutex
	targets  map[string]TargetDescriptor
	current  string
	bindings map[string]string
}

func NewTargetRegistry() *TargetRegistry {
	return &TargetRegistry{targets: make(map[string]TargetDescriptor), bindings: make(map[string]string)}
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
	if r.current == "" {
		r.current = target.ID
	}
	r.mu.Unlock()
	return nil
}

func (r *TargetRegistry) SetCurrent(targetID string) error {
	if r == nil {
		return errors.New("target registry is unavailable")
	}
	targetID = strings.TrimSpace(targetID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.targets[targetID]; !ok {
		return errors.New("target is not registered")
	}
	r.current = targetID
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
		return errors.New("target is not registered")
	}
	r.targets[target.ID] = target
	return nil
}

// BindThreadTarget records the logical current target for one thread. A
// thread binding is independent from the process default and can never select
// an unregistered target.
func (r *TargetRegistry) BindThreadTarget(threadID, targetID string) error {
	threadID, targetID = strings.TrimSpace(threadID), strings.TrimSpace(targetID)
	if threadID == "" || targetID == "" {
		return errors.New("thread and target are required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.targets[targetID]; !ok {
		return errors.New("target is not registered")
	}
	if r.bindings == nil {
		r.bindings = make(map[string]string)
	}
	r.bindings[threadID] = targetID
	return nil
}

func (r *TargetRegistry) ResolveTargetForThread(_ context.Context, threadID, alias string) (TargetDescriptor, error) {
	threadID = strings.TrimSpace(threadID)
	alias = strings.TrimSpace(alias)
	r.mu.RLock()
	if (alias == "" || alias == "current") && threadID != "" {
		alias = r.bindings[threadID]
	}
	r.mu.RUnlock()
	return r.ResolveTarget(context.Background(), alias)
}

func (r *TargetRegistry) ResolveTarget(_ context.Context, alias string) (TargetDescriptor, error) {
	if r == nil {
		return TargetDescriptor{}, errors.New("target registry is unavailable")
	}
	alias = strings.TrimSpace(alias)
	r.mu.RLock()
	defer r.mu.RUnlock()
	if alias == "" || alias == "current" {
		alias = r.current
	}
	target, ok := r.targets[alias]
	if !ok {
		for _, candidate := range r.targets {
			if candidate.Kind != alias {
				continue
			}
			if ok {
				return TargetDescriptor{}, errors.New("target kind has multiple bindings")
			}
			target, ok = candidate, true
		}
		if !ok {
			return TargetDescriptor{}, errors.New("target is not registered")
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

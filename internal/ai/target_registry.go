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
	mu      sync.RWMutex
	targets map[string]TargetDescriptor
	current string
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
		return TargetDescriptor{}, errors.New("target is not registered")
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

// Package flowerwork resolves host-owned work into one Flower execution profile.
// It owns no conversation, approval, effect or business-object persistence.
package flowerwork

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/session"
)

var ErrUnavailable = errors.New("Flower work is unavailable")

type Binding struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	ThreadID string `json:"thread_id"`
	Revision string `json:"revision"`
	Title    string `json:"title"`
	Scope    string `json:"scope"`
}
type Profile struct {
	ID             string   `json:"id"`
	Guidance       string   `json:"guidance"`
	ToolNames      []string `json:"tool_names,omitempty"`
	ToolPrefixes   []string `json:"tool_prefixes"`
	Skills         []string `json:"skills"`
	ResultContract string   `json:"result_contract"`
}
type Context struct {
	Key   string
	Title string
	Text  string
}
type Resolved struct {
	Binding Binding
	Profile Profile
	Context []Context
}
type Adapter interface {
	ResolveThread(context.Context, *session.Meta, string) (*Resolved, error)
}
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
}

func New() *Registry { return &Registry{adapters: map[string]Adapter{}} }
func (r *Registry) Register(kind string, a Adapter) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if kind == "" || a == nil {
		return ErrUnavailable
	}
	if r.adapters[kind] != nil {
		return fmt.Errorf("duplicate Flower work adapter %s", kind)
	}
	r.adapters[kind] = a
	return nil
}
func (r *Registry) Resolve(ctx context.Context, meta *session.Meta, thread string) (*Resolved, error) {
	if r == nil || meta == nil || thread == "" {
		return nil, ErrUnavailable
	}
	r.mu.RLock()
	adapters := make(map[string]Adapter, len(r.adapters))
	for k, a := range r.adapters {
		adapters[k] = a
	}
	r.mu.RUnlock()
	var result *Resolved
	for kind, a := range adapters {
		candidate, err := a.ResolveThread(ctx, meta, thread)
		if err != nil {
			return nil, err
		}
		if candidate == nil {
			continue
		}
		if result != nil || candidate.Binding.Kind != kind || candidate.Binding.ThreadID != thread {
			return nil, fmt.Errorf("%w: conflicting work ownership", ErrUnavailable)
		}
		result = candidate
	}
	return result, nil
}

type AdapterFunc func(context.Context, *session.Meta, string) (*Resolved, error)

func (f AdapterFunc) ResolveThread(c context.Context, m *session.Meta, t string) (*Resolved, error) {
	return f(c, m, t)
}

// AllowsTool describes the profile surface. Runtime authorization still checks
// the current owner, grant and exact resource before every invocation.
func (p Profile) AllowsTool(name string) bool {
	if slices.Contains(p.ToolNames, name) {
		return true
	}
	for _, prefix := range p.ToolPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

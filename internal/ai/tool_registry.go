package ai

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const (
	toolResultStatusSuccess = "success"
	toolResultStatusError   = "error"
	toolResultStatusAborted = "aborted"
	toolResultStatusTimeout = "timeout"
)

var sourceRank = map[string]int{
	"builtin":  4,
	"mcp":      3,
	"skill":    2,
	"subagent": 1,
}

type registeredTool struct {
	def     ToolDef
	handler ToolHandler
}

type InMemoryToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]registeredTool
}

func NewInMemoryToolRegistry() *InMemoryToolRegistry {
	return &InMemoryToolRegistry{tools: make(map[string]registeredTool)}
}

func (r *InMemoryToolRegistry) Register(tool ToolDef, handler ToolHandler) error {
	if r == nil {
		return errors.New("nil tool registry")
	}
	name := strings.TrimSpace(tool.Name)
	if name == "" {
		return errors.New("tool name is required")
	}
	if handler == nil {
		return fmt.Errorf("tool %s missing handler", name)
	}
	tool.Name = name
	tool.Source = strings.ToLower(strings.TrimSpace(tool.Source))
	if tool.Source == "" {
		tool.Source = "builtin"
	}
	if tool.Namespace == "" {
		tool.Namespace = "builtin"
	}
	if err := aitools.ValidatePresentationSpec(name, tool.Presentation); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.tools[name]; ok {
		replace, err := shouldReplaceTool(existing.def, tool)
		if err != nil {
			return err
		}
		if !replace {
			return nil
		}
	}
	r.tools[name] = registeredTool{def: tool, handler: handler}
	return nil
}

func shouldReplaceTool(existing ToolDef, candidate ToolDef) (bool, error) {
	if candidate.Priority > existing.Priority {
		return true, nil
	}
	if candidate.Priority < existing.Priority {
		return false, nil
	}
	existingRank := sourceRank[strings.ToLower(strings.TrimSpace(existing.Source))]
	candidateRank := sourceRank[strings.ToLower(strings.TrimSpace(candidate.Source))]
	if candidateRank > existingRank {
		return true, nil
	}
	if candidateRank < existingRank {
		return false, nil
	}
	return false, fmt.Errorf("tool_registry_conflict: duplicate tool %q with same priority/source", existing.Name)
}

func (r *InMemoryToolRegistry) Unregister(name string) error {
	if r == nil {
		return errors.New("nil tool registry")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("tool name is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tools, name)
	return nil
}

func (r *InMemoryToolRegistry) Snapshot() []ToolDef {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ToolDef, 0, len(r.tools))
	for _, item := range r.tools {
		out = append(out, item.def)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out
}

func (r *InMemoryToolRegistry) resolve(name string) (ToolDef, ToolHandler, bool) {
	if r == nil {
		return ToolDef{}, nil, false
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ToolDef{}, nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.tools[name]
	if !ok {
		return ToolDef{}, nil, false
	}
	return item.def, item.handler, true
}

type DefaultModeToolFilter struct{}

func (f DefaultModeToolFilter) FilterToolsForMode(mode string, all []ToolDef) []ToolDef {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "act"
	}
	out := make([]ToolDef, 0, len(all))
	for _, tool := range all {
		if mode == "plan" && tool.Mutating {
			continue
		}
		out = append(out, tool)
	}
	return out
}

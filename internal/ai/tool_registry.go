package ai

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/ai/toolnames"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const (
	toolResultStatusSuccess = "success"
	toolResultStatusError   = "error"
	toolResultStatusAborted = "aborted"
	toolResultStatusTimeout = "timeout"
)

func validateCallableToolName(name string) error { return toolnames.Validate(name) }

type InMemoryToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]ToolDef
}

func NewInMemoryToolRegistry() *InMemoryToolRegistry {
	return &InMemoryToolRegistry{tools: make(map[string]ToolDef)}
}

func (r *InMemoryToolRegistry) Register(tool ToolDef) error {
	if r == nil {
		return errors.New("nil tool registry")
	}
	name := strings.TrimSpace(tool.Name)
	if name == "" {
		return errors.New("tool name is required")
	}
	if err := validateCallableToolName(name); err != nil {
		return err
	}
	tool.Name = name
	tool = normalizeToolPermissionMetadata(tool)
	tool.Source = strings.ToLower(strings.TrimSpace(tool.Source))
	if tool.Source == "" {
		tool.Source = "builtin"
	}
	if toolnames.IsFirstParty(name) && tool.Source != "builtin" && tool.Source != "floret" {
		return fmt.Errorf("tool_registry_conflict: first-party name %q is reserved", name)
	}
	if strings.HasPrefix(name, "mcp_") && tool.Source != "mcp" {
		return fmt.Errorf("tool_registry_conflict: MCP namespace is reserved")
	}
	if tool.Namespace == "" {
		tool.Namespace = "builtin"
	}
	if err := aitools.ValidatePresentationSpec(name, tool.Presentation); err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.tools[name]; ok {
		return fmt.Errorf("tool_registry_conflict: duplicate tool %q", name)
	}
	r.tools[name] = tool
	return nil
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
	for _, def := range r.tools {
		out = append(out, def)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out
}

type DefaultPermissionToolFilter struct{}

func (f DefaultPermissionToolFilter) FilterTools(permissionType FlowerPermissionType, all []ToolDef) []ToolDef {
	out := make([]ToolDef, 0, len(all))
	for _, tool := range all {
		tool = normalizeToolPermissionMetadata(tool)
		if !toolVisibleForPermission(permissionType, tool) {
			continue
		}
		out = append(out, tool)
	}
	return out
}

func toolVisibleForPermission(permissionType FlowerPermissionType, tool ToolDef) bool {
	switch permissionType {
	case FlowerPermissionReadonly:
		switch tool.Visibility {
		case ToolVisibilityReadonlyExclusive, ToolVisibilitySharedReadonly, ToolVisibilityInteraction, ToolVisibilityControl, ToolVisibilityDelegationControl:
			return true
		default:
			return false
		}
	case FlowerPermissionApprovalRequired, FlowerPermissionFullAccess:
		switch tool.Visibility {
		case ToolVisibilityReadonlyExclusive:
			return false
		case ToolVisibilityStandard, ToolVisibilitySharedReadonly, ToolVisibilityInteraction, ToolVisibilityControl, ToolVisibilityDelegationControl:
			return true
		default:
			return false
		}
	default:
		return false
	}
}

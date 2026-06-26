package ai

import (
	"strings"
)

func newPermissionToolFilter(allowUserInteraction bool) PermissionToolFilter {
	return flowerPermissionToolFilter{
		base:                 DefaultPermissionToolFilter{},
		allowUserInteraction: allowUserInteraction,
	}
}

type allowlistPermissionToolFilter struct {
	base      PermissionToolFilter
	allowlist map[string]struct{}
}

func (r *run) withToolAllowlistFilter(base PermissionToolFilter) PermissionToolFilter {
	if r == nil || len(r.toolAllowlist) == 0 {
		return base
	}
	allow := make(map[string]struct{}, len(r.toolAllowlist))
	for name := range r.toolAllowlist {
		if name = strings.TrimSpace(name); name != "" {
			allow[name] = struct{}{}
		}
	}
	if len(allow) == 0 {
		return base
	}
	return allowlistPermissionToolFilter{base: base, allowlist: allow}
}

func (f allowlistPermissionToolFilter) FilterTools(permissionType FlowerPermissionType, all []ToolDef) []ToolDef {
	base := f.base
	if base == nil {
		base = DefaultPermissionToolFilter{}
	}
	filtered := base.FilterTools(permissionType, all)
	if len(f.allowlist) == 0 {
		return filtered
	}
	out := make([]ToolDef, 0, len(filtered))
	for _, tool := range filtered {
		tool = normalizeToolPermissionMetadata(tool)
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		if _, ok := f.allowlist[name]; ok {
			out = append(out, tool)
		}
	}
	return out
}

type flowerPermissionToolFilter struct {
	base                 PermissionToolFilter
	allowUserInteraction bool
}

func (f flowerPermissionToolFilter) FilterTools(permissionType FlowerPermissionType, all []ToolDef) []ToolDef {
	base := f.base
	if base == nil {
		base = DefaultPermissionToolFilter{}
	}
	filtered := base.FilterTools(permissionType, all)
	out := make([]ToolDef, 0, len(filtered))
	for _, tool := range filtered {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		switch name {
		case "ask_user":
			if !f.allowUserInteraction {
				continue
			}
		}
		out = append(out, tool)
	}
	return out
}

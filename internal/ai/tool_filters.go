package ai

import (
	"strings"

	"github.com/floegence/redeven/internal/config"
)

func newModeToolFilter(cfg *config.AIConfig, allowUserInteraction bool) ModeToolFilter {
	_ = cfg
	return flowerModeToolFilter{
		base:                 DefaultModeToolFilter{},
		allowUserInteraction: allowUserInteraction,
	}
}

type allowlistModeToolFilter struct {
	base      ModeToolFilter
	allowlist map[string]struct{}
}

func (r *run) withToolAllowlistFilter(base ModeToolFilter) ModeToolFilter {
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
	return allowlistModeToolFilter{base: base, allowlist: allow}
}

func (f allowlistModeToolFilter) FilterToolsForMode(mode string, all []ToolDef) []ToolDef {
	base := f.base
	if base == nil {
		base = DefaultModeToolFilter{}
	}
	filtered := base.FilterToolsForMode(mode, all)
	if len(f.allowlist) == 0 {
		return filtered
	}
	out := make([]ToolDef, 0, len(filtered))
	for _, tool := range filtered {
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

type flowerModeToolFilter struct {
	base                 ModeToolFilter
	allowUserInteraction bool
}

func (f flowerModeToolFilter) FilterToolsForMode(mode string, all []ToolDef) []ToolDef {
	base := f.base
	if base == nil {
		base = DefaultModeToolFilter{}
	}
	filtered := base.FilterToolsForMode(mode, all)
	mode = strings.ToLower(strings.TrimSpace(mode))
	out := make([]ToolDef, 0, len(filtered))
	for _, tool := range filtered {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		switch name {
		case "exit_plan_mode":
			if !f.allowUserInteraction || mode != config.AIModePlan {
				continue
			}
		case "ask_user":
			if !f.allowUserInteraction {
				continue
			}
		}
		out = append(out, tool)
	}
	return out
}

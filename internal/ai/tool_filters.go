package ai

import "strings"

type allowlistModeToolFilter struct {
	base      ModeToolFilter
	allowlist map[string]struct{}
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

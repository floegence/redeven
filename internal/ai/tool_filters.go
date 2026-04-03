package ai

import (
	"strings"

	"github.com/floegence/redeven/internal/config"
)

func newModeToolFilter(cfg *config.AIConfig, profile RunProtocolProfile, allowUserInteraction bool) ModeToolFilter {
	_ = cfg
	return protocolModeToolFilter{
		base:                 DefaultModeToolFilter{},
		profile:              normalizeRunProtocolProfile(profile),
		allowUserInteraction: allowUserInteraction,
	}
}

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

type protocolModeToolFilter struct {
	base                 ModeToolFilter
	profile              RunProtocolProfile
	allowUserInteraction bool
}

func (f protocolModeToolFilter) FilterToolsForMode(mode string, all []ToolDef) []ToolDef {
	base := f.base
	if base == nil {
		base = DefaultModeToolFilter{}
	}
	filtered := base.FilterToolsForMode(mode, all)
	mode = strings.ToLower(strings.TrimSpace(mode))
	profile := normalizeRunProtocolProfile(f.profile)
	out := make([]ToolDef, 0, len(filtered))
	for _, tool := range filtered {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		switch name {
		case "file.read", "file.edit", "file.write":
			if profile.Surface != RunProtocolSurfaceStructuredFileOps {
				continue
			}
		case "exit_plan_mode":
			if profile.Surface != RunProtocolSurfaceStructuredFileOps || profile.WaitingMode != RunWaitingModeExitPlanMode || !f.allowUserInteraction || mode != config.AIModePlan {
				continue
			}
		case "apply_patch":
			if !profile.AllowPatchTool {
				continue
			}
		case "task_complete":
			if !profile.AllowSignalTools {
				continue
			}
		case "ask_user":
			if !profile.AllowSignalTools || !f.allowUserInteraction {
				continue
			}
		}
		out = append(out, tool)
	}
	return out
}

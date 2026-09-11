package ai

import (
	"strings"
)

func visibilityForToolName(toolName string) ToolVisibilityClass {
	switch strings.TrimSpace(toolName) {
	case "computer.screenshot":
		return ToolVisibilitySharedReadonly
	case "read_file", "read_files", "rgrep", "find", "file.read":
		return ToolVisibilityReadonlyExclusive
	case "web_fetch", "web.search", "okf.index", "okf.search", "okf.open", "attachment.read":
		return ToolVisibilitySharedReadonly
	case "write_todos":
		return ToolVisibilityInteraction
	case "ask_user":
		return ToolVisibilityControl
	case "subagents":
		return ToolVisibilityDelegationControl
	default:
		return ToolVisibilityStandard
	}
}

func capabilitiesForToolName(toolName string) []ToolCapabilityClass {
	switch strings.TrimSpace(toolName) {
	case "computer.screenshot":
		return []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
	case "computer.click", "computer.double_click", "computer.type", "computer.key", "computer.scroll", "browser.navigate", "browser.back", "browser.reload":
		return []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}
	case "computer.wait":
		return []ToolCapabilityClass{ToolCapabilityInteraction}
	case "terminal.exec":
		return []ToolCapabilityClass{ToolCapabilityShell, ToolCapabilityOpenWorld}
	case "file.edit", "file.write", "apply_patch":
		return []ToolCapabilityClass{ToolCapabilityMutation}
	case "read_file", "read_files", "rgrep", "find", "file.read", "okf.index", "okf.search", "okf.open", "attachment.read":
		return []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
	case "web_fetch", "web.search":
		return []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld}
	case "write_todos", "ask_user":
		return []ToolCapabilityClass{ToolCapabilityInteraction}
	case "subagents":
		return []ToolCapabilityClass{ToolCapabilityDelegation}
	case "use_skill":
		return []ToolCapabilityClass{ToolCapabilityOpenWorld}
	default:
		return nil
	}
}

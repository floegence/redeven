package ai

import (
	"strings"
)

func visibilityForToolName(toolName string) ToolVisibilityClass {
	switch strings.TrimSpace(toolName) {
	case "computer_capture_screenshot":
		return ToolVisibilitySharedReadonly
	case "file_search":
		return ToolVisibilityReadonlyExclusive
	case "file_read", "file_read_many", "path_find", "web_fetch", "web_search_pages", "okf_get_index", "okf_search", "okf_open", "attachment_read", "image_read":
		return ToolVisibilitySharedReadonly
	case "todo_write":
		return ToolVisibilityInteraction
	case "user_ask":
		return ToolVisibilityControl
	case "subagent_manage":
		return ToolVisibilityDelegationControl
	default:
		return ToolVisibilityStandard
	}
}

func capabilitiesForToolName(toolName string) []ToolCapabilityClass {
	switch strings.TrimSpace(toolName) {
	case "computer_capture_screenshot":
		return []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
	case "computer_click", "computer_double_click", "computer_type_text", "computer_press_key", "computer_scroll", "browser_navigate", "browser_go_back", "browser_reload":
		return []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}
	case "computer_wait":
		return []ToolCapabilityClass{ToolCapabilityInteraction}
	case "terminal_exec":
		return []ToolCapabilityClass{ToolCapabilityShell, ToolCapabilityOpenWorld}
	case "file_write", "file_apply_patch", "attachment_materialize":
		return []ToolCapabilityClass{ToolCapabilityMutation}
	case "file_read", "file_read_many", "file_search", "path_find", "okf_get_index", "okf_search", "okf_open", "attachment_read", "image_read":
		return []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
	case "web_fetch", "web_search_pages":
		return []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld}
	case "todo_write", "user_ask":
		return []ToolCapabilityClass{ToolCapabilityInteraction}
	case "subagent_manage":
		return []ToolCapabilityClass{ToolCapabilityDelegation}
	case "skill_use":
		return []ToolCapabilityClass{ToolCapabilityOpenWorld}
	default:
		return nil
	}
}

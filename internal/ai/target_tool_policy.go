package ai

import (
	"context"
	"encoding/json"
	"strings"
)

const (
	ToolTargetModeLocalRuntime   = "local_runtime"
	ToolTargetModeExplicitTarget = "explicit_target"
)

type ToolTargetPolicy struct {
	Mode            string `json:"mode"`
	DefaultTargetID string `json:"default_target_id,omitempty"`
}

func normalizeToolTargetPolicy(in ToolTargetPolicy) ToolTargetPolicy {
	mode := strings.TrimSpace(strings.ToLower(in.Mode))
	switch mode {
	case "", ToolTargetModeLocalRuntime:
		mode = ToolTargetModeLocalRuntime
	case ToolTargetModeExplicitTarget:
	default:
		mode = ToolTargetModeExplicitTarget
	}
	return ToolTargetPolicy{
		Mode:            mode,
		DefaultTargetID: strings.TrimSpace(in.DefaultTargetID),
	}
}

func (p ToolTargetPolicy) requiresExplicitTarget() bool {
	return normalizeToolTargetPolicy(p).Mode == ToolTargetModeExplicitTarget
}

type TargetToolExecutor interface {
	ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error)
}

type TargetToolCall struct {
	ToolCallID           string          `json:"tool_call_id"`
	TargetID             string          `json:"target_id"`
	ToolName             string          `json:"tool_name"`
	Arguments            json.RawMessage `json:"arguments"`
	RequiredCapabilities []string        `json:"required_capabilities"`
}

type TargetToolResult struct {
	TargetID string `json:"target_id"`
	Result   any    `json:"result,omitempty"`
}

func toolRequiresTarget(toolName string) bool {
	toolName = strings.TrimSpace(toolName)
	switch toolName {
	case "file.read", "file.edit", "file.write", "apply_patch", "terminal.exec":
		return true
	}
	return false
}

func requiredTargetCapabilities(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "file.read":
		return []string{"read"}
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}
	case "terminal.exec":
		return []string{"execute"}
	default:
		return nil
	}
}

func StripTargetToolArgs(args map[string]any) map[string]any {
	out := make(map[string]any, len(args))
	for key, value := range args {
		switch strings.TrimSpace(key) {
		case "target_id", "targetId":
			continue
		default:
			out[key] = value
		}
	}
	return out
}

func targetIDFromToolArgs(args map[string]any, defaultTargetID string) string {
	for _, key := range []string{"target_id", "targetId"} {
		if raw, ok := args[key]; ok {
			if value := strings.TrimSpace(anyToString(raw)); value != "" {
				return value
			}
		}
	}
	return strings.TrimSpace(defaultTargetID)
}

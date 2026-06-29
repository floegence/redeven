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
	Mode             string   `json:"mode"`
	DefaultTargetID  string   `json:"default_target_id,omitempty"`
	AllowedTargetIDs []string `json:"allowed_target_ids,omitempty"`
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
	defaultTargetID := strings.TrimSpace(in.DefaultTargetID)
	allowedTargetIDs := normalizedTargetIDs(in.AllowedTargetIDs)
	if defaultTargetID != "" && len(allowedTargetIDs) == 0 {
		allowedTargetIDs = []string{defaultTargetID}
	}
	return ToolTargetPolicy{
		Mode:             mode,
		DefaultTargetID:  defaultTargetID,
		AllowedTargetIDs: allowedTargetIDs,
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
	TargetID          string `json:"target_id"`
	ExecutionLocation string `json:"execution_location,omitempty"`
	Result            any    `json:"result,omitempty"`
}

func toolRequiresTarget(toolName string) bool {
	toolName = strings.TrimSpace(toolName)
	switch toolName {
	case "file.read", "file.edit", "file.write", "apply_patch":
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

func targetIDFromToolArgs(args map[string]any) string {
	for _, key := range []string{"target_id", "targetId"} {
		if raw, ok := args[key]; ok {
			if value := strings.TrimSpace(anyToString(raw)); value != "" {
				return value
			}
		}
	}
	return ""
}

func targetAllowedByPolicy(policy ToolTargetPolicy, targetID string) bool {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return false
	}
	normalized := normalizeToolTargetPolicy(policy)
	if len(normalized.AllowedTargetIDs) == 0 {
		return true
	}
	for _, allowed := range normalized.AllowedTargetIDs {
		if strings.TrimSpace(allowed) == targetID {
			return true
		}
	}
	return false
}

func normalizedTargetIDs(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		seen := false
		for _, existing := range out {
			if existing == value {
				seen = true
				break
			}
		}
		if !seen {
			out = append(out, value)
		}
	}
	return out
}

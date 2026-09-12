package ai

import (
	"encoding/json"
	"strings"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func isComputerUseToolName(name string) bool {
	name = strings.TrimSpace(name)
	return strings.HasPrefix(name, "computer.") || strings.HasPrefix(name, "browser.")
}

func builtInComputerToolDefinitions() []ToolDef {
	target := map[string]any{"target": map[string]any{"type": "string", "minLength": 1, "description": "Logical target alias. Omit to use the current target."}}
	schema := func(properties map[string]any, required []string) json.RawMessage {
		return toolSchemaRaw(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false})
	}
	withTarget := func(properties map[string]any, required ...string) (json.RawMessage, []string) {
		out := map[string]any{}
		for k, v := range target {
			out[k] = v
		}
		for k, v := range properties {
			out[k] = v
		}
		return schema(out, required), required
	}
	defs := []ToolDef{}
	add := func(name, description string, properties map[string]any, required []string, mutating bool, capabilities []ToolCapabilityClass) {
		input, _ := withTarget(properties, required...)
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: input, Mutating: mutating, RequiresApproval: mutating, Visibility: ToolVisibilityStandard, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec(name)})
	}
	add("computer.screenshot", "Capture the current target viewport and return a screenshot for visual inspection.", map[string]any{}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.click", "Click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.double_click", "Double click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.type", "Type text into the focused target element.", map[string]any{"text": map[string]any{"type": "string", "maxLength": 20000}}, []string{"text"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.key", "Press a keyboard key or key chord on the selected target.", map[string]any{"key": map[string]any{"type": "string", "minLength": 1, "maxLength": 80}}, []string{"key"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.scroll", "Scroll the selected target by CSS viewport deltas.", map[string]any{"delta_x": map[string]any{"type": "number"}, "delta_y": map[string]any{"type": "number"}}, []string{"delta_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.wait", "Wait for the target UI to settle and return a fresh screenshot.", map[string]any{"milliseconds": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000}}, []string{}, false, []ToolCapabilityClass{ToolCapabilityInteraction})
	add("browser.navigate", "Navigate the selected browser target to a URL.", map[string]any{"url": map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}}, []string{"url"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.back", "Navigate the selected browser target one history entry back.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.reload", "Reload the selected browser target.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	return defs
}

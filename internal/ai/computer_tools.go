package ai

import (
	"encoding/json"
	"regexp"
	"strings"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

var computerFrameResourcePattern = regexp.MustCompile(`^computer://[A-Za-z0-9_-]+/[a-f0-9]{64}$`)

func isComputerUseToolName(name string) bool {
	name = strings.TrimSpace(name)
	return strings.HasPrefix(name, "computer.") || strings.HasPrefix(name, "browser.")
}

func builtInComputerToolDefinitions() []ToolDef {
	target := map[string]any{"target": map[string]any{"type": "string", "minLength": 1, "description": "Omit target or use current for the current page or application window. Discover available pages and windows with computer.targets and choose one with computer.select_target. Browser actions require a browser page, not a native browser application window. Never invent target identities."}}
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
	defs := []ToolDef{
		{Name: "computer.targets", Description: "Discover browser profiles, tabs and application windows on this environment. No selection is required. The result includes current_target_id, default_candidate_ref and bounded candidates with opaque candidate_ref values, page titles, URLs, profile names and availability. Use the default candidate for an unspecified new web task; choose a matching existing page or application when requested. Multiple personal profiles without a clear match require one question in the conversation.", InputSchema: schema(map[string]any{"browser_source": map[string]any{"type": "string", "enum": []string{"auto", "system", "managed"}, "description": "Use system when the user requests their system or personal browser. This never substitutes a Flower managed browser or native application window. Unconnected system browsers require connection assistance. Omit or use auto only when the user has not specified a browser source."}}, []string{}), Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.targets")},
		{Name: "computer.select_target", Description: "Select a browser page or application window using a candidate_ref returned by computer.targets. A new-tab candidate creates a background task tab. Selection verifies the current identity and availability, preserves existing page contents, and never grants extra access. Then observe the selected target before acting. Selection is the agent's job; do not ask the user to bind targets in settings.", InputSchema: schema(map[string]any{"candidate_ref": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, []string{"candidate_ref"}), Mutating: true, RequiresApproval: true, Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.select_target")},
	}
	add := func(name, description string, properties map[string]any, required []string, mutating bool, capabilities []ToolCapabilityClass) {
		input, _ := withTarget(properties, required...)
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: input, Mutating: mutating, RequiresApproval: mutating, Visibility: ToolVisibilityStandard, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec(name)})
	}
	add("computer.observe", "Inspect the current page or application accessibility tree. Prefer a focused subtree; images are returned only when screenshot is true. Node references expire after navigation, removal or user takeover.", map[string]any{"root_ref": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000}, "screenshot": map[string]any{"type": "boolean"}}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.exec", "Run a short JavaScript program in an isolated persistent namespace for this Turn and target. Use await ui.observe(), ui.getByRole(role,{name}).read/click/fill/press/scroll/waitFor(), ui.ref(ref), ui.screenshot(), ui.assert(), browser.navigate/back/reload/waitForDownload(), and log(). ui.observe({emit:false}) reads locally; normal observation output uses compact diffs, with {full:true} for a complete snapshot. Downloads return a filename and completion state; managed downloads also return their saved path. Save reusable variables on globalThis. All UI operations must be awaited in sequence. Maximum 50 operations, 30 seconds and 64 MiB. No Node, filesystem, network or raw CDP access. Observe and verify results; never replay a partially completed script.", map[string]any{"code": map[string]any{"type": "string", "minLength": 1, "maxLength": 65536}, "description": map[string]any{"type": "string", "minLength": 1, "maxLength": 500, "description": "A concise natural-language explanation of why this script runs and what it will do, shown to the user while it executes."}}, []string{"code", "description"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation, ToolCapabilityOpenWorld})
	add("computer.screenshot", "Capture the current target viewport and return a screenshot for visual inspection.", map[string]any{}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.click", "Click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.double_click", "Double click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.type", "Type text into the focused target element.", map[string]any{"text": map[string]any{"type": "string", "maxLength": 20000}}, []string{"text"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.key", "Press a keyboard key or key chord on the selected target.", map[string]any{"key": map[string]any{"type": "string", "minLength": 1, "maxLength": 80}}, []string{"key"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.drag", "Drag across the selected target from one CSS viewport point to another.", map[string]any{"from_x": map[string]any{"type": "number"}, "from_y": map[string]any{"type": "number"}, "to_x": map[string]any{"type": "number"}, "to_y": map[string]any{"type": "number"}, "duration_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 5000}}, []string{"from_x", "from_y", "to_x", "to_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.scroll", "Scroll by viewport-pixel deltas (positive down/right). Supply x and y from a fresh observation to scroll a specific region; otherwise use the target default position. Prefer ui.ref(ref).scroll(delta_y, delta_x) for a semantic control.", map[string]any{"x": map[string]any{"type": "number", "minimum": 0}, "y": map[string]any{"type": "number", "minimum": 0}, "delta_x": map[string]any{"type": "number"}, "delta_y": map[string]any{"type": "number"}}, []string{"delta_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.wait", "Wait for the target UI to settle and return a fresh screenshot.", map[string]any{"milliseconds": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000}}, []string{}, false, []ToolCapabilityClass{ToolCapabilityInteraction})
	add("browser.navigate", "Navigate the selected browser target to a URL.", map[string]any{"url": map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}}, []string{"url"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.back", "Navigate the selected browser target one history entry back.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.reload", "Reload the selected browser target.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	return defs
}

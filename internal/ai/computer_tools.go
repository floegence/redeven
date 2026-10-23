package ai

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

var computerFrameResourcePattern = regexp.MustCompile(`^computer://[A-Za-z0-9_-]+/[a-f0-9]{64}$`)

func isComputerUseToolName(name string) bool {
	name = strings.TrimSpace(name)
	return strings.HasPrefix(name, "computer.") || strings.HasPrefix(name, "browser.")
}

func builtInComputerToolDefinitions() []ToolDef {
	target := map[string]any{"target": map[string]any{"type": "string", "minLength": 1, "description": "Target ID; omit or use current for the selected page/window."}}
	schema := func(properties map[string]any, required []string) json.RawMessage {
		properties["description"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 500, "description": "User-facing action and target; omit secrets."}
		if !slices.Contains(required, "description") {
			required = append(append([]string{}, required...), "description")
		}
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
		{Name: "computer.targets", Description: "Discover browser profiles, tabs and application windows. candidates lists only discovered resources; current_target_id is this conversation's saved binding, which may be absent from candidates. Returns candidate_ref values and default_candidate_ref for unspecified web tasks.", InputSchema: schema(map[string]any{"browser_source": map[string]any{"type": "string", "enum": []string{"auto", "system", "managed"}, "description": "system selects the personal browser; managed selects Flower. Default auto is for unspecified sources."}}, []string{}), Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.targets")},
		{Name: "computer.select_target", Description: "Select a computer.targets candidate_ref. New-tab candidates create background tabs.", InputSchema: schema(map[string]any{"candidate_ref": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, []string{"candidate_ref"}), Mutating: true, RequiresApproval: true, Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.select_target")},
	}
	add := func(name, description string, properties map[string]any, required []string, mutating bool, capabilities []ToolCapabilityClass) {
		input, _ := withTarget(properties, required...)
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: input, Mutating: mutating, RequiresApproval: mutating, Visibility: ToolVisibilityStandard, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec(name)})
	}
	add("computer.observe", "Read the semantic accessibility tree; root_ref selects a subtree. screenshot adds an image. Node refs expire after navigation, removal or user takeover.", map[string]any{"root_ref": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000}, "screenshot": map[string]any{"type": "boolean"}}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.exec", "Run JavaScript in a persistent namespace scoped to this Turn and target; save variables on globalThis. APIs: await ui.observe(), ui.getByRole(role,{name?,exact?,root_ref?}).read/click/fill/press/scroll/waitFor(), ui.ref(ref), ui.screenshot(), ui.assert(), browser.navigate/back/reload/waitForDownload(), log(). Await UI operations sequentially. ui.observe({emit:false}) returns {observation:{nodes:[...]}} without emitting. Script observations are full; full:true forces a full emitted snapshot instead of diffs. Name matching is case-insensitive contains unless exact:true; role-only selectors require uniqueness in a complete tree. Check waitFor().state for timeout. Managed downloads include the saved path. Limits: 50 operations, 30 seconds, 64 MiB; no Node, filesystem, network or raw CDP.", map[string]any{"code": map[string]any{"type": "string", "minLength": 1, "maxLength": 65536}}, []string{"code", "description"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation, ToolCapabilityOpenWorld})
	add("computer.screenshot", "Capture the selected target viewport.", map[string]any{}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.click", "Click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.double_click", "Double click at CSS viewport coordinates on the selected target.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.type", "Type text into the focused target element.", map[string]any{"text": map[string]any{"type": "string", "maxLength": 20000}}, []string{"text"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.key", "Press a keyboard key or key chord on the selected target.", map[string]any{"key": map[string]any{"type": "string", "minLength": 1, "maxLength": 80}}, []string{"key"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.drag", "Drag across the selected target from one CSS viewport point to another.", map[string]any{"from_x": map[string]any{"type": "number"}, "from_y": map[string]any{"type": "number"}, "to_x": map[string]any{"type": "number"}, "to_y": map[string]any{"type": "number"}, "duration_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 5000}}, []string{"from_x", "from_y", "to_x", "to_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.scroll", "Scroll by viewport pixels (positive down/right). Optional x/y selects a region; otherwise uses the default position.", map[string]any{"x": map[string]any{"type": "number", "minimum": 0}, "y": map[string]any{"type": "number", "minimum": 0}, "delta_x": map[string]any{"type": "number"}, "delta_y": map[string]any{"type": "number"}}, []string{"delta_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.wait", "Wait for the target UI to settle and return a fresh screenshot.", map[string]any{"milliseconds": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000}}, []string{}, false, []ToolCapabilityClass{ToolCapabilityInteraction})
	add("browser.navigate", "Navigate to an absolute browser URL, including file://, data:, about: and extension/internal pages.", map[string]any{"url": map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}}, []string{"url"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.back", "Navigate the selected browser target one history entry back.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.reload", "Reload the selected browser target.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	return defs
}

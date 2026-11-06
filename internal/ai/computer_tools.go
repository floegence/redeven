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
	target := map[string]any{"target": map[string]any{"type": "string", "minLength": 1, "description": "Target ID returned by computer.select_target; omit to use this thread's saved binding. Selection survives later turns and script context_reset. A candidate_ref is not a target ID."}}
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
		{Name: "computer.targets", Description: "Discover browser profiles, tabs and application windows. candidates and current_target_id are observed resource facts; candidate_ref values are short-lived references for computer.select_target.", InputSchema: schema(map[string]any{"browser_source": map[string]any{"type": "string", "enum": []string{"auto", "system", "managed"}, "description": "Resource source to inspect."}}, []string{}), Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.targets")},
		{Name: "computer.select_target", Description: "Select a computer.targets candidate_ref. New-tab candidates create background tabs. Call this alone and wait for its result before computer.exec.", InputSchema: schema(map[string]any{"candidate_ref": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, []string{"candidate_ref"}), Mutating: true, RequiresApproval: true, Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.select_target")},
	}
	add := func(name, description string, properties map[string]any, required []string, mutating bool, capabilities []ToolCapabilityClass) {
		input, _ := withTarget(properties, required...)
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: input, Mutating: mutating, RequiresApproval: mutating, Visibility: ToolVisibilityStandard, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec(name)})
	}
	add("computer.observe", "Read the semantic accessibility tree; root_ref selects a subtree. screenshot adds an image. Node refs expire after navigation, removal or user takeover.", map[string]any{"root_ref": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000}, "screenshot": map[string]any{"type": "boolean"}}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.exec", computerScriptDocumentation, map[string]any{"code": map[string]any{"type": "string", "minLength": 1, "maxLength": 65536}}, []string{"code", "description"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation, ToolCapabilityOpenWorld})
	add("computer.screenshot", "Capture the selected target viewport.", map[string]any{}, nil, false, []ToolCapabilityClass{ToolCapabilityReadonlyLocal})
	add("computer.click", "Click using browser CSS viewport pixels or native target coordinates.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.double_click", "Double click using browser CSS viewport pixels or native target coordinates.", map[string]any{"x": map[string]any{"type": "number"}, "y": map[string]any{"type": "number"}}, []string{"x", "y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.type", "Type text into the focused target element.", map[string]any{"text": map[string]any{"type": "string", "maxLength": 20000}}, []string{"text"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.key", "Press a character or named key joined with Alt, Control, Meta or Shift. Examples: Enter, ArrowDown, Meta+=, Shift+Tab. Physical codes such as Equal are not key names.", map[string]any{"key": map[string]any{"type": "string", "minLength": 1, "maxLength": 80}}, []string{"key"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.drag", "Drag between browser CSS viewport points or native target coordinates.", map[string]any{"from_x": map[string]any{"type": "number"}, "from_y": map[string]any{"type": "number"}, "to_x": map[string]any{"type": "number"}, "to_y": map[string]any{"type": "number"}, "duration_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 5000}}, []string{"from_x", "from_y", "to_x", "to_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.scroll", "Scroll by viewport pixels (positive down/right). Optional x/y selects a region; otherwise uses the default position.", map[string]any{"x": map[string]any{"type": "number", "minimum": 0}, "y": map[string]any{"type": "number", "minimum": 0}, "delta_x": map[string]any{"type": "number"}, "delta_y": map[string]any{"type": "number"}}, []string{"delta_y"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation})
	add("computer.wait", "Delay for milliseconds (default 0, no extra delay), then return a fresh screenshot. This is not a UI-settled condition; use locator.waitFor for conditions.", map[string]any{"milliseconds": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000}}, []string{}, false, []ToolCapabilityClass{ToolCapabilityInteraction})
	navOptions := func() map[string]any {
		return map[string]any{
			"wait_until": map[string]any{"type": "string", "enum": []string{"commit", "domcontentloaded", "load"}, "description": "Lifecycle milestone, not application readiness; default load."},
			"timeout_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000, "description": "Lifecycle wait deadline in milliseconds; default 20000. Timeout is returned as data."},
		}
	}
	nav := navOptions()
	nav["url"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}
	add("browser.navigate", "Navigate to an absolute browser URL, including file://, data:, about: and extension/internal pages. Returns an acknowledged lifecycle receipt.", nav, []string{"url"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.back", "Navigate the selected browser target one history entry back. Lifecycle timeout returns data.", navOptions(), nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.reload", "Reload the selected browser target. Lifecycle timeout returns data.", navOptions(), nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	for i := range defs {
		if slices.Contains([]string{"computer.click", "computer.double_click", "computer.drag", "computer.scroll"}, defs[i].Name) {
			var schema map[string]any
			_ = json.Unmarshal(defs[i].InputSchema, &schema)
			properties := schema["properties"].(map[string]any)
			properties["coordinate_space"] = map[string]any{"type": "string", "enum": []string{"image_pixels", "model_pixels"}, "description": "Coordinates in the referenced screenshot; model_pixels uses the optimized image, image_pixels retains browser source pixels. Requires frame and document_id. Omit for existing target coordinates."}
			properties["frame"] = map[string]any{"type": "string", "pattern": computerFrameResourcePattern.String()}
			properties["document_id"] = map[string]any{"type": "string", "maxLength": 1024}
			defs[i].InputSchema = toolSchemaRaw(schema)
		}
	}
	for i := range defs {
		switch defs[i].Name {
		case "computer.targets":
			defs[i].Description += " Set application to an application name or bundle ID to discover installed native applications, including those not running; omit browser_source for this query."
			var input map[string]any
			_ = json.Unmarshal(defs[i].InputSchema, &input)
			input["properties"].(map[string]any)["application"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 120, "description": "Native application name or bundle ID."}
			defs[i].InputSchema = toolSchemaRaw(input)
		case "computer.select_target":
			defs[i].Description += " Application candidates open or restore the discovered application. Accessible windows are returned as candidates; opening an application does not select a window."
			defs[i].Description += " Selection consumes candidate_ref and returns a target_id; candidate_ref is not a target ID."
		case "computer.observe":
			defs[i].Description += " truncated or children_truncated means omitted content, not empty rows or virtualization. root_ref scopes the returned tree."
		}
	}
	return defs
}

const computerScriptDocumentation = `Execute asynchronous JavaScript against one explicitly selected target. code contains UI/browser operations; description labels the invocation. Selection returns basic signatures in tool_contract.documentation; ui.help(topic) provides detailed contracts. Limits: 50 operations, 30 seconds, 64 MiB heap, 64 KiB logs. SCRIPT_OPERATION_LIMIT stops before operation 51; completed effects remain and context_reset is true. No DOM, Node, filesystem, network or timers. globalThis lasts within a healthy thread/turn/target namespace; execution failures report context_reset without clearing the thread's selected target. Completed effects are not rolled back or automatically replayed. Results distinguish observations, confirmed execution, stop reasons and uncertain effects. Output exhaustion is reported as SCRIPT_OUTPUT_LIMIT with the confirmed prefix and completed reads retained.`

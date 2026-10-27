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
	target := map[string]any{"target": map[string]any{"type": "string", "minLength": 1, "description": "Selected target ID; omit or use current. First pass candidate_ref to computer.select_target."}}
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
	add("browser.navigate", "Navigate to an absolute browser URL, including file://, data:, about: and extension/internal pages.", map[string]any{"url": map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}}, []string{"url"}, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.back", "Navigate the selected browser target one history entry back.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	add("browser.reload", "Reload the selected browser target.", map[string]any{}, nil, true, []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityOpenWorld})
	for i := range defs {
		if slices.Contains([]string{"computer.click", "computer.double_click", "computer.drag", "computer.scroll"}, defs[i].Name) {
			var schema map[string]any
			_ = json.Unmarshal(defs[i].InputSchema, &schema)
			properties := schema["properties"].(map[string]any)
			properties["coordinate_space"] = map[string]any{"type": "string", "enum": []string{"image_pixels"}, "description": "Browser-only: coordinates in the referenced screenshot; requires frame and document_id. Omit for existing target coordinates."}
			properties["frame"] = map[string]any{"type": "string", "pattern": computerFrameResourcePattern.String()}
			properties["document_id"] = map[string]any{"type": "string", "maxLength": 1024}
			defs[i].InputSchema = toolSchemaRaw(schema)
		}
	}
	for i := range defs {
		switch defs[i].Name {
		case "computer.select_target":
			defs[i].Description += " For a new unspecified web task select default_candidate_ref; reuse an existing tab only when the user refers to it or it belongs to this task. Pass the returned target_id to subsequent tools, never candidate_ref. Preserve the requested account/workspace scope."
		case "computer.observe":
			defs[i].Description += " truncated or children_truncated means omitted content, not empty rows or virtualization. Read those subtrees with root_ref before claiming completeness."
		}
	}
	return defs
}

const computerScriptDocumentation = `Execute JavaScript against the selected target. Send one computer call per batch. Use ui.snapshot() to inspect, ui.ref(observedRef).click()/fill(text)/press(key) to act, and inspect the result. Use browser.navigate(url) for browser navigation. Await each operation; log(value) returns concise text. Variables on globalThis persist only within this turn and target; a failed script clears them.
First use: await ui.help('core') returns exact signatures. Other topics: read, visual, downloads. Read a topic when needed instead of guessing methods. Browser methods exist only on browser targets. Select a candidate first; target can be omitted afterward.
Execute only actions authorized by the user. Stop at a changed target or permission request. Earlier effects are not rolled back: inspect current state before continuing and never replay completed or uncertain input. Limits: 50 operations, 30 seconds, 64 MiB heap, 64 KiB logs. No DOM, Node, filesystem, network or raw CDP.`

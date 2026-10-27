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
		{Name: "computer.select_target", Description: "Select a computer.targets candidate_ref. New-tab candidates create background tabs.", InputSchema: schema(map[string]any{"candidate_ref": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, []string{"candidate_ref"}), Mutating: true, RequiresApproval: true, Visibility: ToolVisibilityStandard, Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction, ToolCapabilityMutation}, Source: "builtin", Namespace: "builtin.computer", Priority: 100, Presentation: aitools.MustPresentationSpec("computer.select_target")},
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

const computerScriptDocumentation = `Run JavaScript in a persistent Turn-and-target namespace; save variables on globalThis. Await UI operations sequentially. This is a bounded JSON API, not Playwright or browser JavaScript.
APIs (all UI/browser calls are async):
ui.observe({root_ref?:string,limit?:1..1000,emit?:boolean,full?:boolean,screenshot?:boolean}) returns {url,title,observation:{url,title,nodes,truncated}}. emit:false keeps the tree local; full:true forces a full emitted snapshot instead of a diff.
ui.getByRole(role:string,{name?:string,exact?:boolean,root_ref?:string}) or ui.ref(ref:string) returns a locator with read(), click(), fill(text:string), press(key:string), scroll(delta_y:number,delta_x:number=0), waitFor({state:'visible'|'hidden'|'enabled',timeout_ms:0..30000}). read() returns {node}; inspect a row's subtree using ui.observe({root_ref:node.ref}). Use the observed canonical_role (search inputs are searchbox, not textbox). Regex names and string scroll directions are unsupported. Name matching is case-insensitive contains unless exact:true; locators require uniqueness across the complete scope even when observation is truncated. Check waitFor().state for timeout.
ui.click(x:number,y:number,image?), ui.drag(from_x,from_y,to_x,to_y,duration_ms=0,image?), ui.key(key:string), ui.screenshot(), ui.assert(condition,message?), log(...values).
Browser scroll returns {scroll_progress:{before,after,changed,measurement:"immediate_after_dispatch"}} from the scroll() return value, not read().node. Log const r=await locator.scroll(80); log(r.scroll_progress). Measurements may be null or unchanged before animation settles; never infer failure or repeat automatically.
Browser-only locator.query({limit?:1..200,cursor?:string}) returns {items:[{ref,role,name}],total,truncated,next_cursor?,scope:'loaded_accessibility_tree'}. Count with total; narrow by role/name/root_ref. Continue next_cursor only while contents stay unchanged; virtualized unloaded rows are not included. locator.getAttribute(name) returns {attribute,value}; allowed href/title/aria-label/aria-checked/aria-selected/aria-expanded/aria-rowcount/aria-colcount. href strips credentials, query and fragment; it is not an exact action URL. Do not use it to reconstruct authenticated links.
Browser visual input: image={coordinate_space:"image_pixels",frame,document_id} from screenshot.frame_geometry. Never guess DPR. Old ui.click coordinates remain CSS viewport pixels. Image coordinates reject changed target/document/viewport; observe again. Native image mode is unsupported. Keys use characters or named keys joined with Alt/Control/Meta/Shift, e.g. Meta+=, Enter, ArrowDown; Equal is not a key name.
browser.navigate(url:string), browser.back(), browser.reload(). Downloads: const {cursor}=await browser.downloadCursor(); await ui.getByRole('link',{name:'Export',exact:true}).click(); const result=await browser.waitForDownload({after:cursor,timeout_ms:10000}); check result.download.state==='completed'. Use {id:string} for an already identified download. Multiple new downloads are ambiguous; inspect returned downloads and choose the exact ID. Never identify a download by latest file or filename alone. Managed downloads include the saved path.
There is no setTimeout, ui.waitFor, DOM, Node, filesystem, network or raw CDP. Use locator.waitFor for conditions. Limits: 50 operations, 30 seconds, 64 MiB, 64 KiB total logs. Keep observations local with emit:false and log only selected facts or compact computed summaries; logging a complete tree may exceed the limit. SCRIPT_REFERENCE_ERROR means unavailable name; SCRIPT_TYPE_ERROR means unsupported method/type; SCRIPT_ARGUMENT_ERROR means invalid documented arguments; SCRIPT_OUTPUT_LIMIT means too much logged output. completed_actions preserves effects before failure: observe first and never repeat completed or uncertain effects automatically. A failed script loses its namespace.
Verify current URL, title and account/workspace before data collection and final conclusions. Stay within the user's requested scope. truncated and children_truncated indicate omitted observation content: narrow with root_ref; do not infer empty rows or virtualization. Report incomplete coverage explicitly.`

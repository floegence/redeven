package ai

import "strings"

// Small binding-time contract: exact platform availability, no plugin registry.
func computerTargetContract(target TargetDescriptor) map[string]any {
	browser := strings.HasPrefix(target.Kind, "browser.")
	contract := map[string]any{"version": 1, "backend": target.Kind, "browser_methods": browser, "image_coordinates": browser, "scoped_query": browser, "attribute_read": browser, "fixed_wait_default_ms": 0, "condition_states": []string{"visible", "hidden", "enabled"}, "unknown_effect_replay": false}
	if browser {
		contract["coordinates"] = "CSS viewport by default; image_pixels requires frame and document_id from frame_geometry"
		contract["key_examples"] = []string{"Enter", "ArrowDown", "Meta+=", "Shift+Tab"}
		contract["key_grammar"] = "character or named key; Alt/Control/Meta/Shift chords; Equal is not a key name"
		contract["scroll"] = "CSS wheel pixels; positive down/right; optional point or locator container; scroll_progress is the scroll return value"
		contract["mouse"] = "left click/double click; no force, modifiers or alternate buttons"
		contract["frames"] = "authorized accessible frames; expired documents reject refs; occluded parent frames reject input"
		contract["downloads"] = "downloadCursor then waitForDownload(after), or exact id; ambiguous new downloads reject"
		contract["read_scope"] = "authorized loaded accessibility tree; virtualized rows require explicit traversal"
	} else {
		contract["coordinates"] = "selected native target coordinates; image_pixels/query/getAttribute are unavailable"
	}
	return contract
}

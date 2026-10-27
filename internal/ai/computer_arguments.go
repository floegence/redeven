package ai

import "slices"

// Closed product-authored diagnostics. Never retain raw page errors or arguments.
func computerArgumentDiagnostic(value any) map[string]any {
	raw, _ := value.(map[string]any)
	if raw["phase"] != "validation" || raw["recovery"] != "correct_arguments" {
		return nil
	}
	field := anyToString(raw["field"])
	expected := anyToString(raw["expected"])
	if !slices.Contains([]string{"arguments", "selector", "key", "text", "coordinates", "x", "y", "from_x", "from_y", "to_x", "to_y", "delta_x", "delta_y", "duration_ms", "milliseconds", "timeout_ms", "state", "action", "coordinate_space", "attribute", "limit", "cursor"}, field) {
		return nil
	}
	if !slices.Contains([]string{"documented_fields", "documented_selector", "key_chord", "finite_number", "nonnegative_coordinates", "text_max_20000", "integer_0_5000", "integer_0_30000", "visible_hidden_enabled", "supported_action", "image_pixels_with_frame", "inside_image", "readable_attribute", "integer_1_200", "current_cursor"}, expected) {
		return nil
	}
	out := map[string]any{"phase": "validation", "field": field, "expected": expected, "recovery": "correct_arguments"}
	if expected == "key_chord" {
		out["example"] = "Meta+= or Enter"
	}
	return out
}

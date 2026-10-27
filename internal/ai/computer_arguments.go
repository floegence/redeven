package ai

import (
	"regexp"
	"slices"
	"strings"
)

var computerScriptSymbol = regexp.MustCompile("^[A-Za-z_$][A-Za-z0-9_$]{0,79}$")

// Only bounded locations and identifiers present in submitted code may cross
// the guest boundary. Never include its arbitrary exception message or stack.
func computerScriptDiagnostic(value any, code string) map[string]any {
	raw, _ := value.(map[string]any)
	phase := anyToString(raw["phase"])
	if !slices.Contains([]string{"parse", "execution", "host_operation"}, phase) {
		return nil
	}
	out := map[string]any{"phase": phase}
	if line, ok := raw["line"].(float64); ok && line >= 1 && line <= float64(strings.Count(code, "\n")+1) && line == float64(int(line)) {
		out["line"] = int(line)
		if column, ok := raw["column"].(float64); ok && column >= 1 && column <= 65536 && column == float64(int(column)) {
			out["column"] = int(column)
		}
	}
	if symbol := anyToString(raw["symbol"]); computerScriptSymbol.MatchString(symbol) && strings.Contains(code, symbol) {
		out["symbol"] = symbol
	}
	return out
}

// Closed product-authored diagnostics. Never retain raw page errors or arguments.
func computerArgumentDiagnostic(value any) map[string]any {
	raw, _ := value.(map[string]any)
	if raw["phase"] != "validation" || raw["recovery"] != "correct_arguments" {
		return nil
	}
	field := anyToString(raw["field"])
	expected := anyToString(raw["expected"])
	if !slices.Contains([]string{"arguments", "selector", "key", "text", "coordinates", "x", "y", "from_x", "from_y", "to_x", "to_y", "delta_x", "delta_y", "duration_ms", "milliseconds", "timeout_ms", "state", "equals", "action", "coordinate_space", "attribute", "limit", "cursor"}, field) {
		return nil
	}
	if !slices.Contains([]string{"documented_fields", "documented_selector", "canonical_role_or_observed_ref", "key_chord", "finite_number", "nonnegative_coordinates", "text_max_20000", "integer_0_5000", "integer_0_30000", "visible_hidden_enabled", "documented_condition", "condition_text_max_2000", "supported_action", "image_pixels_with_frame", "inside_image", "readable_attribute", "integer_1_200", "current_cursor"}, expected) {
		return nil
	}
	out := map[string]any{"phase": "validation", "field": field, "expected": expected, "recovery": "correct_arguments"}
	if expected == "key_chord" {
		out["example"] = "Meta+= or Enter"
	}
	if expected == "canonical_role_or_observed_ref" {
		out["example"] = "Use a documented canonical role; other is ref-only: ui.ref(observedRef)"
	}
	return out
}

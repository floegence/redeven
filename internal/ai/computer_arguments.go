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
	if raw["code"] == "CONDITION_TIMEOUT" && raw["method"] == "locator.requireState" {
		state := anyToString(raw["state"])
		timeout, timeoutOK := raw["timeout_ms"].(float64)
		index, indexOK := raw["operation_index"].(float64)
		if slices.Contains([]string{"visible", "hidden", "enabled", "text", "value"}, state) && timeoutOK && timeout >= 0 && timeout <= 30000 && timeout == float64(int(timeout)) && indexOK && index >= 0 && index < 50 && index == float64(int(index)) {
			out["method"], out["state"], out["timeout_ms"], out["operation_index"] = "locator.requireState", state, int(timeout), int(index)
		}
	}
	validation := cloneAnyMap(raw)
	validation["phase"] = "validation"
	if details := computerArgumentDiagnostic(validation); details != nil {
		for key, value := range details {
			if key != "phase" {
				out[key] = value
			}
		}
	}
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
	if raw["phase"] != "validation" && raw["phase"] != "execution" || raw["recovery"] != "correct_arguments" {
		return nil
	}
	field := anyToString(raw["field"])
	expected := anyToString(raw["expected"])
	if !slices.Contains([]string{"arguments", "selector", "key", "text", "coordinates", "x", "y", "from_x", "from_y", "to_x", "to_y", "delta_x", "delta_y", "duration_ms", "milliseconds", "timeout_ms", "state", "equals", "action", "coordinate_space", "attribute", "limit", "cursor", "root_ref", "topic", "url", "id", "after", "emit", "full", "screenshot"}, field) {
		return nil
	}
	if !slices.Contains([]string{"documented_fields", "documented_arity", "documented_selector", "canonical_role_or_observed_ref", "key_chord", "finite_number", "nonnegative_coordinates", "text_max_20000", "integer_0_5000", "integer_0_30000", "visible_hidden_enabled", "documented_condition", "condition_text_max_2000", "supported_action", "image_pixels_with_frame", "inside_image", "readable_attribute", "integer_1_200", "current_cursor", "integer_1_1000", "string", "boolean"}, expected) {
		return nil
	}
	out := map[string]any{"phase": raw["phase"], "field": field, "expected": expected, "recovery": "correct_arguments"}
	if method := anyToString(raw["method"]); slices.Contains([]string{"ui.snapshot", "ui.observe", "ui.screenshot", "ui.help", "ui.type", "ui.doubleClick", "ui.scroll", "ui.scrollAt", "ui.getByRole", "ui.ref", "ui.click", "ui.drag", "ui.key", "locator.node", "locator.snapshot", "locator.read", "locator.query", "locator.count", "locator.rows", "locator.attribute", "locator.linkSummary", "locator.getAttribute", "locator.click", "locator.fill", "locator.press", "locator.scroll", "locator.waitFor", "locator.requireState", "browser.navigate", "browser.waitForDownload", "ui.budget", "ui.assert", "locator.text", "browser.back", "browser.reload", "browser.saveDownload", "browser.readDownload", "browser.downloadCursor", "image.click", "image.doubleClick", "image.drag", "image.scroll", "downloadCursor.wait"}, method) {
		out["method"] = method
	}
	if expected == "integer_1_1000" {
		out["example"] = "await ui.snapshot({limit:200})"
	}
	if expected == "integer_0_30000" {
		out["example"] = "{timeout_ms:5000}"
	}
	if expected == "key_chord" {
		out["example"] = "Meta+= or Enter"
	}
	if expected == "canonical_role_or_observed_ref" {
		out["example"] = "Use a documented canonical role; other is ref-only: ui.ref(observedRef)"
	}
	return out
}

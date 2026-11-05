package ai

import (
	"math"
	"regexp"
	"slices"
	"strings"
)

var computerProtocolMethod = regexp.MustCompile("^(Page|Runtime|DOM|DOMSnapshot|CSS|Network|Fetch|Input|Emulation|Accessibility|IO|Target)[.][A-Za-z]{1,64}$")

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
	if details := computerOperationDiagnostic(validation); details != nil {
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
func computerOperationDiagnostic(value any) (out map[string]any) {
	raw, _ := value.(map[string]any)
	defer func() {
		if out != nil && slices.Contains([]string{"point_coordinates", "point_node", "target_ancestry", "embedding_frames", "scroll_intersection"}, anyToString(raw["checkpoint"])) {
			out["checkpoint"] = raw["checkpoint"]
		}
	}()
	if raw["phase"] == "permission" && raw["method"] == "ui.key" && raw["reason"] == "clipboard_shortcut_requires_explicit_operation" {
		return map[string]any{"phase": "permission", "method": "ui.key", "reason": raw["reason"]}
	}
	if raw["phase"] == "adapter" {
		method, reason := anyToString(raw["method"]), anyToString(raw["reason"])
		if !computerProtocolMethod.MatchString(method) && !slices.Contains([]string{"frame_inventory", "safety_scan", "semantic_read", "capture", "metadata", "hit_test"}, method) || !slices.Contains([]string{"invalid_result", "internal_error"}, reason) {
			return nil
		}
		return map[string]any{"phase": "adapter", "method": method, "reason": reason}
	}
	if raw["phase"] == "evaluation" {
		method, reason := anyToString(raw["method"]), anyToString(raw["reason"])
		if !slices.Contains([]string{"Runtime.evaluate", "Runtime.callFunctionOn"}, method) || !slices.Contains([]string{"exception", "invalid_result"}, reason) {
			return nil
		}
		return map[string]any{"phase": "evaluation", "method": method, "reason": reason}
	}
	if raw["phase"] == "protocol" {
		method := anyToString(raw["method"])
		if !computerProtocolMethod.MatchString(method) {
			return nil
		}
		out := map[string]any{"phase": "protocol", "method": method}
		if value, supplied := raw["code"]; supplied {
			code, ok := value.(float64)
			if !ok || math.IsNaN(code) || math.IsInf(code, 0) || code < math.MinInt32 || code > math.MaxInt32 || math.Trunc(code) != code {
				return nil
			}
			out["code"] = code
		}
		return out
	}
	if raw["phase"] == "read" {
		method, expected := anyToString(raw["method"]), anyToString(raw["expected"])
		if method == "locator.attribute" && expected == "attribute_max_2000" || method == "locator.text" && expected == "html_element" {
			return map[string]any{"phase": "read", "method": method, "expected": expected}
		}
		return nil
	}
	if raw["phase"] != "validation" && raw["phase"] != "execution" {
		return nil
	}
	field := anyToString(raw["field"])
	expected := anyToString(raw["expected"])
	if !slices.Contains([]string{"method", "arguments", "selector", "name", "key", "text", "coordinates", "x", "y", "from_x", "from_y", "to_x", "to_y", "delta_x", "delta_y", "duration_ms", "milliseconds", "timeout_ms", "state", "equals", "action", "coordinate_space", "attribute", "limit", "cursor", "root_ref", "topic", "url", "id", "after", "emit", "full", "screenshot", "wait_until", "on_invalidated"}, field) {
		return nil
	}
	if !slices.Contains([]string{"documented_fields", "documented_arity", "documented_selector", "canonical_role_or_observed_ref", "key_chord", "finite_number", "nonnegative_coordinates", "text_max_20000", "integer_0_5000", "integer_0_30000", "visible_hidden_enabled", "documented_condition", "condition_text_max_2000", "supported_action", "image_pixels_with_frame", "inside_image", "readable_attribute", "attribute_name", "integer_1_200", "current_cursor", "integer_1_1000", "string", "boolean", "navigation_lifecycle", "throw_or_return", "precise_attribute_read"}, expected) {
		return nil
	}
	out = map[string]any{"phase": raw["phase"], "field": field, "expected": expected}
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
		out["example"] = "ui.ref(observedRef)"
	}
	return out
}

// Only closed layout and interaction facts; never page text or alternate targets.
func computerActionabilityFacts(value any) map[string]any {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	stage := anyToString(raw["stage"])
	if !slices.Contains([]string{"precondition", "hit_or_layout", "hit_test"}, stage) {
		return nil
	}
	out := map[string]any{"stage": stage}
	for _, key := range []string{"connected", "visible", "rendered", "enabled", "readonly", "editable", "opacity_zero", "receives", "layout_stable", "quads_truncated"} {
		if v, ok := raw[key].(bool); ok {
			out[key] = v
		}
	}
	if checks := toAnySlice(raw["failed_checks"]); len(checks) > 0 && len(checks) <= 8 {
		filtered := []any{}
		for _, check := range checks {
			if text, ok := check.(string); ok && slices.Contains([]string{"connected", "rendered", "visible", "enabled", "editable", "receives", "layout_stable"}, text) {
				filtered = append(filtered, text)
			}
		}
		out["failed_checks"] = filtered
	}
	if n, ok := raw["sample_interval_ms"].(float64); ok && n >= 0 && n <= 60000 {
		out["sample_interval_ms"] = n
	}
	for _, key := range []string{"previous_quads", "current_quads"} {
		quads := toAnySlice(raw[key])
		if len(quads) > 8 {
			continue
		}
		valid := quads != nil
		for _, value := range quads {
			quad := toAnySlice(value)
			if len(quad) != 8 {
				valid = false
				break
			}
			for _, value := range quad {
				n, ok := value.(float64)
				if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
					valid = false
				}
			}
		}
		if valid {
			out[key] = quads
		}
	}
	if n := readInt64Field(raw, "node_type"); n >= 1 && n <= 12 {
		out["node_type"] = n
	}
	if bounds := toAnySlice(raw["bounds"]); len(bounds) == 4 {
		valid := true
		for _, v := range bounds {
			n, ok := v.(float64)
			valid = valid && ok && !math.IsNaN(n) && !math.IsInf(n, 0)
		}
		if valid {
			out["bounds"] = bounds
		}
	}
	if point, ok := raw["tested_point"].(map[string]any); ok {
		x, xOK := point["x"].(float64)
		y, yOK := point["y"].(float64)
		if xOK && yOK && !math.IsNaN(x) && !math.IsNaN(y) && !math.IsInf(x, 0) && !math.IsInf(y, 0) {
			out["tested_point"] = map[string]any{"x": x, "y": y}
		}
	}
	if raw["coordinate_space"] == "session_css_pixels" {
		out["coordinate_space"] = raw["coordinate_space"]
	}
	if preparation, ok := raw["preparation"].(map[string]any); ok {
		facts := map[string]any{}
		if value, ok := preparation["scroll_into_view"].(bool); ok {
			facts["scroll_into_view"] = value
		}
		for _, key := range []string{"stability_timeout_ms", "elapsed_ms"} {
			if n, ok := preparation[key].(float64); ok && n >= 0 && n <= 60000 {
				facts[key] = n
			}
		}
		out["preparation"] = facts
	}
	if viewport, ok := raw["viewport"].(map[string]any); ok {
		facts := map[string]any{}
		for _, key := range []string{"pageX", "pageY", "clientWidth", "clientHeight"} {
			if n, ok := viewport[key].(float64); ok && !math.IsNaN(n) && !math.IsInf(n, 0) {
				facts[key] = n
			}
		}
		out["viewport"] = facts
	}
	return out
}

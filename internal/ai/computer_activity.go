package ai

import (
	"encoding/json"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"

	fltools "github.com/floegence/floret/v7/tools"
)

// Computer presentation is derived once from returned facts. Rows contain
// readable resources and content; their small meta vocabulary is localized by
// Flower, never shown as platform roles or interpreted as execution authority.
func computerActivityResultRows(tool string, payload map[string]any) []fltools.StructuredActivityRow {
	rows := []fltools.StructuredActivityRow{}
	omitted := false
	add := func(title, meta, content string, format fltools.StructuredActivityRowFormat) {
		if title == "" && content == "" {
			return
		}
		if len(rows) >= structuredActivityRowLimit {
			omitted = true
			return
		}
		rows = append(rows, toolDetailRow(title, meta, content, format, "", false))
	}
	if diagnostic := computerOperationDiagnostic(payload["diagnostic"]); diagnostic != nil {
		for _, key := range []string{"phase", "method", "field", "expected", "example", "recovery"} {
			if value, exists := diagnostic[key]; exists {
				add(key, "", toolDetailValue(value), fltools.StructuredActivityRowFormatText)
			}
		}
	}
	if progress := computerInputProgress(payload["input_progress"]); len(progress) > 0 {
		for _, key := range []string{"stage", "posted", "observed", "expected"} {
			if value, exists := progress[key]; exists {
				add(key, "", toolDetailValue(value), fltools.StructuredActivityRowFormatText)
			}
		}
	}
	for _, key := range []string{"reason", "stage", "target_state", "observation_stage"} {
		if value := computerDiagnosticValue(key, payload[key]); value != "" {
			add(key, "", value, fltools.StructuredActivityRowFormatText)
		}
	}
	if tool == "computer.targets" {
		candidates := toAnySlice(payload["candidates"])
		defaultRef := anyToString(payload["default_candidate_ref"])
		// Keep the default visible in the initial three-row preview.
		slices.SortStableFunc(candidates, func(a, b any) int {
			left, _ := a.(map[string]any)
			right, _ := b.(map[string]any)
			if defaultRef != "" {
				if left["candidate_ref"] == defaultRef && right["candidate_ref"] != defaultRef {
					return -1
				}
				if right["candidate_ref"] == defaultRef && left["candidate_ref"] != defaultRef {
					return 1
				}
			}
			return 0
		})
		for _, item := range candidates {
			candidate, _ := item.(map[string]any)
			name := strings.TrimSpace(anyToString(candidate["display_name"]))
			title := strings.TrimSpace(anyToString(candidate["title"]))
			if title != "" && !strings.Contains(name, title) {
				name = strings.Join(nonemptyComputerText(name, title), " — ")
			}
			meta := ""
			if candidate["new_tab"] == true {
				meta = "new_tab"
			}
			if defaultRef != "" && candidate["candidate_ref"] == defaultRef {
				meta = strings.TrimSpace("default " + meta)
			}
			if state := anyToString(candidate["state"]); state != "" && state != "ready" {
				meta = strings.TrimSpace(meta + " unavailable")
			}
			content := strings.Join(nonemptyComputerText(anyToString(candidate["profile_name"]), computerActivityURL(anyToString(candidate["url"]))), "\n")
			add(name, meta, content, fltools.StructuredActivityRowFormatText)
		}
	} else {
		observation := payload
		if nested, ok := payload["observation"].(map[string]any); ok {
			observation = nested
		}
		title := firstNonEmptyString(anyToString(observation["title"]), anyToString(payload["title"]))
		address := computerActivityURL(firstNonEmptyString(anyToString(observation["url"]), anyToString(payload["url"])))
		text, controls := []string{}, []fltools.StructuredActivityRow{}
		for _, item := range toAnySlice(observation["nodes"]) {
			node, _ := item.(map[string]any)
			role := anyToString(node["canonical_role"])
			if role == "" {
				role = anyToString(node["role"])
				if _, canonical := computerRoleAliases[role]; !canonical {
					role = computerCanonicalRole(role)
				}
			}
			name := firstNonEmptyString(anyToString(node["name"]), anyToString(node["text"]))
			value := strings.TrimSpace(toolDetailValue(node["value"]))
			if name == "" && value == "" {
				continue
			}
			if slices.Contains([]string{"document", "window", "group", "generic", "region"}, role) {
				continue
			}
			if slices.Contains([]string{"button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab", "option"}, role) {
				controls = append(controls, fltools.StructuredActivityRow{Title: name, Meta: role, Content: value, Format: fltools.StructuredActivityRowFormatText})
			} else {
				line := strings.Join(nonemptyComputerText(name, value), " · ")
				if line != "" && (len(text) == 0 || text[len(text)-1] != line) {
					text = append(text, line)
				}
			}
		}
		// A blank document has no useful expanded content. Its explicit empty
		// result is recorded separately from missing historical details.
		if address != "about:blank" || len(text) > 0 || len(controls) > 0 {
			meta := "page"
			if observation["format"] == "diff" {
				meta = "page_changes"
			}
			add(title, meta, strings.Join(nonemptyComputerText(address, strings.Join(text, "\n")), "\n\n"), fltools.StructuredActivityRowFormatText)
		}
		for _, row := range controls {
			add(row.Title, row.Meta, row.Content, row.Format)
		}
		for _, item := range toAnySlice(payload["logs"]) {
			parts := []string{}
			if values, ok := item.([]any); ok {
				for _, value := range values {
					parts = append(parts, toolDetailValue(value))
				}
			} else {
				parts = append(parts, toolDetailValue(item))
			}
			add("", "", strings.Join(parts, " "), fltools.StructuredActivityRowFormatCode)
		}
		if payload["completed"] == false {
			add("", "completed_actions", strings.Join(extractStringSlice(payload["completed_actions"]), "\n"), fltools.StructuredActivityRowFormatCode)
		}
		if readBoolField(observation, "truncated") {
			omitted = true
		}
	}
	if len(rows) > 0 && (omitted || readBoolField(payload, "truncated")) {
		rows[len(rows)-1].Truncated = true
	}
	return rows
}

func nonemptyComputerText(values ...string) []string {
	result := []string{}
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" && !slices.Contains(result, value) {
			result = append(result, value)
		}
	}
	return result
}

func computerActivityURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	switch parsed.Scheme {
	case "http", "https":
		parsed.User, parsed.RawQuery, parsed.Fragment = nil, "", ""
		return parsed.String()
	case "file":
		return displayNameForFilePath(parsed.Path)
	case "about":
		if raw == "about:blank" {
			return raw
		}
	}
	return ""
}

func computerActivityBlankPage(payload map[string]any) bool {
	observation := payload
	if nested, ok := payload["observation"].(map[string]any); ok {
		observation = nested
	}
	address := firstNonEmptyString(anyToString(observation["url"]), anyToString(payload["url"]))
	if address != "about:blank" || observation["format"] == "diff" || readBoolField(observation, "truncated") {
		return false
	}
	nodes, ok := observation["nodes"]
	if !ok {
		return false
	}
	for _, value := range toAnySlice(nodes) {
		node, _ := value.(map[string]any)
		role := firstNonEmptyString(anyToString(node["canonical_role"]), anyToString(node["role"]))
		if _, canonical := computerRoleAliases[role]; !canonical {
			role = computerCanonicalRole(role)
		}
		if role != "document" || strings.TrimSpace(anyToString(node["name"])) != "" || node["value"] != nil {
			return false
		}
	}
	return true
}

// Only the closed non-secret diagnostic vocabulary crosses into presentation.
func computerDiagnosticValue(key string, value any) string {
	text, _ := value.(string)
	allowed := map[string][]string{
		"stage":             {"preparation", "focus", "input_delivery", "input_release", "input_observed", "action", "helper_exchange"},
		"reason":            {"unavailable", "not_focusable", "receipt_timeout", "cancelled", "target_unavailable", "target_not_ready", "permission_required", "invalid_request", "action_failed", "response_unavailable", "viewport_unstable"},
		"target_state":      {"available", "unavailable", "unknown"},
		"observation_stage": {"frame_inventory", "safety_scan", "semantic_read", "capture", "metadata", "hit_test"},
	}
	if slices.Contains(allowed[key], text) {
		return text
	}
	return ""
}

func computerInputProgress(value any) map[string]any {
	raw, _ := value.(map[string]any)
	result := map[string]any{}
	if stage := computerDiagnosticValue("stage", raw["stage"]); stage != "" {
		result["stage"] = stage
	}
	for _, key := range []string{"posted", "observed", "expected"} {
		var count float64
		switch v := raw[key].(type) {
		case int:
			count = float64(v)
		case int64:
			count = float64(v)
		case float64:
			count = v
		case json.Number:
			var err error
			count, err = strconv.ParseFloat(string(v), 64)
			if err != nil {
				continue
			}
		default:
			continue
		}
		if count >= 0 && count <= 1<<31 && math.Trunc(count) == count {
			result[key] = int64(count)
		}
	}
	return result
}

// Presentation classification uses only returned effect facts. It never drives retries.
func computerActivityFailurePhase(payload map[string]any) string {
	if payload["effect_outcome_unknown"] == true {
		return "unknown"
	}
	if payload["action_executed"] == true {
		return "effect_confirmed"
	}
	if payload["preparation_executed"] == true {
		return "prepared"
	}
	if diagnostic := computerOperationDiagnostic(payload["diagnostic"]); diagnostic != nil && diagnostic["phase"] != "read" {
		return "validation"
	}
	return ""
}

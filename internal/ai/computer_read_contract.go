package ai

import (
	"encoding/json"
	"math"
	"unicode/utf8"
)

// Read success is an operation contract, independent of the target adapter.
// Actions may invalidate an old observation without losing their completion.
func computerReadResultValid(call TargetToolCall, result TargetToolResult) bool {
	var args map[string]any
	_ = json.Unmarshal(call.Arguments, &args)
	operation := ""
	switch call.ToolName {
	case "computer.observe":
		operation = "observe"
	case "computer.screenshot":
		operation = "screenshot"
	case "computer.action":
		switch action, _ := args["action"].(string); action {
		case "capabilities", "source", "selection", "read", "text", "query", "table", "attribute", "wait":
			operation = action
		}
	}
	if operation == "" {
		return true
	}
	payload, _ := result.Result.(map[string]any)
	// Target changes and takeovers have their own terminal control boundary.
	if payload["target_changed"] == true {
		return true
	}
	if payload["observation_invalidated"] == true || result.Safety != nil && !result.Safety.SafeToSendToModel {
		return false
	}
	if operation == "screenshot" {
		return true
	} // Frame validation owns decoded image integrity.
	body, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	var p map[string]any
	if json.Unmarshal(body, &p) != nil || p == nil {
		return false
	}
	stringField := func(p map[string]any, key string, nonempty bool) bool {
		value, ok := p[key].(string)
		return ok && (!nonempty || value != "")
	}
	boolField := func(p map[string]any, key string) bool { _, ok := p[key].(bool); return ok }
	switch operation {
	case "capabilities":
		return stringField(p, "source", true) && computerStringArray(p["reads"]) && computerStringArray(p["actions"])
	case "selection":
		if !stringField(p, "text", false) || !stringField(p, "ref", true) || p["unit"] != "utf16_code_units" {
			return false
		}
		start, hasStart := p["start"]
		end, hasEnd := p["end"]
		if !hasStart || !hasEnd {
			return false
		}
		if start == nil || end == nil {
			return start == nil && end == nil && p["text"] == ""
		}
		first, validFirst := computerNonnegativeInteger(start)
		last, validLast := computerNonnegativeInteger(end)
		return validFirst && validLast && last >= first
	case "source":
		if !stringField(p, "source", true) || !stringField(p, "document_id", true) || !stringField(p, "ref", true) || !boolField(p, "truncated") {
			return false
		}
		if fields, exists := p["fields"]; exists {
			return computerStringArray(fields) && p["truncated"] == false
		}
		if !stringField(p, "field", true) {
			return false
		}
		if p["available"] == false {
			return p["truncated"] == false
		}
		if p["available"] != true {
			return false
		}
		offset, validOffset := computerNonnegativeInteger(p["offset"])
		total, validTotal := computerNonnegativeInteger(p["total"])
		if !validOffset || !validTotal || offset > total {
			return false
		}
		var count int
		if items, ok := p["items"].([]any); ok {
			if p["unit"] != "items" || !computerStringArray(items) && p["source"] != "macos_accessibility" {
				return false
			}
			count = len(items)
		} else {
			text, ok := p["value"].(string)
			if !ok || p["unit"] != "unicode_code_points" || p["encoding"] != "text" && p["encoding"] != "json" {
				return false
			}
			count = utf8.RuneCountInString(text)
		}
		end := offset + float64(count)
		return end <= total && (p["truncated"] == true && count > 0 && end < total && stringField(p, "next_cursor", true) || p["truncated"] == false && end == total)
	case "observe":
		observation, ok := p["observation"].(map[string]any)
		if !ok {
			return false
		}
		_, nodes := observation["nodes"].([]any)
		return nodes && stringField(observation, "document_id", true) && boolField(observation, "truncated")
	case "read":
		node, ok := p["node"].(map[string]any)
		return ok && node != nil // Existing semantic normalization validates node content.
	case "text":
		return stringField(p, "text", false) && stringField(p, "scope", true) && boolField(p, "truncated")
	case "attribute":
		value, exists := p["value"]
		text, isText := value.(string)
		return exists && (value == nil || isText && utf8.ValidString(text) && utf8.RuneCountInString(text) <= 2000) && p["attribute"] == args["attribute"]
	case "wait":
		state, ok := p["state"].(string)
		requested, _ := args["state"].(string)
		if requested == "" {
			requested = "visible"
		}
		return ok && (state == requested || state == "timeout" && p["requested_state"] == requested)
	case "query", "table":
		key := "items"
		if operation == "table" {
			key = "rows"
		}
		items, ok := p[key].([]any)
		total, totalOK := p["total"].(float64)
		if !ok || !totalOK || total < 0 || math.Trunc(total) != total || total < float64(len(items)) || !stringField(p, "document_id", true) || !stringField(p, "scope", true) || !boolField(p, "truncated") {
			return false
		}
		if p["truncated"] == true && !stringField(p, "next_cursor", true) {
			return false
		}
		for _, value := range items {
			item, ok := value.(map[string]any)
			if !ok || !stringField(item, "ref", true) {
				return false
			}
			if operation == "query" {
				if !stringField(item, "role", true) || !stringField(item, "name", false) {
					return false
				}
				name := item["name"].(string)
				if !utf8.ValidString(name) || utf8.RuneCountInString(name) > 2000 {
					return false
				}
				if raw, exists := item["name_truncated"]; exists {
					truncated, ok := raw.(bool)
					if !ok || truncated && utf8.RuneCountInString(name) != 2000 {
						return false
					}
				}
			} else {
				cells, ok := item["cells"].([]any)
				if !ok {
					return false
				}
				for _, value := range cells {
					cell, ok := value.(map[string]any)
					if !ok || !stringField(cell, "role", true) || !stringField(cell, "text", false) {
						return false
					}
				}
			}
		}
		return true
	}
	return false
}

func computerStringArray(value any) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, raw := range items {
		if text, ok := raw.(string); !ok || text == "" {
			return false
		}
	}
	return true
}

func computerNonnegativeInteger(value any) (float64, bool) {
	n, ok := value.(float64)
	return n, ok && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 9007199254740991 && n == math.Trunc(n)
}

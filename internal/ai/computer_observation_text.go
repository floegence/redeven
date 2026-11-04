package ai

import (
	"encoding/json"
	"strings"
)

const computerObservationTextBudget = 32 << 10
const computerObservationRecovery = "Read a narrower root_ref; source() enumerates complete AX/DOM fields and paged child refs; rows/query/text read selected content. full:true requests structured details."

// Product presentation never replaces validated semantic authority or guest reads.
func compactComputerObservation(current map[string]any) map[string]any {
	ordered, valid := computerObservationOrder(toAnySlice(current["nodes"]))
	if !valid {
		return current
	}
	metadata := map[string]any{"detail": "compact", "scope": "loaded_accessibility_tree", "source_truncated": current["truncated"] == true}
	for _, key := range []string{"document_id", "url", "title", "truncated", "total", "execution_mode", "source", "coverage", "root_ref", "limit", "read_options"} {
		if v, ok := current[key]; ok {
			metadata[key] = v
		}
	}
	if current["truncated"] == true {
		metadata["recovery"] = computerObservationRecovery
	}
	// Browser titles and addresses are outside the semantic-node field budget.
	// Bound their encoded representation explicitly without changing document IDs.
	for _, key := range []string{"title", "url"} {
		if value, ok := metadata[key].(string); ok && len(computerObservationQuote(value)) > 4096 {
			var prefix strings.Builder
			used := 2
			for _, r := range value {
				cost := len(computerObservationQuote(string(r))) - 2
				if used+cost > 4096 {
					break
				}
				prefix.WriteRune(r)
				used += cost
			}
			metadata[key], metadata[key+"_truncated"] = prefix.String(), true
			metadata["truncated"], metadata["output_truncated"], metadata["recovery"] = true, true, computerObservationRecovery
		}
	}

	nodes := make([]any, 0, len(ordered))
	for _, node := range ordered {
		item := map[string]any{}
		for _, key := range []string{"ref", "parent_ref", "role", "platform_role", "name", "value", "description", "frame_id", "name_truncated", "value_truncated", "description_truncated", "children_truncated"} {
			if v, ok := node[key]; ok {
				item[key] = v
			}
		}
		if states, ok := node["states"].(map[string]any); ok && len(states) > 0 {
			item["states"] = states
		}
		nodes = append(nodes, item)
	}
	project := func(count int) map[string]any {
		out := cloneAnyMap(metadata)
		kept := map[string]bool{}
		for _, raw := range nodes[:count] {
			kept[anyToString(raw.(map[string]any)["ref"])] = true
		}
		selected := make([]any, 0, count)
		for i, raw := range nodes[:count] {
			item := cloneAnyMap(raw.(map[string]any))
			for _, child := range toAnySlice(ordered[i]["child_refs"]) {
				if !kept[anyToString(child)] {
					item["children_truncated"] = true
					break
				}
			}
			selected = append(selected, item)
		}
		out["nodes"] = selected
		if focus := anyToString(current["focus_ref"]); focus != "" && kept[focus] {
			out["focus_ref"] = focus
		}
		if count < len(nodes) {
			out["truncated"], out["output_truncated"], out["recovery"] = true, true, computerObservationRecovery
		}
		return out
	}
	// Charge the final JSON-escaped tree string, including metadata. Reserve
	// truncation markers. Linear work, no token guesses.
	reserve := project(0)
	reserve["format"] = "full"
	if focus := anyToString(current["focus_ref"]); focus != "" {
		reserve["focus_ref"] = focus
	}
	used := computerObservationEncodedSize(reserve)
	parents := map[string]map[string]any{}
	depths := map[string]int{}
	count := 0
	for _, raw := range nodes {
		node := raw.(map[string]any)
		ref, parent := anyToString(node["ref"]), anyToString(node["parent_ref"])
		depth := 0
		if parent != "" {
			depth = depths[parent] + 1
		}
		charged := cloneAnyMap(node)
		if len(toAnySlice(ordered[count]["child_refs"])) > 0 {
			charged["children_truncated"] = true
		}
		line := computerObservationLine(charged, parents[parent], depth)
		cost := len(computerObservationQuote(line)) - 2
		if count > 0 {
			cost += 2
		}
		if used+cost > computerObservationTextBudget {
			break
		}
		used += cost
		count++
		parents[ref] = node
		depths[ref] = depth
	}
	return project(count)
}

// DFS keeps complete branches together; sibling order follows the source.
// Malformed graphs are rejected rather than silently inventing ancestry.
func computerObservationOrder(nodes []any) ([]map[string]any, bool) {
	byRef := map[string]map[string]any{}
	children := map[string][]string{}
	roots := []string{}
	for _, raw := range nodes {
		n, ok := raw.(map[string]any)
		if !ok {
			return nil, false
		}
		ref, ok := n["ref"].(string)
		if !ok || ref == "" || byRef[ref] != nil {
			return nil, false
		}
		byRef[ref] = n
	}
	for _, raw := range nodes {
		n := raw.(map[string]any)
		ref, parent := anyToString(n["ref"]), anyToString(n["parent_ref"])
		if parent == "" {
			roots = append(roots, ref)
		} else if byRef[parent] == nil {
			return nil, false
		} else {
			children[parent] = append(children[parent], ref)
		}
	}
	ordered := make([]map[string]any, 0, len(nodes))
	seen := map[string]bool{}
	var walk func(string) bool
	walk = func(ref string) bool {
		if seen[ref] {
			return false
		}
		seen[ref] = true
		ordered = append(ordered, byRef[ref])
		for _, child := range children[ref] {
			if !walk(child) {
				return false
			}
		}
		return true
	}
	for _, ref := range roots {
		if !walk(ref) {
			return nil, false
		}
	}
	return ordered, len(ordered) == len(nodes)
}

// Quote every source value, including opaque refs. Bidi/newline escapes prevent
// structural spoofing; application content remains untrusted semantic content.
var computerObservationEscapes = strings.NewReplacer(
	"\u202a", "\\u202a", "\u202b", "\\u202b", "\u202c", "\\u202c", "\u202d", "\\u202d", "\u202e", "\\u202e",
	"\u2066", "\\u2066", "\u2067", "\\u2067", "\u2068", "\\u2068", "\u2069", "\\u2069",
)

func computerObservationQuote(value any) string {
	body, _ := json.Marshal(value)
	return computerObservationEscapes.Replace(string(body))
}

func computerObservationLine(node, parent map[string]any, depth int) string {
	var line strings.Builder
	// Deep indentation cannot consume the budget: spell out parent past level 8.
	line.WriteString(strings.Repeat("  ", min(depth, 8)))
	line.WriteString("[" + computerObservationQuote(node["ref"]) + "] " + computerObservationQuote(node["role"]) + " " + computerObservationQuote(node["name"]))
	if _, ok := node["name"]; !ok {
		line.WriteString(" name_absent=true")
	}
	if parent == nil || depth > 8 {
		if ref := anyToString(node["parent_ref"]); ref != "" {
			line.WriteString(" parent_ref=" + computerObservationQuote(ref))
		}
	}
	for _, key := range []string{"value", "states", "description", "frame_id", "name_truncated", "value_truncated", "description_truncated", "children_truncated"} {
		if value, ok := node[key]; ok {
			if key == "frame_id" && depth <= 8 && parent != nil && parent[key] == value {
				continue
			}
			line.WriteString(" " + key + "=" + computerObservationQuote(value))
		} else if key == "frame_id" && (depth > 8 || parent != nil && parent[key] != nil) {
			line.WriteString(" frame_absent=true")
		}
	}
	return line.String()
}

func computerObservationPresentation(value map[string]any) map[string]any {
	if value["detail"] != "compact" {
		return value
	}
	out := cloneAnyMap(value)
	delete(out, "nodes")
	out["encoding"] = "tree_text"
	parents := map[string]map[string]any{}
	depths := map[string]int{}
	lines := []string{}
	for _, raw := range toAnySlice(value["nodes"]) {
		node := raw.(map[string]any)
		ref, p := anyToString(node["ref"]), anyToString(node["parent_ref"])
		depth := 0
		if parents[p] != nil {
			depth = depths[p] + 1
		}
		parent := parents[p]
		if value["format"] == "diff" {
			parent, depth = nil, 0
		}
		lines = append(lines, computerObservationLine(node, parent, depth))
		parents[ref] = node
		depths[ref] = depth
	}
	out["tree"] = strings.Join(lines, "\n")
	return out
}
func computerObservationEncodedSize(value map[string]any) int {
	body, _ := json.Marshal(computerObservationPresentation(value))
	return len(body)
}

// Sparse replacement records cannot establish added/reordered sibling positions.

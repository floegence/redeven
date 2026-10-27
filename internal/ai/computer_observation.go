package ai

import (
	"encoding/json"
	"reflect"
)

// Only the last emitted, bounded tree is retained by the Turn's script process.
// Guest code always reads a full tree; this projection reduces model output.
type computerObservationOutput struct {
	scope          string
	snapshot       map[string]any
	unchangedReads int
}

func (o *computerObservationOutput) render(value any, scope string, full bool) any {
	body, err := json.Marshal(value)
	if err != nil || len(body) > 524288 {
		*o = computerObservationOutput{}
		return value
	}
	decoded, err := decodeToolJSON(body)
	current, ok := decoded.(map[string]any)
	if err != nil || !ok || current == nil {
		*o = computerObservationOutput{}
		return value
	}
	if !full && current["semantic_schema_version"] == nil {
		current = compactComputerObservation(current)
		body, _ = json.Marshal(current)
	}
	nodes, valid := computerObservationNodes(current)
	previous, previousValid := computerObservationNodes(o.snapshot)
	document, _ := current["document_id"].(string)
	output := cloneAnyMap(current)
	output["format"] = "full"
	if !full && valid && previousValid && document != "" && document == o.snapshot["document_id"] && scope == o.scope && current["detail"] == o.snapshot["detail"] && current["truncated"] == false && o.snapshot["truncated"] == false {
		changed, removed := []any{}, []string{}
		for _, node := range current["nodes"].([]any) {
			ref := node.(map[string]any)["ref"].(string)
			if !reflect.DeepEqual(previous[ref], node) {
				changed = append(changed, node)
			}
		}
		for _, node := range o.snapshot["nodes"].([]any) {
			ref := node.(map[string]any)["ref"].(string)
			if _, exists := nodes[ref]; !exists {
				removed = append(removed, ref)
			}
		}
		output["format"], output["nodes"], output["removed_refs"] = "diff", changed, removed
		output["unchanged"] = len(nodes) - len(changed)
		// A large change is clearer and cheaper as a complete snapshot.
		encoded, _ := json.Marshal(output)
		if len(encoded) >= len(body)+len(`,"format":"full"`) {
			output = cloneAnyMap(current)
			output["format"] = "full"
		}
	}
	if valid && previousValid && document != "" && scope == o.scope && reflect.DeepEqual(current, o.snapshot) {
		o.unchangedReads++
		if o.unchangedReads >= 2 {
			output["advisory"] = "Repeated observation has no new information. Inspect a narrower scope or another representation only if needed; do not repeat an uncertain input."
		}
	} else {
		o.unchangedReads = 0
	}
	o.scope, o.snapshot = scope, current
	return output
}

func computerObservationNodes(snapshot map[string]any) (map[string]any, bool) {
	nodes, ok := snapshot["nodes"].([]any)
	if !ok || len(nodes) > 1000 {
		return nil, false
	}
	result := make(map[string]any, len(nodes))
	for _, node := range nodes {
		value, ok := node.(map[string]any)
		if !ok {
			return nil, false
		}
		ref, ok := value["ref"].(string)
		if !ok || ref == "" {
			return nil, false
		}
		if _, exists := result[ref]; exists {
			return nil, false
		}
		result[ref] = node
	}
	return result, true
}

// Only automatic snapshot output is compacted. Guest code receives the full
// validated tree; node() and snapshot({full:true}) expose its details.
func compactComputerObservation(current map[string]any) map[string]any {
	const budget = 32000
	original := toAnySlice(current["nodes"])
	project := func(count int) map[string]any {
		out := map[string]any{"detail": "compact", "scope": "loaded_accessibility_tree"}
		for _, key := range []string{"document_id", "url", "title", "truncated", "total", "execution_mode"} {
			if value, exists := current[key]; exists {
				out[key] = value
			}
		}
		kept := map[string]bool{}
		for _, raw := range original[:count] {
			if node, ok := raw.(map[string]any); ok {
				kept[anyToString(node["ref"])] = true
			}
		}
		nodes := []any{}
		for _, raw := range original[:count] {
			node, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			item := map[string]any{}
			for _, key := range []string{"ref", "parent_ref", "role", "name", "value", "description", "children_truncated"} {
				if value, exists := node[key]; exists {
					item[key] = value
				}
			}
			if parent := anyToString(item["parent_ref"]); parent != "" && !kept[parent] {
				delete(item, "parent_ref")
			}
			for _, child := range toAnySlice(node["child_refs"]) {
				if !kept[anyToString(child)] {
					item["children_truncated"] = true
				}
			}
			if states, ok := node["states"].(map[string]any); ok && len(states) > 0 {
				item["states"] = states
			}
			nodes = append(nodes, item)
		}
		out["nodes"] = nodes
		if focus := anyToString(current["focus_ref"]); focus != "" && kept[focus] {
			out["focus_ref"] = focus
		}
		if count < len(original) {
			out["truncated"], out["output_truncated"] = true, true
			out["recovery"] = "Read a narrower root_ref or use locator.rows/query; full:true requests detailed output."
		}
		return out
	}
	out := project(len(original))
	body, _ := json.Marshal(out)
	if len(body) <= budget {
		return out
	}
	// Find the largest complete prefix, accounting for truncation metadata and
	// omitted children. Validated identity metadata fits without nodes.
	low, high := 0, len(original)-1
	for low < high {
		mid := (low + high + 1) / 2
		body, _ = json.Marshal(project(mid))
		if len(body) <= budget {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return project(low)
}

package ai

import (
	"encoding/json"
	"reflect"
)

// Only the last emitted, bounded tree is retained by the Turn's script process.
// Guest code always reads a full tree; this projection reduces model output.
type computerObservationOutput struct {
	scope    string
	snapshot map[string]any
}

func (o *computerObservationOutput) render(value any, scope string, full bool) any {
	body, err := json.Marshal(value)
	if err != nil || len(body) > 262144 {
		*o = computerObservationOutput{}
		return value
	}
	var current map[string]any
	if json.Unmarshal(body, &current) != nil || current == nil {
		*o = computerObservationOutput{}
		return value
	}
	nodes, valid := computerObservationNodes(current)
	previous, previousValid := computerObservationNodes(o.snapshot)
	document, _ := current["document_id"].(string)
	output := cloneAnyMap(current)
	output["format"] = "full"
	if !full && valid && previousValid && document != "" && document == o.snapshot["document_id"] && scope == o.scope && current["truncated"] == false && o.snapshot["truncated"] == false {
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

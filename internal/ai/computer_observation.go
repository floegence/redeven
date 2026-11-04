package ai

import (
	"encoding/json"
)

// Every emitted observation is self-contained. The guest selects the scope and
// representation; presentation does not choose an implicit diff or reading policy.
type computerObservationOutput struct{}

func (*computerObservationOutput) render(value any, _ string, full bool) any {
	body, err := json.Marshal(value)
	if err != nil || len(body) > 524288 {
		return value
	}
	decoded, err := decodeToolJSON(body)
	current, ok := decoded.(map[string]any)
	if err != nil || !ok || current == nil {
		return value
	}
	if !full && current["semantic_schema_version"] == nil {
		if _, valid := computerObservationNodes(current); !valid {
			return value
		}
		current = compactComputerObservation(current)
	}
	output := cloneAnyMap(current)
	output["format"] = "full"
	return computerObservationPresentation(output)
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

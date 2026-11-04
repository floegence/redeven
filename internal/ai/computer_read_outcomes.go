package ai

import (
	"encoding/json"
	"math"
	"slices"
)

// Invocation-local receipts contain only read identity and outcome, never page
// content or instructions for recovery. The existing operation limit bounds them.
func computerReadOutcome(operation map[string]any, index int, status string, facts map[string]any) map[string]any {
	out := map[string]any{"operation_index": index, "action": operation["action"], "status": status}
	for _, key := range []string{"reason", "observation_stage"} {
		if value := computerDiagnosticValue(key, facts[key]); value != "" {
			out[key] = value
		}
	}
	identity := facts
	if observation, ok := facts["observation"].(map[string]any); ok {
		identity = observation
	}
	for _, key := range []string{"frame_id", "document_id", "ref"} {
		if value, ok := identity[key].(string); ok && len(value) <= 512 {
			out[key] = value
		}
	}
	if invalidation := computerInvalidationFacts(facts["invalidation"]); invalidation != nil {
		out["invalidation"] = invalidation
	}
	return out
}

// Only closed stages and numeric delivery facts cross the helper/UI boundary.
func computerOutputLimitFacts(value any) map[string]any {
	raw, _ := value.(map[string]any)
	if !slices.Contains([]string{"log", "before_observation", "after_observation"}, anyToString(raw["stage"])) {
		return nil
	}
	out := map[string]any{"stage": raw["stage"]}
	for _, key := range []string{"limit_bytes", "attempted_bytes", "remaining_bytes", "emitted_logs", "delivered_observations"} {
		var n float64
		switch v := raw[key].(type) {
		case int:
			n = float64(v)
		case int64:
			n = float64(v)
		case float64:
			n = v
		case json.Number:
			var err error
			n, err = v.Float64()
			if err != nil {
				continue
			}
		default:
			continue
		}
		if n >= 0 && n <= math.MaxInt32 && math.Trunc(n) == n {
			out[key] = int64(n)
		}
	}
	return out
}

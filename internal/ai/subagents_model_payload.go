package ai

// compactSubagentModelData operates on the detached JSON projection. It removes
// display metadata and aliases, never report text, errors or pagination refs.
func compactSubagentModelData(data map[string]any) {
	withReport := map[string]bool{}
	handoffs, _ := data["handoffs"].([]any)
	for _, value := range handoffs {
		if handoff, ok := value.(map[string]any); ok {
			if id, ok := handoff["thread_id"].(string); ok {
				withReport[id] = true
			}
		}
	}
	for _, key := range []string{
		"ids", "target_ids", "selected_ids",
		"requested_timeout_ms", "effective_timeout_ms", "timeout_source",
		"counts", "agent_count", "requested_count", "found_count", "missing_count",
		"updated_at_unix_ms",
	} {
		delete(data, key)
	}
	if data["missing_ids"] != nil || data["status"] != "partial" && data["status"] != "not_found" {
		delete(data, "requested_ids")
	}
	if items, ok := data["items"].([]any); ok {
		for _, value := range items {
			item, ok := value.(map[string]any)
			if !ok {
				continue
			}
			for _, key := range []string{
				"id", "parent_thread_id", "parent_turn_id",
				"started_at_ms", "created_at_ms", "updated_at_ms",
				"closed", "can_send_input", "can_interrupt", "can_close",
			} {
				delete(item, key)
			}
			for _, key := range []string{"waiting_prompt", "last_message_preview"} {
				if item[key] == "" {
					delete(item, key)
				}
			}
			if data["action"] == subagentActionSpawn || data["action"] == subagentActionWait {
				delete(item, "task_description")
			}
			id, _ := item["thread_id"].(string)
			if withReport[id] {
				delete(item, "last_message_preview")
			}
		}
	}
	if data["action"] == subagentActionSpawn {
		delete(data, "task_description")
		// The item contains the accepted identity, effective mode and status.
		for _, key := range []string{"thread_id", "task_name", "context_mode"} {
			delete(data, key)
		}
	}
	page := data
	if nested, ok := data["events"].(map[string]any); ok {
		page = nested
	}
	if events, ok := page["events"].([]any); ok {
		for _, value := range events {
			if event, ok := value.(map[string]any); ok {
				for _, key := range []string{"canonical_ordinal", "parent_thread_id", "parent_turn_id", "source_entry_id", "received_at", "admitted"} {
					delete(event, key)
				}
			}
		}
	}
}

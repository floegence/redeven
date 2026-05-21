package threadstore

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type legacyActivityItem struct {
	runID       string
	itemID      string
	toolID      string
	toolName    string
	groupID     string
	kind        string
	renderer    string
	status      string
	severity    string
	label       string
	description string
	payload     map[string]any
	targetRefs  []map[string]any
	chips       []map[string]any
}

func migrateLegacyToolCallTranscriptBlocksTx(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT id, endpoint_id, thread_id, message_id, updated_at_unix_ms, message_json
FROM transcript_messages
WHERE message_json LIKE '%tool-call%'
`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type legacyMessage struct {
		id        int64
		endpoint  string
		threadID  string
		messageID string
		updatedAt int64
		raw       string
	}
	messages := make([]legacyMessage, 0, 16)
	for rows.Next() {
		var msg legacyMessage
		if err := rows.Scan(&msg.id, &msg.endpoint, &msg.threadID, &msg.messageID, &msg.updatedAt, &msg.raw); err != nil {
			return err
		}
		messages = append(messages, msg)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, msg := range messages {
		nextJSON, items, changed, err := rewriteLegacyToolCallMessageJSON(msg.raw, msg.messageID, msg.updatedAt)
		if err != nil {
			return fmt.Errorf("migrate legacy tool-call transcript %s: %w", msg.messageID, err)
		}
		if !changed {
			continue
		}
		if _, err := tx.Exec(`UPDATE transcript_messages SET message_json = ? WHERE id = ?`, nextJSON, msg.id); err != nil {
			return err
		}
		for idx, item := range items {
			if item.runID == "" || item.itemID == "" {
				continue
			}
			if _, err := tx.Exec(`
INSERT OR REPLACE INTO ai_activity_items(
  endpoint_id, thread_id, run_id, message_id, group_id, item_id,
  tool_id, tool_name, kind, renderer, status, severity,
  summary_json, detail_refs_json, target_refs_json, payload_json,
  order_index, started_at_unix_ms, ended_at_unix_ms, updated_at_unix_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, msg.endpoint, msg.threadID, item.runID, msg.messageID, item.groupID, item.itemID,
				item.toolID, item.toolName, item.kind, item.renderer, item.status, item.severity,
				marshalLegacyActivityJSON(map[string]any{
					"label":       item.label,
					"description": item.description,
					"chips":       item.chips,
				}, "{}"),
				"[]",
				marshalLegacyActivityJSON(item.targetRefs, "[]"),
				marshalLegacyActivityJSON(item.payload, "{}"),
				idx, msg.updatedAt, msg.updatedAt, msg.updatedAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func rewriteLegacyToolCallMessageJSON(raw string, messageID string, updatedAt int64) (string, []legacyActivityItem, bool, error) {
	var envelope map[string]any
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
		return "", nil, false, err
	}
	blocks, ok := envelope["blocks"].([]any)
	if !ok || len(blocks) == 0 {
		return raw, nil, false, nil
	}
	outBlocks := make([]any, 0, len(blocks))
	items := make([]legacyActivityItem, 0, len(blocks))
	insertAt := -1
	runID := ""
	for _, blockAny := range blocks {
		block, ok := blockAny.(map[string]any)
		if !ok || strings.TrimSpace(legacyString(block, "type")) != "tool-call" {
			outBlocks = append(outBlocks, blockAny)
			continue
		}
		if insertAt < 0 {
			insertAt = len(outBlocks)
		}
		item := legacyActivityItemFromToolBlock(block, len(items), updatedAt)
		if item.runID != "" && runID == "" {
			runID = item.runID
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return raw, nil, false, nil
	}
	if runID == "" {
		runID = "legacy_" + strings.TrimSpace(messageID)
	}
	for i := range items {
		if items[i].runID == "" {
			items[i].runID = runID
		}
	}
	timeline := legacyActivityTimelineBlock(runID, messageID, items, updatedAt)
	if insertAt < 0 || insertAt > len(outBlocks) {
		insertAt = len(outBlocks)
	}
	outBlocks = append(outBlocks, nil)
	copy(outBlocks[insertAt+1:], outBlocks[insertAt:])
	outBlocks[insertAt] = timeline
	envelope["blocks"] = outBlocks
	next, err := json.Marshal(envelope)
	if err != nil {
		return "", nil, false, err
	}
	return string(next), items, true, nil
}

func legacyActivityItemFromToolBlock(block map[string]any, index int, updatedAt int64) legacyActivityItem {
	toolName := legacyString(block, "toolName", "tool_name")
	toolID := legacyString(block, "toolId", "tool_id")
	if toolID == "" {
		toolID = fmt.Sprintf("legacy_tool_%d", index+1)
	}
	args := legacyMap(block["args"])
	result := legacyMap(block["result"])
	status := strings.TrimSpace(legacyString(block, "status"))
	if legacyWaitingUser(result) {
		status = "waiting"
	}
	if status == "" {
		status = "success"
	}
	groupID, kind, renderer := legacyPresentationForTool(toolName)
	label, description := legacyActivitySummary(toolName, args, result, status)
	item := legacyActivityItem{
		runID:       legacyRunID(block, result),
		itemID:      toolID,
		toolID:      toolID,
		toolName:    toolName,
		groupID:     groupID,
		kind:        kind,
		renderer:    renderer,
		status:      status,
		severity:    legacySeverity(status, block),
		label:       label,
		description: description,
		payload:     legacyInteractionPayload(toolName, args, result),
		chips: []map[string]any{{
			"kind":  "status",
			"label": legacyStatusLabel(status),
			"tone":  legacyStatusTone(status),
		}},
	}
	if target := legacyActivityTarget(toolName, args, result); len(target) > 0 {
		item.targetRefs = []map[string]any{target}
	}
	_ = updatedAt
	return item
}

func legacyActivityTimelineBlock(runID string, messageID string, items []legacyActivityItem, updatedAt int64) map[string]any {
	groupOrder := make([]string, 0, len(items))
	groupByID := make(map[string][]map[string]any)
	statusByGroup := make(map[string]string)
	severityByGroup := make(map[string]string)
	for _, item := range items {
		if _, ok := groupByID[item.groupID]; !ok {
			groupOrder = append(groupOrder, item.groupID)
		}
		groupByID[item.groupID] = append(groupByID[item.groupID], legacyActivityItemMap(item, updatedAt))
		statusByGroup[item.groupID] = legacyRollupStatus(statusByGroup[item.groupID], item.status)
		severityByGroup[item.groupID] = legacyRollupSeverity(severityByGroup[item.groupID], item.severity)
	}
	groups := make([]map[string]any, 0, len(groupOrder))
	for _, groupID := range groupOrder {
		groupItems := groupByID[groupID]
		renderer := ""
		kind := ""
		if len(groupItems) > 0 {
			renderer = strings.TrimSpace(fmt.Sprint(groupItems[0]["renderer"]))
			kind = strings.TrimSpace(fmt.Sprint(groupItems[0]["kind"]))
		}
		groups = append(groups, map[string]any{
			"groupId":         groupID,
			"kind":            kind,
			"renderer":        renderer,
			"status":          statusByGroup[groupID],
			"severity":        severityByGroup[groupID],
			"title":           legacyGroupTitle(renderer, len(groupItems)),
			"defaultOpen":     statusByGroup[groupID] == "waiting" || statusByGroup[groupID] == "error",
			"items":           groupItems,
			"startedAtUnixMs": updatedAt,
			"endedAtUnixMs":   updatedAt,
		})
	}
	summaryStatus := "success"
	for _, item := range items {
		summaryStatus = legacyRollupStatus(summaryStatus, item.status)
	}
	return map[string]any{
		"type":          "activity-timeline",
		"schemaVersion": 1,
		"runId":         runID,
		"messageId":     messageID,
		"summary": map[string]any{
			"status":       summaryStatus,
			"totalItems":   len(items),
			"visibleItems": len(items),
			"label":        fmt.Sprintf("%d activity item%s", len(items), legacyPluralSuffix(len(items))),
		},
		"groups": groups,
	}
}

func legacyActivityItemMap(item legacyActivityItem, updatedAt int64) map[string]any {
	out := map[string]any{
		"itemId":          item.itemID,
		"groupId":         item.groupID,
		"toolId":          item.toolID,
		"toolName":        item.toolName,
		"kind":            item.kind,
		"renderer":        item.renderer,
		"status":          item.status,
		"severity":        item.severity,
		"label":           item.label,
		"chips":           item.chips,
		"startedAtUnixMs": updatedAt,
		"endedAtUnixMs":   updatedAt,
	}
	if item.description != "" {
		out["description"] = item.description
	}
	if len(item.targetRefs) > 0 {
		out["targetRefs"] = item.targetRefs
	}
	if len(item.payload) > 0 {
		out["payload"] = item.payload
	}
	return out
}

func legacyPresentationForTool(toolName string) (string, string, string) {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return "command", "command", "command"
	case "file.edit", "file.write", "apply_patch":
		return "mutation", "mutation", "file_change"
	case "web.search", "sources":
		return "research", "research", "sources"
	case "knowledge.search":
		return "research", "research", "knowledge"
	case "write_todos":
		return "todo", "todo", "todos"
	case "subagents":
		return "delegation", "delegation", "subagent_group"
	case "ask_user":
		return "interaction", "interaction", "blocking_prompt"
	case "exit_plan_mode", "task_complete":
		return "interaction", "signal", "run_signal"
	case "file.read", "use_skill":
		return "context", "context", "file_context"
	default:
		return "activity", "signal", "run_signal"
	}
}

func legacyActivitySummary(toolName string, args map[string]any, result map[string]any, status string) (string, string) {
	if status == "error" {
		if msg := strings.TrimSpace(fmt.Sprint(result["error"])); msg != "" {
			return legacyHumanToolName(toolName) + " failed", legacyTruncate(msg, 160)
		}
	}
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return "Ran command", legacyTruncate(legacyString(args, "command"), 180)
	case "file.read":
		return "Read " + legacyCompactPath(legacyString(args, "file_path", "filePath")), ""
	case "file.edit":
		return "Edited " + legacyCompactPath(legacyString(args, "file_path", "filePath")), ""
	case "file.write":
		return "Wrote " + legacyCompactPath(legacyString(args, "file_path", "filePath")), ""
	case "apply_patch":
		return "Applied patch", ""
	case "web.search":
		return "Searched the web", legacyTruncate(legacyString(args, "query"), 160)
	case "knowledge.search":
		return "Searched knowledge", legacyTruncate(legacyString(args, "query"), 160)
	case "sources":
		return "Collected sources", ""
	case "write_todos":
		return "Updated todos", ""
	case "subagents":
		return "Managed subagents", legacyString(args, "action")
	case "ask_user":
		return "Input requested", legacyAskQuestionSummary(args, result)
	case "exit_plan_mode":
		return "Mode switch requested", legacyString(args, "summary")
	case "task_complete":
		return "Completion acknowledged", legacyTruncate(legacyString(args, "result"), 180)
	default:
		return legacyHumanToolName(toolName), ""
	}
}

func legacyInteractionPayload(toolName string, args map[string]any, result map[string]any) map[string]any {
	switch strings.TrimSpace(toolName) {
	case "ask_user":
		payload := make(map[string]any, len(args)+len(result))
		for k, v := range args {
			payload[k] = v
		}
		for _, key := range []string{"questions", "source", "reason_code", "required_from_user", "evidence_refs", "interaction_contract", "waiting_prompt", "waiting_user", "summary"} {
			if v, ok := result[key]; ok {
				payload[key] = v
			}
		}
		return payload
	case "exit_plan_mode":
		if prompt, ok := result["waiting_prompt"]; ok {
			return map[string]any{"waiting_prompt": prompt, "waiting_user": result["waiting_user"], "summary": result["summary"]}
		}
	}
	return nil
}

func legacyActivityTarget(toolName string, args map[string]any, _ map[string]any) map[string]any {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		if command := legacyString(args, "command"); command != "" {
			return map[string]any{"kind": "command", "label": legacyTruncate(command, 80)}
		}
	case "file.read", "file.edit", "file.write":
		if path := legacyString(args, "file_path", "filePath"); path != "" {
			return map[string]any{"kind": "file", "label": legacyCompactPath(path), "path": path}
		}
	case "web.search", "knowledge.search":
		if query := legacyString(args, "query"); query != "" {
			return map[string]any{"kind": "query", "label": legacyTruncate(query, 80)}
		}
	}
	return nil
}

func legacyRunID(block map[string]any, result map[string]any) string {
	if id := legacyString(block, "runId", "run_id"); id != "" {
		return id
	}
	outputRef := legacyMap(result["output_ref"])
	if id := legacyString(outputRef, "runId", "run_id"); id != "" {
		return id
	}
	return ""
}

func legacyWaitingUser(result map[string]any) bool {
	switch v := result["waiting_user"].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func legacySeverity(status string, block map[string]any) string {
	if status == "error" {
		return "error"
	}
	if status == "waiting" || legacyBool(block["requiresApproval"], block["requires_approval"]) {
		return "blocking"
	}
	if status == "running" || status == "pending" {
		return "normal"
	}
	return "quiet"
}

func legacyRollupStatus(current string, next string) string {
	rank := map[string]int{"error": 5, "waiting": 4, "running": 3, "pending": 2, "success": 1, "": 0}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func legacyRollupSeverity(current string, next string) string {
	rank := map[string]int{"error": 4, "blocking": 3, "warning": 2, "normal": 1, "quiet": 0, "": 0}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func legacyStatusLabel(status string) string {
	switch strings.TrimSpace(status) {
	case "success":
		return "Done"
	case "error":
		return "Error"
	case "waiting":
		return "Waiting"
	case "running":
		return "Running"
	default:
		return "Pending"
	}
}

func legacyStatusTone(status string) string {
	switch strings.TrimSpace(status) {
	case "success":
		return "success"
	case "error":
		return "error"
	case "waiting":
		return "warning"
	default:
		return "neutral"
	}
}

func legacyGroupTitle(renderer string, count int) string {
	switch strings.TrimSpace(renderer) {
	case "command":
		return legacyPlural("Ran command", "Ran commands", count)
	case "file_change":
		return legacyPlural("Changed file", "Changed files", count)
	case "sources", "knowledge":
		return legacyPlural("Researched source", "Researched sources", count)
	case "todos":
		return "Updated todos"
	case "subagent_group":
		return legacyPlural("Delegated task", "Delegated tasks", count)
	case "blocking_prompt":
		return "Needs input"
	case "file_context":
		return "Explored context"
	default:
		return legacyPlural("Activity", "Activities", count)
	}
}

func legacyAskQuestionSummary(args map[string]any, result map[string]any) string {
	for _, source := range []any{result["questions"], args["questions"]} {
		items, ok := source.([]any)
		if !ok || len(items) == 0 {
			continue
		}
		first, ok := items[0].(map[string]any)
		if !ok {
			continue
		}
		if question := legacyString(first, "question"); question != "" {
			return legacyTruncate(question, 180)
		}
	}
	return ""
}

func legacyString(m map[string]any, keys ...string) string {
	if len(m) == 0 {
		return ""
	}
	for _, key := range keys {
		if value, ok := m[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func legacyMap(value any) map[string]any {
	m, _ := value.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func legacyBool(values ...any) bool {
	for _, value := range values {
		switch v := value.(type) {
		case bool:
			if v {
				return true
			}
		case string:
			if strings.EqualFold(strings.TrimSpace(v), "true") {
				return true
			}
		}
	}
	return false
}

func legacyHumanToolName(toolName string) string {
	parts := strings.Fields(strings.NewReplacer(".", " ", "_", " ").Replace(strings.TrimSpace(toolName)))
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return "Tool"
	}
	return strings.Join(parts, " ")
}

func legacyCompactPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "file"
	}
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return legacyTruncate(path, 80)
	}
	return legacyTruncate(parts[len(parts)-1], 80)
}

func legacyPlural(one string, many string, count int) string {
	if count == 1 {
		return one
	}
	return many
}

func legacyPluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func legacyTruncate(text string, limit int) string {
	text = strings.TrimSpace(text)
	if limit <= 0 || len([]rune(text)) <= limit {
		return text
	}
	runes := []rune(text)
	if limit <= 1 {
		return string(runes[:limit])
	}
	if limit <= 3 {
		return string(runes[:limit])
	}
	return string(runes[:limit-3]) + "..."
}

func marshalLegacyActivityJSON(value any, fallback string) string {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) == 0 {
		return fallback
	}
	return string(raw)
}

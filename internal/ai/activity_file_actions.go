package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/observation"
	"github.com/floegence/redeven/internal/session"
)

var (
	ErrFlowerFileActionInvalid  = errors.New("flower file action is invalid")
	ErrFlowerFileActionNotFound = errors.New("flower file action was not found")
)

type FlowerFileActionOpenRequest struct {
	ThreadID   string `json:"thread_id,omitempty"`
	MessageID  string `json:"message_id"`
	BlockIndex int    `json:"block_index"`
	ItemID     string `json:"item_id"`
	ActionID   string `json:"action_id"`
	Action     string `json:"action"`
}

type FlowerFileActionOpenTarget struct {
	ActionID string `json:"action_id"`
	Action   string `json:"action"`
	Path     string `json:"path"`
}

func (s *Service) ResolveFlowerFileActionOpenTarget(ctx context.Context, meta *session.Meta, req FlowerFileActionOpenRequest) (FlowerFileActionOpenTarget, error) {
	if s == nil {
		return FlowerFileActionOpenTarget{}, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return FlowerFileActionOpenTarget{}, err
	}
	threadID := strings.TrimSpace(req.ThreadID)
	messageID := strings.TrimSpace(req.MessageID)
	itemID := strings.TrimSpace(req.ItemID)
	actionID := strings.TrimSpace(req.ActionID)
	action := strings.TrimSpace(req.Action)
	if action != "preview" && action != "browse_directory" {
		return FlowerFileActionOpenTarget{}, ErrFlowerFileActionInvalid
	}
	if threadID == "" || messageID == "" || req.BlockIndex < 0 || itemID == "" || actionID == "" {
		return FlowerFileActionOpenTarget{}, ErrFlowerFileActionInvalid
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return FlowerFileActionOpenTarget{}, errors.New("missing endpoint_id")
	}
	values, err := s.rawFlowerActionMessageValues(ctx, endpointID, threadID)
	if err != nil {
		return FlowerFileActionOpenTarget{}, err
	}
	target, ok, err := ResolveFlowerFileActionOpenTargetFromMessages(values, req)
	if err != nil {
		return FlowerFileActionOpenTarget{}, err
	}
	if !ok {
		return FlowerFileActionOpenTarget{}, ErrFlowerFileActionNotFound
	}
	return target, nil
}

func (s *Service) rawFlowerActionMessageValues(ctx context.Context, endpointID string, threadID string) ([]any, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	s.mu.Lock()
	state := s.flowerLiveMaterializedStateLocked(endpointID, threadID)
	s.mu.Unlock()
	messages, err := s.buildFlowerTimelineMessages(ctx, endpointID, threadID, state)
	if err != nil {
		return nil, err
	}
	values := make([]any, 0, len(messages))
	for _, message := range messages {
		values = append(values, message)
	}
	return values, nil
}

func SanitizeActivityTimelineMessageJSON(raw string) (json.RawMessage, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var message map[string]any
	if err := json.Unmarshal([]byte(raw), &message); err != nil {
		return nil, fmt.Errorf("parse message JSON: %w", err)
	}
	blocks, _ := message["blocks"].([]any)
	for _, blockValue := range blocks {
		block, ok := blockValue.(map[string]any)
		if !ok || strings.TrimSpace(fmt.Sprint(block["type"])) != activityTimelineBlockType {
			continue
		}
		if err := sanitizeActivityTimelineBlockRecord(block); err != nil {
			return nil, err
		}
	}
	out, err := json.Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("marshal message JSON: %w", err)
	}
	return json.RawMessage(out), nil
}

func SanitizeActivityTimelineBlockJSON(raw json.RawMessage) (json.RawMessage, error) {
	var block map[string]any
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, fmt.Errorf("parse activity timeline block JSON: %w", err)
	}
	if strings.TrimSpace(fmt.Sprint(block["type"])) == activityTimelineBlockType {
		if err := sanitizeActivityTimelineBlockRecord(block); err != nil {
			return nil, err
		}
	}
	out, err := json.Marshal(block)
	if err != nil {
		return nil, fmt.Errorf("marshal activity timeline block JSON: %w", err)
	}
	return json.RawMessage(out), nil
}

func SanitizeActivityTimelineBlockValue(value any) (any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal activity timeline block value: %w", err)
	}
	safe, err := SanitizeActivityTimelineBlockJSON(raw)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(safe, &out); err != nil {
		return nil, fmt.Errorf("decode sanitized activity timeline block: %w", err)
	}
	return out, nil
}

func ResolveFlowerFileActionOpenTargetFromMessages(values []any, req FlowerFileActionOpenRequest) (FlowerFileActionOpenTarget, bool, error) {
	for _, value := range values {
		raw, err := rawMessageBytes(value)
		if err != nil {
			return FlowerFileActionOpenTarget{}, false, err
		}
		var record struct {
			ID     string            `json:"id"`
			Blocks []json.RawMessage `json:"blocks"`
		}
		if err := json.Unmarshal(raw, &record); err != nil {
			return FlowerFileActionOpenTarget{}, false, fmt.Errorf("parse message JSON: %w", err)
		}
		if strings.TrimSpace(record.ID) != strings.TrimSpace(req.MessageID) {
			continue
		}
		if req.BlockIndex < 0 || req.BlockIndex >= len(record.Blocks) {
			return FlowerFileActionOpenTarget{}, false, nil
		}
		target, ok, err := resolveFlowerFileActionOpenTargetFromBlock(record.Blocks[req.BlockIndex], req)
		if err != nil || ok {
			return target, ok, err
		}
		return FlowerFileActionOpenTarget{}, false, nil
	}
	return FlowerFileActionOpenTarget{}, false, nil
}

func rawMessageBytes(value any) ([]byte, error) {
	switch v := value.(type) {
	case json.RawMessage:
		return append([]byte(nil), v...), nil
	case []byte:
		return append([]byte(nil), v...), nil
	case string:
		return []byte(v), nil
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("marshal message JSON: %w", err)
		}
		return b, nil
	}
}

func resolveFlowerFileActionOpenTargetFromBlock(raw json.RawMessage, req FlowerFileActionOpenRequest) (FlowerFileActionOpenTarget, bool, error) {
	var timeline ActivityTimelineBlock
	if err := json.Unmarshal(raw, &timeline); err != nil {
		return FlowerFileActionOpenTarget{}, false, err
	}
	if strings.TrimSpace(timeline.Type) != activityTimelineBlockType {
		return FlowerFileActionOpenTarget{}, false, nil
	}
	if !activityTimelineItemReferencesAction(timeline.Items, req.ItemID, req.ActionID) {
		return FlowerFileActionOpenTarget{}, false, nil
	}
	action := timeline.FileActions[strings.TrimSpace(req.ActionID)]
	if strings.TrimSpace(action.ActionID) != strings.TrimSpace(req.ActionID) {
		return FlowerFileActionOpenTarget{}, false, nil
	}
	path := ""
	switch strings.TrimSpace(req.Action) {
	case "preview":
		path = strings.TrimSpace(action.PreviewPath)
	case "browse_directory":
		path = strings.TrimSpace(action.DirectoryPath)
	}
	if path == "" {
		return FlowerFileActionOpenTarget{}, false, nil
	}
	return FlowerFileActionOpenTarget{
		ActionID: strings.TrimSpace(req.ActionID),
		Action:   strings.TrimSpace(req.Action),
		Path:     path,
	}, true, nil
}

func activityTimelineItemReferencesAction(items []observation.ActivityItem, itemID string, actionID string) bool {
	itemID = strings.TrimSpace(itemID)
	actionID = strings.TrimSpace(actionID)
	if itemID == "" || actionID == "" {
		return false
	}
	for _, item := range items {
		if strings.TrimSpace(item.ItemID) != itemID {
			continue
		}
		if activityPayloadString(item.Payload, "file_action_id") == actionID {
			return true
		}
		for _, mutation := range activityPayloadRecords(item.Payload, "mutations") {
			if activityPayloadString(mutation, "file_action_id") == actionID {
				return true
			}
		}
		return false
	}
	return false
}

func sanitizeActivityTimelineBlockRecord(block map[string]any) error {
	items, _ := block["items"].([]any)
	for _, itemValue := range items {
		item, ok := itemValue.(map[string]any)
		if !ok {
			continue
		}
		item["target_refs"] = sanitizeActivityTargetRefsValue(item["target_refs"])
		if chips := sanitizeActivityChipsValue(item["chips"]); len(chips) > 0 {
			item["chips"] = chips
		} else {
			delete(item, "chips")
		}
		if metadata := sanitizeActivityMetadataValue(item["metadata"]); len(metadata) > 0 {
			item["metadata"] = metadata
		} else {
			delete(item, "metadata")
		}
		renderer := observation.ActivityRenderer(strings.TrimSpace(fmt.Sprint(item["renderer"])))
		toolName := strings.TrimSpace(fmt.Sprint(item["tool_name"]))
		if payload, ok := sanitizeActivityPayloadValue(item["payload"], renderer, toolName); ok {
			item["payload"] = payload
		} else {
			delete(item, "payload")
		}
	}
	actions, ok := block["file_actions"].(map[string]any)
	if !ok || len(actions) == 0 {
		delete(block, "file_actions")
		sanitizeActivityTimelineBlockTopLevel(block)
		return nil
	}
	publicActions := make(map[string]any, len(actions))
	for key, value := range actions {
		record, ok := value.(map[string]any)
		if !ok {
			continue
		}
		actionID := activityMapString(record, "action_id")
		displayName := activityMapString(record, "display_name")
		if strings.TrimSpace(key) == "" || strings.TrimSpace(key) != actionID || actionID == "" || displayName == "" {
			continue
		}
		publicActions[actionID] = map[string]any{
			"action_id":            actionID,
			"display_name":         displayName,
			"can_preview":          activityMapString(record, "preview_path") != "",
			"can_browse_directory": activityMapString(record, "directory_path") != "",
		}
	}
	if len(publicActions) == 0 {
		delete(block, "file_actions")
		sanitizeActivityTimelineBlockTopLevel(block)
		return nil
	}
	block["file_actions"] = publicActions
	sanitizeActivityTimelineBlockTopLevel(block)
	return nil
}

func sanitizeActivityTimelineBlockTopLevel(block map[string]any) {
	allowed := activityTimelineBlockAllowedKeys()
	for key := range block {
		if _, ok := allowed[key]; !ok {
			delete(block, key)
		}
	}
}

func sanitizeActivityTargetRefsValue(value any) []any {
	refs, _ := value.([]any)
	if len(refs) == 0 {
		return nil
	}
	out := make([]any, 0, len(refs))
	for _, refValue := range refs {
		ref, ok := refValue.(map[string]any)
		if !ok {
			continue
		}
		kind := activityMapString(ref, "kind")
		label := activityMapString(ref, "label")
		if kind == "" || label == "" {
			continue
		}
		next := map[string]any{
			"kind":  kind,
			"label": label,
		}
		if uri := activityMapString(ref, "uri"); activityPublicURI(uri) {
			next["uri"] = uri
		}
		if line, ok := activityPublicLineNumber(ref["line"]); ok {
			next["line"] = line
		}
		out = append(out, next)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeActivityChipsValue(value any) []any {
	chips, _ := value.([]any)
	if len(chips) == 0 {
		return nil
	}
	out := make([]any, 0, len(chips))
	for _, chipValue := range chips {
		chip, ok := chipValue.(map[string]any)
		if !ok {
			continue
		}
		kind := activityMapString(chip, "kind")
		label := activityMapString(chip, "label")
		value := activityMapString(chip, "value")
		if kind == "" || label == "" || activityChipForbidden(kind, value) {
			continue
		}
		next := map[string]any{
			"kind":  kind,
			"label": label,
		}
		if value != "" {
			next["value"] = value
		}
		if tone := activityMapString(chip, "tone"); tone != "" {
			next["tone"] = tone
		}
		out = append(out, next)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func activityChipForbidden(kind string, value string) bool {
	switch activityPayloadKeyPolicyToken(kind) {
	case "handle":
		return true
	case "state":
		return strings.TrimSpace(value) == string(observation.ActivityStatusRunning)
	default:
		return false
	}
}

func sanitizeActivityMetadataValue(value any) map[string]any {
	metadata, _ := value.(map[string]any)
	if len(metadata) == 0 {
		return nil
	}
	out := make(map[string]any, len(metadata))
	for key, raw := range metadata {
		key = strings.TrimSpace(key)
		token := activityPayloadKeyPolicyToken(key)
		if key == "" || strings.HasPrefix(token, "pending_") || activityPayloadForbiddenKey(key) {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(raw))
		if text == "" {
			continue
		}
		out[key] = text
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeActivityPayloadValue(value any, renderer observation.ActivityRenderer, toolName string) (map[string]any, bool) {
	payload, ok := value.(map[string]any)
	if !ok || len(payload) == 0 {
		return nil, false
	}
	if strings.TrimSpace(toolName) == "subagents" {
		return sanitizeSubagentsActivityPayloadValue(payload)
	}
	allowed := activityPayloadAllowedKeys(renderer)
	if len(allowed) == 0 {
		return nil, false
	}
	out := make(map[string]any, len(payload))
	for key, item := range payload {
		key = strings.TrimSpace(key)
		if _, ok := allowed[key]; !ok {
			continue
		}
		if key == "mutations" {
			if mutations := sanitizeActivityPayloadMutations(item); len(mutations) > 0 {
				out[key] = mutations
			}
			continue
		}
		out[key] = sanitizeActivityPublicValue(item)
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func sanitizeSubagentsActivityPayloadValue(payload map[string]any) (map[string]any, bool) {
	allowed := activitySubagentsPayloadAllowedKeys()
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		key = strings.TrimSpace(key)
		if _, ok := allowed[key]; !ok {
			continue
		}
		switch key {
		case "items":
			if items := sanitizeSubagentsActivityItems(value); len(items) > 0 {
				out[key] = items
			}
		case "counts":
			if counts := sanitizeSubagentsActivityCounts(value); len(counts) > 0 {
				out[key] = counts
			}
		default:
			out[key] = sanitizeActivityPublicValue(value)
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

func sanitizeSubagentsActivityItems(value any) []any {
	items, _ := value.([]any)
	if len(items) == 0 {
		return nil
	}
	allowed := activitySubagentsItemAllowedKeys()
	out := make([]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		next := sanitizeSubagentsRecordWithAllowedKeys(record, allowed)
		if len(next) > 0 {
			out = append(out, next)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeSubagentsActivityCounts(value any) map[string]any {
	counts, _ := value.(map[string]any)
	if len(counts) == 0 {
		return nil
	}
	allowed := activitySubagentsCountAllowedKeys()
	out := make(map[string]any, len(counts))
	for key, value := range counts {
		key = strings.TrimSpace(key)
		if _, ok := allowed[key]; !ok {
			continue
		}
		out[key] = sanitizeActivityPublicValue(value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeSubagentsRecordWithAllowedKeys(record map[string]any, allowed map[string]struct{}) map[string]any {
	out := make(map[string]any, len(record))
	for key, value := range record {
		key = strings.TrimSpace(key)
		if _, ok := allowed[key]; !ok {
			continue
		}
		out[key] = sanitizeActivityPublicValue(value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeActivityPayloadMutations(value any) []any {
	items, _ := value.([]any)
	if len(items) == 0 {
		return nil
	}
	allowed := activityFileMutationAllowedKeys()
	out := make([]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		next := make(map[string]any, len(record))
		for key, value := range record {
			key = strings.TrimSpace(key)
			if _, ok := allowed[key]; ok {
				next[key] = sanitizeActivityPublicValue(value)
			}
		}
		if len(next) > 0 {
			out = append(out, next)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sanitizeActivityPublicValue(value any) any {
	switch item := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(item))
		for key, nested := range item {
			key = strings.TrimSpace(key)
			if activityPayloadForbiddenKey(key) {
				continue
			}
			out[key] = sanitizeActivityPublicValue(nested)
		}
		return out
	case []any:
		out := make([]any, 0, len(item))
		for _, nested := range item {
			out = append(out, sanitizeActivityPublicValue(nested))
		}
		return out
	default:
		return value
	}
}

func activityPayloadForbiddenKey(key string) bool {
	token := activityPayloadKeyPolicyToken(key)
	if strings.HasPrefix(token, "pending_") {
		return true
	}
	switch token {
	case "action_path", "cwd", "directory_path", "display_path", "file_path", "original_file", "path", "preview_path", "private_path", "root_dir", "stdin", "updated_file", "workdir":
		return true
	default:
		return false
	}
}

func activityPayloadKeyPolicyToken(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	var out strings.Builder
	out.Grow(len(key) + 4)
	previousUnderscore := false
	for index, r := range key {
		switch {
		case r >= 'A' && r <= 'Z':
			if index > 0 && !previousUnderscore {
				out.WriteByte('_')
			}
			out.WriteRune(r + ('a' - 'A'))
			previousUnderscore = false
		case r == '-' || r == '.' || r == ':':
			if !previousUnderscore {
				out.WriteByte('_')
				previousUnderscore = true
			}
		default:
			out.WriteRune(r)
			previousUnderscore = r == '_'
		}
	}
	return strings.Trim(out.String(), "_")
}

func activityPayloadAllowedKeys(renderer observation.ActivityRenderer) map[string]struct{} {
	switch renderer {
	case observation.ActivityRendererTerminal:
		return stringSet("command", "description", "process_id", "execution_location", "output", "first_seq", "last_seq", "latest_seq", "has_more", "total_bytes", "started_at_ms", "ended_at_ms", "exit_code", "duration_ms", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererFile:
		return stringSet("operation", "display_name", "file_action_id", "content", "line_offset", "line_count", "total_lines", "change_type", "additions", "deletions", "unified_diff", "diff_unavailable_reason", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererPatch:
		return stringSet("operation", "files_changed", "hunks", "additions", "deletions", "input_format", "normalized_format", "mutations", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererTodos:
		return stringSet("todos", "counts", "result", "args", "expected_version", "explanation", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererWebSearch:
		return stringSet("query", "provider", "count", "sources", "results", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererQuestion:
		return stringSet("reason_code", "required_from_user", "questions", "contains_secret", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererCompletion:
		return stringSet("result", "evidence_refs", "remaining_risks", "next_actions", "truncated", "summary", "details", "status", "error", "content_ref")
	case observation.ActivityRendererStructured:
		return stringSet(
			"operation", "query", "count", "provider", "name", "action", "limit",
			"data", "result", "content", "content_ref", "activation_id", "already_active",
			"permission_hints", "dependencies", "dependency_degraded", "reason", "id",
			"status", "message", "timed_out", "targets", "stats", "output", "structured",
			"key_files", "rows", "cards", "items", "thread_id",
			"parent_thread_id", "parent_turn_id", "task_name", "task_description",
			"title", "agent_type", "context_mode", "okf_version", "total_sections",
			"sections", "filters", "total_concepts", "total_matches", "match_count",
			"max_results", "has_more", "matches", "concept_title", "concept",
			"body_offset", "body_length", "returned_body_length", "link_count",
			"backlink_count", "links", "backlinks", "queued_inputs", "started_at_ms",
			"updated_at_ms", "created_at_ms", "closed", "can_open", "agent_count",
			"target", "target_ids", "requested_ids", "requested_count", "found_count",
			"missing_count", "missing_ids", "closed_count", "affected_ids", "accepted",
			"running_only", "total", "scope", "evidence_refs", "remaining_risks",
			"next_actions", "truncated", "omitted_count", "summary", "details", "error",
		)
	default:
		return nil
	}
}

func activitySubagentsPayloadAllowedKeys() map[string]struct{} {
	return stringSet(
		"action", "status", "thread_id", "parent_thread_id", "parent_turn_id",
		"task_name", "task_description", "agent_type", "items", "counts",
		"started_at_ms", "created_at_ms", "updated_at_ms", "closed",
		"agent_count", "requested_count", "found_count",
		"missing_count", "closed_count", "stopped_count", "accepted", "running_only",
		"total", "timed_out", "truncated", "omitted_count", "error",
	)
}

func activityTimelineBlockAllowedKeys() map[string]struct{} {
	return stringSet("type", "schema_version", "run_id", "thread_id", "turn_id", "trace_id", "summary", "items", "file_actions")
}

func activitySubagentsItemAllowedKeys() map[string]struct{} {
	return stringSet("thread_id", "parent_thread_id", "parent_turn_id", "task_name", "task_description", "agent_type", "status", "started_at_ms", "created_at_ms", "updated_at_ms", "closed")
}

func activitySubagentsCountAllowedKeys() map[string]struct{} {
	return stringSet("queued", "running", "waiting_input", "waiting", "completed", "failed", "canceled", "cancelled", "timed_out", "total")
}

func activityFileMutationAllowedKeys() map[string]struct{} {
	return stringSet("display_name", "file_action_id", "change_type", "additions", "deletions", "unified_diff", "diff_unavailable_reason", "truncated")
}

func stringSet(values ...string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		out[value] = struct{}{}
	}
	return out
}

func activityMapString(record map[string]any, key string) string {
	value, ok := record[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func activityPublicURI(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "artifact://")
}

func activityPublicLineNumber(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		if typed >= 0 {
			return typed, true
		}
	case int64:
		if typed >= 0 {
			return int(typed), true
		}
	case float64:
		line := int(typed)
		if typed >= 0 && typed == float64(line) {
			return line, true
		}
	}
	return 0, false
}

package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type ForkThreadRequest struct {
	EndpointID            string
	SourceThreadID        string
	DestinationThreadID   string
	Title                 string
	CreatedByUserPublicID string
	CreatedByUserEmail    string
	CreatedAtUnixMs       int64
}

func (s *Store) ForkThread(ctx context.Context, req ForkThreadRequest) (*Thread, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req.EndpointID = strings.TrimSpace(req.EndpointID)
	req.SourceThreadID = strings.TrimSpace(req.SourceThreadID)
	req.DestinationThreadID = strings.TrimSpace(req.DestinationThreadID)
	req.Title = strings.TrimSpace(req.Title)
	req.CreatedByUserPublicID = strings.TrimSpace(req.CreatedByUserPublicID)
	req.CreatedByUserEmail = strings.TrimSpace(req.CreatedByUserEmail)
	if req.EndpointID == "" || req.SourceThreadID == "" || req.DestinationThreadID == "" {
		return nil, errors.New("invalid fork request")
	}
	if req.SourceThreadID == req.DestinationThreadID {
		return nil, errors.New("fork destination must differ from source")
	}
	if len(req.Title) > 200 {
		return nil, errors.New("title too long")
	}
	if req.CreatedAtUnixMs <= 0 {
		req.CreatedAtUnixMs = time.Now().UnixMilli()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var source Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), req.EndpointID, req.SourceThreadID), &source); err != nil {
		return nil, err
	}
	title := req.Title
	if title == "" {
		title = strings.TrimSpace(source.Title)
	}
	if err := insertForkedThreadTx(ctx, tx, req, source, title); err != nil {
		return nil, err
	}
	messageIDMap, err := copyForkTranscriptMessagesTx(ctx, tx, req)
	if err != nil {
		return nil, err
	}
	turnRowIDMap, err := copyForkConversationTurnsTx(ctx, tx, req, messageIDMap)
	if err != nil {
		return nil, err
	}
	if err := copyForkStructuredInputsTx(ctx, tx, req, messageIDMap); err != nil {
		return nil, err
	}
	if err := copyForkThreadTodosTx(ctx, tx, req); err != nil {
		return nil, err
	}
	if err := copyForkMemoryItemsTx(ctx, tx, req, messageIDMap); err != nil {
		return nil, err
	}
	if err := copyForkContextSnapshotsTx(ctx, tx, req, turnRowIDMap); err != nil {
		return nil, err
	}
	if err := copyForkUploadRefsTx(ctx, tx, req, messageIDMap); err != nil {
		return nil, err
	}
	if err := copyForkFlowerMetadataTx(ctx, tx, req); err != nil {
		return nil, err
	}

	var out Thread
	if err := scanThreadRow(tx.QueryRowContext(ctx, fmt.Sprintf(`
SELECT
%s
FROM ai_threads
WHERE endpoint_id = ? AND thread_id = ?
`, threadSelectColumnsSQL), req.EndpointID, req.DestinationThreadID), &out); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &out, nil
}

func insertForkedThreadTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, source Thread, title string) error {
	forkedThread := Thread{
		ThreadID:               req.DestinationThreadID,
		EndpointID:             req.EndpointID,
		NamespacePublicID:      strings.TrimSpace(source.NamespacePublicID),
		ModelID:                strings.TrimSpace(source.ModelID),
		ModelLocked:            source.ModelLocked,
		ReasoningSelectionJSON: strings.TrimSpace(source.ReasoningSelectionJSON),
		ExecutionMode:          normalizeExecutionMode(source.ExecutionMode),
		WorkingDir:             strings.TrimSpace(source.WorkingDir),
		Title:                  title,
		TitleSource:            ThreadTitleSourceUser,
		RunStatus:              "idle",
		CreatedByUserPublicID:  req.CreatedByUserPublicID,
		CreatedByUserEmail:     req.CreatedByUserEmail,
		UpdatedByUserPublicID:  req.CreatedByUserPublicID,
		UpdatedByUserEmail:     req.CreatedByUserEmail,
		CreatedAtUnixMs:        req.CreatedAtUnixMs,
		UpdatedAtUnixMs:        req.CreatedAtUnixMs,
		LastMessageAtUnixMs:    source.LastMessageAtUnixMs,
		LastMessagePreview:     strings.TrimSpace(source.LastMessagePreview),
	}
	snapshot := initialFlowerActivitySnapshot(forkedThread)
	_, err := tx.ExecContext(ctx, `
INSERT INTO ai_threads(
  thread_id, endpoint_id, namespace_public_id, model_id, model_locked, reasoning_selection_json, execution_mode, working_dir, title,
  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
  run_status, run_updated_at_unix_ms, run_error_code, run_error,
  waiting_user_input_json, last_context_run_id,
  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms,
  last_message_at_unix_ms, last_message_preview, pinned_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		forkedThread.ThreadID,
		forkedThread.EndpointID,
		forkedThread.NamespacePublicID,
		forkedThread.ModelID,
		boolToInt(forkedThread.ModelLocked),
		forkedThread.ReasoningSelectionJSON,
		forkedThread.ExecutionMode,
		forkedThread.WorkingDir,
		forkedThread.Title,
		forkedThread.TitleSource,
		int64(0),
		"",
		"",
		"",
		forkedThread.RunStatus,
		int64(0),
		"",
		"",
		"",
		"",
		snapshot.ActivityRevision,
		snapshot.ActivitySignature,
		snapshot.WaitingPromptID,
		forkedThread.CreatedByUserPublicID,
		forkedThread.CreatedByUserEmail,
		forkedThread.UpdatedByUserPublicID,
		forkedThread.UpdatedByUserEmail,
		forkedThread.CreatedAtUnixMs,
		forkedThread.UpdatedAtUnixMs,
		forkedThread.LastMessageAtUnixMs,
		forkedThread.LastMessagePreview,
		int64(0),
	)
	return err
}

func copyForkTranscriptMessagesTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) (map[string]string, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT id, message_id, role, author_user_public_id, author_user_email,
       status, created_at_unix_ms, updated_at_unix_ms,
       text_content, message_json
FROM transcript_messages
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type sourceMessage struct {
		ID                 int64
		MessageID          string
		Role               string
		AuthorUserPublicID string
		AuthorUserEmail    string
		Status             string
		CreatedAtUnixMs    int64
		UpdatedAtUnixMs    int64
		TextContent        string
		MessageJSON        string
	}
	messages := make([]sourceMessage, 0)
	messageIDMap := map[string]string{}
	index := 0
	for rows.Next() {
		var rec sourceMessage
		if err := rows.Scan(
			&rec.ID,
			&rec.MessageID,
			&rec.Role,
			&rec.AuthorUserPublicID,
			&rec.AuthorUserEmail,
			&rec.Status,
			&rec.CreatedAtUnixMs,
			&rec.UpdatedAtUnixMs,
			&rec.TextContent,
			&rec.MessageJSON,
		); err != nil {
			return nil, err
		}
		rec.MessageID = strings.TrimSpace(rec.MessageID)
		if rec.MessageID == "" {
			continue
		}
		index++
		messageIDMap[rec.MessageID] = forkScopedID("msg", req.DestinationThreadID, index)
		messages = append(messages, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	transcriptIDMap := map[string]string{}
	for key, value := range messageIDMap {
		transcriptIDMap[key] = value
	}
	transcriptIDMap[req.SourceThreadID] = req.DestinationThreadID

	for _, rec := range messages {
		nextMessageID := messageIDMap[rec.MessageID]
		body, err := rewriteMessageJSONForFork(rec.MessageJSON, transcriptIDMap)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO transcript_messages(
  thread_id, endpoint_id, message_id, role,
  author_user_public_id, author_user_email,
  status, created_at_unix_ms, updated_at_unix_ms,
  text_content, message_json
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.DestinationThreadID, req.EndpointID, nextMessageID, strings.TrimSpace(rec.Role), strings.TrimSpace(rec.AuthorUserPublicID), strings.TrimSpace(rec.AuthorUserEmail), strings.TrimSpace(rec.Status), rec.CreatedAtUnixMs, rec.UpdatedAtUnixMs, strings.TrimSpace(rec.TextContent), body); err != nil {
			return nil, err
		}
	}
	return messageIDMap, nil
}

func copyForkConversationTurnsTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, messageIDMap map[string]string) (map[int64]int64, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT id, user_message_id, assistant_message_id, created_at_unix_ms
FROM conversation_turns
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	index := 0
	turnRowIDMap := map[int64]int64{}
	for rows.Next() {
		var id int64
		var userMessageID string
		var assistantMessageID string
		var createdAt int64
		if err := rows.Scan(&id, &userMessageID, &assistantMessageID, &createdAt); err != nil {
			return nil, err
		}
		index++
		res, err := tx.ExecContext(ctx, `
INSERT INTO conversation_turns(turn_id, endpoint_id, thread_id, run_id, user_message_id, assistant_message_id, created_at_unix_ms)
VALUES(?, ?, ?, '', ?, ?, ?)
`, forkScopedID("turn", req.DestinationThreadID, index), req.EndpointID, req.DestinationThreadID, mappedForkID(userMessageID, messageIDMap), mappedForkID(assistantMessageID, messageIDMap), createdAt)
		if err != nil {
			return nil, err
		}
		nextID, err := res.LastInsertId()
		if err != nil {
			return nil, err
		}
		turnRowIDMap[id] = nextID
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return turnRowIDMap, nil
}

func copyForkStructuredInputsTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, messageIDMap map[string]string) error {
	rows, err := tx.QueryContext(ctx, `
SELECT response_message_id, prompt_id, tool_id, reason_code, question_id, header, question_text,
       selected_choice_id, selected_choice_label, response_text, public_summary, contains_secret, created_at_unix_ms
FROM structured_user_inputs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var responseMessageID string
		var promptID string
		var toolID string
		var reasonCode string
		var questionID string
		var header string
		var questionText string
		var selectedChoiceID string
		var selectedChoiceLabel string
		var responseText string
		var publicSummary string
		var containsSecret int
		var createdAt int64
		if err := rows.Scan(&responseMessageID, &promptID, &toolID, &reasonCode, &questionID, &header, &questionText, &selectedChoiceID, &selectedChoiceLabel, &responseText, &publicSummary, &containsSecret, &createdAt); err != nil {
			return err
		}
		nextResponseID := mappedForkID(responseMessageID, messageIDMap)
		if strings.TrimSpace(nextResponseID) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO structured_user_inputs(
  endpoint_id, thread_id, response_message_id,
  prompt_id, tool_id, reason_code, question_id, header, question_text,
  selected_choice_id, selected_choice_label, response_text, public_summary, contains_secret, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, req.EndpointID, req.DestinationThreadID, nextResponseID, strings.TrimSpace(promptID), strings.TrimSpace(toolID), strings.TrimSpace(reasonCode), strings.TrimSpace(questionID), strings.TrimSpace(header), strings.TrimSpace(questionText), strings.TrimSpace(selectedChoiceID), strings.TrimSpace(selectedChoiceLabel), strings.TrimSpace(responseText), strings.TrimSpace(publicSummary), containsSecret, createdAt); err != nil {
			return err
		}
	}
	return rows.Err()
}

func copyForkThreadTodosTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO ai_thread_todos(
  endpoint_id, thread_id, version, todos_json, updated_at_unix_ms, updated_by_run_id, updated_by_tool_id
)
SELECT endpoint_id, ?, version, todos_json, updated_at_unix_ms, '', ''
FROM ai_thread_todos
WHERE endpoint_id = ? AND thread_id = ?
`, req.DestinationThreadID, req.EndpointID, req.SourceThreadID)
	return err
}

func copyForkMemoryItemsTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, messageIDMap map[string]string) error {
	rows, err := tx.QueryContext(ctx, `
SELECT memory_id, scope, kind, content, source_refs_json, importance, freshness, confidence, created_at_unix_ms, updated_at_unix_ms
FROM memory_items
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY updated_at_unix_ms ASC, memory_id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return err
	}
	defer rows.Close()

	index := 0
	for rows.Next() {
		var memoryID string
		var scope string
		var kind string
		var content string
		var sourceRefsJSON string
		var importance float64
		var freshness float64
		var confidence float64
		var createdAt int64
		var updatedAt int64
		if err := rows.Scan(&memoryID, &scope, &kind, &content, &sourceRefsJSON, &importance, &freshness, &confidence, &createdAt, &updatedAt); err != nil {
			return err
		}
		index++
		memoryID = forkMemoryID(req, memoryID, index)
		sourceRefsJSON = rewriteOptionalJSONStrings(sourceRefsJSON, messageIDMap)
		if _, err := tx.ExecContext(ctx, `
INSERT INTO memory_items(
  memory_id, endpoint_id, thread_id,
  scope, kind, content, source_refs_json,
  importance, freshness, confidence,
  created_at_unix_ms, updated_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, memoryID, req.EndpointID, req.DestinationThreadID, normalizeScope(scope), normalizeMemoryKind(kind), strings.TrimSpace(content), sourceRefsJSON, importance, freshness, confidence, createdAt, updatedAt); err != nil {
			return err
		}
	}
	return rows.Err()
}

func copyForkContextSnapshotsTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, turnRowIDMap map[int64]int64) error {
	rows, err := tx.QueryContext(ctx, `
SELECT snapshot_id, level, summary_text, covers_turn_from_id, covers_turn_to_id, quality_score, created_at_unix_ms
FROM context_snapshots
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY created_at_unix_ms ASC, snapshot_id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return err
	}
	defer rows.Close()

	index := 0
	for rows.Next() {
		var snapshotID string
		var level string
		var summaryText string
		var coversFrom int64
		var coversTo int64
		var quality float64
		var createdAt int64
		if err := rows.Scan(&snapshotID, &level, &summaryText, &coversFrom, &coversTo, &quality, &createdAt); err != nil {
			return err
		}
		index++
		coversFrom = mappedForkRowID(coversFrom, turnRowIDMap)
		coversTo = mappedForkRowID(coversTo, turnRowIDMap)
		if _, err := tx.ExecContext(ctx, `
INSERT INTO context_snapshots(
  snapshot_id, endpoint_id, thread_id,
  level, summary_text,
  covers_turn_from_id, covers_turn_to_id,
  quality_score, created_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
`, forkScopedID("snap", req.DestinationThreadID, index), req.EndpointID, req.DestinationThreadID, normalizeSnapshotLevel(level), strings.TrimSpace(summaryText), coversFrom, coversTo, quality, createdAt); err != nil {
			return err
		}
	}
	return rows.Err()
}

func copyForkUploadRefsTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, messageIDMap map[string]string) error {
	rows, err := tx.QueryContext(ctx, `
SELECT upload_id, ref_kind, ref_id, created_at_unix_ms
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ?
ORDER BY id ASC
`, req.EndpointID, req.SourceThreadID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var uploadID string
		var refKind string
		var refID string
		var createdAt int64
		if err := rows.Scan(&uploadID, &refKind, &refID, &createdAt); err != nil {
			return err
		}
		nextRefID := mappedForkID(refID, messageIDMap)
		if strings.TrimSpace(nextRefID) == "" || nextRefID == strings.TrimSpace(refID) {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
VALUES(?, ?, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
`, req.EndpointID, strings.TrimSpace(uploadID), req.DestinationThreadID, normalizeUploadRefKind(refKind), nextRefID, createdAt); err != nil {
			return err
		}
	}
	return rows.Err()
}

func copyForkFlowerMetadataTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest) error {
	_, err := tx.ExecContext(ctx, `
INSERT INTO ai_flower_thread_metadata(
  endpoint_id, thread_id, owner_kind, owner_id, parent_thread_id, parent_run_id,
  context_json, action_json, updated_at_unix_ms, home_runtime_id, home_runtime_kind,
  origin_env_public_id, primary_target_id, active_target_ids_json
)
SELECT endpoint_id, ?, owner_kind, owner_id, ?, '',
       context_json, action_json, ?, home_runtime_id, home_runtime_kind,
       origin_env_public_id, primary_target_id, active_target_ids_json
FROM ai_flower_thread_metadata
WHERE endpoint_id = ? AND thread_id = ?
`, req.DestinationThreadID, req.SourceThreadID, req.CreatedAtUnixMs, req.EndpointID, req.SourceThreadID)
	return err
}

func forkMemoryID(req ForkThreadRequest, sourceMemoryID string, index int) string {
	sourceMemoryID = strings.TrimSpace(sourceMemoryID)
	openGoalSourceID := openGoalMemoryPrefix + req.EndpointID + "::" + req.SourceThreadID
	if sourceMemoryID == openGoalSourceID {
		return openGoalMemoryPrefix + req.EndpointID + "::" + req.DestinationThreadID
	}
	return forkScopedID("mem", req.DestinationThreadID, index)
}

func forkScopedID(kind string, threadID string, index int) string {
	return fmt.Sprintf("fork_%s_%s_%d", sanitizeForkIDPart(kind), sanitizeForkIDPart(threadID), index)
}

func sanitizeForkIDPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "item"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '_' || r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if len(out) > 80 {
		out = out[:80]
	}
	if out == "" {
		return "item"
	}
	return out
}

func mappedForkID(sourceID string, replacements map[string]string) string {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return ""
	}
	if next := strings.TrimSpace(replacements[sourceID]); next != "" {
		return next
	}
	return sourceID
}

func mappedForkRowID(sourceID int64, replacements map[int64]int64) int64 {
	if sourceID <= 0 {
		return 0
	}
	if next := replacements[sourceID]; next > 0 {
		return next
	}
	return 0
}

func rewriteMessageJSONForFork(raw string, replacements map[string]string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("empty message json")
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", err
	}
	value = rewriteMessageEnvelopeForFork(value, replacements)
	body, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func rewriteOptionalJSONStrings(raw string, replacements map[string]string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(replacements) == 0 {
		if raw == "" {
			return "[]"
		}
		return raw
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return raw
	}
	value = rewriteJSONIDReferences(value, replacements)
	body, err := json.Marshal(value)
	if err != nil {
		return raw
	}
	return string(body)
}

func rewriteMessageEnvelopeForFork(value any, replacements map[string]string) any {
	message, ok := value.(map[string]any)
	if !ok {
		return value
	}
	rewriteForkMessageIDFields(message, replacements, shouldRewriteForkMessageEnvelopeKey)
	if blocks, ok := message["blocks"].([]any); ok {
		for _, item := range blocks {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			rewriteForkMessageIDFields(block, replacements, shouldRewriteForkMessageBlockKey)
		}
	}
	return message
}

func rewriteForkMessageIDFields(obj map[string]any, replacements map[string]string, allow func(string) bool) {
	for key, item := range obj {
		if !allow(key) {
			continue
		}
		if raw, ok := item.(string); ok {
			obj[key] = mappedForkID(raw, replacements)
		}
	}
}

func rewriteJSONIDReferences(value any, replacements map[string]string) any {
	switch typed := value.(type) {
	case []any:
		for i, item := range typed {
			typed[i] = rewriteJSONIDReferences(item, replacements)
		}
		return typed
	case map[string]any:
		for key, item := range typed {
			if shouldRewriteForkMessageRefKey(key) {
				if raw, ok := item.(string); ok {
					typed[key] = mappedForkID(raw, replacements)
					continue
				}
			}
			typed[key] = rewriteJSONIDReferences(item, replacements)
		}
		return typed
	default:
		return value
	}
}

func shouldRewriteForkMessageEnvelopeKey(key string) bool {
	switch strings.TrimSpace(key) {
	case "id", "message_id", "messageId", "reply_to", "replyTo", "parent_message_id", "parentMessageId", "previous_message_id", "previousMessageId", "source_message_id", "sourceMessageId":
		return true
	default:
		return shouldRewriteForkMessageRefKey(key)
	}
}

func shouldRewriteForkMessageBlockKey(key string) bool {
	switch strings.TrimSpace(key) {
	case "message_id", "messageId", "thread_id", "turn_id":
		return true
	default:
		return shouldRewriteForkMessageRefKey(key)
	}
}

func shouldRewriteForkMessageRefKey(key string) bool {
	switch strings.TrimSpace(key) {
	case "message_id", "messageId", "response_message_id", "responseMessageId", "user_message_id", "userMessageId", "assistant_message_id", "assistantMessageId":
		return true
	default:
		return false
	}
}

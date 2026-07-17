package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type ForkThreadRequest struct {
	OperationID           string
	EndpointID            string
	SourceThreadID        string
	DestinationThreadID   string
	Title                 string
	CreatedByUserPublicID string
	CreatedByUserEmail    string
	CreatedAtUnixMs       int64
}

type ForkTurnRef struct {
	SourceTurnID      string
	SourceRunID       string
	DestinationTurnID string
	DestinationRunID  string
	CreatedAtUnixMs   int64
}

func insertForkedThreadTx(ctx context.Context, tx *sql.Tx, req ForkThreadRequest, source Thread, title string) error {
	forkedThread := Thread{
		ThreadID:               req.DestinationThreadID,
		EndpointID:             req.EndpointID,
		NamespacePublicID:      strings.TrimSpace(source.NamespacePublicID),
		ModelID:                strings.TrimSpace(source.ModelID),
		ReasoningSelectionJSON: strings.TrimSpace(source.ReasoningSelectionJSON),
		PermissionType:         normalizePermissionType(source.PermissionType),
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
  thread_id, endpoint_id, namespace_public_id, model_id, reasoning_selection_json, permission_type, working_dir, title,
  title_source, title_generated_at_unix_ms, title_input_message_id, title_model_id, title_prompt_version,
  run_status, run_updated_at_unix_ms, run_error_code, run_error,
  waiting_user_input_json,
  flower_activity_revision, flower_activity_signature, flower_activity_waiting_prompt_id,
  created_by_user_public_id, created_by_user_email,
  updated_by_user_public_id, updated_by_user_email,
  created_at_unix_ms, updated_at_unix_ms,
  last_message_at_unix_ms, last_message_preview, pinned_at_unix_ms
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
		forkedThread.ThreadID,
		forkedThread.EndpointID,
		forkedThread.NamespacePublicID,
		forkedThread.ModelID,
		forkedThread.ReasoningSelectionJSON,
		forkedThread.PermissionType,
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

func forkTurnRefsBySource(refs []ForkTurnRef) (map[string]ForkTurnRef, error) {
	out := make(map[string]ForkTurnRef, len(refs))
	destinationTurns := make(map[string]struct{}, len(refs))
	destinationRuns := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		ref.SourceTurnID = strings.TrimSpace(ref.SourceTurnID)
		ref.SourceRunID = strings.TrimSpace(ref.SourceRunID)
		ref.DestinationTurnID = strings.TrimSpace(ref.DestinationTurnID)
		ref.DestinationRunID = strings.TrimSpace(ref.DestinationRunID)
		if ref.SourceTurnID == "" || ref.DestinationTurnID == "" {
			return nil, fmt.Errorf("%w: incomplete Floret turn mapping", ErrForkResultConflict)
		}
		if (ref.SourceRunID == "") != (ref.DestinationRunID == "") {
			return nil, fmt.Errorf("%w: incomplete Floret run mapping for turn %q", ErrForkResultConflict, ref.SourceTurnID)
		}
		if _, exists := out[ref.SourceTurnID]; exists {
			return nil, fmt.Errorf("%w: duplicate source turn mapping %q", ErrForkResultConflict, ref.SourceTurnID)
		}
		if _, exists := destinationTurns[ref.DestinationTurnID]; exists {
			return nil, fmt.Errorf("%w: duplicate destination turn mapping %q", ErrForkResultConflict, ref.DestinationTurnID)
		}
		if ref.DestinationRunID != "" {
			if _, exists := destinationRuns[ref.DestinationRunID]; exists {
				return nil, fmt.Errorf("%w: duplicate destination run mapping %q", ErrForkResultConflict, ref.DestinationRunID)
			}
			destinationRuns[ref.DestinationRunID] = struct{}{}
		}
		out[ref.SourceTurnID] = ref
		destinationTurns[ref.DestinationTurnID] = struct{}{}
	}
	return out, nil
}

func forkTurnRefFor(refs map[string]ForkTurnRef, turnID string, runID string) (ForkTurnRef, error) {
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return ForkTurnRef{}, fmt.Errorf("%w: source turn identity is empty", ErrForkResultConflict)
	}
	ref, ok := refs[turnID]
	if !ok {
		return ForkTurnRef{}, fmt.Errorf("%w: missing Floret mapping for source turn %q", ErrForkResultConflict, turnID)
	}
	if ref.SourceRunID != strings.TrimSpace(runID) {
		return ForkTurnRef{}, fmt.Errorf("%w: source run mapping mismatch for turn %q", ErrForkResultConflict, turnID)
	}
	return ref, nil
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
	case "message_id", "messageId", "thread_id", "threadId", "turn_id", "turnId", "run_id", "runId", "trace_id", "traceId":
		return true
	default:
		return shouldRewriteForkMessageRefKey(key)
	}
}

func shouldRewriteForkMessageRefKey(key string) bool {
	switch strings.TrimSpace(key) {
	case "message_id", "messageId", "response_message_id", "responseMessageId", "user_message_id", "userMessageId", "assistant_message_id", "assistantMessageId", "thread_id", "threadId", "turn_id", "turnId", "run_id", "runId", "trace_id", "traceId":
		return true
	default:
		return false
	}
}

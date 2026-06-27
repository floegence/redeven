package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

var ErrRunChanged = errors.New("run changed")
var ErrWaitingPromptChanged = errors.New("waiting prompt changed")
var ErrWaitingUserQueueConflict = errors.New("waiting-user queue request conflicts with waiting response")
var ErrFollowupsRevisionChanged = errors.New("followups revision changed")
var ErrInvalidFollowupLane = errors.New("invalid followup lane")
var ErrReadOnlyThread = errors.New("thread is read only")
var ErrCompactAlreadyPending = errors.New("context compaction already pending")
var ErrNoCompactableContext = errors.New("no compactable context")

const compactThreadContextSourceSlashCommand = "slash_command"

type SendUserTurnRequest struct {
	ThreadID              string     `json:"thread_id"`
	Model                 string     `json:"model,omitempty"`
	Input                 RunInput   `json:"input"`
	Options               RunOptions `json:"options"`
	ExpectedRunID         string     `json:"expected_run_id,omitempty"`
	QueueAfterWaitingUser bool       `json:"queue_after_waiting_user,omitempty"`
	SourceFollowupID      string     `json:"source_followup_id,omitempty"`
}

type SendUserTurnResponse struct {
	RunID                   string `json:"run_id"`
	Kind                    string `json:"kind"` // "start" | "queued"
	QueueID                 string `json:"queue_id,omitempty"`
	QueuePosition           int    `json:"queue_position,omitempty"`
	ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string `json:"applied_permission_type,omitempty"`
}

type CompactThreadContextRequest struct {
	ThreadID    string `json:"thread_id"`
	ActiveRunID string `json:"active_run_id,omitempty"`
}

type CompactThreadContextResponse struct {
	OperationID string `json:"operation_id,omitempty"`
	Kind        string `json:"kind"`
	ErrorCode   string `json:"error_code,omitempty"`
}

type persistedUserMessage struct {
	MessageID       string
	RowID           int64
	MessageJSON     string
	CreatedAtUnixMs int64
}

type preparedUserMessage struct {
	Message          threadstore.Message
	UploadIDs        []string
	StructuredInputs []threadstore.StructuredUserInputRecord
	SecretAnswers    []threadstore.RequestUserInputSecretAnswerRecord
}

func (s *Service) SendUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if s == nil {
		return SendUserTurnResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SendUserTurnResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return SendUserTurnResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return SendUserTurnResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return SendUserTurnResponse{}, errors.New("thread actor not ready")
	}
	return actor.SendUserTurn(ctx, meta, req)
}

func (s *Service) CompactThreadContext(ctx context.Context, meta *session.Meta, req CompactThreadContextRequest) (CompactThreadContextResponse, error) {
	if s == nil {
		return CompactThreadContextResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return CompactThreadContextResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return CompactThreadContextResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return CompactThreadContextResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return CompactThreadContextResponse{}, errors.New("thread actor not ready")
	}
	return actor.CompactThreadContext(ctx, meta, req)
}

func (s *Service) SubmitRequestUserInputResponse(ctx context.Context, meta *session.Meta, req SubmitRequestUserInputResponseRequest) (SubmitRequestUserInputResponseResponse, error) {
	if s == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return SubmitRequestUserInputResponseResponse{}, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	if endpointID == "" || threadID == "" {
		return SubmitRequestUserInputResponseResponse{}, errors.New("invalid request")
	}
	if s.threadMgr == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread manager not ready")
	}
	actor := s.threadMgr.Get(endpointID, threadID)
	if actor == nil {
		return SubmitRequestUserInputResponseResponse{}, errors.New("thread actor not ready")
	}
	return actor.SubmitRequestUserInputResponse(ctx, meta, req)
}

func isSafeClientMessageID(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	if len(raw) > 128 {
		return false
	}
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		switch {
		case ch >= 'a' && ch <= 'z':
			continue
		case ch >= 'A' && ch <= 'Z':
			continue
		case ch >= '0' && ch <= '9':
			continue
		case ch == '_' || ch == '-':
			continue
		default:
			return false
		}
	}
	return true
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(err.Error()))
	if msg == "" {
		return false
	}
	if strings.Contains(msg, "unique constraint failed") {
		return true
	}
	return strings.Contains(msg, "constraint failed") && strings.Contains(msg, "unique")
}

func (s *Service) prepareUserMessage(ctx context.Context, meta *session.Meta, endpointID string, threadID string, input RunInput) (preparedUserMessage, RunInput, error) {
	if s == nil {
		return preparedUserMessage{}, input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if meta == nil || endpointID == "" || threadID == "" {
		return preparedUserMessage{}, input, errors.New("invalid request")
	}

	messageID := strings.TrimSpace(input.MessageID)
	if messageID != "" && !isSafeClientMessageID(messageID) {
		messageID = ""
	}
	if messageID == "" {
		id, err := newUserMessageID()
		if err != nil {
			return preparedUserMessage{}, input, err
		}
		messageID = id
	}
	input.MessageID = messageID
	input, uploadInfoByURL, uploadIDs, err := s.normalizeInputAttachments(ctx, endpointID, input)
	if err != nil {
		return preparedUserMessage{}, input, err
	}

	now := time.Now().UnixMilli()
	userJSON, userText, err := buildUserMessageJSON(messageID, input, uploadInfoByURL, now)
	if err != nil {
		return preparedUserMessage{}, input, err
	}
	structured, secretRecords := structuredUserInputRecords(endpointID, threadID, messageID, input, now)
	return preparedUserMessage{
		Message: threadstore.Message{
			ThreadID:           threadID,
			EndpointID:         endpointID,
			MessageID:          messageID,
			Role:               "user",
			AuthorUserPublicID: strings.TrimSpace(meta.UserPublicID),
			AuthorUserEmail:    strings.TrimSpace(meta.UserEmail),
			Status:             "complete",
			CreatedAtUnixMs:    now,
			UpdatedAtUnixMs:    now,
			TextContent:        userText,
			MessageJSON:        userJSON,
		},
		UploadIDs:        uploadIDs,
		StructuredInputs: structured,
		SecretAnswers:    secretRecords,
	}, input, nil
}

func (s *Service) persistUserMessage(ctx context.Context, meta *session.Meta, endpointID string, threadID string, input RunInput) (persistedUserMessage, RunInput, error) {
	prepared, input, err := s.prepareUserMessage(ctx, meta, endpointID, threadID, input)
	if err != nil {
		return persistedUserMessage{}, input, err
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return persistedUserMessage{}, input, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	pctx, cancel := context.WithTimeout(ctx, persistTO)
	rowID, err := db.AppendMessageWithUploadRefs(pctx, endpointID, threadID, prepared.Message, meta.UserPublicID, meta.UserEmail, prepared.UploadIDs, prepared.Message.CreatedAtUnixMs)
	cancel()
	if err != nil {
		if !isUniqueConstraintError(err) {
			return persistedUserMessage{}, input, err
		}
		// Idempotency: treat duplicate message_id inserts as success.
		pctx, cancel := context.WithTimeout(ctx, persistTO)
		defer cancel()
		existingRow, existingJSON, getErr := db.GetTranscriptMessageRowIDAndJSONByMessageID(pctx, endpointID, threadID, prepared.Message.MessageID)
		if getErr != nil {
			return persistedUserMessage{}, input, err
		}
		persisted := persistedUserMessage{
			MessageID:       prepared.Message.MessageID,
			RowID:           existingRow,
			MessageJSON:     existingJSON,
			CreatedAtUnixMs: prepared.Message.CreatedAtUnixMs,
		}
		if err := s.persistStructuredUserInputContext(ctx, endpointID, threadID, persisted.MessageID, input, prepared.Message.CreatedAtUnixMs); err != nil {
			return persistedUserMessage{}, input, err
		}
		return persisted, input, nil
	}

	persisted := persistedUserMessage{
		MessageID:       prepared.Message.MessageID,
		RowID:           rowID,
		MessageJSON:     prepared.Message.MessageJSON,
		CreatedAtUnixMs: prepared.Message.CreatedAtUnixMs,
	}
	if err := s.persistStructuredUserInputContext(ctx, endpointID, threadID, persisted.MessageID, input, prepared.Message.CreatedAtUnixMs); err != nil {
		return persistedUserMessage{}, input, err
	}
	return persisted, input, nil
}

func structuredUserInputRecords(endpointID string, threadID string, messageID string, input RunInput, createdAtUnixMs int64) ([]threadstore.StructuredUserInputRecord, []threadstore.RequestUserInputSecretAnswerRecord) {
	if input.StructuredResponse == nil {
		return nil, nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	messageID = strings.TrimSpace(messageID)
	record := *input.StructuredResponse
	record.ResponseMessageID = messageID
	structured := make([]threadstore.StructuredUserInputRecord, 0, len(record.Responses))
	for _, response := range record.Responses {
		structured = append(structured, threadstore.StructuredUserInputRecord{
			EndpointID:          endpointID,
			ThreadID:            threadID,
			ResponseMessageID:   messageID,
			PromptID:            strings.TrimSpace(record.PromptID),
			ToolID:              strings.TrimSpace(record.ToolID),
			ReasonCode:          strings.TrimSpace(record.ReasonCode),
			QuestionID:          strings.TrimSpace(response.QuestionID),
			Header:              strings.TrimSpace(response.Header),
			QuestionText:        strings.TrimSpace(response.Question),
			SelectedChoiceID:    strings.TrimSpace(response.SelectedChoiceID),
			SelectedChoiceLabel: strings.TrimSpace(response.SelectedChoiceLabel),
			Text:                strings.TrimSpace(response.Text),
			PublicSummary:       strings.TrimSpace(response.PublicSummary),
			ContainsSecret:      response.ContainsSecret,
			CreatedAtUnixMs:     createdAtUnixMs,
		})
	}
	secretRecords := make([]threadstore.RequestUserInputSecretAnswerRecord, 0, len(input.SecretAnswers))
	for _, secret := range input.SecretAnswers {
		secretRecords = append(secretRecords, threadstore.RequestUserInputSecretAnswerRecord{
			EndpointID:        endpointID,
			ThreadID:          threadID,
			ResponseMessageID: messageID,
			QuestionID:        strings.TrimSpace(secret.QuestionID),
			Text:              strings.TrimSpace(secret.Text),
			CreatedAtUnixMs:   createdAtUnixMs,
		})
	}
	return structured, secretRecords
}

func (s *Service) persistStructuredUserInputContext(ctx context.Context, endpointID string, threadID string, messageID string, input RunInput, createdAtUnixMs int64) error {
	if s == nil {
		return errors.New("nil service")
	}
	if input.StructuredResponse == nil {
		return nil
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	structured, secretRecords := structuredUserInputRecords(endpointID, threadID, strings.TrimSpace(messageID), input, createdAtUnixMs)
	pctx, cancel := context.WithTimeout(ctx, persistTO)
	defer cancel()
	if err := db.ReplaceStructuredUserInputs(pctx, endpointID, threadID, strings.TrimSpace(messageID), structured); err != nil {
		return err
	}
	if err := db.ReplaceRequestUserInputSecretAnswers(pctx, endpointID, threadID, strings.TrimSpace(messageID), secretRecords); err != nil {
		return err
	}
	return nil
}

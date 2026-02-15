package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

var ErrRunChanged = errors.New("run changed")

type SendUserTurnRequest struct {
	ThreadID      string     `json:"thread_id"`
	Model         string     `json:"model,omitempty"`
	Input         RunInput   `json:"input"`
	Options       RunOptions `json:"options"`
	ExpectedRunID string     `json:"expected_run_id,omitempty"`
}

type SendUserTurnResponse struct {
	RunID string `json:"run_id"`
	Kind  string `json:"kind"` // "start"
}

type persistedUserMessage struct {
	MessageID       string
	RowID           int64
	MessageJSON     string
	CreatedAtUnixMs int64
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

func (s *Service) persistUserMessage(ctx context.Context, meta *session.Meta, endpointID string, threadID string, input RunInput) (persistedUserMessage, RunInput, error) {
	if s == nil {
		return persistedUserMessage{}, input, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return persistedUserMessage{}, input, errors.New("invalid request")
	}

	s.mu.Lock()
	db := s.threadsDB
	uploadsDir := strings.TrimSpace(s.uploadsDir)
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return persistedUserMessage{}, input, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	messageID := strings.TrimSpace(input.MessageID)
	if messageID != "" && !isSafeClientMessageID(messageID) {
		messageID = ""
	}
	if messageID == "" {
		id, err := newUserMessageID()
		if err != nil {
			return persistedUserMessage{}, input, err
		}
		messageID = id
	}
	input.MessageID = messageID

	now := time.Now().UnixMilli()
	userJSON, userText, err := buildUserMessageJSON(messageID, input, uploadsDir, now)
	if err != nil {
		return persistedUserMessage{}, input, err
	}

	pctx, cancel := context.WithTimeout(ctx, persistTO)
	rowID, err := db.AppendMessage(pctx, endpointID, threadID, threadstore.Message{
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
	}, meta.UserPublicID, meta.UserEmail)
	cancel()
	if err != nil {
		if !isUniqueConstraintError(err) {
			return persistedUserMessage{}, input, err
		}
		// Idempotency: treat duplicate message_id inserts as success.
		pctx, cancel := context.WithTimeout(ctx, persistTO)
		defer cancel()
		existingRow, existingJSON, getErr := db.GetTranscriptMessageRowIDAndJSONByMessageID(pctx, endpointID, threadID, messageID)
		if getErr != nil {
			return persistedUserMessage{}, input, err
		}
		return persistedUserMessage{
			MessageID:       messageID,
			RowID:           existingRow,
			MessageJSON:     existingJSON,
			CreatedAtUnixMs: now,
		}, input, nil
	}

	return persistedUserMessage{
		MessageID:       messageID,
		RowID:           rowID,
		MessageJSON:     userJSON,
		CreatedAtUnixMs: now,
	}, input, nil
}

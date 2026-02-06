package ai

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

// NewThreadID generates a cryptographically random thread id.
func NewThreadID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "th_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func newUserMessageID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "u_ai_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Service) GetThread(ctx context.Context, meta *session.Meta, threadID string) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	th, err := db.GetThread(ctx, strings.TrimSpace(meta.EndpointID), threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, nil
	}

	return &ThreadView{
		ThreadID:            strings.TrimSpace(th.ThreadID),
		Title:               strings.TrimSpace(th.Title),
		CreatedAtUnixMs:     th.CreatedAtUnixMs,
		UpdatedAtUnixMs:     th.UpdatedAtUnixMs,
		LastMessageAtUnixMs: th.LastMessageAtUnixMs,
		LastMessagePreview:  strings.TrimSpace(th.LastMessagePreview),
	}, nil
}

func (s *Service) ListThreads(ctx context.Context, meta *session.Meta, limit int, cursor string) (*ListThreadsResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	c, ok := threadstore.DecodeCursor(cursor)
	if !ok {
		return nil, errors.New("invalid cursor")
	}

	list, next, err := db.ListThreads(ctx, meta.EndpointID, limit, c)
	if err != nil {
		return nil, err
	}
	out := &ListThreadsResponse{Threads: make([]ThreadView, 0, len(list)), NextCursor: strings.TrimSpace(next)}
	for _, t := range list {
		out.Threads = append(out.Threads, ThreadView{
			ThreadID:            strings.TrimSpace(t.ThreadID),
			Title:               strings.TrimSpace(t.Title),
			CreatedAtUnixMs:     t.CreatedAtUnixMs,
			UpdatedAtUnixMs:     t.UpdatedAtUnixMs,
			LastMessageAtUnixMs: t.LastMessageAtUnixMs,
			LastMessagePreview:  strings.TrimSpace(t.LastMessagePreview),
		})
	}
	return out, nil
}

func (s *Service) CreateThread(ctx context.Context, meta *session.Meta, title string) (*ThreadView, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	id, err := NewThreadID()
	if err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()
	t := threadstore.Thread{
		ThreadID:              id,
		EndpointID:            strings.TrimSpace(meta.EndpointID),
		NamespacePublicID:     strings.TrimSpace(meta.NamespacePublicID),
		Title:                 strings.TrimSpace(title),
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		UpdatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		UpdatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       now,
		UpdatedAtUnixMs:       now,
		LastMessageAtUnixMs:   0,
		LastMessagePreview:    "",
	}
	if err := db.CreateThread(ctx, t); err != nil {
		return nil, err
	}

	return &ThreadView{
		ThreadID:            id,
		Title:               strings.TrimSpace(t.Title),
		CreatedAtUnixMs:     t.CreatedAtUnixMs,
		UpdatedAtUnixMs:     t.UpdatedAtUnixMs,
		LastMessageAtUnixMs: 0,
		LastMessagePreview:  "",
	}, nil
}

func (s *Service) RenameThread(ctx context.Context, meta *session.Meta, threadID string, title string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if strings.TrimSpace(threadID) == "" {
		return errors.New("missing thread_id")
	}
	return db.RenameThread(ctx, meta.EndpointID, threadID, title, meta.UserPublicID, meta.UserEmail)
}

func (s *Service) CancelThread(meta *session.Meta, threadID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	s.mu.Unlock()
	if runID == "" || r == nil {
		return nil
	}
	if strings.TrimSpace(r.endpointID) != endpointID {
		return errors.New("run not found")
	}
	r.requestCancel("canceled")
	return nil
}

func (s *Service) DeleteThread(ctx context.Context, meta *session.Meta, threadID string, force bool) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	runID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	r := s.runs[runID]
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}

	if runID != "" {
		if !force {
			return ErrThreadBusy
		}
		if r == nil || strings.TrimSpace(r.endpointID) != endpointID {
			return ErrThreadBusy
		}

		// Cancel first, then wait for the run to fully exit so we don't race with message persistence.
		r.requestCancel("canceled")
		wctx := ctx
		if wctx == nil {
			wctx = context.Background()
		}
		if _, ok := wctx.Deadline(); !ok {
			var cancel context.CancelFunc
			wctx, cancel = context.WithTimeout(wctx, 10*time.Second)
			defer cancel()
		}
		select {
		case <-r.doneCh:
		case <-wctx.Done():
			return ErrThreadBusy
		}
	}

	return db.DeleteThread(ctx, endpointID, threadID)
}

func (s *Service) ListThreadMessages(ctx context.Context, meta *session.Meta, threadID string, limit int, beforeID int64) (*ListThreadMessagesResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if meta == nil {
		return nil, errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	msgs, nextBeforeID, hasMore, err := db.ListMessages(ctx, meta.EndpointID, threadID, limit, beforeID)
	if err != nil {
		return nil, err
	}
	out := &ListThreadMessagesResponse{
		Messages:      make([]any, 0, len(msgs)),
		NextBeforeID:  nextBeforeID,
		HasMore:       hasMore,
		TotalReturned: len(msgs),
	}
	for _, m := range msgs {
		raw := strings.TrimSpace(m.MessageJSON)
		if raw == "" {
			continue
		}
		out.Messages = append(out.Messages, json.RawMessage(raw))
	}
	return out, nil
}

func (s *Service) AppendThreadMessage(ctx context.Context, meta *session.Meta, threadID string, role string, text string, format string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if meta == nil {
		return errors.New("missing session metadata")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("missing thread_id")
	}

	role = strings.TrimSpace(role)
	if role == "" {
		role = "user"
	}
	if role != "user" {
		return fmt.Errorf("unsupported role: %s", role)
	}

	format = strings.TrimSpace(format)
	if format == "" {
		format = "markdown"
	}
	if format != "markdown" && format != "text" {
		return fmt.Errorf("unsupported format: %s", format)
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("missing text")
	}

	id, err := newUserMessageID()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()

	blocks := []any{}
	content := strings.TrimRight(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if format == "text" {
		blocks = append(blocks, map[string]any{"type": "text", "content": content})
	} else {
		blocks = append(blocks, map[string]any{"type": "markdown", "content": content})
	}
	msg := map[string]any{
		"id":        id,
		"role":      "user",
		"blocks":    blocks,
		"status":    "complete",
		"timestamp": now,
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	_, err = db.AppendMessage(ctx, meta.EndpointID, threadID, threadstore.Message{
		ThreadID:           threadID,
		EndpointID:         meta.EndpointID,
		MessageID:          id,
		Role:               "user",
		AuthorUserPublicID: strings.TrimSpace(meta.UserPublicID),
		AuthorUserEmail:    strings.TrimSpace(meta.UserEmail),
		Status:             "complete",
		CreatedAtUnixMs:    now,
		UpdatedAtUnixMs:    now,
		TextContent:        strings.TrimSpace(content),
		MessageJSON:        string(b),
	}, meta.UserPublicID, meta.UserEmail)
	return err
}

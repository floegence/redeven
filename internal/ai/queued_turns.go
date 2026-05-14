package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func NewQueuedTurnID() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "qt_" + base64.RawURLEncoding.EncodeToString(b), nil
}

func marshalQueuedTurnAttachments(items []RunAttachmentIn) string {
	if len(items) == 0 {
		return "[]"
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func marshalQueuedTurnOptions(opts RunOptions) string {
	b, err := json.Marshal(opts)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func marshalQueuedTurnSessionMeta(meta *session.Meta) string {
	if meta == nil {
		return "{}"
	}
	snapshot := session.Meta{
		ChannelID:         strings.TrimSpace(meta.ChannelID),
		EndpointID:        strings.TrimSpace(meta.EndpointID),
		FloeApp:           strings.TrimSpace(meta.FloeApp),
		CodeSpaceID:       strings.TrimSpace(meta.CodeSpaceID),
		SessionKind:       strings.TrimSpace(meta.SessionKind),
		UserPublicID:      strings.TrimSpace(meta.UserPublicID),
		UserEmail:         strings.TrimSpace(meta.UserEmail),
		NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
		CanRead:           meta.CanRead,
		CanWrite:          meta.CanWrite,
		CanExecute:        meta.CanExecute,
		CanAdmin:          meta.CanAdmin,
		CreatedAtUnixMs:   meta.CreatedAtUnixMs,
	}
	b, err := json.Marshal(snapshot)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func unmarshalQueuedTurnSessionMeta(raw string) (session.Meta, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return session.Meta{}, false
	}
	var out session.Meta
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return session.Meta{}, false
	}
	if strings.TrimSpace(out.ChannelID) == "" || strings.TrimSpace(out.EndpointID) == "" {
		return session.Meta{}, false
	}
	return out, true
}

func unmarshalQueuedTurnAttachments(raw string) []RunAttachmentIn {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var out []RunAttachmentIn
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	cleaned := make([]RunAttachmentIn, 0, len(out))
	for _, item := range out {
		url := strings.TrimSpace(item.URL)
		if url == "" {
			continue
		}
		cleaned = append(cleaned, RunAttachmentIn{
			Name:     strings.TrimSpace(item.Name),
			MimeType: strings.TrimSpace(item.MimeType),
			URL:      url,
		})
	}
	return cleaned
}

func unmarshalQueuedTurnOptions(raw string) RunOptions {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return RunOptions{}
	}
	var out RunOptions
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return RunOptions{}
	}
	return out
}

func followupRecordToView(rec threadstore.QueuedTurn, position int) FollowupItemView {
	attachments := unmarshalQueuedTurnAttachments(rec.AttachmentsJSON)
	views := make([]FollowupAttachmentView, 0, len(attachments))
	for _, item := range attachments {
		views = append(views, FollowupAttachmentView{
			Name:     strings.TrimSpace(item.Name),
			MimeType: strings.TrimSpace(item.MimeType),
			URL:      strings.TrimSpace(item.URL),
		})
	}
	options := unmarshalQueuedTurnOptions(rec.OptionsJSON)
	view := FollowupItemView{
		FollowupID:      strings.TrimSpace(rec.QueueID),
		Lane:            strings.TrimSpace(rec.Lane),
		MessageID:       strings.TrimSpace(rec.MessageID),
		Text:            strings.TrimSpace(rec.TextContent),
		ModelID:         strings.TrimSpace(rec.ModelID),
		ExecutionMode:   normalizeRunMode(options.Mode, ""),
		Position:        position,
		CreatedAtUnixMs: rec.CreatedAtUnixMs,
	}
	if view.ExecutionMode == "act" && strings.TrimSpace(options.Mode) == "" {
		view.ExecutionMode = ""
	}
	if len(views) > 0 {
		view.Attachments = views
	}
	return view
}

func queuedTurnRecordToRunStartRequest(rec threadstore.QueuedTurn, threadExecutionMode string) RunStartRequest {
	options := unmarshalQueuedTurnOptions(rec.OptionsJSON)
	options.Mode = normalizeRunMode(options.Mode, normalizeRunMode(threadExecutionMode, "act"))
	return RunStartRequest{
		ThreadID: strings.TrimSpace(rec.ThreadID),
		Model:    strings.TrimSpace(rec.ModelID),
		Input: RunInput{
			MessageID:   strings.TrimSpace(rec.MessageID),
			Text:        strings.TrimSpace(rec.TextContent),
			Attachments: unmarshalQueuedTurnAttachments(rec.AttachmentsJSON),
		},
		Options: options,
	}
}

func queuedTurnRecordToSessionMeta(rec threadstore.QueuedTurn, namespacePublicID string) *session.Meta {
	meta, ok := unmarshalQueuedTurnSessionMeta(rec.SessionMetaJSON)
	if !ok {
		meta = session.Meta{}
	}
	meta.ChannelID = strings.TrimSpace(rec.ChannelID)
	meta.EndpointID = strings.TrimSpace(rec.EndpointID)
	meta.NamespacePublicID = strings.TrimSpace(namespacePublicID)
	meta.UserPublicID = strings.TrimSpace(meta.UserPublicID)
	if meta.UserPublicID == "" {
		meta.UserPublicID = strings.TrimSpace(rec.CreatedByUserPublicID)
	}
	meta.UserEmail = strings.TrimSpace(meta.UserEmail)
	if meta.UserEmail == "" {
		meta.UserEmail = strings.TrimSpace(rec.CreatedByUserEmail)
	}
	return &meta
}

func (s *Service) enqueueQueuedTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (threadstore.QueuedTurn, int, error) {
	if s == nil {
		return threadstore.QueuedTurn{}, 0, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return threadstore.QueuedTurn{}, 0, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	messageID := strings.TrimSpace(req.Input.MessageID)
	if messageID != "" && !isSafeClientMessageID(messageID) {
		messageID = ""
	}
	if messageID == "" {
		var err error
		messageID, err = newUserMessageID()
		if err != nil {
			return threadstore.QueuedTurn{}, 0, err
		}
	}
	normalizedInput, _, uploadIDs, err := s.normalizeInputAttachments(ctx, strings.TrimSpace(meta.EndpointID), req.Input)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	queueID, err := NewQueuedTurnID()
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	createdAtUnixMs := time.Now().UnixMilli()

	rec := threadstore.QueuedTurn{
		QueueID:               queueID,
		EndpointID:            strings.TrimSpace(meta.EndpointID),
		ThreadID:              strings.TrimSpace(req.ThreadID),
		ChannelID:             strings.TrimSpace(meta.ChannelID),
		Lane:                  threadstore.FollowupLaneQueued,
		MessageID:             messageID,
		ModelID:               strings.TrimSpace(req.Model),
		TextContent:           strings.TrimSpace(normalizedInput.Text),
		AttachmentsJSON:       marshalQueuedTurnAttachments(normalizedInput.Attachments),
		OptionsJSON:           marshalQueuedTurnOptions(req.Options),
		SessionMetaJSON:       marshalQueuedTurnSessionMeta(meta),
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       createdAtUnixMs,
	}

	pctx, cancel := context.WithTimeout(ctx, persistTO)
	defer cancel()
	queued, position, _, err := db.CreateFollowupWithUploadRefs(pctx, rec, uploadIDs, createdAtUnixMs)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	s.broadcastThreadSummary(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(req.ThreadID))
	return queued, position, nil
}

func (s *Service) consumeSourceFollowup(ctx context.Context, meta *session.Meta, threadID string, followupID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	followupID = strings.TrimSpace(followupID)
	if followupID == "" {
		return nil
	}
	if err := s.deleteFollowupResources(ctx, strings.TrimSpace(meta.EndpointID), strings.TrimSpace(threadID), followupID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	return nil
}

func (s *Service) deleteFollowupResources(ctx context.Context, endpointID string, threadID string, followupID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	followupID = strings.TrimSpace(followupID)
	if endpointID == "" || threadID == "" || followupID == "" {
		return errors.New("invalid request")
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
	pctx, cancel := context.WithTimeout(ctx, persistTO)
	result, err := db.DeleteFollowupResources(pctx, endpointID, threadID, followupID)
	cancel()
	if err != nil {
		return err
	}
	if _, err := s.processUploadCleanupCandidates(ctx, result.UploadsToDelete); err != nil {
		return err
	}
	s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

func (s *Service) ListFollowups(ctx context.Context, meta *session.Meta, threadID string, limit int) (*ListFollowupsResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	threadID = strings.TrimSpace(threadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	if th == nil {
		return nil, sql.ErrNoRows
	}
	revision, err := db.GetThreadFollowupsRevision(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	queued, err := db.ListFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued, limit)
	if err != nil {
		return nil, err
	}
	drafts, err := db.ListFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneDraft, limit)
	if err != nil {
		return nil, err
	}
	pausedReason := ""
	runStatus, _ := normalizeThreadRunState(th.RunStatus, th.RunError)
	if NormalizeRunState(runStatus) == RunStateWaitingUser || requestUserInputPromptFromThreadRecord(th, runStatus) != nil {
		if len(queued) > 0 {
			pausedReason = "waiting_user"
		}
	}
	out := &ListFollowupsResponse{
		Revision:     revision,
		PausedReason: pausedReason,
		Queued:       make([]FollowupItemView, 0, len(queued)),
		Drafts:       make([]FollowupItemView, 0, len(drafts)),
	}
	for i, rec := range queued {
		out.Queued = append(out.Queued, followupRecordToView(rec, i+1))
	}
	for i, rec := range drafts {
		out.Drafts = append(out.Drafts, followupRecordToView(rec, i+1))
	}
	return out, nil
}

func (s *Service) UpdateFollowup(ctx context.Context, meta *session.Meta, threadID string, followupID string, req PatchFollowupRequest) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	if req.Text == nil {
		return errors.New("missing fields")
	}
	text := strings.TrimSpace(*req.Text)
	if text == "" {
		return errors.New("missing fields")
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	if _, err := db.UpdateFollowupText(ctx, strings.TrimSpace(meta.EndpointID), strings.TrimSpace(threadID), strings.TrimSpace(followupID), text); err != nil {
		if errors.Is(err, threadstore.ErrFollowupsRevisionChanged) {
			return ErrFollowupsRevisionChanged
		}
		return err
	}
	s.broadcastThreadSummary(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(threadID))
	return nil
}

func (s *Service) DeleteFollowup(ctx context.Context, meta *session.Meta, threadID string, followupID string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return err
	}

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	return s.deleteFollowupResources(ctx, strings.TrimSpace(meta.EndpointID), strings.TrimSpace(threadID), strings.TrimSpace(followupID))
}

func (s *Service) ReorderFollowups(ctx context.Context, meta *session.Meta, threadID string, req ReorderFollowupsRequest) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := requireRWX(meta); err != nil {
		return err
	}
	lane := strings.TrimSpace(req.Lane)
	if lane != threadstore.FollowupLaneQueued && lane != threadstore.FollowupLaneDraft {
		return ErrInvalidFollowupLane
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	expectedRevision := int64(0)
	if req.ExpectedRevision != nil {
		expectedRevision = *req.ExpectedRevision
	}
	if _, err := db.ReorderFollowups(ctx, endpointID, threadID, lane, req.OrderedFollowupIDs, expectedRevision); err != nil {
		switch {
		case errors.Is(err, threadstore.ErrFollowupsRevisionChanged):
			return ErrFollowupsRevisionChanged
		case errors.Is(err, threadstore.ErrInvalidFollowupOrder):
			return errors.New("invalid followup order")
		default:
			return err
		}
	}
	s.broadcastThreadSummary(endpointID, threadID)
	return nil
}

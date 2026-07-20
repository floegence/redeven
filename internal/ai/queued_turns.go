package ai

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
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

func (s *Service) commitPendingTurnCommandAdmission(ctx context.Context, endpointID string, threadID string, commandID string, turnID string, uploadIDs []string) error {
	if s == nil {
		return errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	return db.CommitPendingTurnAdmission(ctx, endpointID, threadID, commandID, turnID, uploadIDs, time.Now().UnixMilli())
}

func (s *Service) releasePendingTurnCommandAdmission(ctx context.Context, endpointID string, threadID string, commandID string, turnID string, runID string, targetLane string) error {
	if s == nil {
		return errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return errors.New("threads store not ready")
	}
	return db.ReleasePendingTurnAdmission(ctx, endpointID, threadID, commandID, turnID, runID, targetLane)
}

func (s *Service) reconcilePendingTurnCommand(ctx context.Context, endpointID string, threadID string, commandID string, turnID string, uploadIDs []string) (bool, error) {
	if s == nil {
		return false, errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	commandID = strings.TrimSpace(commandID)
	turnID = strings.TrimSpace(turnID)
	if endpointID == "" || threadID == "" || commandID == "" || turnID == "" {
		return false, errors.New("invalid pending turn command identity")
	}
	turnIDs, err := s.readCanonicalThreadTurnIDs(ctx, threadID)
	if err != nil {
		return false, err
	}
	if _, accepted := turnIDs[turnID]; !accepted {
		return false, nil
	}
	if err := s.commitPendingTurnCommandAdmission(ctx, endpointID, threadID, commandID, turnID, uploadIDs); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) readCanonicalThreadTurnIDs(ctx context.Context, threadID string) (map[string]struct{}, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("invalid canonical thread identity")
	}
	host, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return nil, err
	}
	afterOrdinal := int64(0)
	turnIDs := make(map[string]struct{})
	for {
		page, err := host.ListThreadTurns(ctx, flruntime.ListThreadTurnsRequest{
			ThreadID: flruntime.ThreadID(threadID), AfterOrdinal: afterOrdinal, Limit: 200,
		})
		if err != nil {
			return nil, err
		}
		for _, turn := range page.Turns {
			turnID := strings.TrimSpace(string(turn.TurnID))
			if turnID == "" {
				return nil, errors.New("Floret returned an empty turn identity")
			}
			turnIDs[turnID] = struct{}{}
		}
		if !page.HasMore {
			break
		}
		if len(page.Turns) == 0 {
			return nil, errors.New("Floret turn pagination stopped before completion")
		}
		next := page.Turns[len(page.Turns)-1].Ordinal
		if next <= afterOrdinal {
			return nil, errors.New("Floret turn pagination did not advance")
		}
		afterOrdinal = next
	}
	return turnIDs, nil
}

func (s *Service) reconcileCanonicalPendingTurnCommands(ctx context.Context, endpointID string, threadID string, db *threadstore.Store) error {
	if s == nil {
		return errors.New("nil service")
	}
	if db == nil {
		return errors.New("threads store not ready")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid pending turn reconciliation identity")
	}
	commands, err := db.ListFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued, 500)
	if err != nil {
		return err
	}
	if len(commands) == 0 {
		return nil
	}
	turnIDs, err := s.readCanonicalThreadTurnIDs(ctx, threadID)
	if err != nil {
		return err
	}
	for _, command := range commands {
		turnID := strings.TrimSpace(command.TurnID)
		if turnID == "" {
			return fmt.Errorf("pending turn command %q has no turn identity", command.QueueID)
		}
		if _, accepted := turnIDs[turnID]; !accepted {
			continue
		}
		if err := s.commitPendingTurnCommandAdmission(ctx, endpointID, threadID, command.QueueID, turnID, nil); err != nil {
			return fmt.Errorf("settle admitted pending turn %q: %w", command.QueueID, err)
		}
	}
	return nil
}

func marshalQueuedTurnAttachments(items []RunAttachmentIn) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func marshalQueuedTurnContextAction(action *ContextActionEnvelope) (string, error) {
	var err error
	action, err = normalizeAskFlowerContextActionEnvelope(action)
	if err != nil || action == nil {
		return "", err
	}
	b, err := json.Marshal(action)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func marshalQueuedTurnOptions(opts RunOptions) (string, error) {
	b, err := json.Marshal(opts)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func marshalQueuedTurnSessionMeta(meta *session.Meta) (string, error) {
	if meta == nil {
		return "", errors.New("queued turn session metadata is missing")
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
		return "", err
	}
	return string(b), nil
}

func unmarshalQueuedTurnSessionMeta(raw string) (session.Meta, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return session.Meta{}, errors.New("queued turn session metadata is empty")
	}
	var out session.Meta
	if err := decodeStrictJSON(raw, &out); err != nil {
		return session.Meta{}, fmt.Errorf("decode queued turn session metadata: %w", err)
	}
	if strings.TrimSpace(out.ChannelID) == "" || strings.TrimSpace(out.EndpointID) == "" {
		return session.Meta{}, errors.New("queued turn session metadata has incomplete identity")
	}
	return out, nil
}

func unmarshalQueuedTurnAttachments(raw string) ([]RunAttachmentIn, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("queued turn attachments are empty")
	}
	var out []RunAttachmentIn
	if err := decodeStrictJSON(raw, &out); err != nil {
		return nil, fmt.Errorf("decode queued turn attachments: %w", err)
	}
	cleaned := make([]RunAttachmentIn, 0, len(out))
	for index, item := range out {
		url := strings.TrimSpace(item.URL)
		if url == "" {
			return nil, fmt.Errorf("queued turn attachment %d has no URL", index)
		}
		if parseUploadIDFromURL(url) == "" {
			return nil, fmt.Errorf("queued turn attachment %d is not a Redeven upload", index)
		}
		cleaned = append(cleaned, RunAttachmentIn{
			Name:     strings.TrimSpace(item.Name),
			MimeType: strings.TrimSpace(item.MimeType),
			URL:      url,
		})
	}
	return cleaned, nil
}

func unmarshalQueuedTurnContextAction(raw string) (*ContextActionEnvelope, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var out ContextActionEnvelope
	if err := decodeStrictJSON(raw, &out); err != nil {
		return nil, err
	}
	action, err := normalizeAskFlowerContextActionEnvelope(&out)
	if err != nil {
		return nil, err
	}
	return action, nil
}

func unmarshalQueuedTurnOptions(raw string) (RunOptions, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return RunOptions{}, errors.New("queued turn options are empty")
	}
	var out RunOptions
	if err := decodeStrictJSON(raw, &out); err != nil {
		return RunOptions{}, fmt.Errorf("decode queued turn options: %w", err)
	}
	return out, nil
}

func followupRecordToView(rec threadstore.QueuedTurn, position int) (FollowupItemView, error) {
	attachments, err := unmarshalQueuedTurnAttachments(rec.AttachmentsJSON)
	if err != nil {
		return FollowupItemView{}, err
	}
	views := make([]FollowupAttachmentView, 0, len(attachments))
	for _, item := range attachments {
		views = append(views, FollowupAttachmentView{
			Name:     strings.TrimSpace(item.Name),
			MimeType: strings.TrimSpace(item.MimeType),
			URL:      strings.TrimSpace(item.URL),
		})
	}
	options, err := unmarshalQueuedTurnOptions(rec.OptionsJSON)
	if err != nil {
		return FollowupItemView{}, err
	}
	view := FollowupItemView{
		FollowupID:      strings.TrimSpace(rec.QueueID),
		Lane:            strings.TrimSpace(rec.Lane),
		MessageID:       strings.TrimSpace(rec.TurnID),
		Text:            strings.TrimSpace(rec.TextContent),
		ModelID:         strings.TrimSpace(rec.ModelID),
		PermissionType:  strings.TrimSpace(options.PermissionType),
		Position:        position,
		CreatedAtUnixMs: rec.CreatedAtUnixMs,
	}
	if len(views) > 0 {
		view.Attachments = views
	}
	contextAction, err := unmarshalQueuedTurnContextAction(rec.ContextActionJSON)
	if err != nil {
		return FollowupItemView{}, err
	}
	view.ContextAction = contextAction
	return view, nil
}

func queuedTurnRecordToThreadView(rec threadstore.QueuedTurn) (QueuedTurnView, error) {
	view := QueuedTurnView{
		MessageID:       strings.TrimSpace(rec.TurnID),
		Text:            strings.TrimSpace(rec.TextContent),
		CreatedAtUnixMs: rec.CreatedAtUnixMs,
	}
	contextAction, err := unmarshalQueuedTurnContextAction(rec.ContextActionJSON)
	if err != nil {
		return QueuedTurnView{}, err
	}
	view.ContextAction = contextAction
	return view, nil
}

func queuedTurnRecordToRunStartRequest(rec threadstore.QueuedTurn, threadPermissionType string) (RunStartRequest, error) {
	options, err := unmarshalQueuedTurnOptions(rec.OptionsJSON)
	if err != nil {
		return RunStartRequest{}, err
	}
	permissionType, err := parsePermissionType(threadPermissionType)
	if err != nil {
		return RunStartRequest{}, fmt.Errorf("parse queued turn permission setting: %w", err)
	}
	options.PermissionType = permissionTypeString(permissionType)
	contextAction, err := unmarshalQueuedTurnContextAction(rec.ContextActionJSON)
	if err != nil {
		return RunStartRequest{}, err
	}
	attachments, err := unmarshalQueuedTurnAttachments(rec.AttachmentsJSON)
	if err != nil {
		return RunStartRequest{}, err
	}
	return RunStartRequest{
		ThreadID: strings.TrimSpace(rec.ThreadID),
		Model:    strings.TrimSpace(rec.ModelID),
		Input: RunInput{
			MessageID:     strings.TrimSpace(rec.TurnID),
			Text:          strings.TrimSpace(rec.TextContent),
			Attachments:   attachments,
			ContextAction: contextAction,
		},
		Options: options,
	}, nil
}

func queuedTurnRecordToSessionMeta(rec threadstore.QueuedTurn, namespacePublicID string) (*session.Meta, error) {
	meta, err := unmarshalQueuedTurnSessionMeta(rec.SessionMetaJSON)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(meta.ChannelID) != strings.TrimSpace(rec.ChannelID) || strings.TrimSpace(meta.EndpointID) != strings.TrimSpace(rec.EndpointID) {
		return nil, errors.New("queued turn session identity conflicts with queue record")
	}
	if strings.TrimSpace(meta.NamespacePublicID) != strings.TrimSpace(namespacePublicID) {
		return nil, errors.New("queued turn namespace conflicts with thread settings")
	}
	if createdBy := strings.TrimSpace(rec.CreatedByUserPublicID); createdBy != "" && strings.TrimSpace(meta.UserPublicID) != createdBy {
		return nil, errors.New("queued turn user identity conflicts with audit record")
	}
	if createdBy := strings.TrimSpace(rec.CreatedByUserEmail); createdBy != "" && strings.TrimSpace(meta.UserEmail) != createdBy {
		return nil, errors.New("queued turn user email conflicts with audit record")
	}
	return &meta, nil
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

	turnID := strings.TrimSpace(req.Input.MessageID)
	if turnID != "" && !isSafeClientMessageID(turnID) {
		turnID = ""
	}
	if turnID == "" {
		var err error
		turnID, err = newMessageID()
		if err != nil {
			return threadstore.QueuedTurn{}, 0, err
		}
	}
	runID, err := NewRunID()
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	normalizedInput, _, uploadIDs, err := s.normalizeInputAttachments(ctx, strings.TrimSpace(meta.EndpointID), req.Input)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	contextActionJSON, err := marshalQueuedTurnContextAction(normalizedInput.ContextAction)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	attachmentsJSON, err := marshalQueuedTurnAttachments(normalizedInput.Attachments)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	optionsJSON, err := marshalQueuedTurnOptions(req.Options)
	if err != nil {
		return threadstore.QueuedTurn{}, 0, err
	}
	sessionMetaJSON, err := marshalQueuedTurnSessionMeta(meta)
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
		TurnID:                turnID,
		RunID:                 runID,
		ModelID:               strings.TrimSpace(req.Model),
		TextContent:           strings.TrimSpace(normalizedInput.Text),
		AttachmentsJSON:       attachmentsJSON,
		ContextActionJSON:     contextActionJSON,
		OptionsJSON:           optionsJSON,
		SessionMetaJSON:       sessionMetaJSON,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID),
		CreatedByUserEmail:    strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs:       createdAtUnixMs,
	}

	pctx, cancel := context.WithTimeout(ctx, persistTO)
	defer cancel()
	var queued threadstore.QueuedTurn
	var position int
	if sourceFollowupID := strings.TrimSpace(req.SourceFollowupID); sourceFollowupID != "" {
		result, replaceErr := db.ReplaceFollowupWithUploadRefs(pctx, sourceFollowupID, rec, uploadIDs, createdAtUnixMs)
		if replaceErr != nil {
			return threadstore.QueuedTurn{}, 0, replaceErr
		}
		queued = result.Queued
		position = result.Position
		if _, cleanupErr := s.processUploadCleanupCandidates(ctx, result.UploadsToDelete); cleanupErr != nil && s.log != nil {
			s.log.Warn("queued followup replacement physical cleanup deferred", "thread_id", rec.ThreadID, "source_followup_id", sourceFollowupID, "error", cleanupErr)
		}
	} else {
		var createErr error
		queued, position, _, createErr = db.CreateFollowupWithUploadRefs(pctx, rec, uploadIDs, createdAtUnixMs)
		if createErr != nil {
			return threadstore.QueuedTurn{}, 0, createErr
		}
	}
	s.broadcastThreadSummary(strings.TrimSpace(meta.EndpointID), strings.TrimSpace(req.ThreadID))
	return queued, position, nil
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
	th, err := db.GetThreadSettings(ctx, endpointID, threadID)
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
	_, latest, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return nil, err
	}
	waitingPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return nil, err
	}
	if waitingPrompt != nil {
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
		view, err := followupRecordToView(rec, i+1)
		if err != nil {
			return nil, fmt.Errorf("decode queued followup %q: %w", rec.QueueID, err)
		}
		out.Queued = append(out.Queued, view)
	}
	for i, rec := range drafts {
		view, err := followupRecordToView(rec, i+1)
		if err != nil {
			return nil, fmt.Errorf("decode draft followup %q: %w", rec.QueueID, err)
		}
		out.Drafts = append(out.Drafts, view)
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

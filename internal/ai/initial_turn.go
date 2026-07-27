package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

func (s *Service) sendInitialUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	if req.Create == nil {
		return SendUserTurnResponse{}, errors.New("thread create snapshot is missing")
	}
	if strings.TrimSpace(req.Input.TurnID) == "" {
		return SendUserTurnResponse{}, errors.New("initial turn_id is required")
	}
	create := *req.Create
	create.ThreadID = strings.TrimSpace(req.ThreadID)
	settings, err := s.buildThreadCreateSettings(ctxOrBackground(ctx), meta, create)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if strings.TrimSpace(req.Model) != "" && strings.TrimSpace(req.Model) != strings.TrimSpace(settings.ModelID) {
		return SendUserTurnResponse{}, errors.New("initial turn model conflicts with create snapshot")
	}
	req.Model = strings.TrimSpace(settings.ModelID)
	req.Options.PermissionType = strings.TrimSpace(settings.PermissionType)
	capability, modelDefault, _, err := s.threadReasoningDefaults(ctxOrBackground(ctx), req.Model)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	threadDefault, err := parseStoredReasoningSelection(settings.ReasoningSelectionJSON)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	resolvedReasoning, err := resolveEffectiveReasoning(capability, req.Options.ReasoningSelection, threadDefault, modelDefault)
	if err != nil {
		return SendUserTurnResponse{}, reasoningSelectionError(req.Model, err)
	}
	req.Options.ReasoningSelection = resolvedReasoning.Effective
	if receipt, err := s.frozenTurnReceipt(ctxOrBackground(ctx), meta, req); err != nil {
		return SendUserTurnResponse{}, err
	} else if receipt != nil {
		return *receipt, nil
	}
	if len(req.Input.Attachments) != 0 && strings.TrimSpace(req.StagingScopeID) == "" {
		return SendUserTurnResponse{}, errors.New("initial attachments require an upload staging scope")
	}
	preparedUser, normalizedInput, err := s.prepareUserTurn(ctxOrBackground(ctx), meta, settings.EndpointID, settings.ThreadID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	runID, err := NewRunID()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	queueID, err := NewQueuedTurnID()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	contextActionJSON, err := marshalQueuedTurnContextAction(normalizedInput.ContextAction)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	attachmentsJSON, err := marshalQueuedTurnAttachments(normalizedInput.Attachments)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	optionsJSON, err := marshalQueuedTurnOptions(req.Options)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	sessionMetaJSON, err := marshalQueuedTurnSessionMeta(meta)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	record := threadstore.QueuedTurn{
		QueueID: queueID, EndpointID: settings.EndpointID, ThreadID: settings.ThreadID, ChannelID: strings.TrimSpace(meta.ChannelID),
		Lane: threadstore.FollowupLaneQueued, TurnID: preparedUser.TurnID, RunID: runID, ModelID: req.Model,
		TextContent: normalizedInput.Text, AttachmentsJSON: attachmentsJSON, ContextActionJSON: contextActionJSON,
		OptionsJSON: optionsJSON, SessionMetaJSON: sessionMetaJSON,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), CreatedByUserEmail: strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs: preparedUser.CreatedAtUnixMs,
	}
	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return SendUserTurnResponse{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	operation, frozen, err := db.PrepareThreadCreateWithInitialTurn(pctx, threadstore.PrepareThreadCreateRequest{
		Settings: settings, ExplicitTitle: strings.TrimSpace(create.Title), CreatedAtMS: preparedUser.CreatedAtUnixMs,
	}, record, preparedUser.UploadIDs, preparedUser.CreatedAtUnixMs, preparedUser.AttachmentAdmission, preparedUser.StagingScope)
	cancel()
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	if _, err := s.resumeThreadCreateOperation(ctxOrBackground(ctx), operation); err != nil {
		return SendUserTurnResponse{}, err
	}
	startReq := RunStartRequest{
		ThreadID: settings.ThreadID, Model: frozen.ModelID,
		Input:   RunInput{TurnID: frozen.TurnID, Text: frozen.TextContent, Attachments: normalizedInput.Attachments, ContextAction: normalizedInput.ContextAction},
		Options: req.Options,
	}
	admitted, _, err := s.startUserTurnDetached(ctxOrBackground(ctx), meta, frozen.RunID, startReq, frozen.QueueID)
	if err != nil {
		return SendUserTurnResponse{}, err
	}
	return SendUserTurnResponse{
		RunID: admitted.RunID, TurnID: admitted.TurnID, Kind: "start", AppliedPermissionType: settings.PermissionType,
	}, nil
}

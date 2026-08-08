package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v3/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
)

const (
	initialTurnPhaseLookupFrozenState      = "lookup_frozen_state"
	initialTurnPhasePrepareAtomic          = "prepare_atomic"
	initialTurnPhaseResumeCanonicalCreate  = "resume_canonical_create"
	initialTurnPhaseStartAdmission         = "start_admission"
	initialTurnPhaseVerifyCanonicalReceipt = "verify_canonical_receipt"
)

func stableInitialQueueID(endpointID, userPublicID, clientRequestID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(endpointID) + "\x00" + strings.TrimSpace(userPublicID) + "\x00" + strings.TrimSpace(clientRequestID)))
	return "qt_" + hex.EncodeToString(sum[:18])
}

func (s *Service) sendInitialUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	clientRequestID := ""
	if req.Create != nil {
		clientRequestID = strings.TrimSpace(req.Create.ClientRequestID)
	}
	fail := func(phase string, err error) (SendUserTurnResponse, error) {
		s.logInitialTurnFailure(phase, clientRequestID, "", err)
		return SendUserTurnResponse{}, err
	}
	if req.Create == nil {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("thread create snapshot is missing"))
	}
	if !validUploadStagingTargetID(clientRequestID) {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("invalid client_request_id"))
	}
	if strings.TrimSpace(req.Input.TurnID) != "" {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("turn_id must be omitted before canonical admission"))
	}
	create := *req.Create
	settings, err := s.buildThreadCreateSettings(ctxOrBackground(ctx), meta, create)
	if err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	if strings.TrimSpace(req.Model) != "" && strings.TrimSpace(req.Model) != strings.TrimSpace(settings.ModelID) {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("initial turn model conflicts with create snapshot"))
	}
	if permission := strings.TrimSpace(req.Options.PermissionType); permission != "" && permission != strings.TrimSpace(settings.PermissionType) {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("initial turn permission conflicts with create snapshot"))
	}
	req.Model = strings.TrimSpace(settings.ModelID)
	req.Options.PermissionType = strings.TrimSpace(settings.PermissionType)
	capability, modelDefault, _, err := s.threadReasoningDefaults(ctxOrBackground(ctx), req.Model)
	if err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	threadDefault, err := parseStoredReasoningSelection(settings.ReasoningSelectionJSON)
	if err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	resolvedReasoning, err := resolveEffectiveReasoning(capability, req.Options.ReasoningSelection, threadDefault, modelDefault)
	if err != nil {
		return fail(initialTurnPhaseLookupFrozenState, reasoningSelectionError(req.Model, err))
	}
	req.Options.ReasoningSelection = resolvedReasoning.Effective

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("threads store not ready"))
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	createRequest := threadstore.PrepareThreadCreateRequest{
		ClientRequestID: clientRequestID, Settings: settings, ExplicitTitle: strings.TrimSpace(create.Title),
	}

	s.orphanMaintenanceMu.Lock()
	locked := true
	defer func() {
		if locked {
			s.orphanMaintenanceMu.Unlock()
		}
	}()

	pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	operation, operationErr := db.GetThreadCreateOperationByClientRequest(pctx, settings.EndpointID, clientRequestID)
	cancel()
	if operationErr != nil && !errors.Is(operationErr, sql.ErrNoRows) {
		return fail(initialTurnPhaseLookupFrozenState, operationErr)
	}
	if errors.Is(operationErr, sql.ErrNoRows) {
		prepared, normalizedInput, prepareErr := s.prepareUserTurnForTarget(ctxOrBackground(ctx), meta, settings.EndpointID, clientRequestID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability, false)
		if prepareErr != nil {
			return fail(initialTurnPhasePrepareAtomic, prepareErr)
		}
		req.Input = normalizedInput
		frozen, buildErr := buildInitialQueuedTurn(meta, req, settings, prepared, stableInitialQueueID(settings.EndpointID, meta.UserPublicID, clientRequestID))
		if buildErr != nil {
			return fail(initialTurnPhasePrepareAtomic, buildErr)
		}
		createRequest.CreatedAtMS = prepared.CreatedAtUnixMs
		pctx, cancel = context.WithTimeout(ctxOrBackground(ctx), persistTO)
		operation, _, err = db.PrepareThreadCreateWithInitialTurn(pctx, createRequest, frozen, prepared.UploadIDs, prepared.CreatedAtUnixMs, prepared.AttachmentAdmission, prepared.StagingScope)
		cancel()
		if err != nil {
			if errors.Is(err, threadstore.ErrThreadCreateConflict) {
				err = fmt.Errorf("%w: %v", ErrInitialTurnStateConflict, err)
			}
			return fail(initialTurnPhasePrepareAtomic, err)
		}
	}
	if operation.InitialTurn == nil {
		return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: create operation has no frozen initial command", ErrInitialTurnStateConflict))
	}
	if err := matchInitialFrozenCreateRequest(create, settings, operation); err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	if err := matchInitialFrozenTurnRequest(meta, req, *operation.InitialTurn); err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}

	committedSettings, err := s.resumeThreadCreateOperation(ctxOrBackground(ctx), operation)
	if err != nil {
		return fail(initialTurnPhaseResumeCanonicalCreate, err)
	}
	pctx, cancel = context.WithTimeout(ctxOrBackground(ctx), persistTO)
	frozen, commandErr := db.GetQueuedTurn(pctx, settings.EndpointID, committedSettings.ThreadID, operation.InitialTurn.QueueID)
	cancel()
	if commandErr != nil && !errors.Is(commandErr, sql.ErrNoRows) {
		return fail(initialTurnPhaseLookupFrozenState, commandErr)
	}
	if errors.Is(commandErr, sql.ErrNoRows) {
		receipt, receiptErr := db.GetPendingTurnAdmissionReceipt(ctxOrBackground(ctx), operation.InitialTurn.QueueID)
		if receiptErr != nil {
			return fail(initialTurnPhaseVerifyCanonicalReceipt, receiptErr)
		}
		if receipt.Stage != threadstore.PendingTurnAdmissionStageSettled || receipt.ThreadID != committedSettings.ThreadID || receipt.TurnID == "" || receipt.RunID == "" {
			return fail(initialTurnPhaseVerifyCanonicalReceipt, fmt.Errorf("%w: initial admission receipt is incomplete", ErrInitialTurnStateConflict))
		}
		canonicalReq := req
		canonicalReq.ThreadID = committedSettings.ThreadID
		canonicalReq.Input.TurnID = receipt.TurnID
		verified, verifyErr := s.canonicalFrozenTurnReceipt(ctxOrBackground(ctx), meta, db, canonicalReq)
		if verifyErr != nil || verified == nil || verified.RunID != receipt.RunID {
			if verifyErr == nil {
				verifyErr = fmt.Errorf("%w: canonical initial turn does not match its durable receipt", ErrInitialTurnStateConflict)
			}
			return fail(initialTurnPhaseVerifyCanonicalReceipt, verifyErr)
		}
		verified.ClientRequestID = clientRequestID
		verified.ThreadID = committedSettings.ThreadID
		return *verified, nil
	}
	if frozen == nil || frozen.TurnID != "" || frozen.RunID != "" {
		return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: initial command contains preallocated canonical identity", ErrInitialTurnStateConflict))
	}
	if err := matchInitialFrozenTurnRequest(meta, req, *frozen); err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	if frozen.AdmissionState != threadstore.PendingTurnAdmissionReady && frozen.AdmissionState != threadstore.PendingTurnAdmissionInFlight {
		return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: unsupported command admission state %q", ErrInitialTurnStateConflict, frozen.AdmissionState))
	}

	s.orphanMaintenanceMu.Unlock()
	locked = false
	if frozen.AdmissionState == threadstore.PendingTurnAdmissionInFlight {
		if !s.matchingInitialTurnAdmissionActive(*frozen) {
			return fail(initialTurnPhaseStartAdmission, ErrThreadBusy)
		}
		return SendUserTurnResponse{ClientRequestID: clientRequestID, ThreadID: committedSettings.ThreadID, AdmissionID: frozen.QueueID, Kind: "admitting", AppliedPermissionType: committedSettings.PermissionType}, nil
	}
	startRequest, err := queuedTurnRecordToRunStartRequest(*frozen, committedSettings.PermissionType)
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	frozenMeta, err := queuedTurnRecordToSessionMeta(*frozen, committedSettings.NamespacePublicID)
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	_, _, err = s.startUserTurnDetached(ctxOrBackground(ctx), frozenMeta, frozen.QueueID, startRequest, frozen.QueueID)
	if errors.Is(err, ErrThreadBusy) {
		if s.matchingInitialTurnAdmissionActive(*frozen) {
			err = nil
		}
	}
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	return SendUserTurnResponse{ClientRequestID: clientRequestID, ThreadID: committedSettings.ThreadID, AdmissionID: frozen.QueueID, Kind: "admitting", AppliedPermissionType: committedSettings.PermissionType}, nil
}

func (s *Service) matchingInitialTurnAdmissionActive(frozen threadstore.QueuedTurn) bool {
	if s == nil {
		return false
	}
	threadKey := runThreadKey(frozen.EndpointID, frozen.ThreadID)
	executionKey := strings.TrimSpace(frozen.QueueID)
	s.mu.Lock()
	defer s.mu.Unlock()
	activeExecutionKey := strings.TrimSpace(s.activeRunByTh[threadKey])
	active := s.runs[activeExecutionKey]
	return activeExecutionKey == executionKey && active != nil && strings.TrimSpace(active.threadID) == strings.TrimSpace(frozen.ThreadID)
}

func matchInitialFrozenCreateRequest(create CreateThreadRequest, settings threadstore.ThreadSettings, operation threadstore.ThreadCreateOperation) error {
	if strings.TrimSpace(create.ClientRequestID) != strings.TrimSpace(operation.ClientRequestID) ||
		strings.TrimSpace(create.Title) != strings.TrimSpace(operation.ExplicitTitle) ||
		strings.TrimSpace(settings.EndpointID) != strings.TrimSpace(operation.Settings.EndpointID) ||
		strings.TrimSpace(settings.NamespacePublicID) != strings.TrimSpace(operation.Settings.NamespacePublicID) ||
		strings.TrimSpace(settings.ModelID) != strings.TrimSpace(operation.Settings.ModelID) ||
		strings.TrimSpace(settings.PermissionType) != strings.TrimSpace(operation.Settings.PermissionType) ||
		strings.TrimSpace(settings.WorkingDir) != strings.TrimSpace(operation.Settings.WorkingDir) ||
		strings.TrimSpace(settings.ReasoningSelectionJSON) != strings.TrimSpace(operation.Settings.ReasoningSelectionJSON) {
		return ErrInitialTurnStateConflict
	}
	return nil
}

func (s *Service) waitForMatchingInitialTurnAdmission(ctx context.Context, frozen threadstore.QueuedTurn) (admittedUserTurn, error) {
	if s == nil {
		return admittedUserTurn{}, ErrThreadBusy
	}
	threadKey := runThreadKey(frozen.EndpointID, frozen.ThreadID)
	executionKey := strings.TrimSpace(frozen.QueueID)
	s.mu.Lock()
	activeExecutionKey := strings.TrimSpace(s.activeRunByTh[threadKey])
	active := s.runs[activeExecutionKey]
	s.mu.Unlock()
	if activeExecutionKey != executionKey || active == nil || strings.TrimSpace(active.threadID) != strings.TrimSpace(frozen.ThreadID) {
		return admittedUserTurn{}, ErrThreadBusy
	}
	return active.waitForUserTurnAdmission(ctxOrBackground(ctx))
}

func buildInitialQueuedTurn(meta *session.Meta, req SendUserTurnRequest, settings threadstore.ThreadSettings, prepared preparedUserTurn, queueID string) (threadstore.QueuedTurn, error) {
	queueID = strings.TrimSpace(queueID)
	if queueID == "" {
		return threadstore.QueuedTurn{}, errors.New("initial queue identity is missing")
	}
	contextActionJSON, err := marshalQueuedTurnContextAction(req.Input.ContextAction)
	if err != nil {
		return threadstore.QueuedTurn{}, err
	}
	attachmentsJSON, err := marshalQueuedTurnAttachments(req.Input.Attachments)
	if err != nil {
		return threadstore.QueuedTurn{}, err
	}
	optionsJSON, err := marshalQueuedTurnOptions(req.Options)
	if err != nil {
		return threadstore.QueuedTurn{}, err
	}
	sessionMetaJSON, err := marshalQueuedTurnSessionMeta(meta)
	if err != nil {
		return threadstore.QueuedTurn{}, err
	}
	return threadstore.QueuedTurn{
		QueueID: queueID, EndpointID: settings.EndpointID, ChannelID: strings.TrimSpace(meta.ChannelID),
		Lane: threadstore.FollowupLaneQueued, ModelID: req.Model, TextContent: req.Input.Text,
		AttachmentsJSON: attachmentsJSON, ContextActionJSON: contextActionJSON, OptionsJSON: optionsJSON, SessionMetaJSON: sessionMetaJSON,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), CreatedByUserEmail: strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs: prepared.CreatedAtUnixMs,
	}, nil
}

func matchInitialFrozenTurnRequest(meta *session.Meta, req SendUserTurnRequest, rec threadstore.QueuedTurn) error {
	if meta == nil || strings.TrimSpace(rec.EndpointID) != strings.TrimSpace(meta.EndpointID) || strings.TrimSpace(rec.ChannelID) != strings.TrimSpace(meta.ChannelID) {
		return ErrTurnIdempotencyConflict
	}
	contextAction, err := normalizeAskFlowerContextActionEnvelope(req.Input.ContextAction)
	if err != nil {
		return err
	}
	contextJSON, err := marshalQueuedTurnContextAction(contextAction)
	if err != nil {
		return err
	}
	attachmentsJSON, err := marshalQueuedTurnAttachments(req.Input.Attachments)
	if err != nil {
		return err
	}
	optionsJSON, err := marshalQueuedTurnOptions(req.Options)
	if err != nil {
		return err
	}
	sessionJSON, err := marshalQueuedTurnSessionMeta(meta)
	if err != nil {
		return err
	}
	if strings.TrimSpace(rec.ModelID) != strings.TrimSpace(req.Model) || rec.TextContent != req.Input.Text || rec.AttachmentsJSON != attachmentsJSON || rec.ContextActionJSON != contextJSON || rec.OptionsJSON != optionsJSON || rec.SessionMetaJSON != sessionJSON {
		return ErrTurnIdempotencyConflict
	}
	return nil
}

func (s *Service) logInitialTurnFailure(phase, clientRequestID, turnID string, err error) {
	if s == nil || s.log == nil || err == nil {
		return
	}
	s.log.Warn("flower initial turn failed", "phase", logsafe.Text(phase, 128), "client_request_id", logsafe.Text(clientRequestID, 256), "turn_id", logsafe.Text(turnID, 256), "error_class", classifyInitialTurnError(err))
}

func classifyInitialTurnError(err error) string {
	switch {
	case err == nil:
		return "none"
	case errors.Is(err, ErrTurnIdempotencyConflict):
		return "idempotency_conflict"
	case errors.Is(err, ErrInitialTurnStateConflict):
		return "state_conflict"
	case errors.Is(err, threadstore.ErrPendingTurnAdmissionInProgress):
		return "admission_in_progress"
	case errors.Is(err, flruntime.ErrThreadNotFound):
		return "canonical_thread_not_found"
	case errors.Is(err, flruntime.ErrTurnNotFound), errors.Is(err, sql.ErrNoRows):
		return "not_found"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline_exceeded"
	default:
		return "contract_error"
	}
}

package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v2/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

const (
	initialTurnPhaseLookupFrozenState      = "lookup_frozen_state"
	initialTurnPhasePrepareAtomic          = "prepare_atomic"
	initialTurnPhaseResumeCanonicalCreate  = "resume_canonical_create"
	initialTurnPhaseStartAdmission         = "start_admission"
	initialTurnPhaseVerifyCanonicalReceipt = "verify_canonical_receipt"
)

func (s *Service) sendInitialUserTurn(ctx context.Context, meta *session.Meta, req SendUserTurnRequest) (SendUserTurnResponse, error) {
	fail := func(phase string, err error) (SendUserTurnResponse, error) {
		s.logInitialTurnFailure(phase, req.ThreadID, req.Input.TurnID, err)
		return SendUserTurnResponse{}, err
	}
	if req.Create == nil {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("thread create snapshot is missing"))
	}
	if strings.TrimSpace(req.Input.TurnID) == "" {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("initial turn_id is required"))
	}
	create := *req.Create
	create.ThreadID = strings.TrimSpace(req.ThreadID)
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
		Settings: settings, ExplicitTitle: strings.TrimSpace(create.Title),
	}

	// Initial creation and admission share one owner so concurrent retries can
	// only observe a complete frozen state or the exact first frozen identity.
	s.orphanMaintenanceMu.Lock()
	defer s.orphanMaintenanceMu.Unlock()

	pctx, cancel := context.WithTimeout(ctxOrBackground(ctx), persistTO)
	frozen, commandErr := db.GetFollowupByLaneAndTurnID(pctx, settings.EndpointID, settings.ThreadID, threadstore.FollowupLaneQueued, req.Input.TurnID)
	operation, operationErr := db.GetMatchingInitialThreadCreateOperation(pctx, createRequest)
	cancel()
	if commandErr != nil && !errors.Is(commandErr, sql.ErrNoRows) {
		return fail(initialTurnPhaseLookupFrozenState, commandErr)
	}
	if operationErr != nil && !errors.Is(operationErr, sql.ErrNoRows) {
		if errors.Is(operationErr, threadstore.ErrThreadCreateConflict) {
			operationErr = fmt.Errorf("%w: %v", ErrInitialTurnStateConflict, operationErr)
		}
		return fail(initialTurnPhaseLookupFrozenState, operationErr)
	}
	hasCommand := commandErr == nil
	hasOperation := operationErr == nil

	if !hasOperation && !hasCommand {
		var prepared preparedUserTurn
		prepared, req.Input, err = s.prepareUserTurn(ctxOrBackground(ctx), meta, settings.EndpointID, settings.ThreadID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability)
		if err != nil {
			return fail(initialTurnPhasePrepareAtomic, err)
		}
		frozen, err = buildInitialQueuedTurn(meta, req, settings, prepared)
		if err != nil {
			return fail(initialTurnPhasePrepareAtomic, err)
		}
		createRequest.CreatedAtMS = prepared.CreatedAtUnixMs
		pctx, cancel = context.WithTimeout(ctxOrBackground(ctx), persistTO)
		operation, frozen, err = db.PrepareThreadCreateWithInitialTurn(pctx, createRequest, frozen, prepared.UploadIDs, prepared.CreatedAtUnixMs, prepared.AttachmentAdmission, prepared.StagingScope)
		cancel()
		if err != nil {
			if errors.Is(err, threadstore.ErrThreadCreateConflict) {
				err = fmt.Errorf("%w: %v", ErrInitialTurnStateConflict, err)
			}
			return fail(initialTurnPhasePrepareAtomic, err)
		}
		hasOperation = true
		hasCommand = true
	}

	if !hasOperation || (!hasCommand && operation.Status != threadstore.ThreadCreateOperationCommitted) {
		return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: incomplete product create operation and command", ErrInitialTurnStateConflict))
	}
	if !hasCommand {
		receipt, verifyErr := s.canonicalFrozenTurnReceipt(ctxOrBackground(ctx), meta, db, req)
		if verifyErr != nil {
			return fail(initialTurnPhaseVerifyCanonicalReceipt, verifyErr)
		}
		if receipt == nil {
			return fail(initialTurnPhaseVerifyCanonicalReceipt, fmt.Errorf("%w: committed create has no matching canonical turn", ErrInitialTurnStateConflict))
		}
		return *receipt, nil
	}
	if err := matchFrozenTurnRequest(meta, req, frozen); err != nil {
		return fail(initialTurnPhaseLookupFrozenState, err)
	}
	if operation.Status != threadstore.ThreadCreateOperationPending && operation.Status != threadstore.ThreadCreateOperationCommitted {
		return fail(initialTurnPhaseResumeCanonicalCreate, fmt.Errorf("%w: unsupported create operation status %q", ErrInitialTurnStateConflict, operation.Status))
	}
	if frozen.AdmissionState == threadstore.PendingTurnAdmissionInFlight {
		if operation.Status != threadstore.ThreadCreateOperationCommitted {
			return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: admission started before create committed", ErrInitialTurnStateConflict))
		}
		return initialTurnReceipt(frozen, settings.PermissionType), nil
	}
	if frozen.AdmissionState != threadstore.PendingTurnAdmissionReady {
		return fail(initialTurnPhaseLookupFrozenState, fmt.Errorf("%w: unsupported command admission state %q", ErrInitialTurnStateConflict, frozen.AdmissionState))
	}

	committedSettings, err := s.resumeThreadCreateOperation(ctxOrBackground(ctx), operation)
	if err != nil {
		return fail(initialTurnPhaseResumeCanonicalCreate, err)
	}
	startRequest, err := queuedTurnRecordToRunStartRequest(frozen, committedSettings.PermissionType)
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	frozenMeta, err := queuedTurnRecordToSessionMeta(frozen, committedSettings.NamespacePublicID)
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	admitted, _, err := s.startUserTurnDetached(ctxOrBackground(ctx), frozenMeta, frozen.RunID, startRequest, frozen.QueueID)
	if errors.Is(err, ErrThreadBusy) {
		admitted, err = s.waitForMatchingInitialTurnAdmission(ctxOrBackground(ctx), frozen)
	}
	if err != nil {
		return fail(initialTurnPhaseStartAdmission, err)
	}
	return SendUserTurnResponse{
		RunID: admitted.RunID, TurnID: admitted.TurnID, Kind: "start", AppliedPermissionType: committedSettings.PermissionType,
	}, nil
}

func (s *Service) waitForMatchingInitialTurnAdmission(ctx context.Context, frozen threadstore.QueuedTurn) (admittedUserTurn, error) {
	if s == nil {
		return admittedUserTurn{}, ErrThreadBusy
	}
	threadKey := runThreadKey(frozen.EndpointID, frozen.ThreadID)
	runID := strings.TrimSpace(frozen.RunID)
	turnID := strings.TrimSpace(frozen.TurnID)
	s.mu.Lock()
	activeRunID := strings.TrimSpace(s.activeRunByTh[threadKey])
	active := s.runs[activeRunID]
	s.mu.Unlock()
	if activeRunID != runID || active == nil || strings.TrimSpace(active.threadID) != strings.TrimSpace(frozen.ThreadID) || strings.TrimSpace(active.turnID) != turnID {
		return admittedUserTurn{}, ErrThreadBusy
	}
	return active.waitForUserTurnAdmission(ctxOrBackground(ctx))
}

func buildInitialQueuedTurn(meta *session.Meta, req SendUserTurnRequest, settings threadstore.ThreadSettings, prepared preparedUserTurn) (threadstore.QueuedTurn, error) {
	runID, err := NewRunID()
	if err != nil {
		return threadstore.QueuedTurn{}, err
	}
	queueID, err := NewQueuedTurnID()
	if err != nil {
		return threadstore.QueuedTurn{}, err
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
		QueueID: queueID, EndpointID: settings.EndpointID, ThreadID: settings.ThreadID, ChannelID: strings.TrimSpace(meta.ChannelID),
		Lane: threadstore.FollowupLaneQueued, TurnID: prepared.TurnID, RunID: runID, ModelID: req.Model,
		TextContent: req.Input.Text, AttachmentsJSON: attachmentsJSON, ContextActionJSON: contextActionJSON,
		OptionsJSON: optionsJSON, SessionMetaJSON: sessionMetaJSON,
		CreatedByUserPublicID: strings.TrimSpace(meta.UserPublicID), CreatedByUserEmail: strings.TrimSpace(meta.UserEmail),
		CreatedAtUnixMs: prepared.CreatedAtUnixMs,
	}, nil
}

func initialTurnReceipt(rec threadstore.QueuedTurn, permissionType string) SendUserTurnResponse {
	return SendUserTurnResponse{
		RunID: strings.TrimSpace(rec.RunID), TurnID: strings.TrimSpace(rec.TurnID), Kind: "start",
		AppliedPermissionType: strings.TrimSpace(permissionType),
	}
}

func (s *Service) logInitialTurnFailure(phase, threadID, turnID string, err error) {
	if s == nil || s.log == nil || err == nil {
		return
	}
	s.log.Warn("flower initial turn failed",
		"phase", strings.TrimSpace(phase),
		"thread_id", strings.TrimSpace(threadID),
		"turn_id", strings.TrimSpace(turnID),
		"error_class", classifyInitialTurnError(err),
	)
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

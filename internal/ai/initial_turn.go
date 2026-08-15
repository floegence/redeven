package ai

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/session"
)

const (
	initialTurnPhaseLookupFrozenState     = "lookup_frozen_state"
	initialTurnPhasePrepareAtomic         = "prepare_atomic"
	initialTurnPhaseResumeCanonicalCreate = "resume_canonical_create"
	initialTurnPhaseStartCommand          = "start_command"
)

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

	thread, err := s.CreateThreadWithOptions(ctxOrBackground(ctx), meta, create)
	if err != nil {
		return fail(initialTurnPhaseResumeCanonicalCreate, err)
	}
	if thread == nil || strings.TrimSpace(thread.ThreadID) == "" {
		return fail(initialTurnPhaseResumeCanonicalCreate, errors.New("created thread identity is missing"))
	}
	if replay, found, replayErr := s.typedSendLookup(ctxOrBackground(ctx), thread.ThreadID, clientRequestID); replayErr != nil {
		return fail(initialTurnPhaseStartCommand, replayErr)
	} else if found {
		replay.AppliedPermissionType = settings.PermissionType
		return replay, nil
	}
	prepared, normalizedInput, err := s.prepareUserTurnForTarget(ctxOrBackground(ctx), meta, settings.EndpointID, clientRequestID, req.Model, req.Input, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		return fail(initialTurnPhasePrepareAtomic, err)
	}
	if len(prepared.UploadIDs) > 0 {
		if prepared.StagingScope == nil {
			return fail(initialTurnPhasePrepareAtomic, errors.New("initial attachments require an upload staging scope"))
		}
		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		if db == nil {
			return fail(initialTurnPhasePrepareAtomic, errors.New("threads store not ready"))
		}
		if err := db.ClaimStagedUploadsToThread(ctxOrBackground(ctx), settings.EndpointID, thread.ThreadID, prepared.UploadIDs, prepared.CreatedAtUnixMs, prepared.AttachmentClaimPolicy, *prepared.StagingScope); err != nil {
			return fail(initialTurnPhasePrepareAtomic, err)
		}
	}
	req.ClientRequestID = clientRequestID
	req.ThreadID = thread.ThreadID
	req.Create = nil
	req.Input = normalizedInput
	response, handled, err := s.sendTypedExistingThread(ctxOrBackground(ctx), meta, req)
	if !handled && err == nil {
		err = errors.New("floret thread runtime not ready")
	}
	if err != nil {
		return fail(initialTurnPhaseStartCommand, err)
	}
	response.AppliedPermissionType = settings.PermissionType
	return response, nil
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

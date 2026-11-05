package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/logsafe"
	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

const (
	initialTurnPhaseLookupFrozenState     = "lookup_frozen_state"
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
	if !validClientRequestID(clientRequestID) {
		return fail(initialTurnPhaseLookupFrozenState, errors.New("invalid client_request_id"))
	}
	create := *req.Create
	if req.PluginDraftID != "" {
		if s.pluginCreation == nil {
			return fail(initialTurnPhaseLookupFrozenState, plugincreation.ErrNotFound)
		}
		source, e := s.pluginCreation.SourceScope(ctx, meta, req.PluginDraftID)
		if e != nil {
			return fail(initialTurnPhaseLookupFrozenState, e)
		}
		create.WorkingDir = source.Directory
		create.managedSource = &source
	}
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
	capability, modelDefault, _, err := s.threadReasoningDefaults(ctxOrBackground(ctx), meta, req.Model)
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

	if req.PluginDraftID != "" {
		owner, e := plugincreation.OwnerFromSession(meta)
		if e != nil {
			return fail(initialTurnPhaseLookupFrozenState, e)
		}
		frozen, e := json.Marshal(create)
		if e != nil {
			return fail(initialTurnPhaseLookupFrozenState, e)
		}
		if _, e = s.pluginCreation.Store.FreezeLaunch(ctx, owner, req.PluginDraftID, clientRequestID, string(frozen)); e != nil {
			return fail(initialTurnPhaseLookupFrozenState, e)
		}
	}
	thread, err := s.CreateThreadWithOptions(ctxOrBackground(ctx), meta, create)
	if err != nil {
		return fail(initialTurnPhaseResumeCanonicalCreate, err)
	}
	if thread == nil || strings.TrimSpace(thread.ThreadID) == "" {
		return fail(initialTurnPhaseResumeCanonicalCreate, errors.New("created thread identity is missing"))
	}
	if req.PluginDraftID != "" {
		owner, e := plugincreation.OwnerFromSession(meta)
		if e != nil {
			return fail(initialTurnPhaseResumeCanonicalCreate, e)
		}
		if _, e = s.pluginCreation.Store.BindThread(ctx, owner, req.PluginDraftID, clientRequestID, thread.ThreadID); e != nil {
			return fail(initialTurnPhaseResumeCanonicalCreate, e)
		}
	}
	req.ClientRequestID = clientRequestID
	req.ThreadID = thread.ThreadID
	req.Create = nil
	response, handled, err := s.sendTypedExistingThread(ctxOrBackground(ctx), meta, req, clientRequestID)
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

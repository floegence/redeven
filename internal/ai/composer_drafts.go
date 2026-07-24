package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

const composerDraftAdmissionReconcileDelay = 30 * time.Second

type ComposerDraftMutationRequest struct {
	ScopeID          string          `json:"scope_id"`
	HolderID         string          `json:"holder_id"`
	LeaseID          string          `json:"lease_id"`
	ExpectedRevision int64           `json:"expected_revision"`
	Value            json.RawMessage `json:"value"`
}

type ComposerDraftThreadRequest struct {
	ExpectedDraftRevision int64               `json:"expected_draft_revision"`
	TurnID                string              `json:"turn_id"`
	Create                CreateThreadRequest `json:"create"`
}

type ComposerDraftThreadResponse struct {
	ThreadID      string `json:"thread_id"`
	DraftRevision int64  `json:"draft_revision"`
}

func (s *Service) composerDraftStore() (*threadstore.Store, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	return db, nil
}

func (s *Service) LoadComposerDraft(ctx context.Context, owner UploadOwner, scopeID string) (threadstore.ComposerDraftRecord, error) {
	db, err := s.composerDraftStore()
	if err != nil {
		return threadstore.ComposerDraftRecord{}, err
	}
	draft, err := db.GetComposerDraft(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, strings.TrimSpace(scopeID), time.Now().UnixMilli())
	return redactComposerDraftLease(draft), err
}

func redactComposerDraftLease(draft threadstore.ComposerDraftRecord) threadstore.ComposerDraftRecord {
	draft.LeaseID = ""
	draft.LeaseHolderID = ""
	draft.LeaseExpiresAtUnixMs = 0
	return draft
}

func (s *Service) AcquireComposerDraftLease(ctx context.Context, owner UploadOwner, scopeID, holderID string, takeOver bool) (threadstore.ComposerDraftLeaseResult, error) {
	db, err := s.composerDraftStore()
	if err != nil {
		return threadstore.ComposerDraftLeaseResult{}, err
	}
	if err := s.reconcileStaleComposerDraftAdmission(ctxOrBackground(ctx), db, owner, strings.TrimSpace(scopeID)); err != nil {
		return threadstore.ComposerDraftLeaseResult{}, err
	}
	result, err := db.AcquireComposerDraftLease(
		ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash,
		strings.TrimSpace(scopeID), strings.TrimSpace(holderID), takeOver, time.Now().UnixMilli(),
	)
	if result.State != "owned" {
		result.Draft = redactComposerDraftLease(result.Draft)
		result.Holder = "another_surface"
	}
	return result, err
}

func (s *Service) reconcileStaleComposerDraftAdmission(ctx context.Context, db *threadstore.Store, owner UploadOwner, scopeID string) error {
	now := time.Now().UnixMilli()
	draft, err := db.GetComposerDraft(ctx, owner.EndpointID, owner.OwnerUserHash, scopeID, now)
	if err != nil {
		return err
	}
	var value struct {
		AdmissionStarted bool   `json:"admission_started"`
		ProposedTurnID   string `json:"proposed_turn_id"`
		TargetThreadID   string `json:"target_thread_id"`
	}
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		return err
	}
	turnID := strings.TrimSpace(value.ProposedTurnID)
	if !value.AdmissionStarted || turnID == "" || draft.LeaseExpiresAtUnixMs > now || now-draft.UpdatedAtUnixMs < composerDraftAdmissionReconcileDelay.Milliseconds() {
		return nil
	}
	targetThreadID := strings.TrimSpace(value.TargetThreadID)
	if targetThreadID == "" && scopeID != "__new_thread__" {
		targetThreadID = scopeID
	}
	accepted := false
	if targetThreadID != "" {
		accepted, err = db.HasPendingTurnID(ctx, owner.EndpointID, targetThreadID, turnID)
		if err != nil {
			return err
		}
		if !accepted {
			settings, readErr := db.GetThreadSettings(ctx, owner.EndpointID, targetThreadID)
			if readErr != nil {
				return readErr
			}
			if settings != nil {
				host, openErr := s.openFloretThreadReadHost(ctx, targetThreadID)
				if openErr != nil {
					return openErr
				}
				accepted, err = floretThreadContainsTurn(ctx, host, targetThreadID, turnID)
				if err != nil {
					return err
				}
			}
		}
	}
	result, err := db.ReconcileComposerDraftAdmission(ctx, owner.EndpointID, owner.OwnerUserHash, scopeID, turnID, accepted, now)
	if err != nil {
		return err
	}
	_, err = s.processUploadCleanupCandidates(ctx, result.UploadsToDelete)
	return err
}

func (s *Service) reconcileStaleComposerDraftAdmissions(ctx context.Context, db *threadstore.Store, limit int) (int64, error) {
	if s == nil || db == nil {
		return 0, nil
	}
	now := time.Now()
	cutoff := now.Add(-composerDraftAdmissionReconcileDelay).UnixMilli()
	var reconciled int64
	var reconcileErrors []error
	var after *threadstore.ComposerDraftAdmissionCandidate
	for {
		candidates, err := db.ListStaleComposerDraftAdmissionsAfter(ctxOrBackground(ctx), cutoff, now.UnixMilli(), after, limit)
		if err != nil {
			reconcileErrors = append(reconcileErrors, err)
			return reconciled, errors.Join(reconcileErrors...)
		}
		if len(candidates) == 0 {
			return reconciled, errors.Join(reconcileErrors...)
		}
		for _, candidate := range candidates {
			owner := UploadOwner{EndpointID: candidate.EndpointID, OwnerUserHash: candidate.OwnerUserHash}
			err := s.reconcileStaleComposerDraftAdmission(ctxOrBackground(ctx), db, owner, candidate.ScopeID)
			if errors.Is(err, threadstore.ErrComposerDraftRevisionConflict) {
				continue
			}
			if err != nil {
				reconcileErrors = append(reconcileErrors, fmt.Errorf("reconcile composer draft %q: %w", candidate.ScopeID, err))
				continue
			}
			reconciled++
		}
		last := candidates[len(candidates)-1]
		after = &last
	}
}

func floretThreadContainsTurn(ctx context.Context, host floretThreadReadHost, threadID, turnID string) (bool, error) {
	var before *flruntime.ThreadTurnsBeforeCursor
	for {
		req := flruntime.ListThreadTurnsRequest{ThreadID: flruntime.ThreadID(threadID)}
		if before == nil {
			req.Tail = 200
		} else {
			req.BeforeCursor = before
			req.Limit = 200
		}
		page, err := host.ListThreadTurns(ctx, req)
		if err != nil {
			return false, err
		}
		for _, turn := range page.Turns {
			if strings.TrimSpace(string(turn.TurnID)) == turnID {
				return true, nil
			}
		}
		if !page.HasMore {
			return false, nil
		}
		if len(page.Turns) == 0 || page.BeforeCursor == nil || strings.TrimSpace(page.BeforeCursor.EntryID) == "" {
			return false, errors.New("Floret turn pagination stopped before admission reconciliation")
		}
		if before != nil && before.EntryID == page.BeforeCursor.EntryID {
			return false, errors.New("Floret turn pagination did not advance during admission reconciliation")
		}
		before = page.BeforeCursor
	}
}

func (s *Service) RenewComposerDraftLease(ctx context.Context, owner UploadOwner, scopeID, holderID, leaseID string) (threadstore.ComposerDraftLeaseResult, error) {
	db, err := s.composerDraftStore()
	if err != nil {
		return threadstore.ComposerDraftLeaseResult{}, err
	}
	result, err := db.RenewComposerDraftLease(
		ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash,
		strings.TrimSpace(scopeID), strings.TrimSpace(holderID), strings.TrimSpace(leaseID), time.Now().UnixMilli(),
	)
	if result.State != "owned" {
		result.Draft = redactComposerDraftLease(result.Draft)
	}
	return result, err
}

func (s *Service) MutateComposerDraft(ctx context.Context, owner UploadOwner, request ComposerDraftMutationRequest) (threadstore.ComposerDraftRecord, error) {
	db, err := s.composerDraftStore()
	if err != nil {
		return threadstore.ComposerDraftRecord{}, err
	}
	draft, err := db.MutateComposerDraft(ctxOrBackground(ctx), threadstore.ComposerDraftMutation{
		EndpointID: owner.EndpointID, OwnerUserHash: owner.OwnerUserHash,
		ScopeID: strings.TrimSpace(request.ScopeID), HolderID: strings.TrimSpace(request.HolderID),
		LeaseID: strings.TrimSpace(request.LeaseID), ExpectedRevision: request.ExpectedRevision,
		Value: request.Value, NowUnixMs: time.Now().UnixMilli(),
	})
	return redactComposerDraftLease(draft), err
}

func (s *Service) ReleaseComposerDraftLease(ctx context.Context, owner UploadOwner, scopeID, holderID, leaseID string) error {
	db, err := s.composerDraftStore()
	if err != nil {
		return err
	}
	return db.ReleaseComposerDraftLease(
		ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash,
		strings.TrimSpace(scopeID), strings.TrimSpace(holderID), strings.TrimSpace(leaseID),
	)
}

func (s *Service) PrepareComposerDraftThread(ctx context.Context, meta *session.Meta, owner UploadOwner, scopeID string, request ComposerDraftThreadRequest) (ComposerDraftThreadResponse, error) {
	if err := requireRWX(meta); err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	scopeID = strings.TrimSpace(scopeID)
	turnID := strings.TrimSpace(request.TurnID)
	if scopeID != "__new_thread__" || request.ExpectedDraftRevision < 0 || turnID == "" {
		return ComposerDraftThreadResponse{}, errors.New("invalid composer draft thread request")
	}
	db, err := s.composerDraftStore()
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	draftBeforeBind, err := db.GetComposerDraft(ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, scopeID, time.Now().UnixMilli())
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	var admissionValue struct {
		Text                         string `json:"text"`
		ModelID                      string `json:"model_id"`
		PreparedLongTextAttachmentID string `json:"prepared_long_text_attachment_id"`
		TargetThreadID               string `json:"target_thread_id"`
		Attachments                  []struct {
			Staged *struct {
				AttachmentID string `json:"attachment_id"`
			} `json:"staged"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(draftBeforeBind.Value, &admissionValue); err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	requestedModelID := strings.TrimSpace(request.Create.ModelID)
	if requestedModelID == "" {
		requestedModelID = strings.TrimSpace(admissionValue.ModelID)
	}
	s.mu.Lock()
	cfg := s.cfg
	s.mu.Unlock()
	resolvedModel, err := s.resolveRunModel(ctxOrBackground(ctx), cfg, requestedModelID, "", nil)
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	request.Create.ModelID = resolvedModel.ID
	input := RunInput{TurnID: turnID, Text: admissionValue.Text}
	if strings.TrimSpace(admissionValue.PreparedLongTextAttachmentID) != "" {
		input.Text = ""
	}
	for _, attachment := range admissionValue.Attachments {
		if attachment.Staged != nil {
			input.Attachments = append(input.Attachments, RunAttachmentIn{AttachmentID: strings.TrimSpace(attachment.Staged.AttachmentID)})
		}
	}
	normalizedInput, uploadIDs, attachmentAdmission, err := s.prepareInputAttachmentAdmission(
		ctxOrBackground(ctx), owner, scopeID, resolvedModel.ID, input,
	)
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	admissionRevision := request.ExpectedDraftRevision
	if strings.TrimSpace(admissionValue.TargetThreadID) != "" {
		admissionRevision = draftBeforeBind.Revision
	}
	if err := db.ValidateComposerDraftAdmission(ctxOrBackground(ctx), threadstore.QueuedTurn{
		EndpointID: owner.EndpointID, ThreadID: scopeID, TurnID: turnID,
		ModelID: resolvedModel.ID, TextContent: normalizedInput.Text,
	}, uploadIDs, threadstore.ComposerDraftAdmission{
		OwnerUserHash: owner.OwnerUserHash, DraftID: scopeID,
		ExpectedRevision: admissionRevision, Attachment: attachmentAdmission,
	}); err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	candidateThreadID, err := NewThreadID()
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	draft, err := db.BindComposerDraftTargetThread(
		ctxOrBackground(ctx), owner.EndpointID, owner.OwnerUserHash, scopeID,
		request.ExpectedDraftRevision, turnID, candidateThreadID, time.Now().UnixMilli(),
	)
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	var value struct {
		TargetThreadID string `json:"target_thread_id"`
	}
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	targetThreadID := strings.TrimSpace(value.TargetThreadID)
	if targetThreadID == "" {
		return ComposerDraftThreadResponse{}, errors.New("composer draft target thread is missing")
	}
	existing, err := db.GetThreadSettings(ctxOrBackground(ctx), owner.EndpointID, targetThreadID)
	if err != nil {
		return ComposerDraftThreadResponse{}, err
	}
	if existing == nil {
		request.Create.ThreadID = targetThreadID
		if _, err := s.CreateThreadWithOptions(ctxOrBackground(ctx), meta, request.Create); err != nil {
			// A retry may observe the durable create after the initial response was lost.
			existing, readErr := db.GetThreadSettings(ctxOrBackground(ctx), owner.EndpointID, targetThreadID)
			if readErr != nil || existing == nil {
				if readErr != nil && !errors.Is(readErr, sql.ErrNoRows) {
					return ComposerDraftThreadResponse{}, readErr
				}
				return ComposerDraftThreadResponse{}, err
			}
		}
	}
	return ComposerDraftThreadResponse{ThreadID: targetThreadID, DraftRevision: draft.Revision}, nil
}

package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type openedCanonicalAttachment struct {
	Membership CanonicalAttachmentMembership
	Upload     *OpenUploadResult
}

func canonicalViewAttachments(view flruntime.ThreadView) []flruntime.MessageAttachment {
	var attachments []flruntime.MessageAttachment
	for _, item := range view.Items {
		attachments = append(attachments, item.Attachments...)
	}
	for _, item := range view.Queue {
		attachments = append(attachments, item.Input.Attachments...)
	}
	for _, item := range view.RestoredInputs {
		attachments = append(attachments, item.Input.Attachments...)
	}
	return attachments
}

func (service *Service) retainCanonicalUploadDescriptors(ctx context.Context, endpointID, threadID string, attachments []flruntime.MessageAttachment) error {
	ids, err := service.canonicalUploadIDs(ctx, endpointID, threadID, attachments)
	if err != nil {
		return err
	}
	return service.threadsDB.RetainCanonicalUploads(ctx, endpointID, threadID, ids)
}

func (service *Service) canonicalUploadIDs(ctx context.Context, endpointID, threadID string, attachments []flruntime.MessageAttachment) ([]string, error) {
	var ids []string
	for _, attachment := range attachments {
		if isToolMediaRef(attachment.ResourceRef) {
			continue
		}
		id, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return nil, err
		}
		record, err := service.threadsDB.GetUpload(ctx, endpointID, id)
		if err != nil {
			return nil, err
		}
		if record == nil || record.State != threadstore.UploadStateLive || record.Name != attachment.Name || normalizeMediaType(record.DetectedMediaType) != normalizeMediaType(attachment.MIMEType) || record.SizeBytes != attachment.SizeBytes || !strings.EqualFold(record.ContentSHA256, digest) {
			return nil, errors.New("canonical attachment does not match the retained upload")
		}
		if _, err := service.threadsDB.GetThreadOwnedUpload(ctx, endpointID, threadID, id); errors.Is(err, sql.ErrNoRows) {
			ids = appendUniqueString(ids, id)
		} else if err != nil {
			return nil, err
		}
	}
	return ids, nil
}

func (service *Service) retainCanonicalUploadForOwner(ctx context.Context, owner UploadOwner, threadID string, membership CanonicalAttachmentMembership) error {
	if service == nil || service.threadsDB == nil {
		return errors.New("attachment store is unavailable")
	}
	record, err := service.threadsDB.GetUpload(ctx, owner.EndpointID, membership.AttachmentID)
	if err != nil {
		return err
	}
	if record == nil || record.OwnerUserHash != owner.OwnerUserHash {
		return sql.ErrNoRows
	}
	return service.retainCanonicalUploadDescriptors(ctx, owner.EndpointID, threadID, []flruntime.MessageAttachment{{
		ResourceRef: membership.ResourceRef,
		Name:        membership.Name,
		MIMEType:    membership.DetectedMediaType,
		SizeBytes:   membership.SizeBytes,
	}})
}

// Authorization reads bounded active-path windows. Queue, restored inputs and
// retention inventories never establish admitted attachment membership.
func (s *Service) findCanonicalAttachment(ctx context.Context, scope threadquery.Scope, threadID, exactTurnID string, matches func(flruntime.MessageAttachment) bool) (flruntime.MessageAttachment, string, error) {
	source, ok := s.threadRuntime.(flruntime.ThreadWindowSource)
	if !ok {
		return flruntime.MessageAttachment{}, "", errors.New("published Floret window contract is unavailable")
	}
	sub, err := source.SubscribeWindowUpdates(ctx, scope)
	if err != nil {
		return flruntime.MessageAttachment{}, "", err
	}
	defer sub.Close()
	before, leaf := "", ""
	for {
		requestID := "attachment:" + before
		if err := sub.SetWindow(ctx, scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), RequestID: requestID, AnchorID: before, Direction: flruntime.ThreadWindowBefore, Limit: 50, PreviewBytes: 128, ActivityFields: true}); err != nil {
			return flruntime.MessageAttachment{}, "", err
		}
		var window *flruntime.ThreadWindowSnapshot
		for window == nil {
			update, err := sub.Next(ctx)
			if err != nil {
				return flruntime.MessageAttachment{}, "", err
			}
			if update.Window != nil && update.Window.Value != nil && update.Window.Value.RequestID == requestID {
				window = update.Window.Value
			}
		}
		if leaf != "" && window.LeafID != leaf {
			return flruntime.MessageAttachment{}, "", errors.New("conversation changed during attachment lookup")
		}
		leaf = window.LeafID
		attachment, turn, err := findCanonicalThreadAttachment(flruntime.ThreadView{Items: window.Items}, exactTurnID, matches)
		if err == nil {
			return attachment, turn, nil
		}
		if !window.HasBefore {
			return flruntime.MessageAttachment{}, "", sql.ErrNoRows
		}
		if window.FirstItemID == "" || window.FirstItemID == before {
			return flruntime.MessageAttachment{}, "", errors.New("attachment history window did not advance")
		}
		before = window.FirstItemID
	}
}

func canonicalUploadMembership(threadID, turnID string, attachment flruntime.MessageAttachment) (CanonicalAttachmentMembership, error) {
	id, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
	if err != nil {
		return CanonicalAttachmentMembership{}, err
	}
	return CanonicalAttachmentMembership{ThreadID: threadID, TurnID: turnID, AttachmentID: id,
		ResourceRef: attachment.ResourceRef, ContentSHA256: digest, Name: attachment.Name,
		DetectedMediaType: attachment.MIMEType, SizeBytes: attachment.SizeBytes}, nil
}

func (s *Service) findCanonicalUpload(ctx context.Context, owner UploadOwner, threadID, exactTurnID, attachmentID string) (CanonicalAttachmentMembership, error) {
	if s == nil || s.threadRuntime == nil || s.threadsDB == nil || threadID == "" || !validUploadID(attachmentID) || owner.EndpointID == "" || len(owner.OwnerUserHash) != 64 {
		return CanonicalAttachmentMembership{}, sql.ErrNoRows
	}
	settings, err := s.threadsDB.GetThreadSettings(ctx, owner.EndpointID, threadID)
	if err != nil {
		return CanonicalAttachmentMembership{}, err
	}
	if settings == nil {
		return CanonicalAttachmentMembership{}, sql.ErrNoRows
	}
	scope := threadquery.Scope{Authority: "attachment:" + owner.EndpointID + ":" + owner.OwnerUserHash, ThreadIDs: []identity.ThreadID{identity.ThreadID(threadID)}}
	attachment, turn, err := s.findCanonicalAttachment(ctx, scope, threadID, exactTurnID, func(a flruntime.MessageAttachment) bool {
		id, _, err := immutableUploadIdentityFromFloretResourceRef(a.ResourceRef)
		return err == nil && id == attachmentID
	})
	if err != nil {
		return CanonicalAttachmentMembership{}, err
	}
	return canonicalUploadMembership(threadID, turn, attachment)
}

// This internal handle authenticates metadata only. Each bytes consumer verifies
// the digest while reading its own snapshot or publishing a working copy.
func (service *Service) openCanonicalLiveAttachment(ctx context.Context, owner UploadOwner, threadID, attachmentID string) (openedCanonicalAttachment, error) {
	membership, err := service.findCanonicalUpload(ctxOrBackground(ctx), owner, strings.TrimSpace(threadID), "", strings.TrimSpace(attachmentID))
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	if err := service.retainCanonicalUploadForOwner(ctxOrBackground(ctx), owner, membership.ThreadID, membership); err != nil {
		return openedCanonicalAttachment{}, err
	}
	upload, err := service.resolveLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, membership.AttachmentID, membership)
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	return openedCanonicalAttachment{Membership: membership, Upload: upload}, nil
}

func (service *Service) OpenCanonicalLiveAttachmentForTurn(ctx context.Context, owner UploadOwner, threadID, turnID, attachmentID string) (*OpenUploadResult, error) {
	threadID, turnID, attachmentID = strings.TrimSpace(threadID), strings.TrimSpace(turnID), strings.TrimSpace(attachmentID)
	if service == nil || service.threadRuntime == nil || threadID == "" || turnID == "" || !validUploadID(attachmentID) {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	membership, err := service.findCanonicalUpload(ctxOrBackground(ctx), owner, threadID, turnID, attachmentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
			return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
		}
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, fmt.Errorf("open canonical attachment authority: %w", err))
	}
	if err := service.retainCanonicalUploadForOwner(ctxOrBackground(ctx), owner, threadID, membership); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
		}
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, fmt.Errorf("retain canonical attachment: %w", err))
	}
	upload, err := service.resolveLiveUpload(ctx, owner, threadID, turnID, attachmentID, membership)
	if err != nil {
		return nil, err
	}
	return verifyOpenedLiveUpload(ctx, upload)
}

// Only canonical admitted items establish attachment membership. Queue, drafts
// and Activity targets are not admitted image ownership.
func findCanonicalThreadAttachment(view flruntime.ThreadView, exactTurnID string, matches func(flruntime.MessageAttachment) bool) (flruntime.MessageAttachment, string, error) {
	for _, item := range view.Items {
		if exactTurnID != "" && item.TurnID.String() != exactTurnID {
			continue
		}
		for _, attachment := range item.Attachments {
			if matches(attachment) {
				return attachment, item.TurnID.String(), nil
			}
		}
	}
	return flruntime.MessageAttachment{}, "", sql.ErrNoRows
}

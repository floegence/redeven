package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

type floretLiveAttachmentAuthority struct {
	service  *Service
	threadID string
}

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

func (service *Service) retainCanonicalUploadResources(ctx context.Context, endpointID string, view flruntime.ThreadView) error {
	return service.retainCanonicalUploadDescriptors(ctx, endpointID, view.ThreadID.String(), canonicalViewAttachments(view))
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

func (authority floretLiveAttachmentAuthority) ReadCanonicalAttachmentMembership(ctx context.Context, threadID, turnID, attachmentID string) (CanonicalAttachmentMembership, error) {
	if authority.service == nil || strings.TrimSpace(threadID) == "" || strings.TrimSpace(threadID) != strings.TrimSpace(authority.threadID) || !validUploadID(strings.TrimSpace(attachmentID)) {
		return CanonicalAttachmentMembership{}, sql.ErrNoRows
	}
	return authority.find(ctx, strings.TrimSpace(turnID), strings.TrimSpace(attachmentID))
}

func (authority floretLiveAttachmentAuthority) find(ctx context.Context, exactTurnID, attachmentID string) (CanonicalAttachmentMembership, error) {
	view, err := authority.service.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(authority.threadID))
	if err != nil {
		return CanonicalAttachmentMembership{}, err
	}
	attachment, turnID, err := findCanonicalThreadAttachment(view, exactTurnID, func(attachment flruntime.MessageAttachment) bool {
		id, _, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
		return err == nil && id == attachmentID
	})
	if err != nil {
		return CanonicalAttachmentMembership{}, err
	}
	id, digest, _ := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
	return CanonicalAttachmentMembership{ThreadID: authority.threadID, TurnID: turnID, AttachmentID: id,
		ResourceRef: attachment.ResourceRef, ContentSHA256: digest, Name: attachment.Name,
		DetectedMediaType: attachment.MIMEType, SizeBytes: attachment.SizeBytes}, nil
}

func (service *Service) openCanonicalLiveAttachment(ctx context.Context, owner UploadOwner, threadID, attachmentID string) (openedCanonicalAttachment, error) {
	authority := floretLiveAttachmentAuthority{service: service, threadID: strings.TrimSpace(threadID)}
	membership, err := authority.find(ctx, "", strings.TrimSpace(attachmentID))
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	if err := service.retainCanonicalUploadForOwner(ctxOrBackground(ctx), owner, membership.ThreadID, membership); err != nil {
		return openedCanonicalAttachment{}, err
	}
	upload, err := service.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, membership.AttachmentID, authority)
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
	authority := floretLiveAttachmentAuthority{service: service, threadID: threadID}
	membership, err := authority.find(ctx, turnID, attachmentID)
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
	return service.OpenLiveUpload(ctx, owner, threadID, turnID, attachmentID, authority)
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

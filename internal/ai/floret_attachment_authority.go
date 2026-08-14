package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
)

type floretLiveAttachmentAuthority struct {
	service  *Service
	threadID string
}

type openedCanonicalAttachment struct {
	Membership CanonicalAttachmentMembership
	Upload     *OpenUploadResult
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
	for _, item := range view.Items {
		if item.Kind != flruntime.ThreadItemUser || exactTurnID != "" && item.TurnID.String() != exactTurnID {
			continue
		}
		for _, attachment := range item.Attachments {
			id, digest, decodeErr := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
			if decodeErr != nil || id != attachmentID {
				continue
			}
			return CanonicalAttachmentMembership{
				ThreadID: authority.threadID, TurnID: item.TurnID.String(), AttachmentID: id,
				ResourceRef: attachment.ResourceRef, ContentSHA256: digest, Name: attachment.Name,
				DetectedMediaType: attachment.MIMEType, SizeBytes: attachment.SizeBytes,
			}, nil
		}
	}
	return CanonicalAttachmentMembership{}, sql.ErrNoRows
}

func (service *Service) openCanonicalLiveAttachment(ctx context.Context, owner UploadOwner, threadID, attachmentID string) (openedCanonicalAttachment, error) {
	authority := floretLiveAttachmentAuthority{service: service, threadID: strings.TrimSpace(threadID)}
	membership, err := authority.find(ctx, "", strings.TrimSpace(attachmentID))
	if err != nil {
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
	if _, err := authority.find(ctx, turnID, attachmentID); err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
			return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
		}
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, fmt.Errorf("open canonical attachment authority: %w", err))
	}
	return service.OpenLiveUpload(ctx, owner, threadID, turnID, attachmentID, authority)
}

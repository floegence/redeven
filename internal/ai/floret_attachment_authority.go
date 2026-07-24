package ai

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type floretLiveAttachmentAuthority struct {
	threadID string
	host     floretThreadReadHost
}

type openedCanonicalAttachment struct {
	Membership CanonicalAttachmentMembership
	Upload     *OpenUploadResult
}

func (a floretLiveAttachmentAuthority) ReadCanonicalAttachmentMembership(ctx context.Context, threadID string, turnID string, attachmentID string) (CanonicalAttachmentMembership, error) {
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	attachmentID = strings.TrimSpace(attachmentID)
	if a.host == nil || threadID == "" || threadID != strings.TrimSpace(a.threadID) || turnID == "" || !validUploadID(attachmentID) {
		return CanonicalAttachmentMembership{}, sql.ErrNoRows
	}
	return a.find(ctx, turnID, attachmentID)
}

func (a floretLiveAttachmentAuthority) find(ctx context.Context, exactTurnID string, attachmentID string) (CanonicalAttachmentMembership, error) {
	var before *flruntime.ThreadTurnsBeforeCursor
	for {
		req := flruntime.ListThreadTurnsRequest{ThreadID: flruntime.ThreadID(a.threadID)}
		if before == nil {
			req.Tail = 200
		} else {
			req.BeforeCursor = before
			req.Limit = 200
		}
		page, err := a.host.ListThreadTurns(ctxOrBackground(ctx), req)
		if err != nil {
			return CanonicalAttachmentMembership{}, err
		}
		for _, turn := range page.Turns {
			turnID := strings.TrimSpace(string(turn.TurnID))
			if exactTurnID != "" && turnID != exactTurnID {
				continue
			}
			for _, attachment := range turn.UserAttachments {
				id, digest, legacy, err := floretUploadIdentityFromResourceRef(attachment.ResourceRef)
				if err != nil || id != attachmentID || (digest == "" && !legacy) {
					continue
				}
				return CanonicalAttachmentMembership{
					ThreadID: a.threadID, TurnID: turnID, AttachmentID: id,
					ResourceRef: attachment.ResourceRef, ContentSHA256: digest,
					Name: attachment.Name, DetectedMediaType: attachment.MIMEType, SizeBytes: attachment.SizeBytes,
				}, nil
			}
		}
		if !page.HasMore {
			return CanonicalAttachmentMembership{}, sql.ErrNoRows
		}
		if len(page.Turns) == 0 || page.BeforeCursor == nil || strings.TrimSpace(page.BeforeCursor.EntryID) == "" {
			return CanonicalAttachmentMembership{}, errors.New("Floret turn pagination stopped before completion")
		}
		if before != nil && before.EntryID == page.BeforeCursor.EntryID {
			return CanonicalAttachmentMembership{}, errors.New("Floret turn pagination did not advance")
		}
		before = page.BeforeCursor
	}
}

func (s *Service) openCanonicalLiveAttachment(ctx context.Context, owner UploadOwner, threadID string, attachmentID string) (openedCanonicalAttachment, error) {
	host, err := s.openFloretThreadReadHost(ctxOrBackground(ctx), threadID)
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	authority := floretLiveAttachmentAuthority{threadID: strings.TrimSpace(threadID), host: host}
	membership, err := authority.find(ctx, "", strings.TrimSpace(attachmentID))
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	upload, err := s.OpenLiveUpload(ctx, owner, membership.ThreadID, membership.TurnID, membership.AttachmentID, authority)
	if err != nil {
		return openedCanonicalAttachment{}, err
	}
	// Legacy refs predate digests. Enrich only this authorized projection; the
	// canonical Floret attachment and its resource_ref remain unchanged.
	if upload != nil && upload.Info != nil && strings.TrimSpace(membership.ContentSHA256) == "" {
		membership.ContentSHA256 = strings.ToLower(strings.TrimSpace(upload.Info.ContentSHA256))
	}
	return openedCanonicalAttachment{Membership: membership, Upload: upload}, nil
}

func (s *Service) OpenCanonicalLiveAttachmentForTurn(ctx context.Context, owner UploadOwner, threadID, turnID, attachmentID string) (*OpenUploadResult, error) {
	threadID = strings.TrimSpace(threadID)
	turnID = strings.TrimSpace(turnID)
	attachmentID = strings.TrimSpace(attachmentID)
	if threadID == "" || turnID == "" || !validUploadID(attachmentID) {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	host, err := s.openFloretThreadReadHost(ctxOrBackground(ctx), threadID)
	if err != nil {
		return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
	}
	authority := floretLiveAttachmentAuthority{threadID: threadID, host: host}
	return s.OpenLiveUpload(ctx, owner, threadID, turnID, attachmentID, authority)
}

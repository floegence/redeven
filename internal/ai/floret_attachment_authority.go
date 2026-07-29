package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v2/runtime"
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
	exactTurnID = strings.TrimSpace(exactTurnID)
	if exactTurnID != "" {
		turn, err := a.host.ReadThreadTurn(ctxOrBackground(ctx), flruntime.TurnID(exactTurnID))
		if errors.Is(err, flruntime.ErrTurnNotFound) {
			return CanonicalAttachmentMembership{}, sql.ErrNoRows
		}
		if err != nil {
			return CanonicalAttachmentMembership{}, err
		}
		return canonicalAttachmentMembershipForTurn(a.threadID, turn, attachmentID)
	}
	var before *flruntime.ThreadTurnCursor
	for {
		req := flruntime.ThreadTurnsRequest{}
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
			membership, membershipErr := canonicalAttachmentMembershipForTurn(a.threadID, turn, attachmentID)
			if membershipErr == nil {
				return membership, nil
			}
			if !errors.Is(membershipErr, sql.ErrNoRows) {
				return CanonicalAttachmentMembership{}, membershipErr
			}
		}
		if !page.HasMore {
			return CanonicalAttachmentMembership{}, sql.ErrNoRows
		}
		if len(page.Turns) == 0 || page.BeforeCursor == nil || strings.TrimSpace(string(*page.BeforeCursor)) == "" {
			return CanonicalAttachmentMembership{}, errors.New("Floret turn pagination stopped before completion")
		}
		if before != nil && *before == *page.BeforeCursor {
			return CanonicalAttachmentMembership{}, errors.New("Floret turn pagination did not advance")
		}
		before = page.BeforeCursor
	}
}

func canonicalAttachmentMembershipForTurn(threadID string, turn flruntime.ThreadTurnSnapshot, attachmentID string) (CanonicalAttachmentMembership, error) {
	turnID := strings.TrimSpace(string(turn.TurnID))
	if turnID == "" {
		return CanonicalAttachmentMembership{}, errors.New("Floret returned an empty turn identity")
	}
	for _, attachment := range turn.UserAttachments {
		id, digest, legacy, err := floretUploadIdentityFromResourceRef(attachment.ResourceRef)
		if err != nil || id != attachmentID || (digest == "" && !legacy) {
			continue
		}
		return CanonicalAttachmentMembership{
			ThreadID: threadID, TurnID: turnID, AttachmentID: id,
			ResourceRef: attachment.ResourceRef, ContentSHA256: digest,
			Name: attachment.Name, DetectedMediaType: attachment.MIMEType, SizeBytes: attachment.SizeBytes,
		}, nil
	}
	return CanonicalAttachmentMembership{}, sql.ErrNoRows
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
		if errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrThreadDeleted) {
			return nil, NewUploadError(UploadErrorNotFound, false, errors.New("attachment not found"))
		}
		return nil, NewUploadError(UploadErrorStoreUnavailable, true, fmt.Errorf("open canonical attachment authority: %w", err))
	}
	authority := floretLiveAttachmentAuthority{threadID: threadID, host: host}
	return s.OpenLiveUpload(ctx, owner, threadID, turnID, attachmentID, authority)
}

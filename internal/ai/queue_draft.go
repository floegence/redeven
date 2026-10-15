package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

// QueuedDraftRequest binds draft preparation and removal to one captured input.
type QueuedDraftRequest struct {
	ExpectedInputFingerprint string `json:"expected_input_fingerprint"`
	StagingScopeID           string `json:"staging_scope_id,omitempty"`
	StagingCapability        string `json:"-"`
}

type QueuedDraftAttachment struct {
	AttachmentID       string `json:"attachment_id"`
	Name               string `json:"name"`
	MimeType           string `json:"mime_type"`
	SizeBytes          int64  `json:"size_bytes"`
	DigestSHA256       string `json:"digest_sha256"`
	Locator            string `json:"locator"`
	Source             string `json:"source"`
	CapabilityRevision string `json:"capability_revision"`
	TextStats          *struct {
		CodePoints int64 `json:"code_points"`
		Lines      int64 `json:"lines"`
	} `json:"text_stats,omitempty"`
}

type QueuedDraftResponse struct {
	Prompt      string                     `json:"prompt"`
	References  []ContextActionContextItem `json:"references"`
	Attachments []QueuedDraftAttachment    `json:"attachments"`
}

// PrepareQueuedDraft copies authorized user input into ordinary draft resources.
// It does not remove the queue item; the client receives the complete draft before
// conditionally removing that exact input through TakeBackQueuedInput.
func (s *Service) PrepareQueuedDraft(ctx context.Context, meta *session.Meta, threadID, queueID string, req QueuedDraftRequest) (QueuedDraftResponse, error) {
	var draft QueuedDraftResponse
	if err := requireRWX(meta); err != nil {
		return draft, err
	}
	if s == nil || s.threadRuntime == nil || len(req.ExpectedInputFingerprint) != 64 {
		return draft, errors.New("invalid queued draft request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return draft, err
	}
	current, err := s.threadRuntime.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return draft, err
	}
	var original *flruntime.UserInput
	for _, queued := range current.Queue {
		if queued.ID == queueID {
			input := queued.Input
			original = &input
			break
		}
	}
	if original == nil || queuedInputFingerprint(*original) != req.ExpectedInputFingerprint {
		return draft, flruntime.ErrRequestConflict
	}
	draft.Prompt = original.Text
	draft.References = []ContextActionContextItem{}
	draft.Attachments = []QueuedDraftAttachment{}
	for _, reference := range original.References {
		var item ContextActionContextItem
		switch reference.Kind {
		case flruntime.MessageReferenceFile, flruntime.MessageReferenceDirectory:
			locator, err := decodeFlowerCanonicalReferenceLocator(reference.ResourceRef)
			if err != nil {
				return draft, err
			}
			authority, err := resolveFlowerCanonicalReferenceTargetAuthority(meta.EndpointID, s.ToolTargetPolicy())
			if err != nil || !flowerCanonicalReferenceLocatorMatchesAuthority(locator, authority) {
				return draft, ErrFlowerCanonicalReferenceDenied
			}
			item = ContextActionContextItem{Kind: contextActionKindFilePath, Path: locator.Path, IsDirectory: locator.Directory}
		case flruntime.MessageReferenceThread:
			var snapshot ThreadReferenceSnapshot
			if err := json.Unmarshal([]byte(reference.Text), &snapshot); err != nil || !snapshot.valid() {
				return draft, ErrInvalidContextAction
			}
			item = ContextActionContextItem{Kind: contextActionKindThread, Thread: &snapshot}
		case flruntime.MessageReferenceText, flruntime.MessageReferenceTerminal, flruntime.MessageReferenceProcess:
			item = ContextActionContextItem{Kind: contextActionKindReferenceSnapshot, ReferenceSnapshot: &ContextActionReferenceSnapshot{Kind: string(reference.Kind), Label: reference.Label, Text: reference.Text, Truncated: reference.Truncated}}
		default:
			return draft, ErrInvalidContextAction
		}
		draft.References = append(draft.References, item)
	}
	if len(original.Attachments) == 0 {
		return draft, nil
	}
	owner, err := NewUploadOwner(meta.EndpointID, meta.UserPublicID, meta.ChannelID)
	if err != nil {
		return draft, err
	}
	scope, err := s.authorizeUploadStagingScope(ctx, owner, req.StagingScopeID, req.StagingCapability)
	if err != nil {
		return draft, err
	}
	if scope.TargetID != threadID {
		return draft, errors.New("queued draft staging target mismatch")
	}
	settings, err := s.threadsDB.GetThreadSettings(ctx, meta.EndpointID, threadID)
	if err != nil {
		return draft, err
	}
	capability := s.AttachmentCapabilitiesForSession(ctx, meta, settings.ModelID)
	for index, attachment := range original.Attachments {
		uploadID, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return draft, err
		}
		opened, err := s.OpenQueuedUpload(ctx, owner, threadID, queueID, uploadID)
		if err != nil {
			return draft, err
		}
		info := opened.Info
		if info.ContentSHA256 != digest || info.Name != attachment.Name || info.SizeBytes != attachment.SizeBytes || info.MimeType != attachment.MIMEType {
			return draft, errors.New("queued attachment metadata changed")
		}
		file, err := os.Open(opened.FilePath)
		if err != nil {
			return draft, err
		}
		requestDigest := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%d", scope.StagingScopeID, queueID, req.ExpectedInputFingerprint, index)))
		nameDigest := sha256.Sum256([]byte(info.Name))
		copied, err := s.SaveUpload(ctx, SaveUploadRequest{Owner: owner, StagingScopeID: scope.StagingScopeID, StagingCapability: req.StagingCapability, Reader: file, DisplayName: info.Name, Source: info.Source, UploadRequestID: fmt.Sprintf("queue-draft-%x", requestDigest), ExpectedContentSHA256: digest, ExpectedSizeBytes: info.SizeBytes, DisplayNameSHA256: fmt.Sprintf("%x", nameDigest)})
		file.Close()
		if err != nil {
			return draft, err
		}
		restored := QueuedDraftAttachment{AttachmentID: copied.AttachmentID, Name: copied.Name, MimeType: copied.MimeType, SizeBytes: copied.SizeBytes, DigestSHA256: copied.ContentSHA256, Locator: copied.LogicalLocator, Source: copied.Source, CapabilityRevision: capability.Revision}
		if copied.UnicodeCodePoints != nil && copied.LogicalLineCount != nil {
			restored.TextStats = &struct {
				CodePoints int64 `json:"code_points"`
				Lines      int64 `json:"lines"`
			}{*copied.UnicodeCodePoints, *copied.LogicalLineCount}
		}
		draft.Attachments = append(draft.Attachments, restored)
	}
	return draft, nil
}

func (s *Service) TakeBackQueuedInput(ctx context.Context, meta *session.Meta, threadID, queueID, fingerprint string) (flruntime.ThreadView, error) {
	if err := requireRWX(meta); err != nil {
		return flruntime.ThreadView{}, err
	}
	if s == nil || s.threadRuntime == nil || strings.TrimSpace(threadID) == "" || strings.TrimSpace(queueID) == "" || len(fingerprint) != 64 {
		return flruntime.ThreadView{}, errors.New("invalid queue take-back request")
	}
	if err := s.requireEndpointThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return flruntime.ThreadView{}, err
	}
	return s.threadRuntime.DeleteQueued(ctx, flruntime.DeleteQueuedInput{ThreadID: identity.ThreadID(threadID), QueueItemID: queueID, ExpectedInputSHA256: fingerprint, RequestKey: flruntime.RequestKey("take-back:" + queueID + ":" + fingerprint)})
}

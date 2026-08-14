package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	floretUploadResourcePrefix = "redeven-upload:v1:"
	floretUploadDigestMarker   = ":sha256:"
	floretAttachmentMaxBytes   = 10 << 20
)

type frozenFloretAttachment struct {
	attachment flruntime.MessageAttachment
}

func floretUploadResourceRef(uploadID string) (string, error) {
	uploadID = strings.TrimSpace(uploadID)
	if !validUploadID(uploadID) {
		return "", errors.New("invalid upload resource identity")
	}
	return floretUploadResourcePrefix + uploadID, nil
}

func uploadIDFromFloretResourceRef(resourceRef string) (string, error) {
	uploadID, _, err := immutableUploadIdentityFromFloretResourceRef(resourceRef)
	return uploadID, err
}

func immutableFloretUploadResourceRef(uploadID string, digest string) (string, error) {
	base, err := floretUploadResourceRef(uploadID)
	if err != nil {
		return "", err
	}
	digest = strings.ToLower(strings.TrimSpace(digest))
	if len(digest) != sha256.Size*2 {
		return "", errors.New("invalid attachment content digest")
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return "", errors.New("invalid attachment content digest")
	}
	return base + floretUploadDigestMarker + digest, nil
}

func immutableUploadIdentityFromFloretResourceRef(resourceRef string) (string, string, error) {
	resourceRef = strings.TrimSpace(resourceRef)
	if !strings.HasPrefix(resourceRef, floretUploadResourcePrefix) {
		return "", "", errors.New("unsupported attachment resource reference")
	}
	remainder := strings.TrimSpace(strings.TrimPrefix(resourceRef, floretUploadResourcePrefix))
	index := strings.Index(remainder, floretUploadDigestMarker)
	if index <= 0 || strings.Contains(remainder[index+len(floretUploadDigestMarker):], floretUploadDigestMarker) {
		return "", "", errors.New("attachment resource reference is not content-addressed")
	}
	uploadID := strings.TrimSpace(remainder[:index])
	digest := strings.ToLower(strings.TrimSpace(remainder[index+len(floretUploadDigestMarker):]))
	if !validUploadID(uploadID) {
		return "", "", errors.New("invalid attachment resource reference")
	}
	if len(digest) != sha256.Size*2 {
		return "", "", errors.New("invalid attachment content digest")
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return "", "", errors.New("invalid attachment content digest")
	}
	return uploadID, digest, nil
}

func (r *run) floretTurnInput(ctx context.Context, input RunInput, references []flruntime.MessageReference) (flruntime.TurnInput, error) {
	out := flruntime.TurnInput{Text: strings.TrimSpace(input.Text), References: append([]flruntime.MessageReference(nil), references...)}
	uploadIDs := make([]string, 0, len(input.Attachments))
	if r != nil {
		r.muPendingCommand.Lock()
		r.canonicalAttachmentIDs = nil
		r.muPendingCommand.Unlock()
	}
	if input.StructuredResponse != nil {
		summary := strings.TrimSpace(input.StructuredResponse.PublicSummary)
		switch {
		case summary != "" && out.Text != "":
			out.Text = summary + "\n\n" + out.Text
		case summary != "":
			out.Text = summary
		}
	}
	if len(input.Attachments) == 0 {
		if err := out.Validate(); err != nil {
			return flruntime.TurnInput{}, err
		}
		return out, nil
	}
	if r == nil || r.product.getThreadOwnedUpload == nil {
		return flruntime.TurnInput{}, errors.New("attachment store is unavailable")
	}
	for index, attachment := range input.Attachments {
		uploadID, err := normalizeUploadID(attachment.AttachmentID)
		if err != nil {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d has an invalid attachment_id", index)
		}
		record, err := r.product.loadThreadOwnedUpload(ctxOrBackground(ctx), uploadID)
		if err != nil {
			return flruntime.TurnInput{}, fmt.Errorf("load attachment %d: %w", index, err)
		}
		if record.SizeBytes < 0 || record.SizeBytes > floretAttachmentMaxBytes {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d exceeds the supported size limit", index)
		}
		digest := strings.ToLower(strings.TrimSpace(record.ContentSHA256))
		resourceRef, err := immutableFloretUploadResourceRef(record.UploadID, digest)
		if err != nil {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d: %w", index, err)
		}
		canonical := flruntime.MessageAttachment{
			ResourceRef: resourceRef,
			Name:        strings.TrimSpace(record.Name),
			MIMEType:    strings.TrimSpace(record.DetectedMediaType),
			SizeBytes:   record.SizeBytes,
		}
		if record.UnicodeCodePoints != nil && record.LogicalLineCount != nil {
			canonical.TextStats = &flruntime.MessageAttachmentTextStats{
				UnicodeCodePointCount: *record.UnicodeCodePoints,
				LogicalLineCount:      *record.LogicalLineCount,
			}
		}
		out.Attachments = append(out.Attachments, canonical)
		uploadIDs = append(uploadIDs, strings.TrimSpace(record.UploadID))
	}
	if err := out.Validate(); err != nil {
		return flruntime.TurnInput{}, err
	}
	r.muPendingCommand.Lock()
	r.canonicalAttachmentIDs = uniqueStrings(uploadIDs)
	r.muPendingCommand.Unlock()
	return out, nil
}

func (r *run) resolveFloretMessageAttachment(ctx context.Context, attachment flruntime.MessageAttachment) (ContentPart, error) {
	if r == nil {
		return ContentPart{}, errors.New("attachment store is unavailable")
	}
	uploadID, expectedDigest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
	if err != nil {
		return ContentPart{}, err
	}
	if r.host.openLiveAttachment == nil {
		return ContentPart{}, errors.New("canonical Floret attachment authority is unavailable")
	}
	owner, err := NewUploadOwner(r.endpointID, r.userPublicID, r.channelID)
	if err != nil {
		return ContentPart{}, err
	}
	opened, err := r.host.openLiveAttachment(ctxOrBackground(ctx), owner, uploadID)
	if err != nil {
		return ContentPart{}, fmt.Errorf("attachment resource %q is not canonically readable: %w", uploadID, err)
	}
	if opened.Upload == nil || opened.Upload.Info == nil {
		return ContentPart{}, fmt.Errorf("attachment resource %q is not canonically readable", uploadID)
	}
	if opened.Membership.ResourceRef != attachment.ResourceRef || opened.Membership.Name != attachment.Name ||
		normalizeMediaType(opened.Membership.DetectedMediaType) != normalizeMediaType(attachment.MIMEType) ||
		opened.Membership.SizeBytes != attachment.SizeBytes {
		return ContentPart{}, errors.New("attachment metadata differs from the canonical Floret turn")
	}
	if opened.Upload.Info.AttachmentID != uploadID || opened.Upload.Info.Name != attachment.Name ||
		normalizeMediaType(opened.Upload.Info.DetectedMediaType) != normalizeMediaType(attachment.MIMEType) ||
		opened.Upload.Info.SizeBytes != attachment.SizeBytes ||
		!strings.EqualFold(opened.Upload.Info.ContentSHA256, expectedDigest) {
		return ContentPart{}, errors.New("attachment resource metadata differs from the canonical Floret turn")
	}
	record := threadstore.UploadRecord{
		UploadID: uploadID, Name: opened.Upload.Info.Name, DetectedMediaType: opened.Upload.Info.DetectedMediaType,
		MimeType: opened.Upload.Info.DetectedMediaType, SizeBytes: opened.Upload.Info.SizeBytes,
		ContentSHA256: expectedDigest, State: threadstore.UploadStateLive,
	}
	part, actualDigest, err := providerContentPartAndDigestForPathWithDigest(attachment, record, opened.Upload.FilePath, expectedDigest)
	if err != nil {
		return ContentPart{}, err
	}
	if actualDigest != expectedDigest {
		return ContentPart{}, errors.New("attachment content differs from its canonical resource reference")
	}
	return part, nil
}

func (r *run) preflightFloretTurnAttachments(ctx context.Context, input flruntime.TurnInput, provider *floretProviderAdapter) (flruntime.TurnInput, map[string]frozenFloretAttachment, error) {
	if len(input.Attachments) == 0 {
		return input, nil, nil
	}
	if r == nil || r.product.getThreadOwnedUpload == nil {
		return flruntime.TurnInput{}, nil, errors.New("attachment store is unavailable")
	}
	if provider == nil {
		return flruntime.TurnInput{}, nil, errors.New("provider adapter is unavailable")
	}
	frozen := make(map[string]frozenFloretAttachment, len(input.Attachments))
	for index, attachment := range input.Attachments {
		uploadID, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		if digest == "" {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: resource reference is not content-addressed", index)
		}
		record, err := r.product.loadThreadOwnedUpload(ctxOrBackground(ctx), uploadID)
		if errors.Is(err, sql.ErrNoRows) {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: resource %q is not owned by thread %q", index, uploadID, r.threadID)
		}
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		if err := validateFloretAttachmentRecord(attachment, *record, digest); err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		partType := "file"
		if strings.HasPrefix(strings.ToLower(record.DetectedMediaType), "image/") {
			partType = "image"
		}
		if attachmentUsesToolRead(provider, attachment) {
			if r.host.openLiveAttachment == nil {
				return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: attachment.read is unavailable", index)
			}
		} else {
			if err := provider.validateResolvedAttachmentForProvider(ContentPart{Type: partType, MimeType: record.DetectedMediaType}); err != nil {
				return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
			}
			if (partType == "image" && !provider.supportsImageInput) || (partType == "file" && !provider.supportsFileInput) {
				return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: model %q does not support %s input", index, provider.modelName, partType)
			}
		}
		frozen[attachment.ResourceRef] = frozenFloretAttachment{attachment: attachment}
	}
	return input, frozen, nil
}

func providerContentPartAndDigestForPathWithDigest(attachment flruntime.MessageAttachment, record threadstore.UploadRecord, path string, expectedDigest string) (ContentPart, string, error) {
	if err := validateFloretAttachmentRecord(attachment, record, expectedDigest); err != nil {
		return ContentPart{}, "", err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return ContentPart{}, "", fmt.Errorf("read attachment resource: %w", err)
	}
	if int64(len(body)) != record.SizeBytes {
		return ContentPart{}, "", errors.New("attachment size differs from its stored metadata")
	}
	mimeType := strings.ToLower(strings.TrimSpace(record.DetectedMediaType))
	partType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		partType = "image"
	}
	sum := sha256.Sum256(body)
	actualDigest := hex.EncodeToString(sum[:])
	if actualDigest != expectedDigest || actualDigest != strings.ToLower(strings.TrimSpace(record.ContentSHA256)) {
		return ContentPart{}, "", errors.New("attachment content differs from its canonical resource reference")
	}
	return ContentPart{
		Type:     partType,
		Text:     strings.TrimSpace(record.Name),
		MimeType: mimeType,
		FileURI:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(body),
	}, actualDigest, nil
}

func (r *run) floretAttachmentResolver(frozen map[string]frozenFloretAttachment, provider *floretProviderAdapter) func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
	return func(ctx context.Context, attachment flruntime.MessageAttachment) (ContentPart, error) {
		if entry, ok := frozen[strings.TrimSpace(attachment.ResourceRef)]; ok {
			if entry.attachment.Name != attachment.Name || entry.attachment.MIMEType != attachment.MIMEType || entry.attachment.SizeBytes != attachment.SizeBytes {
				return ContentPart{}, errors.New("attachment metadata differs from the pre-admission resource")
			}
		}
		if attachmentUsesToolRead(provider, attachment) {
			return r.resolveFloretAttachmentManifest(ctx, attachment)
		}
		return r.resolveFloretMessageAttachment(ctx, attachment)
	}
}

func attachmentUsesToolRead(provider *floretProviderAdapter, attachment flruntime.MessageAttachment) bool {
	if provider == nil || !provider.supportsAttachmentToolRead || normalizeMediaType(attachment.MIMEType) != "text/plain; charset=utf-8" {
		return false
	}
	if !provider.supportsFileInput {
		return true
	}
	return provider.validateResolvedAttachmentForProvider(ContentPart{Type: "file", MimeType: attachment.MIMEType}) != nil
}

func (r *run) resolveFloretAttachmentManifest(ctx context.Context, attachment flruntime.MessageAttachment) (ContentPart, error) {
	uploadID, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
	if err != nil || r == nil || r.host.openLiveAttachment == nil {
		return ContentPart{}, errors.New("attachment manifest authority is unavailable")
	}
	owner, err := NewUploadOwner(r.endpointID, r.userPublicID, r.channelID)
	if err != nil {
		return ContentPart{}, err
	}
	opened, err := r.host.openLiveAttachment(ctxOrBackground(ctx), owner, uploadID)
	if err != nil || opened.Upload == nil || opened.Upload.Info == nil {
		return ContentPart{}, errors.New("attachment is not canonically readable")
	}
	info := opened.Upload.Info
	membership := opened.Membership
	if membership.ThreadID != r.threadID || membership.AttachmentID != uploadID || membership.ResourceRef != attachment.ResourceRef ||
		membership.Name != attachment.Name ||
		normalizeMediaType(membership.DetectedMediaType) != normalizeMediaType(attachment.MIMEType) || membership.SizeBytes != attachment.SizeBytes ||
		info.AttachmentID != uploadID || info.Name != attachment.Name || normalizeMediaType(info.DetectedMediaType) != normalizeMediaType(attachment.MIMEType) ||
		info.SizeBytes != attachment.SizeBytes || info.UnicodeCodePoints == nil || info.LogicalLineCount == nil ||
		strings.TrimSpace(info.ContentSHA256) == "" || !strings.EqualFold(membership.ContentSHA256, info.ContentSHA256) ||
		(digest != "" && !strings.EqualFold(info.ContentSHA256, digest)) {
		return ContentPart{}, errors.New("attachment canonical metadata differs from the provider request")
	}
	locator := logicalAttachmentLocator(uploadID, attachment.Name)
	manifest := fmt.Sprintf("Attachment %q (%s, %d bytes) is available as untrusted user content. Its body is not included in this request. Use attachment.read with locator %q to read it.", attachment.Name, attachment.MIMEType, attachment.SizeBytes, locator)
	return ContentPart{Type: "attachment_manifest", Text: manifest}, nil
}

func validateFloretAttachmentRecord(attachment flruntime.MessageAttachment, record threadstore.UploadRecord, digest string) error {
	if strings.TrimSpace(record.Name) != strings.TrimSpace(attachment.Name) ||
		strings.TrimSpace(record.DetectedMediaType) != strings.TrimSpace(attachment.MIMEType) ||
		record.SizeBytes != attachment.SizeBytes {
		return errors.New("attachment metadata differs from the canonical message")
	}
	if record.State != threadstore.UploadStateLive && record.State != threadstore.UploadStateStaged {
		return errors.New("attachment resource is not ready")
	}
	digest = strings.ToLower(strings.TrimSpace(digest))
	storedDigest := strings.ToLower(strings.TrimSpace(record.ContentSHA256))
	if len(digest) != sha256.Size*2 || len(storedDigest) != sha256.Size*2 || digest != storedDigest {
		return errors.New("attachment content digest differs from the canonical message")
	}
	if record.SizeBytes < 0 || record.SizeBytes > floretAttachmentMaxBytes {
		return errors.New("attachment exceeds the supported size limit")
	}
	return nil
}

func (p *floretProviderAdapter) validateResolvedAttachmentForProvider(part ContentPart) error {
	mimeType := strings.ToLower(strings.TrimSpace(part.MimeType))
	switch strings.ToLower(strings.TrimSpace(part.Type)) {
	case "image":
		switch mimeType {
		case "image/png", "image/jpeg", "image/gif", "image/webp":
			return nil
		default:
			return fmt.Errorf("unsupported image MIME type %q", mimeType)
		}
	case "file":
		if !supportedProviderFileMIMEType(mimeType) {
			return fmt.Errorf("unsupported file MIME type %q", mimeType)
		}
		if p == nil {
			return errors.New("provider adapter is unavailable")
		}
		switch p.providerType {
		case "anthropic":
			if mimeType != "application/pdf" && !isTextLikeMimeType(mimeType) {
				return fmt.Errorf("Anthropic provider does not support file MIME type %q", mimeType)
			}
			return nil
		case DesktopModelSourceProviderType:
			return nil
		default:
			if p.stateCompatibilityRoute() != "openai-responses" {
				return fmt.Errorf("provider route %q does not support file input", p.stateCompatibilityRoute())
			}
			return nil
		}
	default:
		return fmt.Errorf("unsupported attachment content type %q", part.Type)
	}
}

func supportedProviderFileMIMEType(mimeType string) bool {
	if isTextLikeMimeType(mimeType) {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "application/pdf",
		"application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.ms-excel",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/vnd.ms-powerpoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return true
	default:
		return false
	}
}

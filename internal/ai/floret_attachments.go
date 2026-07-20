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
	"path/filepath"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	floretUploadResourcePrefix = "redeven-upload:"
	floretUploadDigestMarker   = ":sha256:"
	floretAttachmentMaxBytes   = 10 << 20
)

type frozenFloretAttachment struct {
	attachment flruntime.MessageAttachment
	part       ContentPart
}

func floretUploadResourceRef(uploadID string) (string, error) {
	uploadID = strings.TrimSpace(uploadID)
	if uploadID == "" || strings.ContainsAny(uploadID, "\r\n") {
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
	uploadID := remainder
	digest := ""
	if index := strings.Index(remainder, floretUploadDigestMarker); index >= 0 {
		uploadID = strings.TrimSpace(remainder[:index])
		digest = strings.ToLower(strings.TrimSpace(remainder[index+len(floretUploadDigestMarker):]))
	}
	if uploadID == "" || strings.ContainsAny(uploadID, "\r\n:/\\") {
		return "", "", errors.New("invalid attachment resource reference")
	}
	if digest != "" {
		if len(digest) != sha256.Size*2 {
			return "", "", errors.New("invalid attachment content digest")
		}
		if _, err := hex.DecodeString(digest); err != nil {
			return "", "", errors.New("invalid attachment content digest")
		}
	}
	return uploadID, digest, nil
}

func (r *run) floretTurnInput(ctx context.Context, input RunInput) (flruntime.TurnInput, error) {
	out := flruntime.TurnInput{Text: strings.TrimSpace(input.Text)}
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
	if r == nil || r.product.getQueuedTurnOwnedUpload == nil {
		return flruntime.TurnInput{}, errors.New("attachment store is unavailable")
	}
	r.muPendingCommand.Lock()
	commandID := strings.TrimSpace(r.pendingCommandID)
	r.muPendingCommand.Unlock()
	if commandID == "" {
		return flruntime.TurnInput{}, errors.New("attachment admission requires a pending command")
	}
	for index, attachment := range input.Attachments {
		uploadID := parseUploadIDFromURL(attachment.URL)
		if uploadID == "" {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d does not reference a Redeven upload", index)
		}
		record, err := r.product.loadQueuedTurnOwnedUpload(ctxOrBackground(ctx), commandID, uploadID)
		if err != nil {
			return flruntime.TurnInput{}, fmt.Errorf("load attachment %d: %w", index, err)
		}
		if record.SizeBytes < 0 || record.SizeBytes > floretAttachmentMaxBytes {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d exceeds the supported size limit", index)
		}
		resourceRef, err := floretUploadResourceRef(record.UploadID)
		if err != nil {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d: %w", index, err)
		}
		out.Attachments = append(out.Attachments, flruntime.MessageAttachment{
			ResourceRef: resourceRef,
			Name:        strings.TrimSpace(record.Name),
			MIMEType:    strings.TrimSpace(record.MimeType),
			SizeBytes:   record.SizeBytes,
		})
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
	if r == nil || r.product.getThreadOwnedUpload == nil {
		return ContentPart{}, errors.New("attachment store is unavailable")
	}
	uploadID, expectedDigest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
	if err != nil {
		return ContentPart{}, err
	}
	if expectedDigest == "" {
		return ContentPart{}, errors.New("attachment resource reference is not content-addressed")
	}
	record, err := r.product.loadThreadOwnedUpload(ctxOrBackground(ctx), uploadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ContentPart{}, fmt.Errorf("attachment resource %q is not owned by thread %q", uploadID, strings.TrimSpace(r.threadID))
	}
	if err != nil {
		return ContentPart{}, err
	}
	part, actualDigest, err := r.providerContentPartAndDigestForUpload(attachment, *record)
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
	if r == nil || r.product.getQueuedTurnOwnedUpload == nil {
		return flruntime.TurnInput{}, nil, errors.New("attachment store is unavailable")
	}
	if provider == nil {
		return flruntime.TurnInput{}, nil, errors.New("provider adapter is unavailable")
	}
	r.muPendingCommand.Lock()
	commandID := strings.TrimSpace(r.pendingCommandID)
	r.muPendingCommand.Unlock()
	if commandID == "" {
		return flruntime.TurnInput{}, nil, errors.New("attachment admission requires a pending command")
	}
	frozen := make(map[string]frozenFloretAttachment, len(input.Attachments))
	for index, attachment := range input.Attachments {
		uploadID, digest, err := immutableUploadIdentityFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		if digest != "" {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: resource reference was already finalized", index)
		}
		record, err := r.product.loadQueuedTurnOwnedUpload(ctxOrBackground(ctx), commandID, uploadID)
		if errors.Is(err, sql.ErrNoRows) {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: resource %q is not owned by pending command %q", index, uploadID, commandID)
		}
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		part, contentDigest, err := r.providerContentPartAndDigestForUpload(attachment, *record)
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		if err := provider.validateResolvedAttachment(part); err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		resourceRef, err := immutableFloretUploadResourceRef(uploadID, contentDigest)
		if err != nil {
			return flruntime.TurnInput{}, nil, fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		attachment.ResourceRef = resourceRef
		input.Attachments[index] = attachment
		frozen[resourceRef] = frozenFloretAttachment{attachment: attachment, part: part}
	}
	return input, frozen, nil
}

func (r *run) providerContentPartAndDigestForUpload(attachment flruntime.MessageAttachment, record threadstore.UploadRecord) (ContentPart, string, error) {
	if strings.TrimSpace(record.Name) != strings.TrimSpace(attachment.Name) ||
		strings.TrimSpace(record.MimeType) != strings.TrimSpace(attachment.MIMEType) ||
		record.SizeBytes != attachment.SizeBytes {
		return ContentPart{}, "", errors.New("attachment metadata differs from the canonical message")
	}
	if record.SizeBytes < 0 || record.SizeBytes > floretAttachmentMaxBytes {
		return ContentPart{}, "", errors.New("attachment exceeds the supported size limit")
	}
	r.mu.Lock()
	uploadsDir := strings.TrimSpace(r.uploadsDir)
	r.mu.Unlock()
	if uploadsDir == "" {
		return ContentPart{}, "", errors.New("attachment storage directory is unavailable")
	}
	path := filepath.Join(uploadsDir, filepath.Base(strings.TrimSpace(record.StorageRelPath)))
	body, err := os.ReadFile(path)
	if err != nil {
		return ContentPart{}, "", fmt.Errorf("read attachment resource: %w", err)
	}
	if int64(len(body)) != record.SizeBytes {
		return ContentPart{}, "", errors.New("attachment size differs from its stored metadata")
	}
	mimeType := strings.ToLower(strings.TrimSpace(record.MimeType))
	partType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		partType = "image"
	}
	sum := sha256.Sum256(body)
	return ContentPart{
		Type:     partType,
		Text:     strings.TrimSpace(record.Name),
		MimeType: mimeType,
		FileURI:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(body),
	}, hex.EncodeToString(sum[:]), nil
}

func (r *run) floretAttachmentResolver(frozen map[string]frozenFloretAttachment) func(context.Context, flruntime.MessageAttachment) (ContentPart, error) {
	return func(ctx context.Context, attachment flruntime.MessageAttachment) (ContentPart, error) {
		if entry, ok := frozen[strings.TrimSpace(attachment.ResourceRef)]; ok {
			if entry.attachment.Name != attachment.Name || entry.attachment.MIMEType != attachment.MIMEType || entry.attachment.SizeBytes != attachment.SizeBytes {
				return ContentPart{}, errors.New("attachment metadata differs from the pre-admission resource")
			}
			return entry.part, nil
		}
		return r.resolveFloretMessageAttachment(ctx, attachment)
	}
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

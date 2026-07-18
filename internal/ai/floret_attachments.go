package ai

import (
	"context"
	"database/sql"
	"encoding/base64"
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
	floretAttachmentMaxBytes   = 10 << 20
)

func floretUploadResourceRef(uploadID string) (string, error) {
	uploadID = strings.TrimSpace(uploadID)
	if uploadID == "" || strings.ContainsAny(uploadID, "\r\n") {
		return "", errors.New("invalid upload resource identity")
	}
	return floretUploadResourcePrefix + uploadID, nil
}

func uploadIDFromFloretResourceRef(resourceRef string) (string, error) {
	resourceRef = strings.TrimSpace(resourceRef)
	if !strings.HasPrefix(resourceRef, floretUploadResourcePrefix) {
		return "", errors.New("unsupported attachment resource reference")
	}
	uploadID := strings.TrimSpace(strings.TrimPrefix(resourceRef, floretUploadResourcePrefix))
	if uploadID == "" || strings.ContainsAny(uploadID, "\r\n:/\\") {
		return "", errors.New("invalid attachment resource reference")
	}
	return uploadID, nil
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
	if r == nil || r.threadsDB == nil {
		return flruntime.TurnInput{}, errors.New("attachment store is unavailable")
	}
	for index, attachment := range input.Attachments {
		uploadID := parseUploadIDFromURL(attachment.URL)
		if uploadID == "" {
			return flruntime.TurnInput{}, fmt.Errorf("attachment %d does not reference a Redeven upload", index)
		}
		record, err := r.threadsDB.GetUpload(ctxOrBackground(ctx), strings.TrimSpace(r.endpointID), uploadID)
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
	if r == nil || r.threadsDB == nil {
		return ContentPart{}, errors.New("attachment store is unavailable")
	}
	uploadID, err := uploadIDFromFloretResourceRef(attachment.ResourceRef)
	if err != nil {
		return ContentPart{}, err
	}
	record, err := r.threadsDB.GetThreadOwnedUpload(ctxOrBackground(ctx), strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID), uploadID)
	if errors.Is(err, sql.ErrNoRows) {
		return ContentPart{}, fmt.Errorf("attachment resource %q is not owned by thread %q", uploadID, strings.TrimSpace(r.threadID))
	}
	if err != nil {
		return ContentPart{}, err
	}
	return r.providerContentPartForUpload(attachment, *record)
}

func (r *run) preflightFloretTurnAttachments(ctx context.Context, input flruntime.TurnInput, provider *floretProviderAdapter) error {
	if len(input.Attachments) == 0 {
		return nil
	}
	if r == nil || r.threadsDB == nil {
		return errors.New("attachment store is unavailable")
	}
	if provider == nil {
		return errors.New("provider adapter is unavailable")
	}
	r.muPendingCommand.Lock()
	commandID := strings.TrimSpace(r.pendingCommandID)
	r.muPendingCommand.Unlock()
	if commandID == "" {
		return errors.New("attachment admission requires a pending command")
	}
	for index, attachment := range input.Attachments {
		uploadID, err := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		record, err := r.threadsDB.GetQueuedTurnOwnedUpload(ctxOrBackground(ctx), strings.TrimSpace(r.endpointID), strings.TrimSpace(r.threadID), commandID, uploadID)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("preflight attachment %d: resource %q is not owned by pending command %q", index, uploadID, commandID)
		}
		if err != nil {
			return fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		part, err := r.providerContentPartForUpload(attachment, *record)
		if err != nil {
			return fmt.Errorf("preflight attachment %d: %w", index, err)
		}
		if err := provider.validateResolvedAttachment(part); err != nil {
			return fmt.Errorf("preflight attachment %d: %w", index, err)
		}
	}
	return nil
}

func (r *run) providerContentPartForUpload(attachment flruntime.MessageAttachment, record threadstore.UploadRecord) (ContentPart, error) {
	if strings.TrimSpace(record.Name) != strings.TrimSpace(attachment.Name) ||
		strings.TrimSpace(record.MimeType) != strings.TrimSpace(attachment.MIMEType) ||
		record.SizeBytes != attachment.SizeBytes {
		return ContentPart{}, errors.New("attachment metadata differs from the canonical message")
	}
	if record.SizeBytes < 0 || record.SizeBytes > floretAttachmentMaxBytes {
		return ContentPart{}, errors.New("attachment exceeds the supported size limit")
	}
	r.mu.Lock()
	uploadsDir := strings.TrimSpace(r.uploadsDir)
	r.mu.Unlock()
	if uploadsDir == "" {
		return ContentPart{}, errors.New("attachment storage directory is unavailable")
	}
	path := filepath.Join(uploadsDir, filepath.Base(strings.TrimSpace(record.StorageRelPath)))
	body, err := os.ReadFile(path)
	if err != nil {
		return ContentPart{}, fmt.Errorf("read attachment resource: %w", err)
	}
	if int64(len(body)) != record.SizeBytes {
		return ContentPart{}, errors.New("attachment size differs from its stored metadata")
	}
	mimeType := strings.ToLower(strings.TrimSpace(record.MimeType))
	partType := "file"
	if strings.HasPrefix(mimeType, "image/") {
		partType = "image"
	}
	return ContentPart{
		Type:     partType,
		Text:     strings.TrimSpace(record.Name),
		MimeType: mimeType,
		FileURI:  "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(body),
	}, nil
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

package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v4/identity"
	flruntime "github.com/floegence/floret/v4/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

// These decoders are isolated to the one-time product v1 queue import. They
// are not a production queue or admission API.
func decodePendingInputSessionMeta(raw string) (session.Meta, error) {
	if strings.TrimSpace(raw) == "" {
		return session.Meta{}, errors.New("pending input session metadata is empty")
	}
	var out session.Meta
	if err := decodeStrictJSON(raw, &out); err != nil {
		return session.Meta{}, fmt.Errorf("decode pending input session metadata: %w", err)
	}
	if strings.TrimSpace(out.ChannelID) == "" || strings.TrimSpace(out.EndpointID) == "" {
		return session.Meta{}, errors.New("pending input session metadata has incomplete identity")
	}
	return out, nil
}

func decodePendingInputAttachments(raw string) ([]RunAttachmentIn, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("pending input attachments are empty")
	}
	var out []RunAttachmentIn
	if err := decodeStrictJSON(raw, &out); err != nil {
		return nil, fmt.Errorf("decode pending input attachments: %w", err)
	}
	cleaned := make([]RunAttachmentIn, 0, len(out))
	for index, item := range out {
		uploadID, err := normalizeUploadID(item.AttachmentID)
		if err != nil {
			return nil, fmt.Errorf("pending input attachment %d has an invalid attachment_id", index)
		}
		cleaned = append(cleaned, RunAttachmentIn{AttachmentID: uploadID})
	}
	return cleaned, nil
}

func decodePendingInputContextAction(raw string) (*ContextActionEnvelope, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var out ContextActionEnvelope
	if err := decodeStrictJSON(raw, &out); err != nil {
		return nil, err
	}
	return normalizeAskFlowerContextActionEnvelope(&out)
}

func decodePendingInputOptions(raw string) (RunOptions, error) {
	if strings.TrimSpace(raw) == "" {
		return RunOptions{}, errors.New("pending input options are empty")
	}
	var out RunOptions
	if err := decodeStrictJSON(raw, &out); err != nil {
		return RunOptions{}, fmt.Errorf("decode pending input options: %w", err)
	}
	return out, nil
}

func (s *Service) importPendingInputs(ctx context.Context) error {
	if s == nil || s.threadsDB == nil || s.threadRuntime == nil || s.floretEffects == nil {
		return errors.New("pending input import is unavailable")
	}
	for {
		records, err := s.threadsDB.ListPendingInputImports(ctxOrBackground(ctx), 200)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return nil
		}
		for start := 0; start < len(records); {
			end := start + 1
			for end < len(records) && records[end].EndpointID == records[start].EndpointID && records[end].ThreadID == records[start].ThreadID {
				end++
			}
			if err := s.importPendingInputGroup(ctx, records[start:end]); err != nil {
				return err
			}
			start = end
		}
	}
}

func (s *Service) importPendingInputGroup(ctx context.Context, records []threadstore.PendingInputImport) error {
	if len(records) == 0 {
		return nil
	}
	threadID := strings.TrimSpace(records[0].ThreadID)
	endpointID := strings.TrimSpace(records[0].EndpointID)
	settings, err := s.threadsDB.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return fmt.Errorf("load pending input thread %q: %w", threadID, err)
	}
	if settings == nil {
		return fmt.Errorf("pending input thread %q is absent from the product catalog", threadID)
	}
	if err := s.requireEndpointThreadAuthority(ctx, endpointID, threadID); err != nil {
		return fmt.Errorf("validate pending input thread %q authority: %w", threadID, err)
	}
	items := make([]flruntime.ImportedPendingInput, 0, len(records))
	requestIDs := make([]string, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record.ThreadID) != threadID || strings.TrimSpace(record.EndpointID) != endpointID {
			return errors.New("pending input import group contains mixed thread scopes")
		}
		meta, err := decodePendingInputSessionMeta(record.SessionMetaJSON)
		if err != nil {
			return fmt.Errorf("decode pending input %q session: %w", record.RequestID, err)
		}
		if strings.TrimSpace(meta.EndpointID) != endpointID || strings.TrimSpace(meta.NamespacePublicID) != strings.TrimSpace(settings.NamespacePublicID) {
			return fmt.Errorf("pending input %q session scope conflicts with the product catalog", record.RequestID)
		}
		options, err := decodePendingInputOptions(record.OptionsJSON)
		if err != nil {
			return fmt.Errorf("decode pending input %q options: %w", record.RequestID, err)
		}
		attachments, err := decodePendingInputAttachments(record.AttachmentsJSON)
		if err != nil {
			return fmt.Errorf("decode pending input %q attachments: %w", record.RequestID, err)
		}
		contextAction, err := decodePendingInputContextAction(record.ContextActionJSON)
		if err != nil {
			return fmt.Errorf("decode pending input %q context action: %w", record.RequestID, err)
		}
		request := SendUserTurnRequest{
			ClientRequestID: strings.TrimSpace(record.RequestID),
			ThreadID:        threadID,
			Model:           strings.TrimSpace(record.ModelID),
			Input: RunInput{
				Text: strings.TrimSpace(record.TextContent), Attachments: attachments, ContextAction: contextAction,
			},
			Options: options,
		}
		effect, err := s.prepareThreadEffect(&meta, request.ClientRequestID, RunStartRequest{
			ThreadID: threadID, Model: request.Model, Input: request.Input, Options: request.Options,
		})
		if err != nil {
			return fmt.Errorf("prepare pending input %q: %w", record.RequestID, err)
		}
		projection, err := floretContextProjectionForInputWithAuthority(effect.req.Input, effect.builder.canonicalReferenceAuthority)
		if err != nil {
			return fmt.Errorf("project pending input %q: %w", record.RequestID, err)
		}
		input, err := effect.builder.floretTurnInput(ctxOrBackground(ctx), effect.req.Input, projection.References)
		if err != nil {
			return fmt.Errorf("materialize pending input %q: %w", record.RequestID, err)
		}
		s.floretEffects.put(identity.ThreadID(threadID), request.ClientRequestID, floretEffectRequest{meta: meta, req: request, effect: effect})
		items = append(items, flruntime.ImportedPendingInput{RequestKey: flruntime.RequestKey(request.ClientRequestID), Input: input})
		requestIDs = append(requestIDs, request.ClientRequestID)
	}
	result, err := s.threadRuntime.ImportPendingInputs(ctxOrBackground(ctx), flruntime.ImportPendingInputsInput{
		ThreadID: identity.ThreadID(threadID), Items: items,
	})
	if err != nil {
		for _, requestID := range requestIDs {
			s.floretEffects.drop(identity.ThreadID(threadID), requestID)
		}
		return fmt.Errorf("import pending inputs for thread %q: %w", threadID, err)
	}
	if err := s.threadsDB.CompletePendingInputImports(ctxOrBackground(ctx), requestIDs); err != nil {
		return err
	}
	if result.View.Activity == flruntime.ThreadActivityIdle && len(result.View.Queue) > 0 {
		first := result.View.Queue[0]
		_, err := s.threadRuntime.PromoteQueued(ctxOrBackground(ctx), flruntime.PromoteQueuedInput{
			ThreadID: identity.ThreadID(threadID), QueueItemID: first.ID,
			RequestKey: flruntime.RequestKey("import-promote:" + first.RequestKey),
		})
		if err != nil && !errors.Is(err, flruntime.ErrThreadBusy) {
			return fmt.Errorf("resume imported input for thread %q: %w", threadID, err)
		}
	}
	return nil
}

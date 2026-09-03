package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

// These decoders are isolated to the one-time product queue migration. They
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

type pendingInputMigrationState struct {
	threadIDs []string
}

func newPendingInputMigrationHandler(opts Options, runtime flruntime.ThreadService, effects *floretEffectAdapter, state *pendingInputMigrationState) threadstore.PendingInputMigrationHandler {
	return func(ctx context.Context, source threadstore.PendingInputMigrationSource, records []threadstore.PendingInputMigrationRecord) ([]threadstore.ExecutionAuthority, error) {
		if runtime == nil || effects == nil || source == nil || state == nil {
			return nil, errors.New("pending input migration dependencies are unavailable")
		}
		authorities := make([]threadstore.ExecutionAuthority, 0, len(records))
		for start := 0; start < len(records); {
			end := start + 1
			for end < len(records) && records[end].EndpointID == records[start].EndpointID && records[end].ThreadID == records[start].ThreadID {
				end++
			}
			groupAuthorities, err := migratePendingInputGroup(ctx, opts, runtime, effects, source, records[start:end])
			if err != nil {
				return nil, err
			}
			authorities = append(authorities, groupAuthorities...)
			state.threadIDs = appendUniqueString(state.threadIDs, strings.TrimSpace(records[start].ThreadID))
			start = end
		}
		return authorities, nil
	}
}

func migratePendingInputGroup(ctx context.Context, opts Options, runtime flruntime.ThreadService, effects *floretEffectAdapter, source threadstore.PendingInputMigrationSource, records []threadstore.PendingInputMigrationRecord) ([]threadstore.ExecutionAuthority, error) {
	if len(records) == 0 {
		return nil, nil
	}
	threadID := strings.TrimSpace(records[0].ThreadID)
	endpointID := strings.TrimSpace(records[0].EndpointID)
	settings, err := source.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return nil, fmt.Errorf("load pending input thread %q: %w", threadID, err)
	}
	if settings == nil {
		return nil, fmt.Errorf("pending input thread %q is absent from the product catalog", threadID)
	}
	if _, err := threadPermissionType(settings); err != nil {
		return nil, err
	}
	routing, err := source.GetFlowerThreadRouting(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil {
		return nil, err
	}
	items := make([]flruntime.ImportedPendingInput, 0, len(records))
	authorities := make([]threadstore.ExecutionAuthority, 0, len(records))
	requestIDs := make([]string, 0, len(records))
	for _, record := range records {
		if strings.TrimSpace(record.ThreadID) != threadID || strings.TrimSpace(record.EndpointID) != endpointID {
			return nil, errors.New("pending input migration group contains mixed thread scopes")
		}
		meta, err := decodePendingInputSessionMeta(record.SessionMetaJSON)
		if err != nil {
			return nil, fmt.Errorf("decode pending input %q session: %w", record.RequestID, err)
		}
		if err := requireRWX(&meta); err != nil {
			return nil, fmt.Errorf("validate pending input %q authority: %w", record.RequestID, err)
		}
		if strings.TrimSpace(meta.EndpointID) != endpointID || strings.TrimSpace(meta.NamespacePublicID) != strings.TrimSpace(settings.NamespacePublicID) {
			return nil, fmt.Errorf("pending input %q session scope conflicts with the product catalog", record.RequestID)
		}
		options, err := decodePendingInputOptions(record.OptionsJSON)
		if err != nil {
			return nil, fmt.Errorf("decode pending input %q options: %w", record.RequestID, err)
		}
		attachments, err := decodePendingInputAttachments(record.AttachmentsJSON)
		if err != nil {
			return nil, fmt.Errorf("decode pending input %q attachments: %w", record.RequestID, err)
		}
		contextAction, err := decodePendingInputContextAction(record.ContextActionJSON)
		if err != nil {
			return nil, fmt.Errorf("decode pending input %q context action: %w", record.RequestID, err)
		}
		input := RunInput{Text: strings.TrimSpace(record.TextContent), Attachments: attachments, ContextAction: contextAction}
		policy := normalizeToolTargetPolicy(opts.ToolTargetPolicy)
		if opts.ToolTargetPolicyForRun != nil {
			policy = normalizeToolTargetPolicy(opts.ToolTargetPolicyForRun(&meta, *settings, routing))
		}
		var referenceAuthority *flowerCanonicalReferenceTargetAuthority
		if flowerContextActionRequiresCanonicalReferenceAuthority(input.ContextAction) {
			resolved, err := resolveFlowerCanonicalReferenceTargetAuthority(endpointID, policy, routing)
			if err != nil {
				return nil, fmt.Errorf("resolve pending input %q context authority: %w", record.RequestID, err)
			}
			if err := authorizeFlowerContextActionTarget(input.ContextAction, resolved); err != nil {
				return nil, fmt.Errorf("authorize pending input %q context: %w", record.RequestID, err)
			}
			input.ContextAction = canonicalizeFlowerContextActionTarget(input.ContextAction, resolved)
			referenceAuthority = &resolved
		}
		projection, err := floretContextProjectionForInputWithAuthority(input, referenceAuthority)
		if err != nil {
			return nil, fmt.Errorf("project pending input %q: %w", record.RequestID, err)
		}
		turnInput, err := floretTurnInputWithUploadLoader(ctxOrBackground(ctx), input, projection.References, func(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
			return source.GetThreadOwnedUpload(ctx, endpointID, threadID, uploadID)
		})
		if err != nil {
			return nil, fmt.Errorf("materialize pending input %q: %w", record.RequestID, err)
		}
		requestID := strings.TrimSpace(record.RequestID)
		request := SendUserTurnRequest{
			ClientRequestID: requestID,
			ThreadID:        threadID,
			Model:           strings.TrimSpace(record.ModelID),
			Input:           input,
			Options:         options,
		}
		authority, err := executionAuthorityFromMeta(&meta, threadID, requestID, "")
		if err != nil {
			return nil, err
		}
		authority.CreatedAtUnixMs = record.CreatedAtUnixMs
		effects.put(identity.ThreadID(threadID), requestID, floretEffectRequest{meta: meta, req: request})
		requestIDs = append(requestIDs, requestID)
		authorities = append(authorities, authority)
		items = append(items, flruntime.ImportedPendingInput{
			RequestKey:          flruntime.RequestKey(requestID),
			Input:               turnInput,
			SupplementalContext: projection.Items,
		})
	}
	if _, err := runtime.ImportPendingInputs(ctxOrBackground(ctx), flruntime.ImportPendingInputsInput{
		ThreadID: identity.ThreadID(threadID),
		Items:    items,
	}); err != nil {
		for _, requestID := range requestIDs {
			effects.drop(identity.ThreadID(threadID), requestID)
		}
		return nil, fmt.Errorf("import pending inputs for thread %q: %w", threadID, err)
	}
	return authorities, nil
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func (s *Service) resumeMigratedPendingInputs(ctx context.Context, threadIDs []string) error {
	for _, threadID := range threadIDs {
		view, err := s.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(threadID))
		if err != nil {
			return err
		}
		if view.Activity != flruntime.ThreadActivityIdle || len(view.Queue) == 0 {
			continue
		}
		first := view.Queue[0]
		if _, err := s.threadRuntime.PromoteQueued(ctxOrBackground(ctx), flruntime.PromoteQueuedInput{
			ThreadID:    identity.ThreadID(threadID),
			QueueItemID: first.ID,
			RequestKey:  flruntime.RequestKey("import-promote:" + first.RequestKey),
		}); err != nil && !errors.Is(err, flruntime.ErrThreadBusy) {
			return fmt.Errorf("resume migrated pending input for thread %q: %w", threadID, err)
		}
	}
	return nil
}

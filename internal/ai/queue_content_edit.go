package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

// The token is a projection of canonical content, never an advancing host revision.
func queuedInputFingerprint(input flruntime.UserInput) string {
	raw, _ := json.Marshal(input)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

func (s *Service) queuedEditReferences(ctx context.Context, meta *session.Meta, original flruntime.UserInput, content EditQueuedContent, requestID string) ([]flruntime.MessageReference, []flruntime.MessageContextItem, error) {
	refs := make([]flruntime.MessageReference, 0, len(content.RetainedReferenceIDs))
	seen := map[string]bool{}
	for _, id := range content.RetainedReferenceIDs {
		if seen[id] {
			return nil, nil, errors.New("duplicate retained reference")
		}
		seen[id] = true
		found := false
		for _, ref := range original.References {
			if ref.ReferenceID == id {
				refs = append(refs, ref)
				found = true
				break
			}
		}
		if !found {
			return nil, nil, flruntime.ErrRequestConflict
		}
	}
	var authority *flowerCanonicalReferenceTargetAuthority
	if flowerContextActionRequiresCanonicalReferenceAuthority(content.ContextAction) {
		resolved, err := resolveFlowerCanonicalReferenceTargetAuthority(meta.EndpointID, s.ToolTargetPolicy())
		if err != nil {
			return nil, nil, err
		}
		authority = &resolved
	}
	projection, err := floretContextProjectionForInput(RunInput{ContextAction: content.ContextAction}, authority, tessivenContextResolver(ctx, s.tessiven))
	if err != nil {
		return nil, nil, err
	}
	newReferenceIDs := map[string]bool{}
	for _, ref := range projection.References {
		newReferenceIDs[ref.ReferenceID] = true
	}
	projection.Context, err = retainedQueuedReferenceContext(flruntime.UserInput{References: projection.References, Context: projection.Context}, newReferenceIDs)
	if err != nil {
		return nil, nil, err
	}
	prefix := fmt.Sprintf("%x", sha256.Sum256([]byte(requestID)))[:24]
	// Admitted runtime and routing facts keep their captured authority. New
	// submitted snapshots append through the same public input projection.
	contexts, err := retainedQueuedReferenceContext(original, seen)
	if err != nil {
		return nil, nil, err
	}
	// Keep context/reference association in the canonical snapshots when edit
	// request identities replace the source-local reference identifiers.
	for i := range projection.Context {
		fact := &projection.Context[i]
		head, raw, ok := strings.Cut(fact.Text, "\n")
		var metadata map[string]string
		if !ok || json.Unmarshal([]byte(raw), &metadata) != nil || metadata["reference_ids"] == "" {
			continue
		}
		var ids []string
		if err := json.Unmarshal([]byte(metadata["reference_ids"]), &ids); err != nil {
			return nil, nil, err
		}
		for j, id := range ids {
			for k, ref := range projection.References {
				if ref.ReferenceID == id {
					ids[j] = fmt.Sprintf("edit:%s:%d", prefix, k)
				}
			}
		}
		encodedIDs, _ := json.Marshal(ids)
		metadata["reference_ids"] = string(encodedIDs)
		encoded, _ := json.Marshal(metadata)
		fact.Text = head + "\n" + string(encoded)
	}
	for i, ref := range projection.References {
		ref.ReferenceID = fmt.Sprintf("edit:%s:%d", prefix, i)
		refs = append(refs, ref)
	}
	contexts = append(contexts, projection.Context...)
	return refs, contexts, nil
}

func queuedEditAttachmentIDs(original flruntime.UserInput, content EditQueuedContent) ([]flruntime.MessageAttachment, []string, error) {
	var retained []flruntime.MessageAttachment
	var ids []string
	seen := map[string]bool{}
	for _, id := range content.RetainedAttachmentIDs {
		if seen[id] {
			return nil, nil, errors.New("duplicate retained attachment")
		}
		seen[id] = true
		found := false
		for _, attachment := range original.Attachments {
			uploadID, _ := uploadIDFromFloretResourceRef(attachment.ResourceRef)
			if uploadID == id {
				retained = append(retained, attachment)
				found = true
				break
			}
		}
		if !found {
			return nil, nil, flruntime.ErrRequestConflict
		}
		ids = append(ids, id)
	}
	for _, attachment := range content.Attachments {
		id := strings.TrimSpace(attachment.AttachmentID)
		if seen[id] {
			return nil, nil, errors.New("duplicate attachment identity")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return retained, ids, nil
}

func (s *Service) editQueuedContent(ctx context.Context, meta *session.Meta, threadID, queueID string, req EditQueuedInputRequest) (flruntime.ThreadView, error) {
	content := *req.Content
	if !validClientRequestID(req.ClientRequestID) || len(content.ExpectedInputFingerprint) != 64 {
		return flruntime.ThreadView{}, errors.New("invalid queue edit identity")
	}
	if err := validateInlineTurnText(content.Text); err != nil {
		return flruntime.ThreadView{}, err
	}
	editor, ok := s.threadRuntime.(flruntime.ThreadQueueController)
	if !ok {
		return flruntime.ThreadView{}, errors.New("queue editing is unavailable")
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadQueueEditReader)
	if !ok {
		return flruntime.ThreadView{}, errors.New("queue edit lookup is unavailable")
	}
	_, settings, unlock, err := s.lockCanonicalThreadSettingsMutation(ctx, meta.EndpointID, threadID)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	defer unlock()
	key := flruntime.RequestKey("edit-queue:" + req.ClientRequestID)
	previous, found, err := reader.LookupQueuedEdit(ctx, flruntime.LookupQueuedEditInput{ThreadID: identity.ThreadID(threadID), RequestKey: key})
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	if found {
		if previous.QueueItemID != queueID || queuedInputFingerprint(previous.ExpectedInput) != content.ExpectedInputFingerprint || previous.Input.Text != content.Text {
			return flruntime.ThreadView{}, flruntime.ErrRequestConflict
		}
		_, ids, err := queuedEditAttachmentIDs(previous.ExpectedInput, content)
		if err != nil {
			return flruntime.ThreadView{}, err
		}
		if len(ids) != len(previous.Input.Attachments) {
			return flruntime.ThreadView{}, flruntime.ErrRequestConflict
		}
		for i, attachment := range previous.Input.Attachments {
			id, _ := uploadIDFromFloretResourceRef(attachment.ResourceRef)
			if id != ids[i] {
				return flruntime.ThreadView{}, flruntime.ErrRequestConflict
			}
		}
		refs, contexts, err := s.queuedEditReferences(ctx, meta, previous.ExpectedInput, content, req.ClientRequestID)
		if err != nil {
			return flruntime.ThreadView{}, err
		}
		if !slices.Equal(refs, previous.Input.References) || !slices.Equal(contexts, previous.Input.Context) {
			return flruntime.ThreadView{}, flruntime.ErrRequestConflict
		}
		return s.threadRuntime.View(ctx, identity.ThreadID(threadID))
	}
	current, err := s.threadRuntime.View(ctx, identity.ThreadID(threadID))
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	var original *flruntime.UserInput
	for _, queued := range current.Queue {
		if queued.ID == queueID {
			input := queued.Input
			original = &input
			break
		}
	}
	if original == nil || queuedInputFingerprint(*original) != content.ExpectedInputFingerprint {
		return flruntime.ThreadView{}, flruntime.ErrRequestConflict
	}
	retained, _, err := queuedEditAttachmentIDs(*original, content)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	if err := s.authorizeThreadReferences(ctx, meta, content.ContextAction); err != nil {
		return flruntime.ThreadView{}, err
	}
	refs, contexts, err := s.queuedEditReferences(ctx, meta, *original, content, req.ClientRequestID)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	prepared, input, err := s.prepareUserTurnForTarget(ctx, meta, meta.EndpointID, threadID, settings.ModelID, RunInput{Text: content.Text, Attachments: content.Attachments, ContextAction: content.ContextAction}, content.StagingScopeID, content.StagingCapability)
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	// Validate retained and new descriptors together before claiming any upload.
	capability := prepared.AttachmentClaimPolicy
	if len(retained)+len(input.Attachments) > capability.MaxCount {
		return flruntime.ThreadView{}, errors.New("attachment count exceeds turn limit")
	}
	var bytes int64
	for _, attachment := range retained {
		bytes += attachment.SizeBytes
		if route := capability.Routes[normalizeMediaType(attachment.MIMEType)]; route != "native_full_content" && route != "tool_read" {
			return flruntime.ThreadView{}, errors.New("attachment media route is unsupported for model")
		}
	}
	for _, attachment := range input.Attachments {
		record, err := s.threadsDB.GetUpload(ctx, meta.EndpointID, attachment.AttachmentID)
		if err != nil {
			return flruntime.ThreadView{}, err
		}
		bytes += record.SizeBytes
	}
	if bytes > capability.MaxTurnBytes {
		return flruntime.ThreadView{}, errors.New("attachment bytes exceed turn limit")
	}
	if len(prepared.UploadIDs) > 0 {
		if prepared.StagingScope == nil {
			return flruntime.ThreadView{}, errors.New("new queue attachments require a staging scope")
		}
		if err := s.threadsDB.ClaimStagedUploadsToThread(ctx, meta.EndpointID, threadID, prepared.UploadIDs, capability, *prepared.StagingScope, true); err != nil {
			return flruntime.ThreadView{}, err
		}
	}
	replacement, err := floretTurnInputWithUploadLoader(ctx, input, refs, func(ctx context.Context, uploadID string) (*threadstore.UploadRecord, error) {
		return s.threadsDB.GetThreadOwnedUpload(ctx, meta.EndpointID, threadID, uploadID)
	})
	if err != nil {
		return flruntime.ThreadView{}, err
	}
	replacement.Attachments = append(retained, replacement.Attachments...)
	replacement.Context = contexts
	if original.ModelContextSnapshot != nil {
		snapshot := *original.ModelContextSnapshot
		snapshot.Sections = append([]flruntime.ModelContextSection(nil), snapshot.Sections...)
		replacement.ModelContextSnapshot = &snapshot
	}
	return editor.EditQueued(ctx, flruntime.EditQueuedInput{ThreadID: identity.ThreadID(threadID), QueueItemID: queueID, ExpectedInput: original, Input: &replacement, RequestKey: key})
}

// Source context indices are canonical host facts. Older captured snapshots
// predate explicit reference_ids; their source order skips only thread items,
// which intentionally have no separate context snapshot.
func retainedQueuedReferenceContext(original flruntime.UserInput, retained map[string]bool) ([]flruntime.MessageContextItem, error) {
	var result []flruntime.MessageContextItem
	sourceIndex := 0
	threadIndices := map[int]bool{}
	for _, ref := range original.References {
		if ref.Kind == flruntime.MessageReferenceThread && strings.HasPrefix(ref.ReferenceID, "context:") {
			if index, err := strconv.Atoi(strings.TrimPrefix(ref.ReferenceID, "context:")); err == nil {
				threadIndices[index] = true
			}
		}
	}
	for _, fact := range original.Context {
		switch fact.Kind {
		case contextActionKindFilePath, contextActionKindTerminal, contextActionKindProcess, contextActionKindText, contextActionKindTessiven:
		default:
			result = append(result, fact)
			continue
		}
		for threadIndices[sourceIndex] {
			sourceIndex++
		}
		var ids []string
		_, raw, hasMetadata := strings.Cut(fact.Text, "\n")
		var metadata map[string]string
		if hasMetadata && json.Unmarshal([]byte(raw), &metadata) == nil && metadata["reference_ids"] != "" {
			if err := json.Unmarshal([]byte(metadata["reference_ids"]), &ids); err != nil {
				return nil, err
			}
		} else {
			prefix := floretContextReferenceID(sourceIndex)
			for _, ref := range original.References {
				if ref.ReferenceID == prefix || strings.HasPrefix(ref.ReferenceID, prefix+":") {
					ids = append(ids, ref.ReferenceID)
				}
			}
		}
		sourceIndex++
		keep := len(ids) == 0
		for _, id := range ids {
			keep = keep || retained[id]
		}
		if keep {
			if len(ids) > 0 && metadata != nil {
				head, _, _ := strings.Cut(fact.Text, "\n")
				encodedIDs, _ := json.Marshal(ids)
				metadata["reference_ids"] = string(encodedIDs)
				encoded, _ := json.Marshal(metadata)
				fact.Text = head + "\n" + string(encoded)
			}
			result = append(result, fact)
		}
	}
	return result, nil
}

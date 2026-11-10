package ai

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/session"
)

var ErrMessageEditUnconfirmed = errors.New("message edit admission could not be confirmed")

// MessageEditDraft is a host presentation of canonical input. Runtime context,
// opaque resource locators and execution authority never enter the browser.
type MessageEditDraft struct {
	StorageGeneration  string                     `json:"storage_generation"`
	ItemID             string                     `json:"item_id"`
	TurnID             string                     `json:"turn_id"`
	InputFingerprint   string                     `json:"input_fingerprint"`
	Prompt             string                     `json:"prompt"`
	References         []ContextActionContextItem `json:"references"`
	ReferenceIDs       []string                   `json:"reference_ids"`
	Attachments        []flowerPublicAttachment   `json:"attachments"`
	RevisionRequestKey string                     `json:"revision_request_key,omitempty"`
}
type EditMessageRequest struct {
	ClientRequestID    string            `json:"client_request_id"`
	StorageGeneration  string            `json:"storage_generation"`
	ItemID             string            `json:"item_id"`
	StopActive         bool              `json:"stop_active"`
	RestoreRevisionKey string            `json:"restore_revision_key,omitempty"`
	Content            EditQueuedContent `json:"content"`
}
type MessageEditHistory struct {
	Draft MessageEditDraft   `json:"draft"`
	Items []flowerPublicItem `json:"items"`
}

func (s *Service) messageEditor(ctx context.Context, meta *session.Meta, threadID string) (flruntime.ThreadMessageEditor, error) {
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if s == nil || s.threadRuntime == nil || strings.TrimSpace(threadID) == "" {
		return nil, errors.New("invalid message edit request")
	}
	if err := s.requireInteractiveThreadAuthority(ctx, meta.EndpointID, threadID); err != nil {
		return nil, err
	}
	editor, ok := s.threadRuntime.(flruntime.ThreadMessageEditor)
	if !ok {
		return nil, errors.New("message editing is unavailable")
	}
	return editor, nil
}
func (s *Service) messageEditDraft(meta *session.Meta, threadID string, target flruntime.EditableMessage) (MessageEditDraft, error) {
	refs, err := s.editedDraftReferences(meta, target.Input)
	if err != nil {
		return MessageEditDraft{}, err
	}
	out := MessageEditDraft{StorageGeneration: s.storageGeneration, ItemID: target.ItemID, TurnID: target.TurnID.String(), InputFingerprint: queuedInputFingerprint(target.Input), Prompt: target.Input.Text, References: refs, ReferenceIDs: []string{}, Attachments: projectFlowerAttachments(target.Input.Attachments, threadID, target.TurnID.String(), ""), RevisionRequestKey: string(target.RevisionRequestKey)}
	if out.Attachments == nil {
		out.Attachments = []flowerPublicAttachment{}
	}
	for _, ref := range target.Input.References {
		out.ReferenceIDs = append(out.ReferenceIDs, ref.ReferenceID)
	}
	return out, nil
}
func (s *Service) GetMessageEditDraft(ctx context.Context, meta *session.Meta, threadID string) (MessageEditDraft, error) {
	editor, err := s.messageEditor(ctx, meta, threadID)
	if err != nil {
		return MessageEditDraft{}, err
	}
	target, err := editor.LatestEditableMessage(ctx, identity.ThreadID(threadID))
	if err != nil {
		return MessageEditDraft{}, err
	}
	return s.messageEditDraft(meta, threadID, target)
}
func (s *Service) GetMessageEditHistory(ctx context.Context, meta *session.Meta, threadID, key string) (MessageEditHistory, error) {
	editor, err := s.messageEditor(ctx, meta, threadID)
	if err != nil {
		return MessageEditHistory{}, err
	}
	in := flruntime.LookupMessageEditInput{ThreadID: identity.ThreadID(threadID), RequestKey: flruntime.RequestKey(key)}
	previous, found, err := editor.LookupMessageEdit(ctx, in)
	if err != nil {
		return MessageEditHistory{}, err
	}
	if !found {
		return MessageEditHistory{}, flruntime.ErrRequestConflict
	}
	draft, err := s.messageEditDraft(meta, threadID, previous.EditableMessage)
	if err != nil {
		return MessageEditHistory{}, err
	}
	items, err := editor.ReadMessageEditHistory(ctx, in)
	if err != nil {
		return MessageEditHistory{}, err
	}
	result := MessageEditHistory{Draft: draft, Items: []flowerPublicItem{}}
	for _, item := range items {
		if item.TurnID.String() == draft.TurnID {
			result.Items = append(result.Items, projectFlowerItem(item, threadID, nil))
		}
	}
	return result, nil
}
func (s *Service) EditLastUserMessage(ctx context.Context, meta *session.Meta, threadID string, req EditMessageRequest) (flruntime.ThreadCommandAck, error) {
	editor, err := s.messageEditor(ctx, meta, threadID)
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	if req.StorageGeneration != s.storageGeneration {
		return flruntime.ThreadCommandAck{}, ErrFlowerStorageRestored
	}
	if !validClientRequestID(req.ClientRequestID) || len(req.Content.ExpectedInputFingerprint) != 64 || strings.TrimSpace(req.ItemID) == "" {
		return flruntime.ThreadCommandAck{}, errors.New("invalid message edit identity")
	}
	if err := validateInlineTurnText(req.Content.Text); err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	unlockCanvas, err := s.lockTessivenExecution(ctx, threadID)
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	defer unlockCanvas()
	_, settings, unlock, err := s.lockCanonicalThreadSettingsMutation(ctx, meta.EndpointID, threadID)
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	defer unlock()
	key := flruntime.RequestKey("edit-message:" + req.ClientRequestID)
	previous, found, err := editor.LookupMessageEdit(ctx, flruntime.LookupMessageEditInput{ThreadID: identity.ThreadID(threadID), RequestKey: key})
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	var target flruntime.EditableMessage
	if found {
		target = previous.EditableMessage
	} else {
		target, err = editor.LatestEditableMessage(ctx, identity.ThreadID(threadID))
		if err != nil {
			return flruntime.ThreadCommandAck{}, err
		}
	}
	if target.ItemID != req.ItemID || queuedInputFingerprint(target.Input) != req.Content.ExpectedInputFingerprint {
		return flruntime.ThreadCommandAck{}, flruntime.ErrRequestConflict
	}
	original := target.Input
	if req.RestoreRevisionKey != "" {
		restored, exists, err := editor.LookupMessageEdit(ctx, flruntime.LookupMessageEditInput{ThreadID: identity.ThreadID(threadID), RequestKey: flruntime.RequestKey(req.RestoreRevisionKey)})
		if err != nil {
			return flruntime.ThreadCommandAck{}, err
		}
		if !exists {
			return flruntime.ThreadCommandAck{}, flruntime.ErrRequestConflict
		}
		original = restored.Input
	}
	if found {
		_, ids, err := queuedEditAttachmentIDs(original, req.Content)
		if err != nil {
			return flruntime.ThreadCommandAck{}, err
		}
		if previous.Replacement.Text != req.Content.Text || len(ids) != len(previous.Replacement.Attachments) {
			return flruntime.ThreadCommandAck{}, flruntime.ErrRequestConflict
		}
		for i, a := range previous.Replacement.Attachments {
			id, _ := uploadIDFromFloretResourceRef(a.ResourceRef)
			if id != ids[i] {
				return flruntime.ThreadCommandAck{}, flruntime.ErrRequestConflict
			}
		}
		refs, facts, err := s.queuedEditReferences(ctx, meta, original, req.Content, req.ClientRequestID)
		if err != nil {
			return flruntime.ThreadCommandAck{}, err
		}
		if !slices.Equal(refs, previous.Replacement.References) || !slices.Equal(facts, previous.Replacement.Context) {
			return flruntime.ThreadCommandAck{}, flruntime.ErrRequestConflict
		}
		return previous.Ack, nil
	}
	permission, err := threadPermissionType(settings)
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	send := SendUserTurnRequest{ThreadID: threadID, Model: settings.ModelID, Options: RunOptions{PermissionType: permissionTypeString(permission)}}
	if err := s.requireDesktopModelSourceForSend(ctx, meta, send); err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	replacement, err := s.prepareEditedInput(ctx, meta, threadID, settings.ModelID, original, req.Content, req.ClientRequestID)
	if err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	if err := replacement.Validate(); err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	if err := s.persistExecutionAuthority(ctx, meta, threadID, string(key), "", send.Options.PermissionType, send); err != nil {
		return flruntime.ThreadCommandAck{}, err
	}
	ack, err := editor.EditLastUserMessage(ctx, flruntime.EditLastUserMessageInput{ThreadID: identity.ThreadID(threadID), ItemID: req.ItemID, ExpectedInput: target.Input, Input: replacement, RequestKey: key, StopActive: req.StopActive})
	if err != nil && !errors.Is(err, flruntime.ErrRequestConflict) {
		return flruntime.ThreadCommandAck{}, errors.Join(ErrMessageEditUnconfirmed, err)
	}
	return ack, err
}

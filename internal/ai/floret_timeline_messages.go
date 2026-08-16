package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/url"
	"slices"
	"strings"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/floret/v4/observation"
	flruntime "github.com/floegence/floret/v4/runtime"
)

// threadTimelineMessage is an HTTP pagination envelope over the typed current
// view. RowID is response-local ordering, not a durable lifecycle cursor.
type threadTimelineMessage struct {
	RowID       int64
	MessageID   string
	MessageJSON json.RawMessage
	Decoration  *FlowerTimelineDecoration
}

func normalizeTimelineLimit(limit int) int {
	if limit <= 0 {
		return 200
	}
	return min(limit, 500)
}

func (service *Service) typedTimelineMessages(ctx context.Context, endpointID, threadID string) ([]threadTimelineMessage, error) {
	if service == nil || service.threadRuntime == nil || service.threadsDB == nil {
		return nil, errors.New("Flower thread runtime is unavailable")
	}
	endpointID, threadID = strings.TrimSpace(endpointID), strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	settings, err := service.threadsDB.GetThreadSettings(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil || settings == nil {
		if err == nil {
			err = flruntime.ErrThreadNotFound
		}
		return nil, err
	}
	view, err := service.threadRuntime.View(ctxOrBackground(ctx), identity.ThreadID(threadID))
	if err != nil {
		return nil, err
	}
	items := append([]flruntime.ThreadItem(nil), view.Items...)
	if len(items) == 0 {
		history, historyErr := service.threadRuntime.History(ctxOrBackground(ctx), identity.ThreadID(threadID), "", 200)
		if historyErr != nil {
			return nil, historyErr
		}
		items = history.Items
	}
	out := make([]threadTimelineMessage, 0, len(items))
	for _, item := range items {
		raw, ok, itemErr := typedThreadItemMessage(threadID, item)
		if itemErr != nil {
			return nil, itemErr
		}
		if !ok {
			continue
		}
		out = append(out, threadTimelineMessage{RowID: int64(len(out) + 1), MessageID: item.ID, MessageJSON: raw})
	}
	return out, nil
}

func typedThreadItemMessage(threadID string, item flruntime.ThreadItem) (json.RawMessage, bool, error) {
	createdAt := item.CreatedAt.UnixMilli()
	switch item.Kind {
	case flruntime.ThreadItemUser:
		raw, err := canonicalUserTimelineMessageForThread(threadID, item.TurnID.String(), item.ID, item.Text, item.Attachments, item.References, createdAt)
		return raw, err == nil, err
	case flruntime.ThreadItemInteraction:
		return typedResolvedInputMessage(threadID, item, createdAt)
	case flruntime.ThreadItemTool:
		if item.Activity == nil {
			return nil, false, nil
		}
		timeline := observation.ActivityTimeline{
			SchemaVersion: observation.ActivityTimelineSchemaVersion,
			ThreadID:      identity.ThreadID(threadID),
			TurnID:        item.TurnID,
			Items:         []observation.ActivityItem{*item.Activity},
		}
		timeline.Summary = observation.RebuildActivitySummary(timeline)
		block := newActivityTimelineBlockWithPublicIdentity(timeline, nil, activityTimelinePublicIdentity{
			ThreadID: threadID,
			TurnID:   item.TurnID.String(),
		})
		raw, err := json.Marshal(map[string]any{
			"id": item.ID, "thread_id": threadID, "turn_id": item.TurnID.String(), "role": "assistant",
			"status": "complete", "timestamp": createdAt, "content": "", "blocks": []any{block},
			"live": false, "active_cursor": false,
		})
		return raw, true, err
	case flruntime.ThreadItemThinking, flruntime.ThreadItemAssistant:
		// Both text segment kinds are mapped below.
	default:
		return nil, false, nil
	}
	text := strings.TrimSpace(item.Text)
	if text == "" {
		return nil, false, nil
	}
	status := "complete"
	if item.Live {
		status = "streaming"
	}
	blocks := []any{persistedMarkdownBlock{Type: "markdown", Content: text}}
	content := text
	activeCursor := item.Live
	if item.Kind == flruntime.ThreadItemThinking {
		blocks = []any{persistedThinkingBlock{Type: "thinking", Content: text}}
		content = ""
		activeCursor = false
	}
	raw, err := json.Marshal(map[string]any{
		"id": item.ID, "thread_id": threadID, "turn_id": item.TurnID.String(), "role": "assistant",
		"status": status, "timestamp": createdAt, "content": content,
		"blocks": blocks, "live": item.Live, "active_cursor": activeCursor,
	})
	return raw, true, err
}

func typedResolvedInputMessage(threadID string, item flruntime.ThreadItem, createdAt int64) (json.RawMessage, bool, error) {
	interaction := item.Interaction
	if interaction == nil || interaction.Kind != flruntime.ThreadInteractionInput || !interaction.Resolved || interaction.Resolution == nil || interaction.Resolution.Redacted {
		return nil, false, nil
	}
	keys := slices.Sorted(maps.Keys(interaction.Resolution.Input))
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		if value := strings.TrimSpace(interaction.Resolution.Input[key]); value != "" {
			values = append(values, value)
		}
	}
	text := strings.Join(values, "\n")
	if text == "" {
		return nil, false, nil
	}
	raw, err := canonicalUserTimelineMessageForThread(threadID, item.TurnID.String(), item.ID, text, nil, nil, createdAt)
	return raw, err == nil, err
}

func (service *Service) listThreadTimelineMessages(ctx context.Context, endpointID, threadID string, limit int, beforeRowID int64) ([]threadTimelineMessage, int64, bool, error) {
	items, err := service.typedTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	limit = normalizeTimelineLimit(limit)
	end := len(items)
	if beforeRowID > 0 && int(beforeRowID) <= end {
		end = int(beforeRowID) - 1
	}
	start := max(0, end-limit)
	page := append([]threadTimelineMessage(nil), items[start:end]...)
	if start == 0 || len(page) == 0 {
		return page, 0, false, nil
	}
	return page, int64(start + 1), true, nil
}

func (service *Service) listThreadTimelineMessagesAfter(ctx context.Context, endpointID, threadID string, limit int, afterRowID int64, tail bool) ([]threadTimelineMessage, int64, bool, error) {
	items, err := service.typedTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	limit = normalizeTimelineLimit(limit)
	start := max(0, int(afterRowID))
	if tail {
		start = max(0, len(items)-limit)
	}
	if start > len(items) {
		start = len(items)
	}
	end := min(len(items), start+limit)
	page := append([]threadTimelineMessage(nil), items[start:end]...)
	return page, int64(end), end < len(items), nil
}

func (service *Service) buildCanonicalFlowerTimelineMessages(ctx context.Context, endpointID, threadID string) ([]FlowerTimelineMessage, error) {
	items, err := service.typedTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	out := make([]FlowerTimelineMessage, 0, len(items))
	for _, item := range items {
		message, ok, decodeErr := flowerTimelineMessageFromRaw(threadID, "", "", item.MessageID, item.MessageJSON)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if ok {
			out = append(out, message)
		}
	}
	return out, nil
}

func canonicalUserTimelineMessage(turnID, entryID, input string, attachments []flruntime.MessageAttachment, references []flruntime.MessageReference, createdAt int64) (json.RawMessage, error) {
	return canonicalUserTimelineMessageForThread("", turnID, entryID, input, attachments, references, createdAt)
}

func canonicalUserTimelineMessageForThread(threadID, turnID, entryID, input string, attachments []flruntime.MessageAttachment, references []flruntime.MessageReference, createdAt int64) (json.RawMessage, error) {
	threadID, turnID, entryID = strings.TrimSpace(threadID), strings.TrimSpace(turnID), strings.TrimSpace(entryID)
	if turnID == "" || entryID == "" {
		return nil, errors.New("canonical user message has incomplete identity")
	}
	blocks := make([]any, 0, len(attachments)+1)
	for index, attachment := range attachments {
		uploadID, err := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return nil, fmt.Errorf("canonical user attachment %d: %w", index, err)
		}
		downloadURL := uploadURLPrefix + uploadID
		if threadID != "" {
			downloadURL += "?" + url.Values{"thread_id": {threadID}, "turn_id": {turnID}}.Encode()
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(attachment.MIMEType)), "image/") {
			blocks = append(blocks, persistedImageBlock{Type: "image", Src: downloadURL, Alt: strings.TrimSpace(attachment.Name)})
		} else {
			blocks = append(blocks, persistedFileBlock{Type: "file", Name: strings.TrimSpace(attachment.Name), Size: attachment.SizeBytes, MimeType: strings.TrimSpace(attachment.MIMEType), URL: downloadURL})
		}
	}
	if input = strings.TrimSpace(input); input != "" {
		blocks = append(blocks, persistedMarkdownBlock{Type: "markdown", Content: input})
	}
	publicReferences, err := publicFloretMessageReferences(references)
	if err != nil {
		return nil, err
	}
	if len(blocks) == 0 && len(publicReferences) == 0 {
		return nil, errors.New("canonical user message has no content")
	}
	message := map[string]any{
		"id": entryID, "thread_id": threadID, "turn_id": turnID, "role": "user", "status": "complete",
		"timestamp": createdAt, "content": input, "blocks": blocks, "live": false, "active_cursor": false,
	}
	if len(publicReferences) > 0 {
		message["references"] = publicReferences
	}
	raw, err := json.Marshal(message)
	return raw, err
}

type publicFloretMessageReference = FlowerMessageReference

func publicFloretMessageReferences(references []flruntime.MessageReference) ([]publicFloretMessageReference, error) {
	out := make([]publicFloretMessageReference, 0, len(references))
	for index, reference := range references {
		if err := reference.Validate(); err != nil {
			return nil, fmt.Errorf("canonical user reference %d: %w", index, err)
		}
		text := reference.Text
		if reference.Kind == flruntime.MessageReferenceFile || reference.Kind == flruntime.MessageReferenceDirectory {
			text = ""
		}
		out = append(out, FlowerMessageReference{ReferenceID: reference.ReferenceID, Kind: string(reference.Kind), Label: reference.Label, Text: text, Truncated: reference.Truncated})
	}
	return out, nil
}

func publicFloretThreadView(current flruntime.ThreadView) flruntime.ThreadView {
	out := current
	out.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	for index := range out.Items {
		out.Items[index].Attachments = publicFloretAttachments(out.Items[index].Attachments)
		out.Items[index].References = publicRuntimeReferences(out.Items[index].References)
		if out.Items[index].Interaction != nil {
			interaction := publicFloretInteraction(*out.Items[index].Interaction)
			out.Items[index].Interaction = &interaction
		}
	}
	out.Queue = append([]flruntime.QueuedInput(nil), current.Queue...)
	for index := range out.Queue {
		out.Queue[index].Input.Attachments = publicFloretAttachments(out.Queue[index].Input.Attachments)
		out.Queue[index].Input.References = publicRuntimeReferences(out.Queue[index].Input.References)
	}
	out.Interactions = append([]flruntime.ThreadInteraction(nil), current.Interactions...)
	for index := range out.Interactions {
		out.Interactions[index] = publicFloretInteraction(out.Interactions[index])
	}
	return out
}

func publicFloretAttachments(attachments []flruntime.MessageAttachment) []flruntime.MessageAttachment {
	out := append([]flruntime.MessageAttachment(nil), attachments...)
	for index := range out {
		out[index].ResourceRef = ""
	}
	return out
}

func publicRuntimeReferences(references []flruntime.MessageReference) []flruntime.MessageReference {
	out := append([]flruntime.MessageReference(nil), references...)
	for index := range out {
		out[index].ResourceRef = ""
		if out[index].Kind == flruntime.MessageReferenceFile || out[index].Kind == flruntime.MessageReferenceDirectory {
			out[index].Text = ""
		}
	}
	return out
}

func publicFloretInteraction(interaction flruntime.ThreadInteraction) flruntime.ThreadInteraction {
	if interaction.Resolution == nil {
		return interaction
	}
	resolution := *interaction.Resolution
	if resolution.Redacted {
		resolution.Input = nil
	} else if resolution.Input != nil {
		resolution.Input = maps.Clone(resolution.Input)
	}
	interaction.Resolution = &resolution
	return interaction
}

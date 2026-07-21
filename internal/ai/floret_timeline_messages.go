package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
)

type threadTimelineMessage struct {
	RowID         int64
	MessageID     string
	CreatedAt     int64
	CanonicalTurn string
	CanonicalRun  string
	TurnOrdinal   int64
	TurnStatus    flruntime.TurnStatus
	MessageJSON   json.RawMessage
	Decoration    *FlowerTimelineDecoration
}

func (s *Service) listThreadTimelineMessages(ctx context.Context, endpointID string, threadID string, limit int, beforeRowID int64) ([]threadTimelineMessage, int64, bool, error) {
	items, err := s.loadThreadTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	messages := timelineMessageItems(items)
	limit = normalizeTimelineLimit(limit)
	end := len(messages)
	if beforeRowID > 0 {
		found := false
		for index, item := range messages {
			if item.RowID == beforeRowID {
				end = index
				found = true
				break
			}
		}
		if !found {
			return nil, 0, false, canonicalTimelineResyncErrorf("before cursor %d is not present in the canonical timeline", beforeRowID)
		}
	}
	start := max(0, end-limit)
	page := append([]threadTimelineMessage(nil), messages[start:end]...)
	out := timelinePageWithRelatedDecorations(items, page)
	if start == 0 || len(page) == 0 {
		return out, 0, false, nil
	}
	return out, page[0].RowID, true, nil
}

func (s *Service) listThreadTimelineMessagesAfter(ctx context.Context, endpointID string, threadID string, limit int, afterRowID int64, tail bool) ([]threadTimelineMessage, int64, bool, error) {
	items, err := s.loadThreadTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	messages := timelineMessageItems(items)
	limit = normalizeTimelineLimit(limit)
	start := 0
	if tail {
		start = max(0, len(messages)-limit)
	} else if afterRowID > 0 {
		found := false
		for index, item := range messages {
			if item.RowID == afterRowID {
				start = index + 1
				found = true
				break
			}
		}
		if !found {
			return nil, 0, false, canonicalTimelineResyncErrorf("after cursor %d is not present in the canonical timeline", afterRowID)
		}
	}
	end := min(len(messages), start+limit)
	page := append([]threadTimelineMessage(nil), messages[start:end]...)
	out := timelinePageWithRelatedDecorations(items, page)
	next := afterRowID
	if len(page) > 0 {
		next = page[len(page)-1].RowID
	}
	return out, next, end < len(messages), nil
}

func normalizeTimelineLimit(limit int) int {
	if limit <= 0 {
		return 200
	}
	return min(limit, 500)
}

func timelineMessageItems(items []threadTimelineMessage) []threadTimelineMessage {
	out := make([]threadTimelineMessage, 0, len(items))
	for _, item := range items {
		if item.Decoration == nil {
			out = append(out, item)
		}
	}
	return out
}

func timelinePageWithRelatedDecorations(items []threadTimelineMessage, page []threadTimelineMessage) []threadTimelineMessage {
	if len(page) == 0 {
		return nil
	}
	rows := make(map[int64]struct{}, len(page))
	messageIDs := make(map[string]struct{}, len(page))
	for _, item := range page {
		rows[item.RowID] = struct{}{}
		messageIDs[strings.TrimSpace(item.MessageID)] = struct{}{}
	}
	out := make([]threadTimelineMessage, 0, len(page))
	for _, item := range items {
		if item.Decoration == nil {
			if _, ok := rows[item.RowID]; ok {
				out = append(out, item)
			}
			continue
		}
		if _, ok := messageIDs[strings.TrimSpace(item.Decoration.Anchor.MessageID)]; ok {
			out = append(out, item)
		}
	}
	return out
}

func (s *Service) loadThreadTimelineMessages(ctx context.Context, endpointID string, threadID string) ([]threadTimelineMessage, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}
	host, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return nil, err
	}
	turns, err := listAllFloretThreadTurns(ctx, host, threadID)
	if err != nil {
		return nil, err
	}
	items := make([]threadTimelineMessage, 0, len(turns)*2)
	for _, turn := range turns {
		turnID := strings.TrimSpace(string(turn.TurnID))
		runID := strings.TrimSpace(string(turn.RunID))
		userEntryID := strings.TrimSpace(turn.UserEntryID)
		if turnID == "" || runID == "" || userEntryID == "" || turn.Ordinal <= 0 {
			return nil, fmt.Errorf("Floret turn %q has incomplete canonical identity", turnID)
		}
		userCreatedAt := turn.StartedAt.UnixMilli()
		userRaw, err := canonicalUserTimelineMessage(turnID, userEntryID, turn.UserInput, turn.UserAttachments, turn.UserReferences, userCreatedAt)
		if err != nil {
			return nil, err
		}
		userRowID := turn.Ordinal * 4
		items = append(items, threadTimelineMessage{
			RowID: userRowID, MessageID: userEntryID, CreatedAt: userCreatedAt,
			CanonicalTurn: turnID, CanonicalRun: runID,
			TurnOrdinal: turn.Ordinal, TurnStatus: turn.Status, MessageJSON: userRaw,
		})
		assistant, reason, err := s.floretProjectionMessage(endpointID, threadID, turn)
		if err != nil {
			return nil, err
		}
		if len(assistant) > 0 {
			items = append(items, threadTimelineMessage{
				RowID: userRowID + 1, MessageID: turnID, CreatedAt: turn.UpdatedAt.UnixMilli(),
				CanonicalTurn: turnID, CanonicalRun: runID,
				TurnOrdinal: turn.Ordinal, TurnStatus: turn.Status, MessageJSON: assistant,
			})
		} else if reason.Valid() {
			decoration, err := projectionUnavailableDecoration(turn, reason)
			if err != nil {
				return nil, err
			}
			items = append(items, threadTimelineMessage{
				RowID: userRowID + 1, MessageID: turnID, CreatedAt: turn.UpdatedAt.UnixMilli(),
				CanonicalTurn: turnID, CanonicalRun: runID,
				TurnOrdinal: turn.Ordinal, TurnStatus: turn.Status, Decoration: &decoration,
			})
		}
	}
	return items, nil
}

func listAllFloretThreadTurns(ctx context.Context, host interface {
	ListThreadTurns(context.Context, flruntime.ListThreadTurnsRequest) (flruntime.ThreadTurnsPage, error)
}, threadID string) ([]flruntime.ThreadTurnSnapshot, error) {
	newerThroughOrdinal := int64(-1)
	newerOldestTurnOrdinal := int64(-1)
	out := make([]flruntime.ThreadTurnSnapshot, 0)
	var before *flruntime.ThreadTurnsBeforeCursor
	for {
		request := flruntime.ListThreadTurnsRequest{ThreadID: flruntime.ThreadID(threadID)}
		if before == nil {
			request.Tail = 200
		} else {
			request.BeforeCursor = before
			request.Limit = 200
		}
		page, err := host.ListThreadTurns(ctx, request)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(string(page.ThreadID)) != strings.TrimSpace(threadID) {
			return nil, canonicalTimelineResyncErrorf("turn page thread identity differs from the requested thread")
		}
		if page.ThroughOrdinal < 0 {
			return nil, canonicalTimelineResyncErrorf("turn page through ordinal is negative")
		}
		if before != nil && len(page.Turns) == 0 {
			return nil, canonicalTimelineResyncErrorf("historical turn page is empty after a page reported more turns")
		}
		if before != nil && (page.ThroughOrdinal >= newerThroughOrdinal || page.ThroughOrdinal >= newerOldestTurnOrdinal) {
			return nil, canonicalTimelineResyncErrorf(
				"historical turn page through ordinal %d does not precede newer page boundary %d and oldest turn %d",
				page.ThroughOrdinal,
				newerThroughOrdinal,
				newerOldestTurnOrdinal,
			)
		}
		for index, turn := range page.Turns {
			if turn.Ordinal <= 0 || turn.Ordinal > page.ThroughOrdinal {
				return nil, canonicalTimelineResyncErrorf("turn ordinal %d is outside page boundary %d", turn.Ordinal, page.ThroughOrdinal)
			}
			if index > 0 && turn.Ordinal <= page.Turns[index-1].Ordinal {
				return nil, canonicalTimelineResyncErrorf("turn ordinals are not strictly increasing")
			}
		}
		out = append(append(make([]flruntime.ThreadTurnSnapshot, 0, len(page.Turns)+len(out)), page.Turns...), out...)
		if !page.HasMore {
			break
		}
		if len(page.Turns) == 0 || page.BeforeCursor == nil || strings.TrimSpace(page.BeforeCursor.EntryID) == "" {
			return nil, errors.New("Floret turn pagination did not advance")
		}
		if before != nil && page.BeforeCursor.EntryID == before.EntryID {
			return nil, errors.New("Floret turn pagination cursor did not advance")
		}
		newerThroughOrdinal = page.ThroughOrdinal
		newerOldestTurnOrdinal = page.Turns[0].Ordinal
		before = page.BeforeCursor
	}
	for index, turn := range out {
		if index > 0 && turn.Ordinal <= out[index-1].Ordinal {
			return nil, canonicalTimelineResyncErrorf("turn ordinals are not strictly increasing")
		}
	}
	return out, nil
}

func canonicalTimelineResyncErrorf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrCanonicalTimelineResyncRequired, fmt.Sprintf(format, args...))
}

func canonicalUserTimelineMessage(turnID string, entryID string, input string, attachments []flruntime.MessageAttachment, references []flruntime.MessageReference, createdAt int64) (json.RawMessage, error) {
	turnID = strings.TrimSpace(turnID)
	entryID = strings.TrimSpace(entryID)
	if turnID == "" || entryID == "" {
		return nil, errors.New("canonical user message has incomplete identity")
	}
	blocks := make([]any, 0, len(attachments)+1)
	for index, attachment := range attachments {
		uploadID, err := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			return nil, fmt.Errorf("canonical user attachment %d: %w", index, err)
		}
		url := uploadURLPrefix + uploadID
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(attachment.MIMEType)), "image/") {
			blocks = append(blocks, persistedImageBlock{Type: "image", Src: url, Alt: strings.TrimSpace(attachment.Name)})
			continue
		}
		blocks = append(blocks, persistedFileBlock{
			Type: "file", Name: strings.TrimSpace(attachment.Name), Size: attachment.SizeBytes,
			MimeType: strings.TrimSpace(attachment.MIMEType), URL: url,
		})
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
		"id": entryID, "turn_id": turnID, "role": "user", "status": "complete", "timestamp": createdAt,
		"blocks": blocks,
	}
	if len(publicReferences) > 0 {
		message["references"] = publicReferences
	}
	raw, err := json.Marshal(message)
	return json.RawMessage(raw), err
}

type publicFloretMessageReference = FlowerMessageReference

func publicFloretMessageReferences(references []flruntime.MessageReference) ([]publicFloretMessageReference, error) {
	if len(references) == 0 {
		return nil, nil
	}
	out := make([]publicFloretMessageReference, 0, len(references))
	for index, reference := range references {
		if err := reference.Validate(); err != nil {
			return nil, fmt.Errorf("canonical user reference %d: %w", index, err)
		}
		text := reference.Text
		switch reference.Kind {
		case flruntime.MessageReferenceFile, flruntime.MessageReferenceDirectory:
			text = ""
		}
		out = append(out, publicFloretMessageReference{
			ReferenceID: reference.ReferenceID,
			Kind:        string(reference.Kind),
			Label:       reference.Label,
			Text:        text,
			Truncated:   reference.Truncated,
		})
	}
	return out, nil
}

func (s *Service) floretProjectionMessage(endpointID string, threadID string, turn flruntime.ThreadTurnSnapshot) (json.RawMessage, FlowerTurnProjectionUnavailableReason, error) {
	projection := turn.Projection
	if err := projection.Validate(); err != nil {
		return nil, "", canonicalTimelineResyncErrorf("turn %q projection is invalid: %v", turn.TurnID, err)
	}
	if strings.TrimSpace(string(projection.ThreadID)) != strings.TrimSpace(threadID) ||
		projection.TurnID != turn.TurnID || projection.RunID != turn.RunID ||
		projection.ThroughOrdinal != turn.ThroughOrdinal {
		return nil, "", canonicalTimelineResyncErrorf("turn %q projection identity differs from the turn page", turn.TurnID)
	}
	createdAt := turn.StartedAt.UnixMilli()
	if createdAt <= 0 {
		createdAt = turn.UpdatedAt.UnixMilli()
	}
	projectionRun := &run{
		id: strings.TrimSpace(string(turn.RunID)), endpointID: strings.TrimSpace(endpointID),
		threadID: strings.TrimSpace(threadID), turnID: strings.TrimSpace(string(turn.TurnID)), messageID: strings.TrimSpace(string(turn.TurnID)),
		assistantCreatedAtUnixMs: createdAt,
	}
	if err := projectionRun.validateFloretThreadProjection(projection); err != nil {
		return nil, "", canonicalTimelineResyncErrorf("turn %q projection does not match its canonical identity: %v", turn.TurnID, err)
	}
	status, err := snapshotStatusForFloretProjection(projection)
	if err != nil {
		return nil, "", canonicalTimelineResyncErrorf("turn %q projection status is invalid: %v", turn.TurnID, err)
	}
	blocks, err := projectionRun.flowerBlocksFromFloretThreadProjection(projection)
	if err != nil {
		return nil, "", canonicalTimelineResyncErrorf("turn %q projection cannot be mapped: %v", turn.TurnID, err)
	}
	if len(blocks) == 0 {
		if projection.Status == flruntime.TurnStatusRunning {
			return nil, "", nil
		}
		return nil, FlowerTurnProjectionUnavailableNotRenderable, nil
	}
	projectionRun.assistantBlocks = blocks
	raw, _, _, err := projectionRun.snapshotAssistantMessageJSONWithStatus(status)
	if err != nil {
		return nil, "", err
	}
	sanitized, err := SanitizeActivityTimelineMessageJSON(string(raw))
	return sanitized, "", err
}

func projectionUnavailableDecoration(turn flruntime.ThreadTurnSnapshot, reason FlowerTurnProjectionUnavailableReason) (FlowerTimelineDecoration, error) {
	turnID := strings.TrimSpace(string(turn.TurnID))
	runID := strings.TrimSpace(string(turn.RunID))
	userEntryID := strings.TrimSpace(turn.UserEntryID)
	if turnID == "" || runID == "" || userEntryID == "" || !reason.Valid() {
		return FlowerTimelineDecoration{}, errors.New("projection unavailable decoration identity is incomplete")
	}
	decoration := FlowerTimelineDecoration{
		DecorationID: "turn-projection-unavailable:" + turnID,
		Kind:         FlowerTimelineDecorationTurnProjectionUnavailable,
		Anchor:       FlowerTimelineAnchor{TargetKind: "message", MessageID: userEntryID, Edge: "after"},
		ProjectionUnavailable: &FlowerTurnProjectionUnavailable{
			TurnID: turnID, RunID: runID, ExpectedMessageID: turnID, Reason: reason,
		},
	}
	return decoration, decoration.Validate()
}

func snapshotStatusForFloretProjection(projection flruntime.ThreadTurnProjection) (string, error) {
	switch projection.Status {
	case flruntime.TurnStatusRunning, flruntime.TurnStatusWaiting:
		return "streaming", nil
	case flruntime.TurnStatusCancelled:
		return "canceled", nil
	case flruntime.TurnStatusFailed:
		return "error", nil
	case flruntime.TurnStatusCompleted:
		return "complete", nil
	default:
		return "", fmt.Errorf("unsupported Floret turn projection status %q", projection.Status)
	}
}

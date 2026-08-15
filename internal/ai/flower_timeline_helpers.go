package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
)

func flowerTimelineMessageFromRaw(threadID string, canonicalTurnID string, runID string, messageID string, raw json.RawMessage) (FlowerTimelineMessage, bool, error) {
	var record struct {
		ID         string            `json:"id"`
		TurnID     string            `json:"turn_id"`
		Role       string            `json:"role"`
		Status     string            `json:"status"`
		Timestamp  int64             `json:"timestamp"`
		Blocks     []json.RawMessage `json:"blocks"`
		References json.RawMessage   `json:"references"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return FlowerTimelineMessage{}, false, err
	}
	canonicalTurnID = strings.TrimSpace(canonicalTurnID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if recordTurnID := strings.TrimSpace(record.TurnID); threadID == "" || runID == "" || canonicalTurnID == "" || recordTurnID == "" || recordTurnID != canonicalTurnID {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid turn identity")
	}
	id := strings.TrimSpace(record.ID)
	if messageID = strings.TrimSpace(messageID); id == "" {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message is missing message identity")
	} else if messageID == "" || id != messageID {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message identity differs from its row")
	}
	role := strings.TrimSpace(record.Role)
	if role != "user" && role != "assistant" && role != "system" {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid role")
	}
	status := strings.TrimSpace(record.Status)
	if status != "streaming" && status != "error" && status != "complete" && status != "canceled" {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid status")
	}
	if record.Timestamp <= 0 {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid timestamp")
	}
	references, err := decodeFlowerTimelineMessageReferences(record.References, role)
	if err != nil {
		return FlowerTimelineMessage{}, false, err
	}
	blocks := make([]any, 0, len(record.Blocks))
	for index, block := range record.Blocks {
		var value any
		if err := json.Unmarshal(block, &value); err != nil {
			return FlowerTimelineMessage{}, false, fmt.Errorf("canonical timeline message block %d is invalid: %w", index, err)
		}
		if _, ok := value.(map[string]any); !ok {
			return FlowerTimelineMessage{}, false, fmt.Errorf("canonical timeline message block %d is not an object", index)
		}
		blocks = append(blocks, value)
	}
	return FlowerTimelineMessage{
		MessageID: id, ThreadID: threadID, TurnID: canonicalTurnID, RunID: runID,
		Role: role, Content: flowerTimelineTextFromBlocks(blocks), Status: status,
		CreatedAtMs: record.Timestamp, Blocks: blocks, References: references,
	}, true, nil
}

func decodeFlowerTimelineMessageReferences(raw json.RawMessage, role string) ([]FlowerMessageReference, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if role != "user" {
		return nil, errors.New("canonical timeline message references require the user role")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, errors.New("canonical timeline message references must be an array")
	}
	out := make([]FlowerMessageReference, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(item, &fields); err != nil || fields == nil {
			return nil, fmt.Errorf("canonical timeline message reference %d must be an object", index)
		}
		for field := range fields {
			switch field {
			case "reference_id", "kind", "label", "text", "truncated":
			default:
				return nil, fmt.Errorf("canonical timeline message reference %d contains forbidden field %q", index, field)
			}
		}
		var reference FlowerMessageReference
		if err := json.Unmarshal(item, &reference); err != nil {
			return nil, fmt.Errorf("canonical timeline message reference %d is invalid: %w", index, err)
		}
		reference.ReferenceID = strings.TrimSpace(reference.ReferenceID)
		reference.Kind = strings.TrimSpace(reference.Kind)
		reference.Label = strings.TrimSpace(reference.Label)
		if reference.ReferenceID == "" || reference.Label == "" {
			return nil, fmt.Errorf("canonical timeline message reference %d has incomplete identity", index)
		}
		if _, exists := seen[reference.ReferenceID]; exists {
			return nil, fmt.Errorf("canonical timeline message reference %q is duplicated", reference.ReferenceID)
		}
		switch reference.Kind {
		case string(flruntime.MessageReferenceFile), string(flruntime.MessageReferenceDirectory):
			if _, present := fields["text"]; present {
				return nil, fmt.Errorf("canonical timeline message reference %q exposes host-only path text", reference.ReferenceID)
			}
		case string(flruntime.MessageReferenceText), string(flruntime.MessageReferenceTerminal), string(flruntime.MessageReferenceProcess):
		default:
			return nil, fmt.Errorf("canonical timeline message reference %q has invalid kind", reference.ReferenceID)
		}
		seen[reference.ReferenceID] = struct{}{}
		out = append(out, reference)
	}
	return out, nil
}

func flowerTimelineTextFromBlocks(blocks []any) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if text := assistantVisibleTextFromBlock(block); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

func validFlowerTimelineAnchor(anchor FlowerTimelineAnchor) bool {
	messageID := strings.TrimSpace(anchor.MessageID)
	edge := strings.TrimSpace(anchor.Edge)
	if messageID == "" || (edge != "before" && edge != "after") {
		return false
	}
	switch strings.TrimSpace(anchor.TargetKind) {
	case "message":
		return anchor.BlockIndex == nil && strings.TrimSpace(anchor.ActivityItemID) == ""
	case "block":
		return anchor.BlockIndex != nil && *anchor.BlockIndex >= 0 && strings.TrimSpace(anchor.ActivityItemID) == ""
	case "activity_item":
		return anchor.BlockIndex != nil && *anchor.BlockIndex >= 0 && strings.TrimSpace(anchor.ActivityItemID) != ""
	default:
		return false
	}
}

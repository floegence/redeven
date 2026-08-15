package ai

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
)

func (r *run) snapshotControlConfirmationApproval(toolID string) (FlowerApprovalAction, bool) {
	if r == nil || strings.TrimSpace(toolID) == "" {
		return FlowerApprovalAction{}, false
	}
	toolID = strings.TrimSpace(toolID)
	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil || approval.resolved {
		r.mu.Unlock()
		return FlowerApprovalAction{}, false
	}
	action := r.controlConfirmationApprovalActionLocked(toolID, approval)
	r.mu.Unlock()
	return action, true
}

func (r *run) controlConfirmationApprovalActionLocked(toolID string, approval *toolApprovalRequest) FlowerApprovalAction {
	runID, _, turnID := r.floretCanonicalIdentity()
	toolName := strings.TrimSpace(approval.toolName)
	if toolName == "" {
		toolName = "tool"
	}
	command := strings.TrimSpace(approval.command)
	cwd := strings.TrimSpace(approval.cwd)
	targets := append([]FlowerSafeTarget(nil), approval.targets...)
	return FlowerApprovalAction{
		ActionID: flowerApprovalActionID(runID, toolID), Origin: FlowerApprovalOriginControlConfirm,
		RunID: runID, TurnID: turnID, ToolID: toolID, ToolName: toolName,
		State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		RequestedAtMs: approval.requestedAtMs, ExpiresAtMs: approval.expiresAtMs,
		CanApprove: true, BatchIndex: 0, BatchSize: 1,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: toolApprovalDescription(approval), Command: command, Cwd: cwd,
			Effects: toolApprovalSummaryEffects(toolName, approval), Flags: append([]string(nil), approval.flags...), Targets: targets,
		},
	}
}

func flowerApprovalActionID(runID string, toolID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(toolID)))
	return "appr_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func toolApprovalDescription(approval *toolApprovalRequest) string {
	if approval != nil {
		for _, target := range approval.targets {
			if label := strings.TrimSpace(target.Label); label != "" {
				return "Review access to " + label + " before this tool runs."
			}
		}
	}
	return "Review this tool before it runs."
}

func toolApprovalSummaryEffects(toolName string, approval *toolApprovalRequest) []string {
	if approval != nil && len(approval.effects) > 0 {
		return append([]string(nil), approval.effects...)
	}
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []string{"shell"}
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}
	case "web.search":
		return []string{"network"}
	default:
		return []string{"tool"}
	}
}

func toolApprovalDisplayLabel(toolName string, args map[string]any) string {
	fallback := strings.TrimSpace(toolName)
	if fallback == "" {
		fallback = "Tool approval"
	}
	activity := floretActivityForToolCall(toolName, args)
	if activity != nil && strings.TrimSpace(activity.Label) != "" {
		return strings.TrimSpace(activity.Label)
	}
	return fallback
}

func toolApprovalPresentationArgs(toolName string, command string, cwd string, targets []FlowerSafeTarget) map[string]any {
	args := map[string]any{}
	if strings.TrimSpace(toolName) == "terminal.exec" {
		if command = strings.TrimSpace(command); command != "" {
			args["command"] = command
		}
		if cwd = strings.TrimSpace(cwd); cwd != "" {
			args["cwd"] = cwd
		}
	}
	for _, target := range targets {
		if strings.TrimSpace(target.Kind) == "file" && strings.TrimSpace(target.Label) != "" {
			args["file_path"] = strings.TrimSpace(target.Label)
			break
		}
	}
	if len(args) == 0 {
		return nil
	}
	return args
}

func cloneQueuedTurnViews(in []QueuedTurnView) []QueuedTurnView {
	if in == nil {
		return nil
	}
	out := make([]QueuedTurnView, len(in))
	for index, item := range in {
		out[index] = item
		out[index].Attachments = append([]FlowerAttachmentView(nil), item.Attachments...)
		out[index].ContextAction = normalizeContextActionEnvelope(item.ContextAction)
	}
	return out
}

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

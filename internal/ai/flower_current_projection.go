package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

// flowerAttachmentURL is the single URL construction rule used by both the
// canonical timeline and typed current projections. The upload endpoint is
// still the authority for ownership, membership, and integrity checks.
func flowerAttachmentURL(uploadID, threadID, turnID, queueID string) string {
	uploadID = strings.TrimSpace(uploadID)
	threadID, turnID, queueID = strings.TrimSpace(threadID), strings.TrimSpace(turnID), strings.TrimSpace(queueID)
	if uploadID == "" || threadID == "" {
		return ""
	}
	query := url.Values{"thread_id": {threadID}}
	switch {
	case turnID != "":
		query.Set("turn_id", turnID)
	case queueID != "":
		query.Set("queue_id", queueID)
	default:
		return ""
	}
	return uploadURLPrefix + uploadID + "?" + query.Encode()
}

func flowerCurrentJSON(current flruntime.ThreadView) (json.RawMessage, error) {
	return flowerCurrentJSONAt(current, time.Now())
}

func flowerCurrentJSONAt(current flruntime.ThreadView, sampledAt time.Time) (json.RawMessage, error) {
	if err := validateFlowerCurrentIdentity(current); err != nil {
		return nil, err
	}
	// Keep all product-specific redaction in the existing public projection,
	// then add only scoped preview URLs from the original opaque references.
	public := publicFloretThreadView(current)
	// Typed failures are consumed below; only the product-safe error crosses
	// the public boundary.
	public.Failure = nil
	encoded, err := json.Marshal(public)
	if err != nil {
		return nil, err
	}
	var root map[string]any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err := decoder.Decode(&root); err != nil {
		return nil, err
	}
	if current.RunProgress != nil && current.RunProgress.Request != nil && !sampledAt.IsZero() {
		root["sampled_at_ms"] = sampledAt.UnixMilli()
	}
	threadID := strings.TrimSpace(current.ThreadID.String())
	if items, ok := root["items"].([]any); ok {
		for index, value := range items {
			item, ok := value.(map[string]any)
			if !ok || index >= len(current.Items) {
				continue
			}
			turnID := strings.TrimSpace(current.Items[index].TurnID.String())
			projectCurrentAttachmentURLs(item, current.Items[index].Attachments, threadID, turnID, "")
		}
	}
	if queue, ok := root["queue"].([]any); ok {
		for index, value := range queue {
			entry, ok := value.(map[string]any)
			if !ok || index >= len(current.Queue) {
				continue
			}
			input, _ := entry["input"].(map[string]any)
			if input == nil {
				continue
			}
			entry["input_fingerprint"] = queuedInputFingerprint(current.Queue[index].Input)
			projectCurrentAttachmentURLs(input, current.Queue[index].Input.Attachments, threadID, "", current.Queue[index].ID)
		}
	}
	if restored, ok := root["restored_inputs"].([]any); ok {
		for index, value := range restored {
			entry, ok := value.(map[string]any)
			if !ok || index >= len(current.RestoredInputs) {
				continue
			}
			input, _ := entry["input"].(map[string]any)
			if input != nil {
				// Retained inputs are copyable history, without an executable
				// queue or Turn scope from which to mint a preview URL.
				projectCurrentAttachmentURLs(input, current.RestoredInputs[index].Input.Attachments, "", "", "")
			}
		}
	}

	// Floret's typed failure is consumed at this boundary. Its internal message
	// must not become a second public UI contract.
	if current.Failure != nil {
		code, message := projectFloretTurnFailure(current.Failure, "floret_turn_failed")
		if code == "" && message == "" {
			delete(root, "run_error_code")
			return json.Marshal(root)
		}
		root["run_error_code"] = code
		root["error"] = message
		if detail := canonicalFailureDetail(current.Failure); detail != "" {
			root["run_error_detail"] = detail
		}
	}
	return json.Marshal(root)
}

func validateFlowerCurrentIdentity(current flruntime.ThreadView) error {
	if strings.TrimSpace(current.ThreadID.String()) == "" {
		return errors.New("flower current view requires thread_id")
	}
	for _, item := range current.Items {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.TurnID.String()) == "" || strings.TrimSpace(item.RunID.String()) == "" {
			return errors.New("flower current item requires exact id, turn_id, and run_id")
		}
		if item.Interaction != nil && (item.Interaction.TurnID != item.TurnID || item.Interaction.RunID != item.RunID) {
			return errors.New("flower current item and interaction identities differ")
		}
	}
	for _, interaction := range current.Interactions {
		if strings.TrimSpace(interaction.ID) == "" || strings.TrimSpace(interaction.TurnID.String()) == "" || strings.TrimSpace(interaction.RunID.String()) == "" {
			return errors.New("flower current interaction requires exact id, turn_id, and run_id")
		}
	}
	for _, call := range current.ToolCallPreviews {
		if call.ThreadID != current.ThreadID || call.TurnID == "" || call.TurnID != current.TurnID || call.RunID == "" || call.RunID != current.RunID || call.CallID == "" || call.LogicalRequestID == "" || call.AttemptID == "" || call.AttemptEpoch < 0 {
			return errors.New("flower tool preview requires exact thread, turn, run, request, and call identity")
		}
		if current.RunProgress != nil && current.RunProgress.Request != nil {
			request := current.RunProgress.Request
			if call.LogicalRequestID != request.LogicalRequestID || call.AttemptID != request.AttemptID || call.AttemptEpoch != request.AttemptEpoch {
				return errors.New("flower tool preview and provider request identities differ")
			}
		}
	}
	return nil
}

// MarshalFlowerCurrentView is the appserver handoff for detail envelopes that
// cannot embed FlowerThreadDetail directly. It keeps the same projection rule
// as every typed response and live frame.
func MarshalFlowerCurrentView(current flruntime.ThreadView) (json.RawMessage, error) {
	return flowerCurrentJSON(current)
}

func projectCurrentAttachmentURLs(parent map[string]any, attachments []flruntime.MessageAttachment, threadID, turnID, queueID string) {
	values, ok := parent["attachments"].([]any)
	if !ok {
		return
	}
	for index, value := range values {
		attachment, ok := value.(map[string]any)
		if !ok || index >= len(attachments) {
			continue
		}
		if uploadID, err := uploadIDFromFloretResourceRef(attachments[index].ResourceRef); err == nil {
			attachment["attachment_id"] = uploadID
			if previewURL := flowerAttachmentURL(uploadID, threadID, turnID, queueID); previewURL != "" {
				attachment["url"] = previewURL
			}
		}
		delete(attachment, "resource_ref")
	}
}

// The explicit current field in each wire envelope overrides the embedded raw
// field, so private runtime data never reaches envelope serialization.
type flowerCurrentJSONView flruntime.ThreadView

func (current flowerCurrentJSONView) MarshalJSON() ([]byte, error) {
	return flowerCurrentJSON(flruntime.ThreadView(current))
}

func (d FlowerThreadDetail) MarshalJSON() ([]byte, error) {
	type wire FlowerThreadDetail
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(d), flowerCurrentJSONView(d.Current)})
}

func (d FlowerSubagentDetailResponse) MarshalJSON() ([]byte, error) {
	type wire FlowerSubagentDetailResponse
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(d), flowerCurrentJSONView(d.Current)})
}

func (r SendUserTurnResponse) MarshalJSON() ([]byte, error) {
	type wire SendUserTurnResponse
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(r), flowerCurrentJSONView(r.Current)})
}

func (r SubmitRequestUserInputResponseResponse) MarshalJSON() ([]byte, error) {
	type wire SubmitRequestUserInputResponseResponse
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(r), flowerCurrentJSONView(r.Current)})
}

func (r SubmitFlowerApprovalResponse) MarshalJSON() ([]byte, error) {
	type wire SubmitFlowerApprovalResponse
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(r), flowerCurrentJSONView(r.Current)})
}

func (r aiSendUserTurnResp) MarshalJSON() ([]byte, error) {
	type wire aiSendUserTurnResp
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(r), flowerCurrentJSONView(r.Current)})
}

func (r aiSubmitRequestUserInputResponseResp) MarshalJSON() ([]byte, error) {
	type wire aiSubmitRequestUserInputResponseResp
	return json.Marshal(struct {
		wire
		Current flowerCurrentJSONView `json:"current"`
	}{wire(r), flowerCurrentJSONView(r.Current)})
}

func (e FlowerLiveStreamEnvelope) MarshalJSON() ([]byte, error) {
	return marshalFlowerLiveEnvelopeAt(e, time.Now())
}

func marshalFlowerLiveEnvelopeAt(e FlowerLiveStreamEnvelope, sampledAt time.Time) ([]byte, error) {
	var current, subagentCurrent json.RawMessage
	var err error
	if e.Current != nil {
		current, err = flowerCurrentJSONAt(*e.Current, sampledAt)
		if err != nil {
			return nil, err
		}
	}
	if e.SubagentCurrent != nil {
		subagentCurrent, err = flowerCurrentJSONAt(*e.SubagentCurrent, sampledAt)
		if err != nil {
			return nil, err
		}
	}
	type wire FlowerLiveStreamEnvelope
	return json.Marshal(struct {
		wire
		Current         json.RawMessage `json:"current,omitempty"`
		SubagentCurrent json.RawMessage `json:"subagent_current,omitempty"`
	}{wire(e), current, subagentCurrent})
}

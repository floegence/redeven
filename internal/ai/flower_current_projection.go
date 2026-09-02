package ai

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"

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
	if err := validateFlowerCurrentIdentity(current); err != nil {
		return nil, err
	}
	// Keep all product-specific redaction in the existing public projection,
	// then add only scoped preview URLs from the original opaque references.
	public := publicFloretThreadView(current)
	encoded, err := json.Marshal(public)
	if err != nil {
		return nil, err
	}
	var root map[string]any
	if err := json.Unmarshal(encoded, &root); err != nil {
		return nil, err
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
			projectCurrentAttachmentURLs(input, current.Queue[index].Input.Attachments, threadID, "", current.Queue[index].ID)
		}
	}
	// Floret's typed failure is consumed at this boundary. Its internal message
	// must not become a second public UI contract.
	delete(root, "failure")
	delete(root, "error")
	if current.Failure != nil {
		code, message := projectFloretTurnFailure(current.Failure, "floret_turn_failed")
		if code == "" && message == "" {
			delete(root, "run_error_code")
			return json.Marshal(root)
		}
		root["run_error_code"] = code
		root["error"] = message
	}
	return json.Marshal(root)
}

func validateFlowerCurrentIdentity(current flruntime.ThreadView) error {
	if strings.TrimSpace(current.ThreadID.String()) == "" {
		return errors.New("Flower current view requires thread_id")
	}
	for _, item := range current.Items {
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.TurnID.String()) == "" || strings.TrimSpace(item.RunID.String()) == "" {
			return errors.New("Flower current item requires exact id, turn_id, and run_id")
		}
		if item.Interaction != nil && (item.Interaction.TurnID != item.TurnID || item.Interaction.RunID != item.RunID) {
			return errors.New("Flower current item and interaction identities differ")
		}
	}
	for _, interaction := range current.Interactions {
		if strings.TrimSpace(interaction.ID) == "" || strings.TrimSpace(interaction.TurnID.String()) == "" || strings.TrimSpace(interaction.RunID.String()) == "" {
			return errors.New("Flower current interaction requires exact id, turn_id, and run_id")
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
			if previewURL := flowerAttachmentURL(uploadID, threadID, turnID, queueID); previewURL != "" {
				attachment["url"] = previewURL
			}
		}
		delete(attachment, "resource_ref")
	}
}

func replaceFlowerCurrentJSONField(encoded []byte, field string, current flruntime.ThreadView) ([]byte, error) {
	currentJSON, err := flowerCurrentJSON(current)
	if err != nil {
		return nil, err
	}
	var currentValue any
	if err := json.Unmarshal(currentJSON, &currentValue); err != nil {
		return nil, err
	}
	var root map[string]any
	if err := json.Unmarshal(encoded, &root); err != nil {
		return nil, err
	}
	root[field] = currentValue
	return json.Marshal(root)
}

func replaceFlowerCurrentJSON(encoded []byte, current flruntime.ThreadView) ([]byte, error) {
	return replaceFlowerCurrentJSONField(encoded, "current", current)
}

func marshalFlowerCurrentEnvelope(value any, current flruntime.ThreadView) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return replaceFlowerCurrentJSON(encoded, current)
}

func (d FlowerThreadDetail) MarshalJSON() ([]byte, error) {
	type wire FlowerThreadDetail
	return marshalFlowerCurrentEnvelope(wire(d), d.Current)
}

func (d FlowerSubagentDetailResponse) MarshalJSON() ([]byte, error) {
	type wire FlowerSubagentDetailResponse
	return marshalFlowerCurrentEnvelope(wire(d), d.Current)
}

func (r SendUserTurnResponse) MarshalJSON() ([]byte, error) {
	type wire SendUserTurnResponse
	return marshalFlowerCurrentEnvelope(wire(r), r.Current)
}

func (r SubmitRequestUserInputResponseResponse) MarshalJSON() ([]byte, error) {
	type wire SubmitRequestUserInputResponseResponse
	return marshalFlowerCurrentEnvelope(wire(r), r.Current)
}

func (r SubmitFlowerApprovalResponse) MarshalJSON() ([]byte, error) {
	type wire SubmitFlowerApprovalResponse
	return marshalFlowerCurrentEnvelope(wire(r), r.Current)
}

func (r aiSendUserTurnResp) MarshalJSON() ([]byte, error) {
	type wire aiSendUserTurnResp
	return marshalFlowerCurrentEnvelope(wire(r), r.Current)
}

func (r aiSubmitRequestUserInputResponseResp) MarshalJSON() ([]byte, error) {
	type wire aiSubmitRequestUserInputResponseResp
	return marshalFlowerCurrentEnvelope(wire(r), r.Current)
}

func (e FlowerLiveStreamEnvelope) MarshalJSON() ([]byte, error) {
	type wire FlowerLiveStreamEnvelope
	encoded, err := json.Marshal(wire(e))
	if err != nil {
		return nil, err
	}
	if e.Current != nil {
		encoded, err = replaceFlowerCurrentJSON(encoded, *e.Current)
		if err != nil {
			return nil, err
		}
	}
	if e.SubagentCurrent != nil {
		return replaceFlowerCurrentJSONField(encoded, "subagent_current", *e.SubagentCurrent)
	}
	return encoded, nil
}

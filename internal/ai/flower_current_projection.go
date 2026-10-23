package ai

import (
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

func flowerCurrentJSONAt(current flruntime.ThreadView, sampledAt time.Time, evidence ...*flruntime.ThreadView) (json.RawMessage, error) {
	public, err := projectFlowerCurrent(current, sampledAt, evidence...)
	if err != nil {
		return nil, err
	}
	return json.Marshal(public)
}

func validateFlowerCurrentIdentity(current flruntime.ThreadView) error {
	if strings.TrimSpace(current.ThreadID.String()) == "" {
		return errors.New("flower current view requires thread_id")
	}
	for _, item := range current.Items {
		if strings.TrimSpace(item.ID) == "" || (item.Kind != flruntime.ThreadItemGoal && (strings.TrimSpace(item.TurnID.String()) == "" || strings.TrimSpace(item.RunID.String()) == "")) {
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
func MarshalFlowerCurrentView(current flruntime.ThreadView, evidence ...*flruntime.ThreadView) (json.RawMessage, error) {
	return flowerCurrentJSONAt(current, time.Now(), evidence...)
}

// The explicit current field in each wire envelope overrides the embedded raw
// field, so private runtime data never reaches envelope serialization.
type flowerCurrentJSONView flruntime.ThreadView

func (current flowerCurrentJSONView) MarshalJSON() ([]byte, error) {
	return flowerCurrentJSON(flruntime.ThreadView(current))
}

// Snapshot context fields override the product metadata at one typed boundary.
// Omitted snapshots preserve absence; present empty snapshots explicitly clear.
func projectFlowerContext(current flruntime.ThreadView) (*flowerPublicContext, error) {
	if current.Context == nil {
		return nil, nil
	}
	projection, err := flowerCurrentContextProjection(current)
	if err != nil {
		return nil, err
	}
	return &flowerPublicContext{projection.ModelContext, projection.Usage, projection.Compactions, projection.Decorations}, nil
}

func (d FlowerThreadDetail) MarshalJSON() ([]byte, error) {
	public, err := MarshalFlowerCurrentView(d.Current, d.ComputerEvidence)
	if err != nil {
		return nil, err
	}
	context, err := projectFlowerContext(d.Current)
	if err != nil {
		return nil, err
	}
	var thread any = d.Thread
	if context != nil {
		thread = struct {
			ThreadView
			ModelContext        *flruntime.ThreadModelContext `json:"model_context"`
			ContextUsage        *FlowerContextUsage           `json:"context_usage"`
			ContextCompactions  []FlowerContextCompaction     `json:"context_compactions"`
			TimelineDecorations []FlowerTimelineDecoration    `json:"timeline_decorations"`
		}{d.Thread, context.ModelContext, context.ContextUsage, context.ContextCompactions, context.TimelineDecorations}
	}
	return json.Marshal(struct {
		Window  *FlowerHistoryWindow `json:"window,omitempty"`
		Thread  any                  `json:"thread"`
		Current json.RawMessage      `json:"current"`
	}{d.Window, thread, public})
}

func (d FlowerSubagentDetailResponse) MarshalJSON() ([]byte, error) {
	public, err := MarshalFlowerCurrentView(d.Current, d.ComputerEvidence)
	if err != nil {
		return nil, err
	}
	context, err := projectFlowerContext(d.Current)
	if err != nil {
		return nil, err
	}
	type wire FlowerSubagentDetailResponse
	if context == nil {
		return json.Marshal(struct {
			wire
			Current json.RawMessage `json:"current"`
		}{wire(d), public})
	}
	return json.Marshal(struct {
		wire
		ModelContext        *flruntime.ThreadModelContext `json:"model_context"`
		ContextUsage        *FlowerContextUsage           `json:"context_usage"`
		ContextCompactions  []FlowerContextCompaction     `json:"context_compactions"`
		TimelineDecorations []FlowerTimelineDecoration    `json:"timeline_decorations"`
		Current             json.RawMessage               `json:"current"`
	}{wire(d), context.ModelContext, context.ContextUsage, context.ContextCompactions, context.TimelineDecorations, public})
}

func (r SendUserTurnResponse) MarshalJSON() ([]byte, error) {
	public := r.PublicCurrent
	if public == nil {
		var err error
		public, err = flowerCurrentJSON(r.Current)
		if err != nil {
			return nil, err
		}
	}
	type wire SendUserTurnResponse
	return json.Marshal(struct {
		wire
		Current json.RawMessage `json:"current"`
	}{wire(r), public})
}

func (r SubmitRequestUserInputResponseResponse) MarshalJSON() ([]byte, error) {
	public := r.PublicCurrent
	if public == nil {
		var err error
		public, err = flowerCurrentJSON(r.Current)
		if err != nil {
			return nil, err
		}
	}
	type wire SubmitRequestUserInputResponseResponse
	return json.Marshal(struct {
		wire
		Current json.RawMessage `json:"current"`
	}{wire(r), public})
}

func (r SubmitFlowerApprovalResponse) MarshalJSON() ([]byte, error) {
	public := r.PublicCurrent
	if public == nil {
		var err error
		public, err = flowerCurrentJSON(r.Current)
		if err != nil {
			return nil, err
		}
	}
	type wire SubmitFlowerApprovalResponse
	return json.Marshal(struct {
		wire
		Current json.RawMessage `json:"current"`
	}{wire(r), public})
}

func (r aiSendUserTurnResp) MarshalJSON() ([]byte, error) {
	public := r.PublicCurrent
	if public == nil {
		var err error
		public, err = flowerCurrentJSON(r.Current)
		if err != nil {
			return nil, err
		}
	}
	type wire aiSendUserTurnResp
	return json.Marshal(struct {
		wire
		Current json.RawMessage `json:"current"`
	}{wire(r), public})
}

func (r aiSubmitRequestUserInputResponseResp) MarshalJSON() ([]byte, error) {
	public := r.PublicCurrent
	if public == nil {
		var err error
		public, err = flowerCurrentJSON(r.Current)
		if err != nil {
			return nil, err
		}
	}
	type wire aiSubmitRequestUserInputResponseResp
	return json.Marshal(struct {
		wire
		Current json.RawMessage `json:"current"`
	}{wire(r), public})
}

func (e FlowerLiveStreamEnvelope) MarshalJSON() ([]byte, error) {
	return marshalFlowerLiveEnvelopeAt(e, time.Now())
}

func marshalFlowerLiveEnvelopeAt(e FlowerLiveStreamEnvelope, sampledAt time.Time) ([]byte, error) {
	var current, subagentCurrent, update, subagentUpdate json.RawMessage
	var err error
	if e.Current != nil {
		current, err = flowerCurrentJSONAt(*e.Current, sampledAt, e.updateEvidence)
		if err != nil {
			return nil, err
		}
	}
	if e.SubagentCurrent != nil {
		subagentCurrent, err = flowerCurrentJSONAt(*e.SubagentCurrent, sampledAt, e.updateEvidence)
		if err != nil {
			return nil, err
		}
	}
	if e.Update != nil {
		update, err = flowerUpdateJSONAt(*e.Update, sampledAt, e.updateEvidence)
		if err != nil {
			return nil, err
		}
	}
	if e.SubagentUpdate != nil {
		subagentUpdate, err = flowerUpdateJSONAt(*e.SubagentUpdate, sampledAt, e.updateEvidence)
		if err != nil {
			return nil, err
		}
	}
	type wire FlowerLiveStreamEnvelope
	value := struct {
		wire
		Current         json.RawMessage `json:"current,omitempty"`
		SubagentCurrent json.RawMessage `json:"subagent_current,omitempty"`
		Update          json.RawMessage `json:"update,omitempty"`
		SubagentUpdate  json.RawMessage `json:"subagent_update,omitempty"`
	}{wire(e), current, subagentCurrent, update, subagentUpdate}

	var context *flowerPublicContext
	if e.Current != nil {
		context, err = projectFlowerContext(*e.Current)
	}
	if e.SubagentCurrent != nil {
		context, err = projectFlowerContext(*e.SubagentCurrent)
	}
	if err != nil {
		return nil, err
	}
	if context == nil {
		return json.Marshal(value)
	}
	return json.Marshal(struct {
		wire
		ModelContext        *flruntime.ThreadModelContext `json:"model_context"`
		ContextUsage        *FlowerContextUsage           `json:"context_usage"`
		ContextCompactions  []FlowerContextCompaction     `json:"context_compactions"`
		TimelineDecorations []FlowerTimelineDecoration    `json:"timeline_decorations"`
		Current             json.RawMessage               `json:"current,omitempty"`
		SubagentCurrent     json.RawMessage               `json:"subagent_current,omitempty"`
		Update              json.RawMessage               `json:"update,omitempty"`
		SubagentUpdate      json.RawMessage               `json:"subagent_update,omitempty"`
	}{value.wire, context.ModelContext, context.ContextUsage, context.ContextCompactions, context.TimelineDecorations, current, subagentCurrent, update, subagentUpdate})
}

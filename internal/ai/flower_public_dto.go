package ai

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	"github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

type flowerPublicActivityPresentation struct {
	Label       string                   `json:"label,omitempty"`
	Description string                   `json:"description,omitempty"`
	Renderer    fltools.ActivityRenderer `json:"renderer,omitempty"`
	TargetRefs  []any                    `json:"target_refs,omitempty"`
	Chips       []any                    `json:"chips,omitempty"`
	Payload     map[string]any           `json:"payload,omitempty"`
}

type flowerPublicActivity struct {
	ItemID           string                                `json:"item_id"`
	ToolID           string                                `json:"tool_id,omitempty"`
	ToolName         string                                `json:"tool_name,omitempty"`
	Kind             observation.ActivityKind              `json:"kind"`
	Status           observation.ActivityStatus            `json:"status"`
	Severity         observation.ActivitySeverity          `json:"severity"`
	NeedsAttention   bool                                  `json:"needs_attention"`
	AttentionReasons []observation.ActivityAttentionReason `json:"attention_reasons,omitempty"`
	RequiresApproval bool                                  `json:"requires_approval"`
	ApprovalState    string                                `json:"approval_state,omitempty"`
	StartedAtUnixMS  int64                                 `json:"started_at_unix_ms,omitempty"`
	EndedAtUnixMS    int64                                 `json:"ended_at_unix_ms,omitempty"`
	Presentation     *flowerPublicActivityPresentation     `json:"presentation,omitempty"`
	Metadata         map[string]any                        `json:"metadata,omitempty"`
}

func projectFlowerActivity(item observation.ActivityItem) flowerPublicActivity {
	if item.Presentation != nil && item.Presentation.Validate() != nil {
		return flowerPublicActivity{}
	}
	out := flowerPublicActivity{ItemID: item.ItemID, ToolID: item.ToolID, ToolName: item.ToolName, Kind: item.Kind, Status: item.Status, Severity: item.Severity, NeedsAttention: item.NeedsAttention, AttentionReasons: item.AttentionReasons, RequiresApproval: item.RequiresApproval, ApprovalState: item.ApprovalState, StartedAtUnixMS: item.StartedAtUnixMS, EndedAtUnixMS: item.EndedAtUnixMS}
	metadata := make(map[string]any, len(item.Metadata))
	for key, value := range item.Metadata {
		metadata[key] = value
	}
	out.Metadata = sanitizeActivityMetadataValue(metadata)
	if item.Presentation != nil {
		value := item.Presentation
		refs := make([]any, 0, len(value.TargetRefs))
		for _, ref := range value.TargetRefs {
			refs = append(refs, map[string]any{"kind": ref.Kind, "label": ref.Label, "uri": ref.URI, "resource_ref": ref.ResourceRef, "path": ref.Path, "line": ref.Line})
		}
		chips := make([]any, 0, len(value.Chips))
		for _, chip := range value.Chips {
			chips = append(chips, map[string]any{"kind": chip.Kind, "label": chip.Label, "value": chip.Value, "tone": chip.Tone})
		}
		payload, _ := sanitizeActivityPayloadValue(activityPayloadMap(value.Payload), value.Renderer, item.ToolName)
		out.Presentation = &flowerPublicActivityPresentation{value.Label, value.Description, value.Renderer, sanitizeActivityTargetRefsValue(refs), sanitizeActivityChipsValue(chips), payload}
	}
	return out
}

// These DTOs own the public field rules shared by views and actor changes.
// Resource authority and internal failures cannot enter their serialized shape.
type flowerPublicAttachment struct {
	Name         string                                `json:"name"`
	MIMEType     string                                `json:"mime_type"`
	SizeBytes    int64                                 `json:"size_bytes,omitempty"`
	TextStats    *flruntime.MessageAttachmentTextStats `json:"text_stats,omitempty"`
	AttachmentID string                                `json:"attachment_id,omitempty"`
	URL          string                                `json:"url,omitempty"`
}
type flowerPublicInteraction struct {
	ID                 string                           `json:"id"`
	TurnID             identity.TurnID                  `json:"turn_id"`
	RunID              identity.RunID                   `json:"run_id"`
	Kind               flruntime.ThreadInteractionKind  `json:"kind"`
	ToolCallID         string                           `json:"tool_call_id,omitempty"`
	Resolved           bool                             `json:"resolved,omitempty"`
	Approved           *bool                            `json:"approved,omitempty"`
	Approval           *flruntime.ApprovalPresentation  `json:"approval,omitempty"`
	Input              *flruntime.InputPresentation     `json:"input,omitempty"`
	Resolution         *flruntime.InteractionResolution `json:"resolution,omitempty"`
	ComputerAssistance *ComputerInputAssistance         `json:"computer_assistance,omitempty"`
}
type flowerPublicItem struct {
	WindowBytes      int                              `json:"window_bytes,omitempty"`
	ActivitySummary  *flruntime.ThreadActivitySummary `json:"activity_summary,omitempty"`
	OutputStartedAt  *time.Time                       `json:"output_started_at,omitempty"`
	OutputEndedAt    *time.Time                       `json:"output_ended_at,omitempty"`
	Body             *flruntime.ThreadItemBody        `json:"body,omitempty"`
	ActivityBodies   []flruntime.ThreadActivityBody   `json:"activity_bodies,omitempty"`
	Goal             *flruntime.ThreadGoalChange      `json:"goal,omitempty"`
	Steering         *flruntime.ThreadSteering        `json:"steering,omitempty"`
	Sources          []provider.Source                `json:"sources,omitempty"`
	ID               string                           `json:"id"`
	TurnID           identity.TurnID                  `json:"turn_id,omitempty"`
	RunID            identity.RunID                   `json:"run_id,omitempty"`
	CanonicalOrdinal uint64                           `json:"canonical_ordinal,omitempty"`
	Ordinal          uint64                           `json:"ordinal"`
	Kind             flruntime.ThreadItemKind         `json:"kind"`
	Text             string                           `json:"text,omitempty"`
	Live             bool                             `json:"live,omitempty"`
	CreatedAt        time.Time                        `json:"created_at,omitempty"`
	Attachments      []flowerPublicAttachment         `json:"attachments,omitempty"`
	References       []flruntime.MessageReference     `json:"references,omitempty"`
	Context          []flruntime.MessageContextItem   `json:"context,omitempty"`
	Activity         *flowerPublicActivity            `json:"activity,omitempty"`
	Interaction      *flowerPublicInteraction         `json:"interaction,omitempty"`
}
type flowerPublicInput struct {
	ModelContextSnapshot *flruntime.ModelContextSnapshot `json:"model_context_snapshot,omitempty"`
	Text                 string                          `json:"text,omitempty"`
	Attachments          []flowerPublicAttachment        `json:"attachments,omitempty"`
	References           []flruntime.MessageReference    `json:"references,omitempty"`
	Context              []flruntime.MessageContextItem  `json:"context,omitempty"`
}
type flowerPublicQueuedInput struct {
	ID               string            `json:"id"`
	RequestKey       string            `json:"request_key"`
	Input            flowerPublicInput `json:"input"`
	CreatedAt        time.Time         `json:"created_at"`
	InputFingerprint string            `json:"input_fingerprint"`
}
type flowerPublicRestoredInput struct {
	ID    string            `json:"id"`
	Input flowerPublicInput `json:"input"`
}
type flowerPublicFacts struct {
	Activity       flruntime.ThreadActivity      `json:"activity"`
	Attention      flruntime.AttentionSummary    `json:"attention"`
	TurnKind       flruntime.TurnKind            `json:"turn_kind,omitempty"`
	LastOutcome    *flruntime.TurnOutcome        `json:"last_outcome,omitempty"`
	Cancellation   *flruntime.ThreadCancellation `json:"cancellation,omitempty"`
	RunProgress    *flruntime.ThreadRunProgress  `json:"run_progress,omitempty"`
	QueueCount     int                           `json:"queue_count"`
	SampledAtMS    int64                         `json:"sampled_at_ms,omitempty"`
	RunErrorCode   string                        `json:"run_error_code,omitempty"`
	Error          string                        `json:"error,omitempty"`
	RunErrorDetail string                        `json:"run_error_detail,omitempty"`
}
type flowerPublicCurrent struct {
	flowerPublicFacts
	Goal             *flruntime.ThreadGoal             `json:"goal,omitempty"`
	ParentEvents     *flruntime.ParentEventPage        `json:"parent_events,omitempty"`
	ToolCallPreviews []flruntime.ThreadToolCallPreview `json:"tool_call_previews,omitempty"`
	Turns            []flruntime.ThreadTurn            `json:"turns"`
	RestoredInputs   []flowerPublicRestoredInput       `json:"restored_inputs,omitempty"`
	ThreadID         identity.ThreadID                 `json:"thread_id"`
	ViewVersion      uint64                            `json:"view_version"`
	TurnID           identity.TurnID                   `json:"turn_id,omitempty"`
	RunID            identity.RunID                    `json:"run_id,omitempty"`
	Items            []flowerPublicItem                `json:"items,omitempty"`
	Queue            []flowerPublicQueuedInput         `json:"queue,omitempty"`
	Interactions     []flowerPublicInteraction         `json:"interactions,omitempty"`
}

func projectFlowerAttachments(values []flruntime.MessageAttachment, threadID, turnID, queueID string) []flowerPublicAttachment {
	if len(values) == 0 {
		return nil
	}
	out := make([]flowerPublicAttachment, len(values))
	for i, value := range values {
		id, _ := uploadIDFromFloretResourceRef(value.ResourceRef)
		out[i] = flowerPublicAttachment{value.Name, value.MIMEType, value.SizeBytes, value.TextStats, id, flowerAttachmentURL(id, threadID, turnID, queueID)}
	}
	return out
}
func projectFlowerInteraction(value flruntime.ThreadInteraction, evidence *flruntime.ThreadView) flowerPublicInteraction {
	value = publicFloretInteraction(value)
	out := flowerPublicInteraction{ID: value.ID, TurnID: value.TurnID, RunID: value.RunID, Kind: value.Kind, ToolCallID: value.ToolCallID, Resolved: value.Resolved, Approved: value.Approved, Approval: value.Approval, Input: value.Input, Resolution: value.Resolution}
	if evidence != nil {
		out.ComputerAssistance = computerAssistanceFromEvidence(*evidence, value)
	}
	return out
}
func projectFlowerItem(value flruntime.ThreadItem, threadID string, evidence *flruntime.ThreadView) flowerPublicItem {
	out := flowerPublicItem{ActivitySummary: publicFlowerActivitySummary(value.ActivitySummary), OutputStartedAt: value.OutputStartedAt, OutputEndedAt: value.OutputEndedAt, Body: value.Body, ActivityBodies: value.ActivityBodies, Goal: value.Goal, Steering: value.Steering, Sources: value.Sources, ID: value.ID, TurnID: value.TurnID, RunID: value.RunID, CanonicalOrdinal: value.CanonicalOrdinal, Ordinal: value.Ordinal, Kind: value.Kind, Text: value.Text, Live: value.Live, CreatedAt: value.CreatedAt, Attachments: projectFlowerAttachments(value.Attachments, threadID, value.TurnID.String(), ""), References: publicRuntimeReferences(value.References), Context: value.Context}
	if value.Activity != nil {
		activity := projectFlowerActivity(*value.Activity)
		out.Activity = &activity
	}
	if value.Interaction != nil {
		interaction := projectFlowerInteraction(*value.Interaction, evidence)
		out.Interaction = &interaction
	}
	return out
}

func projectFlowerWindowItem(value flruntime.ThreadItem, threadID string, evidence *flruntime.ThreadView) (flowerPublicItem, error) {
	out := projectFlowerItem(value, threadID, evidence)
	if value.ActivitySummary != nil {
		// The canonical window is budgeted before product-only compaction. Keep
		// that exact cost without sending the stripped locators back to clients.
		raw, err := json.Marshal(value)
		if err != nil {
			return flowerPublicItem{}, err
		}
		out.WindowBytes = len(raw)
	}
	return out, nil
}

// Field mode carries the canonical shape and small display values. Apply the
// same product sanitizers as complete presentations to chips and target refs.
func publicFlowerActivitySummary(source *flruntime.ThreadActivitySummary) *flruntime.ThreadActivitySummary {
	if source == nil {
		return nil
	}
	result := *source
	// Collapsed rows use shape and small display facts only. Detail readers
	// resolve fresh authorized sources when opened; repeating source locators
	// on every summary field adds bytes without providing a read capability.
	if source.Fields != nil {
		result.Fields = make([]flruntime.ThreadActivityField, len(source.Fields))
		for i, field := range source.Fields {
			result.Fields[i] = flruntime.ThreadActivityField{Path: field.Path, Kind: field.Kind,
				Bytes: field.Bytes, Count: field.Count, Value: field.Value}
		}
	}
	result.Values = make(map[string]json.RawMessage, len(source.Values))
	for path, raw := range source.Values {
		if path == "/chips" || path == "/target_refs" {
			var values []any
			if json.Unmarshal(raw, &values) != nil {
				continue
			}
			if path == "/chips" {
				values = sanitizeActivityChipsValue(values)
			} else {
				values = sanitizeActivityTargetRefsValue(values)
			}
			raw, _ = json.Marshal(values)
		}
		result.Values[path] = raw
	}
	return &result
}

func projectFlowerInput(value flruntime.UserInput, threadID, queueID string) flowerPublicInput {
	return flowerPublicInput{value.ModelContextSnapshot, value.Text, projectFlowerAttachments(value.Attachments, threadID, "", queueID), publicRuntimeReferences(value.References), value.Context}
}
func projectFlowerQueue(values []flruntime.QueuedInput, threadID string) []flowerPublicQueuedInput {
	if values == nil {
		return nil
	}
	out := make([]flowerPublicQueuedInput, len(values))
	for i, value := range values {
		out[i] = flowerPublicQueuedInput{value.ID, value.RequestKey, projectFlowerInput(value.Input, threadID, value.ID), value.CreatedAt, queuedInputFingerprint(value.Input)}
	}
	return out
}
func projectFlowerRestored(values []flruntime.RestoredInput) []flowerPublicRestoredInput {
	if values == nil {
		return nil
	}
	out := make([]flowerPublicRestoredInput, len(values))
	for i, value := range values {
		out[i] = flowerPublicRestoredInput{value.ID, projectFlowerInput(value.Input, "", "")}
	}
	return out
}
func projectFlowerFacts(facts flruntime.ThreadRuntimeFacts, threadID, turnID, runID string, sampledAt time.Time) flowerPublicFacts {
	out := flowerPublicFacts{Activity: facts.Activity, Attention: facts.Attention, TurnKind: facts.TurnKind, LastOutcome: facts.LastOutcome, Cancellation: facts.Cancellation, RunProgress: facts.RunProgress, QueueCount: facts.QueueCount}
	if facts.RunProgress != nil && facts.RunProgress.Request != nil && !sampledAt.IsZero() {
		out.SampledAtMS = sampledAt.UnixMilli()
	}
	if facts.Failure != nil {
		out.RunErrorCode, out.Error = projectFloretTurnFailure(facts.Failure, "floret_turn_failed")
		out.RunErrorDetail = scopedFailureDetail(facts.Failure, threadID, turnID, runID)
	}
	return out
}
func projectFlowerCurrent(current flruntime.ThreadView, sampledAt time.Time, evidence ...*flruntime.ThreadView) (flowerPublicCurrent, error) {
	source := &current
	if len(evidence) > 0 && evidence[0] != nil {
		source = evidence[0]
	}
	if err := validateFlowerCurrentIdentity(current); err != nil {
		return flowerPublicCurrent{}, err
	}
	out := flowerPublicCurrent{flowerPublicFacts: projectFlowerFacts(flruntime.ThreadRuntimeFacts{Activity: current.Activity, Attention: current.Attention, TurnKind: current.TurnKind, LastOutcome: current.LastOutcome, Failure: current.Failure, Cancellation: current.Cancellation, RunProgress: current.RunProgress, QueueCount: len(current.Queue)}, current.ThreadID.String(), current.TurnID.String(), current.RunID.String(), sampledAt), Goal: current.Goal, ParentEvents: current.ParentEvents, ToolCallPreviews: current.ToolCallPreviews, Turns: current.Turns, ThreadID: current.ThreadID, ViewVersion: current.ViewVersion, TurnID: current.TurnID, RunID: current.RunID, Queue: projectFlowerQueue(current.Queue, current.ThreadID.String()), RestoredInputs: projectFlowerRestored(current.RestoredInputs)}
	if current.Items != nil {
		out.Items = make([]flowerPublicItem, len(current.Items))
		for i, value := range current.Items {
			item, err := projectFlowerWindowItem(value, current.ThreadID.String(), source)
			if err != nil {
				return flowerPublicCurrent{}, err
			}
			out.Items[i] = item
		}
	}
	if current.Interactions != nil {
		out.Interactions = make([]flowerPublicInteraction, len(current.Interactions))
		for i, value := range current.Interactions {
			out.Interactions[i] = projectFlowerInteraction(value, source)
		}
	}
	return out, nil
}

type flowerPublicItemChange struct {
	Body   *flruntime.ThreadItemBody      `json:"body,omitempty"`
	Kind   flruntime.ThreadItemChangeKind `json:"kind"`
	ItemID string                         `json:"item_id"`
	Item   *flowerPublicItem              `json:"item,omitempty"`
	Append *flruntime.ThreadTextAppend    `json:"append,omitempty"`
}
type flowerPublicContext struct {
	ModelContext        *flruntime.ThreadModelContext `json:"model_context"`
	ContextUsage        *FlowerContextUsage           `json:"context_usage"`
	ContextCompactions  []FlowerContextCompaction     `json:"context_compactions"`
	TimelineDecorations []FlowerTimelineDecoration    `json:"timeline_decorations"`
}
type flowerPublicUpdate struct {
	ThreadID         identity.ThreadID                                             `json:"thread_id"`
	TurnID           identity.TurnID                                               `json:"turn_id,omitempty"`
	RunID            identity.RunID                                                `json:"run_id,omitempty"`
	BaseVersion      uint64                                                        `json:"base_version"`
	ViewVersion      uint64                                                        `json:"view_version"`
	Facts            flowerPublicFacts                                             `json:"facts"`
	Items            []flowerPublicItemChange                                      `json:"items,omitempty"`
	ItemOrder        *flruntime.ThreadComponent[[]string]                          `json:"item_order,omitempty"`
	Context          *flruntime.ThreadComponent[flowerPublicContext]               `json:"context,omitempty"`
	Goal             *flruntime.ThreadComponent[*flruntime.ThreadGoal]             `json:"goal,omitempty"`
	ParentEvents     *flruntime.ThreadComponent[*flruntime.ParentEventPage]        `json:"parent_events,omitempty"`
	Turns            *flruntime.ThreadComponent[[]flruntime.ThreadTurn]            `json:"turns,omitempty"`
	Queue            *flruntime.ThreadComponent[[]flowerPublicQueuedInput]         `json:"queue,omitempty"`
	Interactions     *flruntime.ThreadComponent[[]flowerPublicInteraction]         `json:"interactions,omitempty"`
	ToolCallPreviews *flruntime.ThreadComponent[[]flruntime.ThreadToolCallPreview] `json:"tool_call_previews,omitempty"`
	RestoredInputs   *flruntime.ThreadComponent[[]flowerPublicRestoredInput]       `json:"restored_inputs,omitempty"`
}

func flowerUpdateJSONAt(update flruntime.ThreadUpdate, sampledAt time.Time, evidence *flruntime.ThreadView) (json.RawMessage, error) {
	if update.ThreadID == "" || update.ViewVersion <= update.BaseVersion {
		return nil, errors.New("Flower update requires exact identity and increasing versions")
	}
	if evidence != nil && (evidence.ThreadID != update.ThreadID || evidence.ViewVersion < update.ViewVersion) {
		return nil, errors.New("Flower update evidence requires the same thread and a current runtime version")
	}
	out := flowerPublicUpdate{ThreadID: update.ThreadID, TurnID: update.TurnID, RunID: update.RunID, BaseVersion: update.BaseVersion, ViewVersion: update.ViewVersion, Facts: projectFlowerFacts(update.Facts, update.ThreadID.String(), update.TurnID.String(), update.RunID.String(), sampledAt), ItemOrder: update.ItemOrder, Goal: update.Goal, ParentEvents: update.ParentEvents, Turns: update.Turns, ToolCallPreviews: update.ToolCallPreviews}
	for _, change := range update.Items {
		value := flowerPublicItemChange{Kind: change.Kind, ItemID: change.ItemID, Append: change.Append, Body: change.Body}
		if change.Item != nil {
			if change.Item.ID != change.ItemID {
				return nil, errors.New("Flower update item identity differs")
			}
			if err := validateFlowerCurrentIdentity(flruntime.ThreadView{ThreadID: update.ThreadID, Items: []flruntime.ThreadItem{*change.Item}}); err != nil {
				return nil, err
			}
			item, err := projectFlowerWindowItem(*change.Item, update.ThreadID.String(), evidence)
			if err != nil {
				return nil, err
			}
			value.Item = &item
		}
		out.Items = append(out.Items, value)
	}
	if update.Queue != nil {
		out.Queue = &flruntime.ThreadComponent[[]flowerPublicQueuedInput]{Value: projectFlowerQueue(update.Queue.Value, update.ThreadID.String())}
	}
	if update.RestoredInputs != nil {
		out.RestoredInputs = &flruntime.ThreadComponent[[]flowerPublicRestoredInput]{Value: projectFlowerRestored(update.RestoredInputs.Value)}
	}
	if update.Interactions != nil {
		var values []flowerPublicInteraction
		if update.Interactions.Value != nil {
			values = make([]flowerPublicInteraction, len(update.Interactions.Value))
		}
		for i, value := range update.Interactions.Value {
			values[i] = projectFlowerInteraction(value, evidence)
		}
		out.Interactions = &flruntime.ThreadComponent[[]flowerPublicInteraction]{Value: values}
	}
	if update.Context != nil {
		var value flowerPublicContext
		if update.Context.Value != nil {
			projected, err := flowerThreadContextProjection(*update.Context.Value, flruntime.ThreadView{ThreadID: update.ThreadID})
			if err != nil {
				return nil, err
			}
			value = flowerPublicContext{projected.ModelContext, projected.Usage, projected.Compactions, projected.Decorations}
		}
		out.Context = &flruntime.ThreadComponent[flowerPublicContext]{Value: value}
	}
	return json.Marshal(out)
}

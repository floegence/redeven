package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/redeven/internal/config"
)

const FlowerLiveSchemaVersion int64 = 1
const flowerLiveFallbackStreamGeneration int64 = 1

type FlowerThreadReadSnapshot struct {
	ActivityRevision    int64  `json:"activity_revision"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	ActivitySignature   string `json:"activity_signature"`
	WaitingPromptID     string `json:"waiting_prompt_id,omitempty"`
}

type FlowerThreadReadRecord struct {
	LastSeenActivityRevision  int64  `json:"last_seen_activity_revision"`
	LastReadMessageAtUnixMs   int64  `json:"last_read_message_at_unix_ms"`
	LastSeenActivitySignature string `json:"last_seen_activity_signature"`
	LastSeenWaitingPromptID   string `json:"last_seen_waiting_prompt_id,omitempty"`
}

type FlowerThreadReadView struct {
	IsUnread  bool                     `json:"is_unread"`
	Snapshot  FlowerThreadReadSnapshot `json:"snapshot"`
	ReadState FlowerThreadReadRecord   `json:"read_state"`
}

type FlowerLiveKind string

const (
	FlowerLiveRunStarted               FlowerLiveKind = "run.started"
	FlowerLiveRunStatusChanged         FlowerLiveKind = "run.status_changed"
	FlowerLiveThreadPatched            FlowerLiveKind = "thread.patched"
	FlowerLiveMessageStarted           FlowerLiveKind = "message.started"
	FlowerLiveMessageBlockStart        FlowerLiveKind = "message.block_started"
	FlowerLiveMessageBlockDelta        FlowerLiveKind = "message.block_delta"
	FlowerLiveMessageBlockSet          FlowerLiveKind = "message.block_set"
	FlowerLiveMessageCommitted         FlowerLiveKind = "message.committed"
	FlowerLiveMessageFailed            FlowerLiveKind = "message.failed"
	FlowerLiveApprovalRequested        FlowerLiveKind = "approval.requested"
	FlowerLiveApprovalResolved         FlowerLiveKind = "approval.resolved"
	FlowerLiveInputRequested           FlowerLiveKind = "input.requested"
	FlowerLiveInputResolved            FlowerLiveKind = "input.resolved"
	FlowerLiveModelIOUpdated           FlowerLiveKind = "model_io.updated"
	FlowerLiveContextUsageUpdated      FlowerLiveKind = "context.usage.updated"
	FlowerLiveContextCompactionUpdated FlowerLiveKind = "context.compaction.updated"
	FlowerLiveTimelineReplaced         FlowerLiveKind = "timeline.replaced"
	FlowerLiveResyncRequired           FlowerLiveKind = "stream.resync_required"
)

type FlowerModelIOPhase string

const (
	FlowerModelIOPhasePreparing       FlowerModelIOPhase = "preparing"
	FlowerModelIOPhaseWaitingResponse FlowerModelIOPhase = "waiting_response"
	FlowerModelIOPhaseStreaming       FlowerModelIOPhase = "streaming"
	FlowerModelIOPhaseRetrying        FlowerModelIOPhase = "retrying"
	FlowerModelIOPhaseFinalizing      FlowerModelIOPhase = "finalizing"
)

type FlowerModelIOStatus struct {
	Phase       FlowerModelIOPhase `json:"phase"`
	RunID       string             `json:"run_id,omitempty"`
	StepIndex   int                `json:"step_index,omitempty"`
	UpdatedAtMs int64              `json:"updated_at_ms"`
}

type FlowerLiveEvent struct {
	SchemaVersion int64           `json:"schema_version"`
	Seq           int64           `json:"seq"`
	EndpointID    string          `json:"endpoint_id"`
	ThreadID      string          `json:"thread_id"`
	RunID         string          `json:"run_id,omitempty"`
	TurnID        string          `json:"turn_id,omitempty"`
	TraceID       string          `json:"trace_id,omitempty"`
	Step          string          `json:"step,omitempty"`
	AtUnixMs      int64           `json:"at_unix_ms"`
	Kind          FlowerLiveKind  `json:"kind"`
	Payload       json.RawMessage `json:"payload"`
}

type FlowerLiveRunStartedPayload struct {
	RunID     string `json:"run_id"`
	TurnID    string `json:"turn_id,omitempty"`
	MessageID string `json:"message_id,omitempty"`
	Status    string `json:"status"`
	ModelID   string `json:"model_id,omitempty"`
}

type FlowerLiveRunStatusChangedPayload struct {
	RunID         string                  `json:"run_id"`
	Status        string                  `json:"status"`
	ErrorCode     string                  `json:"error_code,omitempty"`
	Error         string                  `json:"error,omitempty"`
	WaitingPrompt *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
}

type FlowerLiveThreadPatch struct {
	ThreadID               string                        `json:"thread_id,omitempty"`
	Title                  string                        `json:"title,omitempty"`
	ModelID                string                        `json:"model_id,omitempty"`
	PermissionType         string                        `json:"permission_type,omitempty"`
	WorkingDir             string                        `json:"working_dir,omitempty"`
	QueuedTurnCount        *int                          `json:"queued_turn_count,omitempty"`
	RunStatus              string                        `json:"run_status,omitempty"`
	RunUpdatedAtUnixMs     int64                         `json:"run_updated_at_unix_ms,omitempty"`
	RunErrorCode           string                        `json:"run_error_code,omitempty"`
	RunError               string                        `json:"run_error,omitempty"`
	WaitingPrompt          *RequestUserInputPrompt       `json:"waiting_prompt,omitempty"`
	ActiveRunID            string                        `json:"active_run_id,omitempty"`
	PinnedAtUnixMs         int64                         `json:"pinned_at_unix_ms,omitempty"`
	CreatedAtUnixMs        int64                         `json:"created_at_unix_ms,omitempty"`
	UpdatedAtUnixMs        int64                         `json:"updated_at_unix_ms,omitempty"`
	LastMessageAtUnixMs    int64                         `json:"last_message_at_unix_ms,omitempty"`
	LastMessagePreview     string                        `json:"last_message_preview,omitempty"`
	ReasoningSelection     *config.AIReasoningSelection  `json:"reasoning_selection,omitempty"`
	ReasoningCapability    *config.AIReasoningCapability `json:"reasoning_capability,omitempty"`
	ReasoningSelectionSet  bool                          `json:"-"`
	ReasoningCapabilitySet bool                          `json:"-"`
	ReadStatus             *FlowerThreadReadView         `json:"read_status,omitempty"`
	Subagents              []FlowerSubagentSummary       `json:"subagents,omitempty"`
	SubagentsSet           bool                          `json:"-"`
}

func (p FlowerLiveThreadPatch) MarshalJSON() ([]byte, error) {
	type patchJSON struct {
		ThreadID            string                        `json:"thread_id,omitempty"`
		Title               string                        `json:"title,omitempty"`
		ModelID             string                        `json:"model_id,omitempty"`
		PermissionType      string                        `json:"permission_type,omitempty"`
		WorkingDir          string                        `json:"working_dir,omitempty"`
		QueuedTurnCount     *int                          `json:"queued_turn_count,omitempty"`
		RunStatus           string                        `json:"run_status,omitempty"`
		RunUpdatedAtUnixMs  int64                         `json:"run_updated_at_unix_ms,omitempty"`
		RunErrorCode        string                        `json:"run_error_code,omitempty"`
		RunError            string                        `json:"run_error,omitempty"`
		WaitingPrompt       *RequestUserInputPrompt       `json:"waiting_prompt,omitempty"`
		ActiveRunID         string                        `json:"active_run_id,omitempty"`
		PinnedAtUnixMs      int64                         `json:"pinned_at_unix_ms,omitempty"`
		CreatedAtUnixMs     int64                         `json:"created_at_unix_ms,omitempty"`
		UpdatedAtUnixMs     int64                         `json:"updated_at_unix_ms,omitempty"`
		LastMessageAtUnixMs int64                         `json:"last_message_at_unix_ms,omitempty"`
		LastMessagePreview  string                        `json:"last_message_preview,omitempty"`
		ReasoningSelection  *config.AIReasoningSelection  `json:"reasoning_selection,omitempty"`
		ReasoningCapability *config.AIReasoningCapability `json:"reasoning_capability,omitempty"`
		ReadStatus          *FlowerThreadReadView         `json:"read_status,omitempty"`
		Subagents           []FlowerSubagentSummary       `json:"subagents,omitempty"`
	}
	out := patchJSON{
		ThreadID:            p.ThreadID,
		Title:               p.Title,
		ModelID:             p.ModelID,
		PermissionType:      p.PermissionType,
		WorkingDir:          p.WorkingDir,
		QueuedTurnCount:     p.QueuedTurnCount,
		RunStatus:           p.RunStatus,
		RunUpdatedAtUnixMs:  p.RunUpdatedAtUnixMs,
		RunErrorCode:        p.RunErrorCode,
		RunError:            p.RunError,
		WaitingPrompt:       p.WaitingPrompt,
		ActiveRunID:         p.ActiveRunID,
		PinnedAtUnixMs:      p.PinnedAtUnixMs,
		CreatedAtUnixMs:     p.CreatedAtUnixMs,
		UpdatedAtUnixMs:     p.UpdatedAtUnixMs,
		LastMessageAtUnixMs: p.LastMessageAtUnixMs,
		LastMessagePreview:  p.LastMessagePreview,
		ReasoningSelection:  p.ReasoningSelection,
		ReasoningCapability: p.ReasoningCapability,
		ReadStatus:          p.ReadStatus,
		Subagents:           cloneFlowerSubagentSummaries(p.Subagents),
	}
	needsRecordPatch := (p.ReasoningSelectionSet && p.ReasoningSelection == nil) ||
		(p.ReasoningCapabilitySet && p.ReasoningCapability == nil) ||
		p.SubagentsSet
	if !needsRecordPatch {
		return json.Marshal(out)
	}
	data, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	var record map[string]json.RawMessage
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	if p.ReasoningSelectionSet && p.ReasoningSelection == nil {
		record["reasoning_selection"] = json.RawMessage("null")
	}
	if p.ReasoningCapabilitySet && p.ReasoningCapability == nil {
		record["reasoning_capability"] = json.RawMessage("null")
	}
	if p.SubagentsSet {
		subagents := cloneFlowerSubagentSummaries(p.Subagents)
		if subagents == nil {
			subagents = []FlowerSubagentSummary{}
		}
		subagentsData, err := json.Marshal(subagents)
		if err != nil {
			return nil, err
		}
		record["subagents"] = subagentsData
	}
	return json.Marshal(record)
}

func (p *FlowerLiveThreadPatch) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	var raw struct {
		ThreadID            string                  `json:"thread_id,omitempty"`
		Title               string                  `json:"title,omitempty"`
		ModelID             string                  `json:"model_id,omitempty"`
		PermissionType      string                  `json:"permission_type,omitempty"`
		WorkingDir          string                  `json:"working_dir,omitempty"`
		QueuedTurnCount     *int                    `json:"queued_turn_count,omitempty"`
		RunStatus           string                  `json:"run_status,omitempty"`
		RunUpdatedAtUnixMs  int64                   `json:"run_updated_at_unix_ms,omitempty"`
		RunErrorCode        string                  `json:"run_error_code,omitempty"`
		RunError            string                  `json:"run_error,omitempty"`
		WaitingPrompt       *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
		ActiveRunID         string                  `json:"active_run_id,omitempty"`
		PinnedAtUnixMs      int64                   `json:"pinned_at_unix_ms,omitempty"`
		CreatedAtUnixMs     int64                   `json:"created_at_unix_ms,omitempty"`
		UpdatedAtUnixMs     int64                   `json:"updated_at_unix_ms,omitempty"`
		LastMessageAtUnixMs int64                   `json:"last_message_at_unix_ms,omitempty"`
		LastMessagePreview  string                  `json:"last_message_preview,omitempty"`
		ReasoningSelection  json.RawMessage         `json:"reasoning_selection"`
		ReasoningCapability json.RawMessage         `json:"reasoning_capability"`
		ReadStatus          *FlowerThreadReadView   `json:"read_status,omitempty"`
		Subagents           []FlowerSubagentSummary `json:"subagents,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = FlowerLiveThreadPatch{
		ThreadID:            raw.ThreadID,
		Title:               raw.Title,
		ModelID:             raw.ModelID,
		PermissionType:      raw.PermissionType,
		WorkingDir:          raw.WorkingDir,
		QueuedTurnCount:     raw.QueuedTurnCount,
		RunStatus:           raw.RunStatus,
		RunUpdatedAtUnixMs:  raw.RunUpdatedAtUnixMs,
		RunErrorCode:        raw.RunErrorCode,
		RunError:            raw.RunError,
		WaitingPrompt:       raw.WaitingPrompt,
		ActiveRunID:         raw.ActiveRunID,
		PinnedAtUnixMs:      raw.PinnedAtUnixMs,
		CreatedAtUnixMs:     raw.CreatedAtUnixMs,
		UpdatedAtUnixMs:     raw.UpdatedAtUnixMs,
		LastMessageAtUnixMs: raw.LastMessageAtUnixMs,
		LastMessagePreview:  raw.LastMessagePreview,
		ReadStatus:          raw.ReadStatus,
		Subagents:           cloneFlowerSubagentSummaries(raw.Subagents),
	}
	if _, ok := fields["subagents"]; ok {
		p.SubagentsSet = true
		if p.Subagents == nil {
			p.Subagents = []FlowerSubagentSummary{}
		}
	}
	if raw.ReasoningSelection != nil {
		p.ReasoningSelectionSet = true
		if string(raw.ReasoningSelection) != "null" {
			var selection config.AIReasoningSelection
			if err := json.Unmarshal(raw.ReasoningSelection, &selection); err != nil {
				return err
			}
			selection = config.NormalizeAIReasoningSelection(selection)
			p.ReasoningSelection = &selection
		}
	}
	if raw.ReasoningCapability != nil {
		p.ReasoningCapabilitySet = true
		if string(raw.ReasoningCapability) != "null" {
			var capability config.AIReasoningCapability
			if err := json.Unmarshal(raw.ReasoningCapability, &capability); err != nil {
				return err
			}
			capability = capability.Normalize()
			p.ReasoningCapability = &capability
		}
	}
	return nil
}

type FlowerLiveThreadPatchedPayload struct {
	Patch FlowerLiveThreadPatch `json:"patch"`
}

type FlowerLiveMessageStartedPayload struct {
	MessageID   string `json:"message_id"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	CreatedAtMs int64  `json:"created_at_ms"`
}

type FlowerLiveMessageBlockStartedPayload struct {
	MessageID  string `json:"message_id"`
	BlockIndex int    `json:"block_index"`
	BlockType  string `json:"block_type"`
}

type FlowerLiveMessageBlockDeltaPayload struct {
	MessageID  string `json:"message_id"`
	BlockIndex int    `json:"block_index"`
	Delta      string `json:"delta"`
}

type FlowerLiveMessageBlockSetPayload struct {
	MessageID  string `json:"message_id"`
	BlockIndex int    `json:"block_index"`
	Block      any    `json:"block"`
}

type FlowerLiveMessageCommittedPayload struct {
	MessageID string          `json:"message_id"`
	Message   json.RawMessage `json:"message"`
}

type FlowerLiveMessageFailedPayload struct {
	MessageID string `json:"message_id"`
	Error     string `json:"error"`
}

type FlowerApprovalState string

const (
	FlowerApprovalStateRequested   FlowerApprovalState = "requested"
	FlowerApprovalStateApproved    FlowerApprovalState = "approved"
	FlowerApprovalStateRejected    FlowerApprovalState = "rejected"
	FlowerApprovalStateTimedOut    FlowerApprovalState = "timed_out"
	FlowerApprovalStateCanceled    FlowerApprovalState = "canceled"
	FlowerApprovalStateUnavailable FlowerApprovalState = "unavailable"
)

type FlowerApprovalStatus string

const (
	FlowerApprovalStatusPending     FlowerApprovalStatus = "pending"
	FlowerApprovalStatusResolved    FlowerApprovalStatus = "resolved"
	FlowerApprovalStatusUnavailable FlowerApprovalStatus = "unavailable"
)

type FlowerApprovalOrigin string

const (
	FlowerApprovalOriginMainTool          FlowerApprovalOrigin = "main_tool"
	FlowerApprovalOriginDelegatedSubagent FlowerApprovalOrigin = "delegated_subagent"
	FlowerApprovalOriginControlConfirm    FlowerApprovalOrigin = "control_confirm"
)

type FlowerApprovalSurfaceRole string

const (
	FlowerApprovalSurfacePrimaryAction FlowerApprovalSurfaceRole = "primary_action"
	FlowerApprovalSurfaceLocator       FlowerApprovalSurfaceRole = "locator"
	FlowerApprovalSurfaceMirror        FlowerApprovalSurfaceRole = "mirror"
)

type FlowerApprovalDeliveryState string

const (
	FlowerApprovalDeliveryWaiting     FlowerApprovalDeliveryState = "waiting_decision"
	FlowerApprovalDeliveryPending     FlowerApprovalDeliveryState = "delivery_pending"
	FlowerApprovalDeliveryDelivered   FlowerApprovalDeliveryState = "delivery_delivered"
	FlowerApprovalDeliveryFailed      FlowerApprovalDeliveryState = "delivery_failed"
	FlowerApprovalDeliveryAckUnknown  FlowerApprovalDeliveryState = "delivery_ack_unknown"
	FlowerApprovalDeliveryUnavailable FlowerApprovalDeliveryState = "delivery_unavailable"
)

type FlowerApprovalChildExecutionState string

const (
	FlowerApprovalChildExecutionUnknown   FlowerApprovalChildExecutionState = "unknown"
	FlowerApprovalChildExecutionPending   FlowerApprovalChildExecutionState = "pending"
	FlowerApprovalChildExecutionRunning   FlowerApprovalChildExecutionState = "running"
	FlowerApprovalChildExecutionSucceeded FlowerApprovalChildExecutionState = "succeeded"
	FlowerApprovalChildExecutionFailed    FlowerApprovalChildExecutionState = "failed"
	FlowerApprovalChildExecutionCanceled  FlowerApprovalChildExecutionState = "canceled"
)

type DelegatedApprovalRef struct {
	ParentThreadID  string `json:"parent_thread_id"`
	ParentRunID     string `json:"parent_run_id"`
	ParentTurnID    string `json:"parent_turn_id,omitempty"`
	SubagentID      string `json:"subagent_id"`
	ChildThreadID   string `json:"child_thread_id"`
	ChildRunID      string `json:"child_run_id"`
	ChildTurnID     string `json:"child_turn_id,omitempty"`
	ChildToolCallID string `json:"child_tool_call_id"`
	ApprovalID      string `json:"approval_id"`
}

type FlowerApprovalAction struct {
	ActionID            string                            `json:"action_id"`
	Origin              FlowerApprovalOrigin              `json:"origin"`
	RunID               string                            `json:"run_id,omitempty"`
	TurnID              string                            `json:"turn_id,omitempty"`
	StepID              string                            `json:"step_id,omitempty"`
	ToolID              string                            `json:"tool_id,omitempty"`
	ToolName            string                            `json:"tool_name"`
	State               FlowerApprovalState               `json:"state"`
	Status              FlowerApprovalStatus              `json:"status"`
	Revision            int64                             `json:"revision"`
	Version             int64                             `json:"version"`
	SurfaceEpoch        int64                             `json:"surface_epoch,omitempty"`
	SurfaceRole         FlowerApprovalSurfaceRole         `json:"surface_role,omitempty"`
	Scope               string                            `json:"scope,omitempty"`
	RequestedAtMs       int64                             `json:"requested_at_unix_ms"`
	ResolvedAtMs        int64                             `json:"resolved_at_unix_ms,omitempty"`
	ExpiresAtMs         int64                             `json:"expires_at_unix_ms,omitempty"`
	CanApprove          bool                              `json:"can_approve"`
	ExpectedSeq         int64                             `json:"expected_seq,omitempty"`
	ReadOnlyReason      string                            `json:"read_only_reason,omitempty"`
	DelegatedRef        *DelegatedApprovalRef             `json:"delegated_ref,omitempty"`
	DeliveryState       FlowerApprovalDeliveryState       `json:"delivery_state,omitempty"`
	ChildExecutionState FlowerApprovalChildExecutionState `json:"child_execution_state,omitempty"`
	PrimaryWaitAnchor   string                            `json:"primary_wait_anchor,omitempty"`
	QueueGeneration     int64                             `json:"queue_generation"`
	QueueOrder          int64                             `json:"queue_order"`
	BatchIndex          int                               `json:"batch_index"`
	BatchSize           int                               `json:"batch_size"`
	Summary             FlowerApprovalSummary             `json:"summary"`
}

type FlowerApprovalQueue struct {
	Generation      int64  `json:"generation"`
	Revision        int64  `json:"revision"`
	CurrentActionID string `json:"current_action_id,omitempty"`
	CurrentPosition int    `json:"current_position"`
	Total           int    `json:"total"`
	UnresolvedCount int    `json:"unresolved_count"`
}

type FlowerApprovalSummary struct {
	Label       string             `json:"label"`
	Description string             `json:"description,omitempty"`
	Command     string             `json:"command,omitempty"`
	Cwd         string             `json:"cwd,omitempty"`
	Effects     []string           `json:"effects,omitempty"`
	Flags       []string           `json:"flags,omitempty"`
	Targets     []FlowerSafeTarget `json:"targets,omitempty"`
}

type FlowerSafeTarget struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	URI   string `json:"uri,omitempty"`
}

type FlowerLiveApprovalPayload struct {
	Action        FlowerApprovalAction `json:"action"`
	ApprovalQueue *FlowerApprovalQueue `json:"approval_queue,omitempty"`
}

type FlowerLiveInputRequestedPayload struct {
	Request RequestUserInputPrompt `json:"request"`
}

type FlowerLiveInputResolvedPayload struct {
	PromptID string `json:"prompt_id"`
}

type FlowerLiveUsageUpdatedPayload struct {
	Usage FlowerContextUsage `json:"usage"`
}

type FlowerLiveContextCompactionUpdatedPayload struct {
	Compaction         FlowerContextCompaction  `json:"compaction"`
	TimelineDecoration FlowerTimelineDecoration `json:"timeline_decoration"`
}

type FlowerLiveModelIOUpdatedPayload struct {
	Status *FlowerModelIOStatus `json:"status"`
}

type FlowerContextUsage struct {
	RunID                  string  `json:"run_id,omitempty"`
	StepIndex              int     `json:"step_index,omitempty"`
	Phase                  string  `json:"phase"`
	InputTokens            int64   `json:"input_tokens,omitempty"`
	ContextWindowTokens    int64   `json:"context_window_tokens,omitempty"`
	ThresholdTokens        int64   `json:"threshold_tokens,omitempty"`
	RequestSafeLimitTokens int64   `json:"request_safe_limit_tokens,omitempty"`
	OutputHeadroomTokens   int64   `json:"output_headroom_tokens,omitempty"`
	UsedRatio              float64 `json:"used_ratio,omitempty"`
	ThresholdRatio         float64 `json:"threshold_ratio,omitempty"`
	PressureStatus         string  `json:"pressure_status"`
	Source                 string  `json:"source,omitempty"`
	UpdatedAtMs            int64   `json:"updated_at_ms"`
}

type FlowerContextCompaction struct {
	OperationID         string `json:"operation_id"`
	RequestID           string `json:"request_id"`
	RunID               string `json:"run_id,omitempty"`
	StepIndex           int    `json:"step_index,omitempty"`
	Phase               string `json:"phase"`
	Status              string `json:"status"`
	Trigger             string `json:"trigger,omitempty"`
	Reason              string `json:"reason,omitempty"`
	Source              string `json:"source"`
	TokensBefore        int64  `json:"tokens_before,omitempty"`
	TokensAfterEstimate int64  `json:"tokens_after_estimate,omitempty"`
	Error               string `json:"error,omitempty"`
	UpdatedAtMs         int64  `json:"updated_at_ms"`
}

type FlowerTimelineAnchor struct {
	TargetKind     string `json:"target_kind"`
	MessageID      string `json:"message_id"`
	BlockIndex     *int   `json:"block_index,omitempty"`
	ActivityItemID string `json:"activity_item_id,omitempty"`
	Edge           string `json:"edge"`
}

type FlowerTimelineDecorationKind string

const (
	FlowerTimelineDecorationContextCompaction         FlowerTimelineDecorationKind = "context_compaction"
	FlowerTimelineDecorationTurnProjectionUnavailable FlowerTimelineDecorationKind = "turn_projection_unavailable"
)

type FlowerTurnProjectionUnavailableReason string

const (
	FlowerTurnProjectionUnavailableNotFound        FlowerTurnProjectionUnavailableReason = "not_found"
	FlowerTurnProjectionUnavailableInvalidContract FlowerTurnProjectionUnavailableReason = "invalid_contract"
	FlowerTurnProjectionUnavailableNotRenderable   FlowerTurnProjectionUnavailableReason = "not_renderable"
)

func (reason FlowerTurnProjectionUnavailableReason) Valid() bool {
	switch reason {
	case FlowerTurnProjectionUnavailableNotFound, FlowerTurnProjectionUnavailableInvalidContract, FlowerTurnProjectionUnavailableNotRenderable:
		return true
	default:
		return false
	}
}

type FlowerTurnProjectionUnavailable struct {
	TurnID            string                                `json:"turn_id"`
	RunID             string                                `json:"run_id"`
	ExpectedMessageID string                                `json:"expected_message_id"`
	Reason            FlowerTurnProjectionUnavailableReason `json:"reason"`
}

type FlowerTimelineDecoration struct {
	DecorationID          string                           `json:"decoration_id"`
	Kind                  FlowerTimelineDecorationKind     `json:"kind"`
	Anchor                FlowerTimelineAnchor             `json:"anchor"`
	Ordinal               int                              `json:"ordinal"`
	Compaction            FlowerContextCompaction          `json:"-"`
	ProjectionUnavailable *FlowerTurnProjectionUnavailable `json:"-"`
	compactionPresent     bool
	projectionPresent     bool
}

func (decoration FlowerTimelineDecoration) Validate() error {
	if strings.TrimSpace(decoration.DecorationID) == "" {
		return errors.New("timeline decoration id is required")
	}
	if !validFlowerTimelineAnchor(decoration.Anchor) {
		return errors.New("timeline decoration requires a valid anchor")
	}
	switch decoration.Kind {
	case FlowerTimelineDecorationContextCompaction:
		if strings.TrimSpace(decoration.Compaction.OperationID) == "" {
			return errors.New("context compaction decoration requires compaction payload")
		}
		if decoration.ProjectionUnavailable != nil || decoration.projectionPresent {
			return errors.New("context compaction decoration must not include projection unavailable payload")
		}
	case FlowerTimelineDecorationTurnProjectionUnavailable:
		if strings.TrimSpace(decoration.Compaction.OperationID) != "" || decoration.compactionPresent {
			return errors.New("projection unavailable decoration must not include compaction payload")
		}
		payload := decoration.ProjectionUnavailable
		if decoration.Anchor.TargetKind != "message" || decoration.Anchor.Edge != "after" {
			return errors.New("projection unavailable decoration must follow a message")
		}
		if payload == nil || strings.TrimSpace(payload.TurnID) == "" || strings.TrimSpace(payload.RunID) == "" || strings.TrimSpace(payload.ExpectedMessageID) == "" || !payload.Reason.Valid() {
			return errors.New("projection unavailable decoration requires a valid payload")
		}
	default:
		return fmt.Errorf("unsupported timeline decoration kind %q", decoration.Kind)
	}
	return nil
}

func (decoration FlowerTimelineDecoration) MarshalJSON() ([]byte, error) {
	if err := decoration.Validate(); err != nil {
		return nil, err
	}
	type wire struct {
		DecorationID          string                           `json:"decoration_id"`
		Kind                  FlowerTimelineDecorationKind     `json:"kind"`
		Anchor                FlowerTimelineAnchor             `json:"anchor"`
		Ordinal               int                              `json:"ordinal"`
		Compaction            *FlowerContextCompaction         `json:"compaction,omitempty"`
		ProjectionUnavailable *FlowerTurnProjectionUnavailable `json:"projection_unavailable,omitempty"`
	}
	out := wire{DecorationID: decoration.DecorationID, Kind: decoration.Kind, Anchor: decoration.Anchor, Ordinal: decoration.Ordinal, ProjectionUnavailable: decoration.ProjectionUnavailable}
	if decoration.Kind == FlowerTimelineDecorationContextCompaction {
		compaction := decoration.Compaction
		out.Compaction = &compaction
	}
	return json.Marshal(out)
}

func (decoration *FlowerTimelineDecoration) UnmarshalJSON(data []byte) error {
	if decoration == nil {
		return errors.New("nil timeline decoration")
	}
	type wire struct {
		DecorationID          string                           `json:"decoration_id"`
		Kind                  FlowerTimelineDecorationKind     `json:"kind"`
		Anchor                FlowerTimelineAnchor             `json:"anchor"`
		Ordinal               int                              `json:"ordinal"`
		Compaction            *FlowerContextCompaction         `json:"compaction"`
		ProjectionUnavailable *FlowerTurnProjectionUnavailable `json:"projection_unavailable"`
	}
	var in wire
	if err := json.Unmarshal(data, &in); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	_, compactionPresent := fields["compaction"]
	_, projectionPresent := fields["projection_unavailable"]
	*decoration = FlowerTimelineDecoration{
		DecorationID:          in.DecorationID,
		Kind:                  in.Kind,
		Anchor:                in.Anchor,
		Ordinal:               in.Ordinal,
		ProjectionUnavailable: in.ProjectionUnavailable,
		compactionPresent:     compactionPresent,
		projectionPresent:     projectionPresent,
	}
	if in.Compaction != nil {
		decoration.Compaction = *in.Compaction
	}
	return decoration.Validate()
}

type FlowerTimelineMessage struct {
	MessageID     string `json:"id"`
	Role          string `json:"role"`
	Content       string `json:"content"`
	Status        string `json:"status"`
	CreatedAtMs   int64  `json:"created_at_ms"`
	Blocks        []any  `json:"blocks,omitempty"`
	ContextAction any    `json:"context_action,omitempty"`
	Live          bool   `json:"live"`
	ActiveCursor  bool   `json:"active_cursor"`
}

type FlowerLiveTimelineReplacedPayload struct {
	Messages            []FlowerTimelineMessage     `json:"messages"`
	StreamGeneration    int64                       `json:"stream_generation"`
	SnapshotThroughSeq  int64                       `json:"snapshot_through_seq"`
	ThreadPatch         FlowerLiveThreadPatch       `json:"thread_patch"`
	LiveState           FlowerLiveMaterializedState `json:"live_state"`
	ContextUsage        *FlowerContextUsage         `json:"context_usage"`
	ContextCompactions  []FlowerContextCompaction   `json:"context_compactions"`
	TimelineDecorations []FlowerTimelineDecoration  `json:"timeline_decorations"`
}

type FlowerLiveResyncRequiredPayload struct {
	Reason string `json:"reason"`
}

type FlowerLiveMessageDraft struct {
	MessageID   string            `json:"message_id"`
	Role        string            `json:"role"`
	Status      string            `json:"status"`
	CreatedAtMs int64             `json:"created_at_ms"`
	Blocks      []FlowerLiveBlock `json:"blocks"`
}

type FlowerLiveBlock struct {
	Type    string          `json:"type"`
	Content string          `json:"content,omitempty"`
	Block   json.RawMessage `json:"block,omitempty"`
}

type FlowerLiveRunState struct {
	RunID         string                  `json:"run_id"`
	Status        string                  `json:"status"`
	MessageID     string                  `json:"message_id,omitempty"`
	WaitingPrompt *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
	ErrorCode     string                  `json:"error_code,omitempty"`
	Error         string                  `json:"error,omitempty"`
}

type FlowerLiveMaterializedState struct {
	ThreadPatch         FlowerLiveThreadPatch             `json:"thread_patch"`
	Messages            map[string]FlowerLiveMessageDraft `json:"-"`
	Runs                map[string]FlowerLiveRunState     `json:"runs"`
	ModelIO             *FlowerModelIOStatus              `json:"model_io,omitempty"`
	ContextUsage        *FlowerContextUsage               `json:"context_usage,omitempty"`
	ContextCompactions  []FlowerContextCompaction         `json:"context_compactions,omitempty"`
	TimelineDecorations []FlowerTimelineDecoration        `json:"timeline_decorations,omitempty"`
	ApprovalActions     map[string]FlowerApprovalAction   `json:"approval_actions"`
	ApprovalActionsSeen bool                              `json:"-"`
	ApprovalQueue       *FlowerApprovalQueue              `json:"approval_queue,omitempty"`
	InputRequests       map[string]RequestUserInputPrompt `json:"input_requests"`
}

func (s FlowerLiveMaterializedState) MarshalJSON() ([]byte, error) {
	type flowerLiveMaterializedStateJSON struct {
		ThreadPatch         FlowerLiveThreadPatch             `json:"thread_patch"`
		Runs                map[string]FlowerLiveRunState     `json:"runs"`
		ModelIO             *FlowerModelIOStatus              `json:"model_io,omitempty"`
		ContextUsage        *FlowerContextUsage               `json:"context_usage,omitempty"`
		ContextCompactions  []FlowerContextCompaction         `json:"context_compactions,omitempty"`
		TimelineDecorations []FlowerTimelineDecoration        `json:"timeline_decorations,omitempty"`
		ApprovalActions     *map[string]FlowerApprovalAction  `json:"approval_actions,omitempty"`
		ApprovalQueue       *FlowerApprovalQueue              `json:"approval_queue,omitempty"`
		InputRequests       map[string]RequestUserInputPrompt `json:"input_requests"`
	}
	var approvals *map[string]FlowerApprovalAction
	if s.ApprovalActionsSeen {
		actions := s.ApprovalActions
		if actions == nil {
			actions = map[string]FlowerApprovalAction{}
		}
		approvals = &actions
	}
	return json.Marshal(flowerLiveMaterializedStateJSON{
		ThreadPatch:         s.ThreadPatch,
		Runs:                s.Runs,
		ModelIO:             s.ModelIO,
		ContextUsage:        s.ContextUsage,
		ContextCompactions:  s.ContextCompactions,
		TimelineDecorations: s.TimelineDecorations,
		ApprovalActions:     approvals,
		ApprovalQueue:       cloneFlowerApprovalQueue(s.ApprovalQueue),
		InputRequests:       s.InputRequests,
	})
}

func (s *FlowerLiveMaterializedState) UnmarshalJSON(data []byte) error {
	type flowerLiveMaterializedStateJSON struct {
		ThreadPatch         FlowerLiveThreadPatch             `json:"thread_patch"`
		Runs                map[string]FlowerLiveRunState     `json:"runs"`
		ModelIO             *FlowerModelIOStatus              `json:"model_io,omitempty"`
		ContextUsage        *FlowerContextUsage               `json:"context_usage,omitempty"`
		ContextCompactions  []FlowerContextCompaction         `json:"context_compactions,omitempty"`
		TimelineDecorations []FlowerTimelineDecoration        `json:"timeline_decorations,omitempty"`
		ApprovalActions     *map[string]FlowerApprovalAction  `json:"approval_actions,omitempty"`
		ApprovalQueue       *FlowerApprovalQueue              `json:"approval_queue,omitempty"`
		InputRequests       map[string]RequestUserInputPrompt `json:"input_requests"`
	}
	var raw flowerLiveMaterializedStateJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	s.ThreadPatch = raw.ThreadPatch
	s.Runs = raw.Runs
	s.ModelIO = raw.ModelIO
	s.ContextUsage = raw.ContextUsage
	s.ContextCompactions = raw.ContextCompactions
	s.TimelineDecorations = raw.TimelineDecorations
	s.ApprovalActionsSeen = raw.ApprovalActions != nil
	s.ApprovalQueue = cloneFlowerApprovalQueue(raw.ApprovalQueue)
	if raw.ApprovalActions != nil {
		s.ApprovalActions = *raw.ApprovalActions
	} else {
		s.ApprovalActions = nil
	}
	s.InputRequests = raw.InputRequests
	return nil
}

type FlowerLiveBootstrapResponse struct {
	SchemaVersion    int64                       `json:"schema_version"`
	EndpointID       string                      `json:"endpoint_id"`
	ThreadID         string                      `json:"thread_id"`
	StreamGeneration int64                       `json:"stream_generation"`
	Cursor           int64                       `json:"cursor"`
	RetainedFromSeq  int64                       `json:"retained_from_seq"`
	Thread           ThreadView                  `json:"thread"`
	TimelineMessages []FlowerTimelineMessage     `json:"timeline_messages"`
	LiveState        FlowerLiveMaterializedState `json:"live_state"`
	ReadStatus       FlowerThreadReadView        `json:"read_status"`
	GeneratedAtMs    int64                       `json:"generated_at_unix_ms"`
}

type FlowerLiveEventsResponse struct {
	StreamGeneration int64             `json:"stream_generation"`
	Events           []FlowerLiveEvent `json:"events"`
	NextCursor       int64             `json:"next_cursor"`
	HasMore          bool              `json:"has_more,omitempty"`
	RetainedFromSeq  int64             `json:"retained_from_seq"`
}

type SubmitFlowerApprovalRequest struct {
	ThreadID        string                `json:"thread_id"`
	Origin          FlowerApprovalOrigin  `json:"origin,omitempty"`
	RunID           string                `json:"run_id"`
	ActionID        string                `json:"action_id"`
	ToolID          string                `json:"tool_id"`
	Approved        bool                  `json:"approved"`
	ExpectedSeq     int64                 `json:"expected_seq"`
	Revision        int64                 `json:"revision"`
	Version         int64                 `json:"version,omitempty"`
	SurfaceEpoch    int64                 `json:"surface_epoch,omitempty"`
	QueueGeneration int64                 `json:"queue_generation"`
	QueueRevision   int64                 `json:"queue_revision"`
	IdempotencyKey  string                `json:"idempotency_key,omitempty"`
	DelegatedRef    *DelegatedApprovalRef `json:"delegated_ref,omitempty"`
}

type SubmitFlowerApprovalResponse struct {
	OK            bool  `json:"ok"`
	CurrentCursor int64 `json:"current_cursor"`
}

package ai

import (
	"encoding/json"

	"github.com/floegence/redeven/internal/config"
)

const FlowerLiveSchemaVersion int64 = 1

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
	FlowerLiveActivityUpdated          FlowerLiveKind = "activity.updated"
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
	ModelLocked            *bool                         `json:"model_locked,omitempty"`
	ExecutionMode          string                        `json:"execution_mode,omitempty"`
	WorkingDir             string                        `json:"working_dir,omitempty"`
	QueuedTurnCount        *int                          `json:"queued_turn_count,omitempty"`
	RunStatus              string                        `json:"run_status,omitempty"`
	RunUpdatedAtUnixMs     int64                         `json:"run_updated_at_unix_ms,omitempty"`
	RunErrorCode           string                        `json:"run_error_code,omitempty"`
	RunError               string                        `json:"run_error,omitempty"`
	WaitingPrompt          *RequestUserInputPrompt       `json:"waiting_prompt,omitempty"`
	LastContextRunID       string                        `json:"last_context_run_id,omitempty"`
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
}

func (p FlowerLiveThreadPatch) MarshalJSON() ([]byte, error) {
	type patchJSON struct {
		ThreadID            string                        `json:"thread_id,omitempty"`
		Title               string                        `json:"title,omitempty"`
		ModelID             string                        `json:"model_id,omitempty"`
		ModelLocked         *bool                         `json:"model_locked,omitempty"`
		ExecutionMode       string                        `json:"execution_mode,omitempty"`
		WorkingDir          string                        `json:"working_dir,omitempty"`
		QueuedTurnCount     *int                          `json:"queued_turn_count,omitempty"`
		RunStatus           string                        `json:"run_status,omitempty"`
		RunUpdatedAtUnixMs  int64                         `json:"run_updated_at_unix_ms,omitempty"`
		RunErrorCode        string                        `json:"run_error_code,omitempty"`
		RunError            string                        `json:"run_error,omitempty"`
		WaitingPrompt       *RequestUserInputPrompt       `json:"waiting_prompt,omitempty"`
		LastContextRunID    string                        `json:"last_context_run_id,omitempty"`
		PinnedAtUnixMs      int64                         `json:"pinned_at_unix_ms,omitempty"`
		CreatedAtUnixMs     int64                         `json:"created_at_unix_ms,omitempty"`
		UpdatedAtUnixMs     int64                         `json:"updated_at_unix_ms,omitempty"`
		LastMessageAtUnixMs int64                         `json:"last_message_at_unix_ms,omitempty"`
		LastMessagePreview  string                        `json:"last_message_preview,omitempty"`
		ReasoningSelection  *config.AIReasoningSelection  `json:"reasoning_selection,omitempty"`
		ReasoningCapability *config.AIReasoningCapability `json:"reasoning_capability,omitempty"`
		ReadStatus          *FlowerThreadReadView         `json:"read_status,omitempty"`
	}
	out := patchJSON{
		ThreadID:            p.ThreadID,
		Title:               p.Title,
		ModelID:             p.ModelID,
		ModelLocked:         p.ModelLocked,
		ExecutionMode:       p.ExecutionMode,
		WorkingDir:          p.WorkingDir,
		QueuedTurnCount:     p.QueuedTurnCount,
		RunStatus:           p.RunStatus,
		RunUpdatedAtUnixMs:  p.RunUpdatedAtUnixMs,
		RunErrorCode:        p.RunErrorCode,
		RunError:            p.RunError,
		WaitingPrompt:       p.WaitingPrompt,
		LastContextRunID:    p.LastContextRunID,
		PinnedAtUnixMs:      p.PinnedAtUnixMs,
		CreatedAtUnixMs:     p.CreatedAtUnixMs,
		UpdatedAtUnixMs:     p.UpdatedAtUnixMs,
		LastMessageAtUnixMs: p.LastMessageAtUnixMs,
		LastMessagePreview:  p.LastMessagePreview,
		ReasoningSelection:  p.ReasoningSelection,
		ReasoningCapability: p.ReasoningCapability,
		ReadStatus:          p.ReadStatus,
	}
	if p.ReasoningSelectionSet && p.ReasoningSelection == nil {
		data, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		var record map[string]json.RawMessage
		if err := json.Unmarshal(data, &record); err != nil {
			return nil, err
		}
		record["reasoning_selection"] = json.RawMessage("null")
		if p.ReasoningCapabilitySet && p.ReasoningCapability == nil {
			record["reasoning_capability"] = json.RawMessage("null")
		}
		return json.Marshal(record)
	}
	if p.ReasoningCapabilitySet && p.ReasoningCapability == nil {
		data, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		var record map[string]json.RawMessage
		if err := json.Unmarshal(data, &record); err != nil {
			return nil, err
		}
		record["reasoning_capability"] = json.RawMessage("null")
		return json.Marshal(record)
	}
	return json.Marshal(out)
}

func (p *FlowerLiveThreadPatch) UnmarshalJSON(data []byte) error {
	var raw struct {
		ThreadID            string                  `json:"thread_id,omitempty"`
		Title               string                  `json:"title,omitempty"`
		ModelID             string                  `json:"model_id,omitempty"`
		ModelLocked         *bool                   `json:"model_locked,omitempty"`
		ExecutionMode       string                  `json:"execution_mode,omitempty"`
		WorkingDir          string                  `json:"working_dir,omitempty"`
		QueuedTurnCount     *int                    `json:"queued_turn_count,omitempty"`
		RunStatus           string                  `json:"run_status,omitempty"`
		RunUpdatedAtUnixMs  int64                   `json:"run_updated_at_unix_ms,omitempty"`
		RunErrorCode        string                  `json:"run_error_code,omitempty"`
		RunError            string                  `json:"run_error,omitempty"`
		WaitingPrompt       *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
		LastContextRunID    string                  `json:"last_context_run_id,omitempty"`
		PinnedAtUnixMs      int64                   `json:"pinned_at_unix_ms,omitempty"`
		CreatedAtUnixMs     int64                   `json:"created_at_unix_ms,omitempty"`
		UpdatedAtUnixMs     int64                   `json:"updated_at_unix_ms,omitempty"`
		LastMessageAtUnixMs int64                   `json:"last_message_at_unix_ms,omitempty"`
		LastMessagePreview  string                  `json:"last_message_preview,omitempty"`
		ReasoningSelection  json.RawMessage         `json:"reasoning_selection"`
		ReasoningCapability json.RawMessage         `json:"reasoning_capability"`
		ReadStatus          *FlowerThreadReadView   `json:"read_status,omitempty"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = FlowerLiveThreadPatch{
		ThreadID:            raw.ThreadID,
		Title:               raw.Title,
		ModelID:             raw.ModelID,
		ModelLocked:         raw.ModelLocked,
		ExecutionMode:       raw.ExecutionMode,
		WorkingDir:          raw.WorkingDir,
		QueuedTurnCount:     raw.QueuedTurnCount,
		RunStatus:           raw.RunStatus,
		RunUpdatedAtUnixMs:  raw.RunUpdatedAtUnixMs,
		RunErrorCode:        raw.RunErrorCode,
		RunError:            raw.RunError,
		WaitingPrompt:       raw.WaitingPrompt,
		LastContextRunID:    raw.LastContextRunID,
		PinnedAtUnixMs:      raw.PinnedAtUnixMs,
		CreatedAtUnixMs:     raw.CreatedAtUnixMs,
		UpdatedAtUnixMs:     raw.UpdatedAtUnixMs,
		LastMessageAtUnixMs: raw.LastMessageAtUnixMs,
		LastMessagePreview:  raw.LastMessagePreview,
		ReadStatus:          raw.ReadStatus,
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

type FlowerLiveActivityUpdatedPayload struct {
	RunID      string `json:"run_id"`
	MessageID  string `json:"message_id"`
	BlockIndex int    `json:"block_index"`
	Activity   any    `json:"activity"`
}

type FlowerApprovalState string

const (
	FlowerApprovalStateRequested FlowerApprovalState = "requested"
	FlowerApprovalStateApproved  FlowerApprovalState = "approved"
	FlowerApprovalStateRejected  FlowerApprovalState = "rejected"
	FlowerApprovalStateTimedOut  FlowerApprovalState = "timed_out"
	FlowerApprovalStateCanceled  FlowerApprovalState = "canceled"
)

type FlowerApprovalStatus string

const (
	FlowerApprovalStatusPending  FlowerApprovalStatus = "pending"
	FlowerApprovalStatusResolved FlowerApprovalStatus = "resolved"
)

type FlowerApprovalAction struct {
	ActionID       string                `json:"action_id"`
	RunID          string                `json:"run_id"`
	TurnID         string                `json:"turn_id,omitempty"`
	StepID         string                `json:"step_id,omitempty"`
	ToolID         string                `json:"tool_id"`
	ToolName       string                `json:"tool_name"`
	State          FlowerApprovalState   `json:"state"`
	Status         FlowerApprovalStatus  `json:"status"`
	Revision       int64                 `json:"revision"`
	RequestedAtMs  int64                 `json:"requested_at_unix_ms"`
	ResolvedAtMs   int64                 `json:"resolved_at_unix_ms,omitempty"`
	ExpiresAtMs    int64                 `json:"expires_at_unix_ms,omitempty"`
	CanApprove     bool                  `json:"can_approve"`
	ExpectedSeq    int64                 `json:"expected_seq,omitempty"`
	ReadOnlyReason string                `json:"read_only_reason,omitempty"`
	Summary        FlowerApprovalSummary `json:"summary"`
}

type FlowerApprovalSummary struct {
	Label       string             `json:"label"`
	Description string             `json:"description,omitempty"`
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
	Action FlowerApprovalAction `json:"action"`
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
	OperationID          string `json:"operation_id"`
	RunID                string `json:"run_id,omitempty"`
	StepIndex            int    `json:"step_index,omitempty"`
	Phase                string `json:"phase"`
	Status               string `json:"status"`
	Trigger              string `json:"trigger,omitempty"`
	Reason               string `json:"reason,omitempty"`
	CompactionID         string `json:"compaction_id,omitempty"`
	CompactionGeneration int    `json:"compaction_generation,omitempty"`
	CompactionWindowID   string `json:"compaction_window_id,omitempty"`
	TokensBefore         int64  `json:"tokens_before,omitempty"`
	TokensAfterEstimate  int64  `json:"tokens_after_estimate,omitempty"`
	Error                string `json:"error,omitempty"`
	UpdatedAtMs          int64  `json:"updated_at_ms"`
}

type FlowerTimelineAnchor struct {
	TargetKind     string `json:"target_kind"`
	MessageID      string `json:"message_id"`
	BlockIndex     *int   `json:"block_index,omitempty"`
	ActivityItemID string `json:"activity_item_id,omitempty"`
	Edge           string `json:"edge"`
}

type FlowerTimelineDecoration struct {
	DecorationID string                  `json:"decoration_id"`
	Kind         string                  `json:"kind"`
	Anchor       FlowerTimelineAnchor    `json:"anchor"`
	Ordinal      int                     `json:"ordinal"`
	Compaction   FlowerContextCompaction `json:"compaction"`
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
	Messages []FlowerTimelineMessage `json:"messages"`
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
	InputRequests       map[string]RequestUserInputPrompt `json:"input_requests"`
}

type FlowerLiveBootstrapResponse struct {
	SchemaVersion    int64                       `json:"schema_version"`
	EndpointID       string                      `json:"endpoint_id"`
	ThreadID         string                      `json:"thread_id"`
	Cursor           int64                       `json:"cursor"`
	RetainedFromSeq  int64                       `json:"retained_from_seq"`
	Thread           ThreadView                  `json:"thread"`
	TimelineMessages []FlowerTimelineMessage     `json:"timeline_messages"`
	LiveState        FlowerLiveMaterializedState `json:"live_state"`
	ReadStatus       FlowerThreadReadView        `json:"read_status"`
	GeneratedAtMs    int64                       `json:"generated_at_unix_ms"`
}

type FlowerLiveEventsResponse struct {
	Events          []FlowerLiveEvent `json:"events"`
	NextCursor      int64             `json:"next_cursor"`
	HasMore         bool              `json:"has_more,omitempty"`
	RetainedFromSeq int64             `json:"retained_from_seq"`
}

type SubmitFlowerApprovalRequest struct {
	ThreadID    string `json:"thread_id"`
	RunID       string `json:"run_id"`
	ActionID    string `json:"action_id"`
	ToolID      string `json:"tool_id"`
	Approved    bool   `json:"approved"`
	ExpectedSeq int64  `json:"expected_seq"`
	Revision    int64  `json:"revision"`
}

type SubmitFlowerApprovalResponse struct {
	OK            bool  `json:"ok"`
	CurrentCursor int64 `json:"current_cursor"`
}

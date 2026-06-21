package ai

import "encoding/json"

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
	FlowerLiveRunStarted        FlowerLiveKind = "run.started"
	FlowerLiveRunStatusChanged  FlowerLiveKind = "run.status_changed"
	FlowerLiveThreadPatched     FlowerLiveKind = "thread.patched"
	FlowerLiveMessageStarted    FlowerLiveKind = "message.started"
	FlowerLiveMessageBlockStart FlowerLiveKind = "message.block_started"
	FlowerLiveMessageBlockDelta FlowerLiveKind = "message.block_delta"
	FlowerLiveMessageBlockSet   FlowerLiveKind = "message.block_set"
	FlowerLiveMessageCommitted  FlowerLiveKind = "message.committed"
	FlowerLiveMessageFailed     FlowerLiveKind = "message.failed"
	FlowerLiveActivityUpdated   FlowerLiveKind = "activity.updated"
	FlowerLiveApprovalRequested FlowerLiveKind = "approval.requested"
	FlowerLiveApprovalResolved  FlowerLiveKind = "approval.resolved"
	FlowerLiveInputRequested    FlowerLiveKind = "input.requested"
	FlowerLiveInputResolved     FlowerLiveKind = "input.resolved"
	FlowerLiveUsageUpdated      FlowerLiveKind = "usage.updated"
	FlowerLiveTimelineReplaced  FlowerLiveKind = "timeline.replaced"
	FlowerLiveResyncRequired    FlowerLiveKind = "stream.resync_required"
)

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
	ReadStatus          *FlowerThreadReadView   `json:"read_status,omitempty"`
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
	Usage map[string]any `json:"usage"`
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
	ThreadPatch     FlowerLiveThreadPatch             `json:"thread_patch"`
	Messages        map[string]FlowerLiveMessageDraft `json:"-"`
	Runs            map[string]FlowerLiveRunState     `json:"runs"`
	ApprovalActions map[string]FlowerApprovalAction   `json:"approval_actions"`
	InputRequests   map[string]RequestUserInputPrompt `json:"input_requests"`
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

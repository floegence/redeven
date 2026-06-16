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

type FlowerThreadLiveSnapshot struct {
	SchemaVersion int64                `json:"schema_version"`
	Thread        ThreadView           `json:"thread"`
	Messages      []json.RawMessage    `json:"messages"`
	ActiveRun     *FlowerLiveActiveRun `json:"active_run,omitempty"`
	ReadStatus    FlowerThreadReadView `json:"read_status"`
	EventCursor   int64                `json:"event_cursor"`
	GeneratedAtMs int64                `json:"generated_at_unix_ms"`
}

type FlowerLiveActiveRun struct {
	RunID           string                  `json:"run_id"`
	Status          string                  `json:"status"`
	Message         json.RawMessage         `json:"message"`
	WaitingPrompt   *RequestUserInputPrompt `json:"waiting_prompt,omitempty"`
	ApprovalActions []FlowerApprovalAction  `json:"approval_actions,omitempty"`
	LastEventSeq    int64                   `json:"last_event_seq"`
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
	FlowerApprovalStatusPending     FlowerApprovalStatus = "pending"
	FlowerApprovalStatusResolved    FlowerApprovalStatus = "resolved"
	FlowerApprovalStatusUnavailable FlowerApprovalStatus = "unavailable"
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

type FlowerLiveUpdateKind string

const (
	FlowerLiveThreadPatched    FlowerLiveUpdateKind = "thread.patched"
	FlowerLiveMessageAppended  FlowerLiveUpdateKind = "message.appended"
	FlowerLiveActiveRunPatched FlowerLiveUpdateKind = "active_run.patched"
	FlowerLiveReadPatched      FlowerLiveUpdateKind = "read_state.patched"
	FlowerLiveResyncRequired   FlowerLiveUpdateKind = "resync.required"
)

type FlowerThreadLiveUpdate struct {
	SchemaVersion  int64                 `json:"schema_version"`
	Seq            int64                 `json:"seq"`
	EndpointID     string                `json:"endpoint_id"`
	ThreadID       string                `json:"thread_id"`
	Kind           FlowerLiveUpdateKind  `json:"kind"`
	AtUnixMs       int64                 `json:"at_unix_ms"`
	Thread         *ThreadView           `json:"thread,omitempty"`
	Message        json.RawMessage       `json:"message,omitempty"`
	ActiveRun      *FlowerLiveActiveRun  `json:"active_run,omitempty"`
	ClearActiveRun bool                  `json:"clear_active_run,omitempty"`
	ReadStatus     *FlowerThreadReadView `json:"read_status,omitempty"`
	ResyncReason   string                `json:"resync_reason,omitempty"`
}

type FlowerThreadLiveUpdatesResponse struct {
	Updates    []FlowerThreadLiveUpdate `json:"updates"`
	NextCursor int64                    `json:"next_cursor"`
	HasMore    bool                     `json:"has_more,omitempty"`
}

type SubmitFlowerApprovalRequest struct {
	ThreadID    string `json:"thread_id"`
	RunID       string `json:"run_id"`
	ActionID    string `json:"action_id"`
	ToolID      string `json:"tool_id"`
	Approved    bool   `json:"approved"`
	ExpectedSeq int64  `json:"expected_seq,omitempty"`
	Revision    int64  `json:"revision,omitempty"`
}

type SubmitFlowerApprovalResponse struct {
	OK bool `json:"ok"`
}

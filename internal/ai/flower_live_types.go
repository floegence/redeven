package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
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

type FlowerApprovalAction struct {
	ActionID       string                    `json:"action_id"`
	Origin         FlowerApprovalOrigin      `json:"origin"`
	RunID          string                    `json:"run_id,omitempty"`
	TurnID         string                    `json:"turn_id,omitempty"`
	StepID         string                    `json:"step_id,omitempty"`
	ToolID         string                    `json:"tool_id,omitempty"`
	ToolName       string                    `json:"tool_name"`
	State          FlowerApprovalState       `json:"state"`
	Status         FlowerApprovalStatus      `json:"status"`
	SurfaceRole    FlowerApprovalSurfaceRole `json:"surface_role,omitempty"`
	Scope          string                    `json:"scope,omitempty"`
	RequestedAtMs  int64                     `json:"requested_at_unix_ms"`
	ResolvedAtMs   int64                     `json:"resolved_at_unix_ms,omitempty"`
	ExpiresAtMs    int64                     `json:"expires_at_unix_ms,omitempty"`
	CanApprove     bool                      `json:"can_approve"`
	ReadOnlyReason string                    `json:"read_only_reason,omitempty"`
	QueueOrder     int64                     `json:"queue_order"`
	BatchIndex     int                       `json:"batch_index"`
	BatchSize      int                       `json:"batch_size"`
	Summary        FlowerApprovalSummary     `json:"summary"`
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
	FlowerTurnProjectionUnavailableNotRenderable FlowerTurnProjectionUnavailableReason = "not_renderable"
)

func (reason FlowerTurnProjectionUnavailableReason) Valid() bool {
	return reason == FlowerTurnProjectionUnavailableNotRenderable
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
	MessageID        string                   `json:"id"`
	ThreadID         string                   `json:"thread_id"`
	TurnID           string                   `json:"turn_id"`
	RunID            string                   `json:"run_id"`
	LogicalRequestID string                   `json:"logical_request_id,omitempty"`
	TurnOrdinal      int64                    `json:"turn_ordinal,omitempty"`
	Role             string                   `json:"role"`
	Content          string                   `json:"content"`
	Status           string                   `json:"status"`
	CreatedAtMs      int64                    `json:"created_at_ms"`
	Blocks           []any                    `json:"blocks,omitempty"`
	References       []FlowerMessageReference `json:"references,omitempty"`
	Live             bool                     `json:"live"`
	ActiveCursor     bool                     `json:"active_cursor"`
}

type FlowerMessageReference struct {
	ReferenceID string `json:"reference_id"`
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Text        string `json:"text,omitempty"`
	Truncated   bool   `json:"truncated,omitempty"`
}

type SubmitFlowerApprovalRequest struct {
	ThreadID      string `json:"thread_id"`
	InteractionID string `json:"interaction_id"`
	Approved      bool   `json:"approved"`
	RejectAll     bool   `json:"reject_all,omitempty"`
}

type SubmitFlowerApprovalResponse struct {
	OK      bool                 `json:"ok"`
	Current flruntime.ThreadView `json:"current"`
}

package ai

// This package defines the Go-side implementation of the Env App AI feature.
//
// Design notes:
// - The browser talks to the agent via the existing local gateway (/_redeven_proxy/api/ai/*) over Flowersec E2EE proxy.
// - The agent enforces permissions using authoritative session_meta (direct control channel), not browser-claimed flags.
// - The LLM orchestration runs in a TS sidecar process; the Go agent is the only authority that can execute tools.

import (
	"strings"
	"time"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

type Model struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

// --- HTTP API types (snake_case, stable) ---

type ModelsResponse struct {
	DefaultModel string  `json:"default_model"`
	Models       []Model `json:"models"`
}

type ThreadView struct {
	ThreadID            string `json:"thread_id"`
	Title               string `json:"title"`
	ModelID             string `json:"model_id"`
	RunStatus           string `json:"run_status"`
	RunUpdatedAtUnixMs  int64  `json:"run_updated_at_unix_ms"`
	RunError            string `json:"run_error,omitempty"`
	CreatedAtUnixMs     int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs     int64  `json:"updated_at_unix_ms"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	LastMessagePreview  string `json:"last_message_preview"`
}

type ListThreadsResponse struct {
	Threads    []ThreadView `json:"threads"`
	NextCursor string       `json:"next_cursor,omitempty"`
}

type CreateThreadRequest struct {
	Title   string `json:"title"`
	ModelID string `json:"model_id,omitempty"`
}

type CreateThreadResponse struct {
	Thread ThreadView `json:"thread"`
}

type PatchThreadRequest struct {
	Title   *string `json:"title,omitempty"`
	ModelID *string `json:"model_id,omitempty"`
}

type ListThreadMessagesResponse struct {
	Messages      []any `json:"messages"`
	NextBeforeID  int64 `json:"next_before_id,omitempty"`
	HasMore       bool  `json:"has_more,omitempty"`
	TotalReturned int   `json:"total_returned,omitempty"`
}

type AppendThreadMessageRequest struct {
	Role   string `json:"role"`
	Text   string `json:"text"`
	Format string `json:"format,omitempty"` // markdown|text (defaults to markdown for now)
}

// RunStartRequest is the HTTP request body for starting an AI run.
//
// Notes:
// - thread_id is mandatory; the agent builds history from the persisted thread store.
// - history must NOT be provided by clients (agent is the source of truth).
type RunStartRequest struct {
	ThreadID string     `json:"thread_id"`
	Model    string     `json:"model"`
	Input    RunInput   `json:"input"`
	Options  RunOptions `json:"options"`
}

// RunRequest is the internal run request passed to the sidecar (includes history).
type RunRequest struct {
	Model          string             `json:"model"`
	History        []RunHistoryMsg    `json:"history"`
	Input          RunInput           `json:"input"`
	Options        RunOptions         `json:"options"`
	ContextPackage *RunContextPackage `json:"context_package,omitempty"`
}

type RunHistoryMsg struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type RunContextPackage struct {
	OpenGoal           string            `json:"open_goal,omitempty"`
	HistorySummary     string            `json:"history_summary,omitempty"`
	Anchors            []string          `json:"anchors,omitempty"`
	ToolMemories       []RunToolMemory   `json:"tool_memories,omitempty"`
	WorkingDirAbs      string            `json:"working_dir_abs,omitempty"`
	TaskObjective      string            `json:"task_objective,omitempty"`
	TaskSteps          []RunTaskStep     `json:"task_steps,omitempty"`
	TaskProgressDigest string            `json:"task_progress_digest,omitempty"`
	Stats              map[string]int    `json:"stats,omitempty"`
	Meta               map[string]string `json:"meta,omitempty"`
}

// RunToolMemory is a compact cross-attempt tool execution memory item used by context orchestration.
type RunToolMemory struct {
	RunID         string `json:"run_id,omitempty"`
	ToolName      string `json:"tool_name,omitempty"`
	Status        string `json:"status,omitempty"`
	ArgsPreview   string `json:"args_preview,omitempty"`
	ResultPreview string `json:"result_preview,omitempty"`
	ErrorCode     string `json:"error_code,omitempty"`
	ErrorMessage  string `json:"error_message,omitempty"`
}

type RunTaskStep struct {
	Title  string `json:"title"`
	Status string `json:"status"`
}

type RunInput struct {
	Text        string            `json:"text"`
	Attachments []RunAttachmentIn `json:"attachments"`
}

type RunAttachmentIn struct {
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
	URL      string `json:"url"`
}

type RunOptions struct {
	MaxSteps int `json:"max_steps"`

	// PromptProfile selects the sidecar prompt strategy.
	PromptProfile string `json:"prompt_profile,omitempty"`
	// LoopProfile selects the Go-side task-loop strategy.
	LoopProfile string `json:"loop_profile,omitempty"`
	// EvalTag is an optional experiment tag for diagnostics/evaluation only.
	EvalTag string `json:"eval_tag,omitempty"`
}

type ToolApprovalRequest struct {
	ToolID   string `json:"tool_id"`
	Approved bool   `json:"approved"`
}

type UploadResponse struct {
	URL      string `json:"url"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	MimeType string `json:"mime_type"`
}

type RunEventView struct {
	RunID      string `json:"run_id"`
	ThreadID   string `json:"thread_id"`
	StreamKind string `json:"stream_kind,omitempty"`
	EventType  string `json:"event_type"`
	AtUnixMs   int64  `json:"at_unix_ms"`
	Payload    any    `json:"payload,omitempty"`
}

type ListRunEventsResponse struct {
	Events []RunEventView `json:"events"`
}

// RunState is the normalized state machine for a single AI run.
type RunState string

const (
	RunStateIdle            RunState = "idle"
	RunStateAccepted        RunState = "accepted"
	RunStateRunning         RunState = "running"
	RunStateWaitingApproval RunState = "waiting_approval"
	RunStateRecovering      RunState = "recovering"
	RunStateSuccess         RunState = "success"
	RunStateFailed          RunState = "failed"
	RunStateCanceled        RunState = "canceled"
	RunStateTimedOut        RunState = "timed_out"
)

func NormalizeRunState(raw string) RunState {
	v := strings.TrimSpace(strings.ToLower(raw))
	switch RunState(v) {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateSuccess, RunStateFailed, RunStateCanceled, RunStateTimedOut:
		return RunState(v)
	default:
		return RunStateIdle
	}
}

func IsActiveRunState(raw string) bool {
	s := NormalizeRunState(raw)
	switch s {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering:
		return true
	default:
		return false
	}
}

// --- StreamEvent types (camelCase, aligned with @floegence/floe-webapp-core) ---

type streamEventMessageStart struct {
	Type      string `json:"type"`
	MessageID string `json:"messageId"`
}

type streamEventBlockStart struct {
	Type       string `json:"type"`
	MessageID  string `json:"messageId"`
	BlockIndex int    `json:"blockIndex"`
	BlockType  string `json:"blockType"`
}

type streamEventBlockDelta struct {
	Type       string `json:"type"`
	MessageID  string `json:"messageId"`
	BlockIndex int    `json:"blockIndex"`
	Delta      string `json:"delta"`
}

type streamEventBlockSet struct {
	Type       string      `json:"type"`
	MessageID  string      `json:"messageId"`
	BlockIndex int         `json:"blockIndex"`
	Block      interface{} `json:"block"`
}

type streamEventMessageEnd struct {
	Type      string `json:"type"`
	MessageID string `json:"messageId"`
}

type streamEventError struct {
	Type      string `json:"type"`
	MessageID string `json:"messageId"`
	Error     string `json:"error"`
}

type streamEventLifecyclePhase struct {
	Type      string         `json:"type"`
	MessageID string         `json:"messageId,omitempty"`
	Phase     string         `json:"phase"`
	Diag      map[string]any `json:"diag,omitempty"`
}

// Convenience helpers for tool-call blocks (MessageBlock).

type ToolCallStatus string

const (
	ToolCallStatusPending    ToolCallStatus = "pending"
	ToolCallStatusRunning    ToolCallStatus = "running"
	ToolCallStatusRecovering ToolCallStatus = "recovering"
	ToolCallStatusSuccess    ToolCallStatus = "success"
	ToolCallStatusError      ToolCallStatus = "error"
)

type ToolCallBlock struct {
	Type             string             `json:"type"` // tool-call
	ToolName         string             `json:"toolName"`
	ToolID           string             `json:"toolId"`
	Args             map[string]any     `json:"args"`
	RequiresApproval bool               `json:"requiresApproval,omitempty"`
	ApprovalState    string             `json:"approvalState,omitempty"` // required|approved|rejected
	Status           ToolCallStatus     `json:"status"`
	Result           any                `json:"result,omitempty"`
	Error            string             `json:"error,omitempty"`
	ErrorDetails     *aitools.ToolError `json:"errorDetails,omitempty"`
	Children         []any              `json:"children,omitempty"`
	Collapsed        *bool              `json:"collapsed,omitempty"`
	StartedAt        *time.Time         `json:"-"`
}

// RealtimeEventType defines the high-level AI event category sent over Flowersec RPC notify.
type RealtimeEventType string

const (
	RealtimeEventTypeStream      RealtimeEventType = "stream_event"
	RealtimeEventTypeThreadState RealtimeEventType = "thread_state"
)

// RealtimeStreamKind is a low-cardinality stream category for diagnostics/UI routing.
type RealtimeStreamKind string

const (
	RealtimeStreamKindLifecycle RealtimeStreamKind = "lifecycle"
	RealtimeStreamKindAssistant RealtimeStreamKind = "assistant"
	RealtimeStreamKindTool      RealtimeStreamKind = "tool"
)

// RealtimeLifecyclePhase marks lifecycle transitions.
type RealtimeLifecyclePhase string

const (
	RealtimePhaseStart       RealtimeLifecyclePhase = "start"
	RealtimePhaseStateChange RealtimeLifecyclePhase = "state_change"
	RealtimePhaseEnd         RealtimeLifecyclePhase = "end"
	RealtimePhaseError       RealtimeLifecyclePhase = "error"
)

// RealtimeEvent is emitted by the agent for cross-session AI chat collaboration.
//
// JSON fields use snake_case because this payload is transported over Redeven RPC wire.
type RealtimeEvent struct {
	EventType   RealtimeEventType      `json:"event_type"`
	EndpointID  string                 `json:"endpoint_id"`
	ThreadID    string                 `json:"thread_id"`
	RunID       string                 `json:"run_id"`
	AtUnixMs    int64                  `json:"at_unix_ms"`
	StreamKind  RealtimeStreamKind     `json:"stream_kind,omitempty"`
	Phase       RealtimeLifecyclePhase `json:"phase,omitempty"`
	Diag        map[string]any         `json:"diag,omitempty"`
	StreamEvent any                    `json:"stream_event,omitempty"`
	RunStatus   string                 `json:"run_status,omitempty"`
	RunError    string                 `json:"run_error,omitempty"`
}

// ActiveThreadRun is returned in subscribe snapshots so late subscribers can discover
// currently running threads before live events arrive.
type ActiveThreadRun struct {
	ThreadID string `json:"thread_id"`
	RunID    string `json:"run_id"`
}

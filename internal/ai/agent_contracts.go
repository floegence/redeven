package ai

import (
	"context"
	"encoding/json"
	"strings"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

// StreamEventType is the normalized stream event kind produced by provider adapters.
type StreamEventType string

const (
	StreamEventTextDelta     StreamEventType = "text_delta"
	StreamEventToolCallStart StreamEventType = "tool_call_start"
	StreamEventToolCallDelta StreamEventType = "tool_call_delta"
	StreamEventToolCallEnd   StreamEventType = "tool_call_end"
	StreamEventThinkingDelta StreamEventType = "thinking_delta"
	StreamEventUsage         StreamEventType = "usage"
	StreamEventFinishReason  StreamEventType = "finish_reason"
)

type PartialToolCall struct {
	ID            string         `json:"id,omitempty"`
	Name          string         `json:"name,omitempty"`
	ArgumentsJSON string         `json:"arguments_json,omitempty"`
	Arguments     map[string]any `json:"arguments,omitempty"`
}

type PartialUsage struct {
	InputTokens     int64 `json:"input_tokens,omitempty"`
	OutputTokens    int64 `json:"output_tokens,omitempty"`
	ReasoningTokens int64 `json:"reasoning_tokens,omitempty"`
}

type StreamEvent struct {
	Type       StreamEventType  `json:"type"`
	Text       string           `json:"text,omitempty"`
	ToolCall   *PartialToolCall `json:"tool_call,omitempty"`
	Usage      *PartialUsage    `json:"usage,omitempty"`
	FinishHint string           `json:"finish_hint,omitempty"`
}

type ContentPart struct {
	Type       string `json:"type"`
	Text       string `json:"text,omitempty"`
	FileURI    string `json:"file_uri,omitempty"`
	MimeType   string `json:"mime_type,omitempty"`
	ToolCallID string `json:"tool_call_id,omitempty"`
	ToolUseID  string `json:"tool_use_id,omitempty"`
	JSON       []byte `json:"json,omitempty"`
}

type Message struct {
	Role    string        `json:"role"`
	Content []ContentPart `json:"content"`
}

type ProviderControls struct {
	ThinkingBudgetTokens int      `json:"thinking_budget_tokens,omitempty"`
	CacheControl         string   `json:"cache_control,omitempty"`
	ResponseFormat       string   `json:"response_format,omitempty"`
	Temperature          *float64 `json:"temperature,omitempty"`
	TopP                 *float64 `json:"top_p,omitempty"`
}

type TurnBudgets struct {
	MaxSteps       int     `json:"max_steps,omitempty"`
	MaxInputTokens int     `json:"max_input_tokens,omitempty"`
	MaxOutputToken int     `json:"max_output_tokens,omitempty"`
	MaxCostUSD     float64 `json:"max_cost_usd,omitempty"`
}

type ModeFlags struct {
	Mode          string `json:"mode,omitempty"`
	ReasoningOnly bool   `json:"reasoning_only,omitempty"`
}

type TurnRequest struct {
	Model            string           `json:"model"`
	Messages         []Message        `json:"messages"`
	Tools            []ToolDef        `json:"tools"`
	Budgets          TurnBudgets      `json:"budgets"`
	ModeFlags        ModeFlags        `json:"mode_flags"`
	ProviderControls ProviderControls `json:"provider_controls,omitempty"`
}

type ToolCall struct {
	ID   string         `json:"id,omitempty"`
	Name string         `json:"name"`
	Args map[string]any `json:"args,omitempty"`
}

type ToolResult struct {
	ToolID     string             `json:"tool_id,omitempty"`
	ToolName   string             `json:"tool_name,omitempty"`
	Status     string             `json:"status"`
	Summary    string             `json:"summary,omitempty"`
	Details    string             `json:"details,omitempty"`
	Data       any                `json:"data,omitempty"`
	Error      *aitools.ToolError `json:"error,omitempty"`
	Truncated  bool               `json:"truncated,omitempty"`
	ContentRef string             `json:"content_ref,omitempty"`
}

type TurnUsage struct {
	InputTokens     int64 `json:"input_tokens,omitempty"`
	OutputTokens    int64 `json:"output_tokens,omitempty"`
	ReasoningTokens int64 `json:"reasoning_tokens,omitempty"`
}

type TurnResult struct {
	FinishReason    string         `json:"finish_reason"`
	Text            string         `json:"text,omitempty"`
	ToolCalls       []ToolCall     `json:"tool_calls,omitempty"`
	Usage           TurnUsage      `json:"usage,omitempty"`
	RawProviderDiag map[string]any `json:"raw_provider_diag,omitempty"`
	StreamEvents    []StreamEvent  `json:"stream_events,omitempty"`
	ToolResults     []ToolResult   `json:"tool_results,omitempty"`
}

// Provider is the normalized runtime adapter contract.
type Provider interface {
	StreamTurn(ctx context.Context, req TurnRequest, onEvent func(StreamEvent)) (TurnResult, error)
}

type ToolDef struct {
	Name             string          `json:"name"`
	Description      string          `json:"description,omitempty"`
	InputSchema      json.RawMessage `json:"input_schema,omitempty"`
	ParallelSafe     bool            `json:"parallel_safe,omitempty"`
	Mutating         bool            `json:"mutating,omitempty"`
	RequiresApproval bool            `json:"requires_approval,omitempty"`
	Source           string          `json:"source,omitempty"`
	Namespace        string          `json:"namespace,omitempty"`
	Priority         int             `json:"priority,omitempty"`
}

type ToolHandler interface {
	Validate(ctx context.Context, call ToolCall) error
	Execute(ctx context.Context, call ToolCall) (ToolResult, error)
	HandlePartial(ctx context.Context, partial PartialToolCall) error
}

type ToolInterceptor interface {
	BeforeExec(ctx context.Context, call ToolCall) (ToolCall, error)
	AfterExec(ctx context.Context, call ToolCall, result ToolResult) (ToolResult, error)
}

type ToolRegistry interface {
	Register(tool ToolDef, handler ToolHandler) error
	Unregister(name string) error
	Snapshot() []ToolDef
}

type ModeToolFilter interface {
	FilterToolsForMode(mode string, all []ToolDef) []ToolDef
}

type ModelSelectInput struct {
	Mode          string
	ReasoningOnly bool
	Configured    string
}

type ModelSelector interface {
	Select(ctx context.Context, in ModelSelectInput) (provider string, model string, reason string)
}

type StepResult struct {
	Round        int
	TurnResult   TurnResult
	ToolResults  []ToolResult
	FinishReason string
}

type RunContext struct {
	RunID     string
	ThreadID  string
	Endpoint  string
	Objective string
}

type TurnHook interface {
	BeforeTurn(ctx context.Context, run *RunContext) error
	AfterTurn(ctx context.Context, run *RunContext, step StepResult) error
}

type LoopBudget struct {
	MaxSteps       int
	MaxWallTimeMS  int64
	MaxInputTokens int64
	MaxOutputToken int64
	MaxCostMilli   int64
}

type BudgetHint struct {
	MaxSteps int
}

type AgentLoop struct {
	runID        string
	parent       *AgentLoop
	depth        int
	budget       LoopBudget
	deriveBudget func(parent LoopBudget, hint BudgetHint) LoopBudget
}

type TurnSnapshot struct {
	ToolCalls    []ToolCall
	ToolResults  []ToolResult
	FinishReason string
	Assistant    string
}

type LoopDetector interface {
	Detect(ctx context.Context, window []TurnSnapshot) (hit bool, reason string, confidence float64)
}

type runtimeState struct {
	PendingToolCalls      []ToolCall        `json:"pending_tool_calls,omitempty"`
	ToolCallLedger        map[string]string `json:"tool_call_ledger,omitempty"`
	RecentErrors          []string          `json:"recent_errors,omitempty"`
	NoProgressSignatures  []string          `json:"no_progress_signatures,omitempty"`
	PendingUserInputQueue []string          `json:"pending_user_input_queue,omitempty"`
	CompletedActionFacts  []string          `json:"completed_action_facts,omitempty"`
	BlockedActionFacts    []string          `json:"blocked_action_facts,omitempty"`
	ActiveObjectiveDigest string            `json:"active_objective_digest,omitempty"`
	EstimateSource        string            `json:"estimate_source,omitempty"`
}

func newRuntimeState(objective string) runtimeState {
	return runtimeState{
		PendingToolCalls:      make([]ToolCall, 0, 4),
		ToolCallLedger:        make(map[string]string),
		RecentErrors:          make([]string, 0, 4),
		NoProgressSignatures:  make([]string, 0, 8),
		PendingUserInputQueue: make([]string, 0, 2),
		CompletedActionFacts:  make([]string, 0, 8),
		BlockedActionFacts:    make([]string, 0, 8),
		ActiveObjectiveDigest: strings.TrimSpace(objective),
	}
}

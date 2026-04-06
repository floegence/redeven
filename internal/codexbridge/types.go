package codexbridge

type OperationName string

const (
	OperationThreadArchive      OperationName = "thread_archive"
	OperationThreadUnarchive    OperationName = "thread_unarchive"
	OperationThreadFork         OperationName = "thread_fork"
	OperationThreadListArchived OperationName = "thread_list_archived"
	OperationTurnSteer          OperationName = "turn_steer"
	OperationTurnInterrupt      OperationName = "turn_interrupt"
	OperationReviewStart        OperationName = "review_start"
)

type Status struct {
	Available    bool   `json:"available"`
	Ready        bool   `json:"ready"`
	BinaryPath   string `json:"binary_path,omitempty"`
	AgentHomeDir string `json:"agent_home_dir,omitempty"`
	Error        string `json:"error,omitempty"`
}

type ThreadRuntimeConfig struct {
	Model             string `json:"model,omitempty"`
	ModelProvider     string `json:"model_provider,omitempty"`
	CWD               string `json:"cwd,omitempty"`
	ApprovalPolicy    string `json:"approval_policy,omitempty"`
	ApprovalsReviewer string `json:"approvals_reviewer,omitempty"`
	SandboxMode       string `json:"sandbox_mode,omitempty"`
	ReasoningEffort   string `json:"reasoning_effort,omitempty"`
}

type ModelOption struct {
	ID                        string   `json:"id"`
	DisplayName               string   `json:"display_name"`
	Description               string   `json:"description,omitempty"`
	IsDefault                 bool     `json:"is_default,omitempty"`
	SupportsImageInput        bool     `json:"supports_image_input,omitempty"`
	DefaultReasoningEffort    string   `json:"default_reasoning_effort,omitempty"`
	SupportedReasoningEfforts []string `json:"supported_reasoning_efforts,omitempty"`
}

type ConfigRequirements struct {
	AllowedApprovalPolicies []string `json:"allowed_approval_policies,omitempty"`
	AllowedSandboxModes     []string `json:"allowed_sandbox_modes,omitempty"`
}

type Capabilities struct {
	Models          []ModelOption       `json:"models,omitempty"`
	EffectiveConfig ThreadRuntimeConfig `json:"effective_config"`
	Requirements    *ConfigRequirements `json:"requirements,omitempty"`
	Operations      []OperationName     `json:"operations,omitempty"`
}

type ListThreadsRequest struct {
	Limit    int   `json:"limit,omitempty"`
	Archived *bool `json:"archived,omitempty"`
}

type StartThreadRequest struct {
	CWD               string `json:"cwd,omitempty"`
	Model             string `json:"model,omitempty"`
	ApprovalPolicy    string `json:"approval_policy,omitempty"`
	SandboxMode       string `json:"sandbox_mode,omitempty"`
	ApprovalsReviewer string `json:"approvals_reviewer,omitempty"`
}

type ForkThreadRequest struct {
	ThreadID          string `json:"thread_id"`
	Model             string `json:"model,omitempty"`
	ApprovalPolicy    string `json:"approval_policy,omitempty"`
	SandboxMode       string `json:"sandbox_mode,omitempty"`
	ApprovalsReviewer string `json:"approvals_reviewer,omitempty"`
}

type StartTurnRequest struct {
	ThreadID          string           `json:"thread_id"`
	InputText         string           `json:"input_text,omitempty"`
	Inputs            []UserInputEntry `json:"inputs,omitempty"`
	CWD               string           `json:"cwd,omitempty"`
	Model             string           `json:"model,omitempty"`
	Effort            string           `json:"effort,omitempty"`
	ApprovalPolicy    string           `json:"approval_policy,omitempty"`
	SandboxMode       string           `json:"sandbox_mode,omitempty"`
	ApprovalsReviewer string           `json:"approvals_reviewer,omitempty"`
}

type SteerTurnRequest struct {
	ThreadID       string           `json:"thread_id"`
	ExpectedTurnID string           `json:"expected_turn_id"`
	Inputs         []UserInputEntry `json:"inputs,omitempty"`
}

type InterruptTurnRequest struct {
	ThreadID string `json:"thread_id"`
	TurnID   string `json:"turn_id"`
}

type StartReviewRequest struct {
	ThreadID string `json:"thread_id"`
	Target   string `json:"target,omitempty"`
}

type TokenUsageBreakdown struct {
	TotalTokens           int64 `json:"total_tokens"`
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens"`
}

type ThreadTokenUsage struct {
	Total              TokenUsageBreakdown `json:"total"`
	Last               TokenUsageBreakdown `json:"last"`
	ModelContextWindow *int64              `json:"model_context_window,omitempty"`
}

type ThreadDetail struct {
	Thread            Thread              `json:"thread"`
	RuntimeConfig     ThreadRuntimeConfig `json:"runtime_config,omitempty"`
	PendingRequests   []PendingRequest    `json:"pending_requests,omitempty"`
	TokenUsage        *ThreadTokenUsage   `json:"token_usage,omitempty"`
	LastAppliedSeq    int64               `json:"last_applied_seq"`
	ActiveStatus      string              `json:"active_status,omitempty"`
	ActiveStatusFlags []string            `json:"active_status_flags,omitempty"`
}

type Thread struct {
	ID             string   `json:"id"`
	Preview        string   `json:"preview"`
	Ephemeral      bool     `json:"ephemeral"`
	ModelProvider  string   `json:"model_provider"`
	CreatedAtUnixS int64    `json:"created_at_unix_s"`
	UpdatedAtUnixS int64    `json:"updated_at_unix_s"`
	Status         string   `json:"status"`
	ActiveFlags    []string `json:"active_flags,omitempty"`
	Path           string   `json:"path,omitempty"`
	CWD            string   `json:"cwd"`
	CLIVersion     string   `json:"cli_version,omitempty"`
	Source         string   `json:"source,omitempty"`
	AgentNickname  string   `json:"agent_nickname,omitempty"`
	AgentRole      string   `json:"agent_role,omitempty"`
	Name           string   `json:"name,omitempty"`
	Turns          []Turn   `json:"turns,omitempty"`
}

type Turn struct {
	ID           string     `json:"id"`
	Kind         string     `json:"kind,omitempty"`
	AcceptsSteer *bool      `json:"accepts_steer,omitempty"`
	Status       string     `json:"status"`
	Error        *TurnError `json:"error,omitempty"`
	Items        []Item     `json:"items,omitempty"`
}

type TurnError struct {
	Message           string `json:"message"`
	AdditionalDetails string `json:"additional_details,omitempty"`
	CodexErrorCode    string `json:"codex_error_code,omitempty"`
}

type Item struct {
	ID               string           `json:"id"`
	Type             string           `json:"type"`
	Text             string           `json:"text,omitempty"`
	Phase            string           `json:"phase,omitempty"`
	Summary          []string         `json:"summary,omitempty"`
	Content          []string         `json:"content,omitempty"`
	Command          string           `json:"command,omitempty"`
	CWD              string           `json:"cwd,omitempty"`
	Status           string           `json:"status,omitempty"`
	AggregatedOutput string           `json:"aggregated_output,omitempty"`
	ExitCode         *int             `json:"exit_code,omitempty"`
	DurationMs       *int64           `json:"duration_ms,omitempty"`
	Changes          []FileChange     `json:"changes,omitempty"`
	Query            string           `json:"query,omitempty"`
	Action           *WebSearchAction `json:"action,omitempty"`
	Inputs           []UserInputEntry `json:"inputs,omitempty"`
}

type FileChange struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	MovePath string `json:"move_path,omitempty"`
	Diff     string `json:"diff,omitempty"`
}

type TextElement struct {
	Start       int    `json:"start"`
	End         int    `json:"end"`
	Placeholder string `json:"placeholder,omitempty"`
}

type UserInputEntry struct {
	Type         string        `json:"type"`
	Text         string        `json:"text,omitempty"`
	URL          string        `json:"url,omitempty"`
	Path         string        `json:"path,omitempty"`
	Name         string        `json:"name,omitempty"`
	TextElements []TextElement `json:"text_elements,omitempty"`
}

type WebSearchAction struct {
	Type    string   `json:"type"`
	Query   string   `json:"query,omitempty"`
	Queries []string `json:"queries,omitempty"`
	URL     string   `json:"url,omitempty"`
	Pattern string   `json:"pattern,omitempty"`
}

type PermissionProfile struct {
	FileSystemRead  []string `json:"file_system_read,omitempty"`
	FileSystemWrite []string `json:"file_system_write,omitempty"`
	NetworkEnabled  *bool    `json:"network_enabled,omitempty"`
}

type PendingRequest struct {
	ID                    string              `json:"id"`
	Type                  string              `json:"type"`
	ThreadID              string              `json:"thread_id"`
	TurnID                string              `json:"turn_id"`
	ItemID                string              `json:"item_id"`
	Reason                string              `json:"reason,omitempty"`
	Command               string              `json:"command,omitempty"`
	CWD                   string              `json:"cwd,omitempty"`
	GrantRoot             string              `json:"grant_root,omitempty"`
	AvailableDecisions    []string            `json:"available_decisions,omitempty"`
	Questions             []UserInputQuestion `json:"questions,omitempty"`
	Permissions           *PermissionProfile  `json:"permissions,omitempty"`
	AdditionalPermissions *PermissionProfile  `json:"additional_permissions,omitempty"`
}

type UserInputQuestion struct {
	ID       string            `json:"id"`
	Header   string            `json:"header"`
	Question string            `json:"question"`
	IsOther  bool              `json:"is_other"`
	IsSecret bool              `json:"is_secret"`
	Options  []UserInputOption `json:"options,omitempty"`
}

type UserInputOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

type PendingRequestResponse struct {
	Type     string              `json:"type,omitempty"`
	Decision string              `json:"decision,omitempty"`
	Answers  map[string][]string `json:"answers,omitempty"`
}

type Event struct {
	Seq          int64             `json:"seq"`
	Type         string            `json:"type"`
	ThreadID     string            `json:"thread_id"`
	TurnID       string            `json:"turn_id,omitempty"`
	ItemID       string            `json:"item_id,omitempty"`
	RequestID    string            `json:"request_id,omitempty"`
	Thread       *Thread           `json:"thread,omitempty"`
	Turn         *Turn             `json:"turn,omitempty"`
	Item         *Item             `json:"item,omitempty"`
	Request      *PendingRequest   `json:"request,omitempty"`
	TokenUsage   *ThreadTokenUsage `json:"token_usage,omitempty"`
	Delta        string            `json:"delta,omitempty"`
	Status       string            `json:"status,omitempty"`
	Flags        []string          `json:"flags,omitempty"`
	ThreadName   string            `json:"thread_name,omitempty"`
	SummaryIndex *int64            `json:"summary_index,omitempty"`
	ContentIndex *int64            `json:"content_index,omitempty"`
	Error        string            `json:"error,omitempty"`
	WillRetry    bool              `json:"will_retry,omitempty"`
}

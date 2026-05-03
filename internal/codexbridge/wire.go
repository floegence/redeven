package codexbridge

import (
	"encoding/json"
)

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type rpcEnvelope struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

type initializeParams struct {
	ClientInfo   clientInfo              `json:"clientInfo"`
	Capabilities *initializeCapabilities `json:"capabilities,omitempty"`
}

type clientInfo struct {
	Name    string `json:"name"`
	Title   string `json:"title"`
	Version string `json:"version"`
}

type initializeCapabilities struct {
	ExperimentalAPI bool `json:"experimentalApi"`
}

type wireThreadStatus struct {
	Type        string   `json:"type"`
	ActiveFlags []string `json:"activeFlags,omitempty"`
}

type wireThread struct {
	ID            string           `json:"id"`
	Preview       string           `json:"preview"`
	Ephemeral     bool             `json:"ephemeral"`
	ModelProvider string           `json:"modelProvider"`
	CreatedAt     int64            `json:"createdAt"`
	UpdatedAt     int64            `json:"updatedAt"`
	Status        wireThreadStatus `json:"status"`
	Path          *string          `json:"path"`
	CWD           string           `json:"cwd"`
	CLIVersion    string           `json:"cliVersion"`
	Source        string           `json:"source"`
	AgentNickname *string          `json:"agentNickname"`
	AgentRole     *string          `json:"agentRole"`
	Name          *string          `json:"name"`
	Turns         []wireTurn       `json:"turns"`
}

type wireTurn struct {
	ID     string           `json:"id"`
	Items  []wireThreadItem `json:"items"`
	Status string           `json:"status"`
	Error  *wireTurnError   `json:"error"`
}

type wireTurnError struct {
	Message           string          `json:"message"`
	CodexErrorInfo    json.RawMessage `json:"codexErrorInfo"`
	AdditionalDetails *string         `json:"additionalDetails"`
}

type wireThreadItem struct {
	Type             string                 `json:"type"`
	ID               string                 `json:"id"`
	Content          []wireUserInput        `json:"content,omitempty"`
	Text             string                 `json:"text,omitempty"`
	Phase            *string                `json:"phase,omitempty"`
	Summary          []string               `json:"summary,omitempty"`
	Command          string                 `json:"command,omitempty"`
	CWD              string                 `json:"cwd,omitempty"`
	Status           string                 `json:"status,omitempty"`
	AggregatedOutput *string                `json:"aggregatedOutput,omitempty"`
	ExitCode         *int                   `json:"exitCode,omitempty"`
	DurationMs       *int64                 `json:"durationMs,omitempty"`
	Changes          []wireFileUpdateChange `json:"changes,omitempty"`
	Query            string                 `json:"query,omitempty"`
	Action           *wireWebSearchAction   `json:"action,omitempty"`
}

type wireFileUpdateChange struct {
	Path string              `json:"path"`
	Kind wirePatchChangeKind `json:"kind"`
	Diff string              `json:"diff"`
}

type wireWebSearchAction struct {
	Type    string   `json:"type"`
	Query   *string  `json:"query,omitempty"`
	Queries []string `json:"queries,omitempty"`
	URL     *string  `json:"url,omitempty"`
	Pattern *string  `json:"pattern,omitempty"`
}

type wirePatchChangeKind struct {
	Type     string  `json:"type"`
	MovePath *string `json:"move_path"`
}

type wireUserInput struct {
	Type         string            `json:"type"`
	Text         string            `json:"text,omitempty"`
	URL          string            `json:"url,omitempty"`
	Path         string            `json:"path,omitempty"`
	Name         string            `json:"name,omitempty"`
	TextElements []wireTextElement `json:"textElements,omitempty"`
}

type wireTextElement struct {
	Start       int     `json:"start"`
	End         int     `json:"end"`
	Placeholder *string `json:"placeholder,omitempty"`
}

type wireSandboxPolicy struct {
	Type                string   `json:"type"`
	WritableRoots       []string `json:"writableRoots,omitempty"`
	NetworkAccess       bool     `json:"networkAccess,omitempty"`
	ExcludeTmpdirEnvVar bool     `json:"excludeTmpdirEnvVar,omitempty"`
	ExcludeSlashTmp     bool     `json:"excludeSlashTmp,omitempty"`
}

type wireReasoningEffortOption struct {
	ReasoningEffort string `json:"reasoningEffort"`
	Description     string `json:"description"`
}

type wireModel struct {
	ID                        string                      `json:"id"`
	DisplayName               string                      `json:"displayName"`
	Description               string                      `json:"description"`
	IsDefault                 bool                        `json:"isDefault"`
	DefaultReasoningEffort    string                      `json:"defaultReasoningEffort"`
	SupportedReasoningEfforts []wireReasoningEffortOption `json:"supportedReasoningEfforts"`
	InputModalities           []string                    `json:"inputModalities"`
}

type wireModelListParams struct {
	IncludeHidden *bool `json:"includeHidden,omitempty"`
}

type wireModelListResponse struct {
	Data []wireModel `json:"data"`
}

type wireConfigReadParams struct {
	IncludeLayers bool    `json:"includeLayers"`
	CWD           *string `json:"cwd,omitempty"`
}

type wireConfig struct {
	Model                *string         `json:"model"`
	ModelProvider        *string         `json:"model_provider"`
	ApprovalPolicy       json.RawMessage `json:"approval_policy"`
	ApprovalsReviewer    *string         `json:"approvals_reviewer"`
	SandboxMode          *string         `json:"sandbox_mode"`
	ModelReasoningEffort *string         `json:"model_reasoning_effort"`
}

type wireConfigReadResponse struct {
	Config wireConfig `json:"config"`
}

type wireConfigRequirements struct {
	AllowedApprovalPolicies []json.RawMessage `json:"allowedApprovalPolicies"`
	AllowedSandboxModes     []string          `json:"allowedSandboxModes"`
}

type wireConfigRequirementsReadResponse struct {
	Requirements *wireConfigRequirements `json:"requirements"`
}

type wireThreadListResponse struct {
	Data       []wireThread `json:"data"`
	NextCursor *string      `json:"nextCursor"`
}

type wireThreadStartParams struct {
	Model                  *string `json:"model,omitempty"`
	CWD                    *string `json:"cwd,omitempty"`
	ApprovalPolicy         *string `json:"approvalPolicy,omitempty"`
	Sandbox                *string `json:"sandbox,omitempty"`
	ApprovalsReviewer      *string `json:"approvalsReviewer,omitempty"`
	ServiceName            *string `json:"serviceName,omitempty"`
	ExperimentalRawEvents  bool    `json:"experimentalRawEvents"`
	PersistExtendedHistory bool    `json:"persistExtendedHistory"`
}

type wireThreadStartResponse struct {
	Thread            wireThread        `json:"thread"`
	Model             string            `json:"model"`
	ModelProvider     string            `json:"modelProvider"`
	CWD               string            `json:"cwd"`
	ApprovalPolicy    json.RawMessage   `json:"approvalPolicy"`
	ApprovalsReviewer string            `json:"approvalsReviewer"`
	Sandbox           wireSandboxPolicy `json:"sandbox"`
	ReasoningEffort   *string           `json:"reasoningEffort"`
}

type wireThreadResumeParams struct {
	ThreadID               string  `json:"threadId"`
	Model                  *string `json:"model,omitempty"`
	CWD                    *string `json:"cwd,omitempty"`
	ApprovalPolicy         *string `json:"approvalPolicy,omitempty"`
	Sandbox                *string `json:"sandbox,omitempty"`
	ApprovalsReviewer      *string `json:"approvalsReviewer,omitempty"`
	PersistExtendedHistory bool    `json:"persistExtendedHistory"`
}

type wireThreadResumeResponse struct {
	Thread            wireThread        `json:"thread"`
	Model             string            `json:"model"`
	ModelProvider     string            `json:"modelProvider"`
	CWD               string            `json:"cwd"`
	ApprovalPolicy    json.RawMessage   `json:"approvalPolicy"`
	ApprovalsReviewer string            `json:"approvalsReviewer"`
	Sandbox           wireSandboxPolicy `json:"sandbox"`
	ReasoningEffort   *string           `json:"reasoningEffort"`
}

type wireThreadReadParams struct {
	ThreadID     string `json:"threadId"`
	IncludeTurns bool   `json:"includeTurns"`
}

type wireThreadReadResponse struct {
	Thread wireThread `json:"thread"`
}

type wireThreadArchiveParams struct {
	ThreadID string `json:"threadId"`
}

type wireThreadListParams struct {
	Limit    int    `json:"limit,omitempty"`
	SortKey  string `json:"sortKey,omitempty"`
	Archived *bool  `json:"archived,omitempty"`
}

type wireTurnStartParams struct {
	ThreadID          string             `json:"threadId"`
	Input             []wireUserInput    `json:"input"`
	CWD               *string            `json:"cwd,omitempty"`
	ApprovalPolicy    *string            `json:"approvalPolicy,omitempty"`
	ApprovalsReviewer *string            `json:"approvalsReviewer,omitempty"`
	SandboxPolicy     *wireSandboxPolicy `json:"sandboxPolicy,omitempty"`
	Model             *string            `json:"model,omitempty"`
	Effort            *string            `json:"effort,omitempty"`
}

type wireTurnStartResponse struct {
	Turn wireTurn `json:"turn"`
}

type wireTurnSteerParams struct {
	ThreadID       string          `json:"threadId"`
	Input          []wireUserInput `json:"input"`
	ExpectedTurnID string          `json:"expectedTurnId"`
}

type wireTurnSteerResponse struct {
	TurnID string `json:"turnId"`
}

type wireThreadForkParams struct {
	ThreadID               string  `json:"threadId"`
	Model                  *string `json:"model,omitempty"`
	ApprovalPolicy         *string `json:"approvalPolicy,omitempty"`
	Sandbox                *string `json:"sandbox,omitempty"`
	ApprovalsReviewer      *string `json:"approvalsReviewer,omitempty"`
	PersistExtendedHistory bool    `json:"persistExtendedHistory"`
}

type wireThreadForkResponse struct {
	Thread            wireThread        `json:"thread"`
	Model             string            `json:"model"`
	ModelProvider     string            `json:"modelProvider"`
	CWD               string            `json:"cwd"`
	ApprovalPolicy    json.RawMessage   `json:"approvalPolicy"`
	ApprovalsReviewer string            `json:"approvalsReviewer"`
	Sandbox           wireSandboxPolicy `json:"sandbox"`
	ReasoningEffort   *string           `json:"reasoningEffort"`
}

type wireThreadUnarchiveParams struct {
	ThreadID string `json:"threadId"`
}

type wireThreadUnarchiveResponse struct {
	Thread wireThread `json:"thread"`
}

type wireTurnInterruptParams struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
}

type wireReviewTarget struct {
	Type string `json:"type"`
}

type wireReviewStartParams struct {
	ThreadID string           `json:"threadId"`
	Target   wireReviewTarget `json:"target"`
}

type wireReviewStartResponse struct {
	Turn           wireTurn `json:"turn"`
	ReviewThreadID string   `json:"reviewThreadId"`
}

type wireThreadStartedNotification struct {
	Thread wireThread `json:"thread"`
}

type wireTurnNotification struct {
	ThreadID string   `json:"threadId"`
	Turn     wireTurn `json:"turn"`
}

type wireItemNotification struct {
	ThreadID string         `json:"threadId"`
	TurnID   string         `json:"turnId"`
	Item     wireThreadItem `json:"item"`
}

type wireResponseItem struct {
	Type   string               `json:"type"`
	ID     *string              `json:"id,omitempty"`
	Status *string              `json:"status,omitempty"`
	Action *wireWebSearchAction `json:"action,omitempty"`
}

type wireRawResponseItemCompletedNotification struct {
	ThreadID string           `json:"threadId"`
	TurnID   string           `json:"turnId"`
	Item     wireResponseItem `json:"item"`
}

type wireDeltaNotification struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
	ItemID   string `json:"itemId"`
	Delta    string `json:"delta"`
}

type wireReasoningSummaryTextDeltaNotification struct {
	ThreadID     string `json:"threadId"`
	TurnID       string `json:"turnId"`
	ItemID       string `json:"itemId"`
	Delta        string `json:"delta"`
	SummaryIndex int64  `json:"summaryIndex"`
}

type wireReasoningSummaryPartAddedNotification struct {
	ThreadID     string `json:"threadId"`
	TurnID       string `json:"turnId"`
	ItemID       string `json:"itemId"`
	SummaryIndex int64  `json:"summaryIndex"`
}

type wireReasoningTextDeltaNotification struct {
	ThreadID     string `json:"threadId"`
	TurnID       string `json:"turnId"`
	ItemID       string `json:"itemId"`
	Delta        string `json:"delta"`
	ContentIndex int64  `json:"contentIndex"`
}

type wireThreadStatusChangedNotification struct {
	ThreadID string           `json:"threadId"`
	Status   wireThreadStatus `json:"status"`
}

type wireThreadArchivedNotification struct {
	ThreadID string `json:"threadId"`
}

type wireThreadUnarchivedNotification struct {
	ThreadID string `json:"threadId"`
}

type wireThreadClosedNotification struct {
	ThreadID string `json:"threadId"`
}

type wireThreadNameUpdatedNotification struct {
	ThreadID   string  `json:"threadId"`
	ThreadName *string `json:"threadName"`
}

type wireTokenUsageBreakdown struct {
	TotalTokens           int64 `json:"totalTokens"`
	InputTokens           int64 `json:"inputTokens"`
	CachedInputTokens     int64 `json:"cachedInputTokens"`
	OutputTokens          int64 `json:"outputTokens"`
	ReasoningOutputTokens int64 `json:"reasoningOutputTokens"`
}

type wireThreadTokenUsage struct {
	Total              wireTokenUsageBreakdown `json:"total"`
	Last               wireTokenUsageBreakdown `json:"last"`
	ModelContextWindow *int64                  `json:"modelContextWindow"`
}

type wireThreadTokenUsageUpdatedNotification struct {
	ThreadID   string               `json:"threadId"`
	TurnID     string               `json:"turnId"`
	TokenUsage wireThreadTokenUsage `json:"tokenUsage"`
}

type wireServerRequestResolvedNotification struct {
	ThreadID  string          `json:"threadId"`
	RequestID json.RawMessage `json:"requestId"`
}

type wireErrorNotification struct {
	Error     wireTurnError `json:"error"`
	WillRetry bool          `json:"willRetry"`
	ThreadID  string        `json:"threadId"`
	TurnID    string        `json:"turnId"`
}

type wireCommandApprovalRequest struct {
	ThreadID              string                 `json:"threadId"`
	TurnID                string                 `json:"turnId"`
	ItemID                string                 `json:"itemId"`
	ApprovalID            *string                `json:"approvalId"`
	Reason                *string                `json:"reason"`
	Command               *string                `json:"command"`
	CWD                   *string                `json:"cwd"`
	AvailableDecisions    []json.RawMessage      `json:"availableDecisions"`
	AdditionalPermissions *wirePermissionProfile `json:"additionalPermissions"`
}

type wireFileChangeApprovalRequest struct {
	ThreadID  string  `json:"threadId"`
	TurnID    string  `json:"turnId"`
	ItemID    string  `json:"itemId"`
	Reason    *string `json:"reason"`
	GrantRoot *string `json:"grantRoot"`
}

type wireUserInputRequest struct {
	ThreadID  string                  `json:"threadId"`
	TurnID    string                  `json:"turnId"`
	ItemID    string                  `json:"itemId"`
	Questions []wireUserInputQuestion `json:"questions"`
}

type wireUserInputQuestion struct {
	ID       string                `json:"id"`
	Header   string                `json:"header"`
	Question string                `json:"question"`
	IsOther  bool                  `json:"isOther"`
	IsSecret bool                  `json:"isSecret"`
	Options  []wireUserInputOption `json:"options"`
}

type wireUserInputOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

type wirePermissionsRequest struct {
	ThreadID    string                `json:"threadId"`
	TurnID      string                `json:"turnId"`
	ItemID      string                `json:"itemId"`
	Reason      *string               `json:"reason"`
	Permissions wirePermissionProfile `json:"permissions"`
}

type wirePermissionProfile struct {
	Network    *wireAdditionalNetworkPermissions    `json:"network,omitempty"`
	FileSystem *wireAdditionalFileSystemPermissions `json:"fileSystem,omitempty"`
}

type wireAdditionalNetworkPermissions struct {
	Enabled *bool `json:"enabled"`
}

type wireAdditionalFileSystemPermissions struct {
	Read  []string `json:"read"`
	Write []string `json:"write"`
}

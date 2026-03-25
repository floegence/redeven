package codexbridge

import (
	"encoding/json"
)

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
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
}

type wireFileUpdateChange struct {
	Path string              `json:"path"`
	Kind wirePatchChangeKind `json:"kind"`
	Diff string              `json:"diff"`
}

type wirePatchChangeKind struct {
	Type     string  `json:"type"`
	MovePath *string `json:"move_path"`
}

type wireUserInput struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	URL  string `json:"url,omitempty"`
	Path string `json:"path,omitempty"`
	Name string `json:"name,omitempty"`
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
	ServiceName            *string `json:"serviceName,omitempty"`
	ExperimentalRawEvents  bool    `json:"experimentalRawEvents"`
	PersistExtendedHistory bool    `json:"persistExtendedHistory"`
}

type wireThreadStartResponse struct {
	Thread wireThread `json:"thread"`
}

type wireThreadResumeParams struct {
	ThreadID               string  `json:"threadId"`
	Model                  *string `json:"model,omitempty"`
	CWD                    *string `json:"cwd,omitempty"`
	ApprovalPolicy         *string `json:"approvalPolicy,omitempty"`
	Sandbox                *string `json:"sandbox,omitempty"`
	PersistExtendedHistory bool    `json:"persistExtendedHistory"`
}

type wireThreadResumeResponse struct {
	Thread wireThread `json:"thread"`
}

type wireThreadArchiveParams struct {
	ThreadID string `json:"threadId"`
}

type wireThreadListParams struct {
	Limit   int    `json:"limit,omitempty"`
	SortKey string `json:"sortKey,omitempty"`
}

type wireTurnStartParams struct {
	ThreadID string          `json:"threadId"`
	Input    []wireUserInput `json:"input"`
}

type wireTurnStartResponse struct {
	Turn wireTurn `json:"turn"`
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

type wireDeltaNotification struct {
	ThreadID string `json:"threadId"`
	TurnID   string `json:"turnId"`
	ItemID   string `json:"itemId"`
	Delta    string `json:"delta"`
}

type wireThreadStatusChangedNotification struct {
	ThreadID string           `json:"threadId"`
	Status   wireThreadStatus `json:"status"`
}

type wireThreadArchivedNotification struct {
	ThreadID string `json:"threadId"`
}

type wireServerRequestResolvedNotification struct {
	ThreadID  string          `json:"threadId"`
	RequestID json.RawMessage `json:"requestId"`
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

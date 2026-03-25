package codexbridge

type Status struct {
	Enabled        bool   `json:"enabled"`
	Ready          bool   `json:"ready"`
	BinaryPath     string `json:"binary_path,omitempty"`
	DefaultModel   string `json:"default_model,omitempty"`
	ApprovalPolicy string `json:"approval_policy,omitempty"`
	SandboxMode    string `json:"sandbox_mode,omitempty"`
	AgentHomeDir   string `json:"agent_home_dir,omitempty"`
	Error          string `json:"error,omitempty"`
}

type StartThreadRequest struct {
	CWD   string `json:"cwd,omitempty"`
	Model string `json:"model,omitempty"`
}

type StartTurnRequest struct {
	ThreadID  string `json:"thread_id"`
	InputText string `json:"input_text"`
}

type ThreadDetail struct {
	Thread           Thread           `json:"thread"`
	PendingRequests  []PendingRequest `json:"pending_requests,omitempty"`
	LastEventSeq     int64            `json:"last_event_seq"`
	ActiveStatus     string           `json:"active_status,omitempty"`
	ActiveStatusFlag []string         `json:"active_status_flags,omitempty"`
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
	ID     string     `json:"id"`
	Status string     `json:"status"`
	Error  *TurnError `json:"error,omitempty"`
	Items  []Item     `json:"items,omitempty"`
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
	Inputs           []UserInputEntry `json:"inputs,omitempty"`
}

type FileChange struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	MovePath string `json:"move_path,omitempty"`
	Diff     string `json:"diff,omitempty"`
}

type UserInputEntry struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	URL  string `json:"url,omitempty"`
	Path string `json:"path,omitempty"`
	Name string `json:"name,omitempty"`
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
	Seq       int64           `json:"seq"`
	Type      string          `json:"type"`
	ThreadID  string          `json:"thread_id"`
	TurnID    string          `json:"turn_id,omitempty"`
	ItemID    string          `json:"item_id,omitempty"`
	RequestID string          `json:"request_id,omitempty"`
	Thread    *Thread         `json:"thread,omitempty"`
	Turn      *Turn           `json:"turn,omitempty"`
	Item      *Item           `json:"item,omitempty"`
	Request   *PendingRequest `json:"request,omitempty"`
	Delta     string          `json:"delta,omitempty"`
	Status    string          `json:"status,omitempty"`
	Flags     []string        `json:"flags,omitempty"`
	Error     string          `json:"error,omitempty"`
}

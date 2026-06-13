package flowerhost

import (
	"encoding/json"
	"time"

	"github.com/floegence/floret/observation"
	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/redeven/internal/config"
)

const (
	SchemaVersion = 1

	HostKindGlobal   = "global"
	HostKindEnvLocal = "env_local"

	CarrierKindDesktop = "desktop"
	CarrierKindServer  = "server"
	CarrierKindRuntime = "runtime"

	HandlerKindGlobal   = "global"
	HandlerKindEnvLocal = "env_local"

	HandlerStateOnline      = "online"
	HandlerStateUnreachable = "unreachable"

	RouteFlowerHost         = "flower_host"
	RouteEnvLocal           = "env_local"
	RouteBlocked            = "blocked"
	RouteNeedsClarification = "needs_clarification"

	ReasonHostAvailable           = "host_available"
	ReasonHostUnavailable         = "host_unavailable"
	ReasonCurrentEnvOnly          = "current_env_only"
	ReasonCrossEnvRequiresHost    = "cross_env_requires_flower_host"
	ReasonRequestedHandlerInvalid = "requested_handler_unavailable"
	ReasonDecisionRevisionExpired = "decision_revision_expired"
	ReasonDecisionScopeMismatch   = "decision_scope_mismatch"
	ReasonHandlerSelectionStale   = "handler_selection_stale"
	ReasonHandlerUnavailable      = "handler_unavailable"
	ReasonHostNotConfigured       = "host_not_configured"

	ThreadKindChat = "chat"
	ThreadKindTask = "task"

	ClientSurfaceFlowerSurface    = "flower_surface"
	ClientSurfaceWelcomeAskFlower = "welcome_ask_flower"
	ClientSurfaceEnvAppAskFlower  = "env_app_ask_flower"

	SelectionSourceRouterDefault = "router_default"
	SelectionSourceUserSelected  = "user_selected"

	ThreadCreateErrorSelectionStale     = "HANDLER_SELECTION_STALE"
	ThreadCreateErrorHandlerUnavailable = "HANDLER_UNAVAILABLE"
	ThreadCreateErrorRevisionExpired    = "DECISION_REVISION_EXPIRED"
	ThreadCreateErrorScopeMismatch      = "DECISION_SCOPE_MISMATCH"
	ThreadCreateErrorInvalidContext     = "INVALID_CONTEXT_ENVELOPE"
)

type HostIdentity struct {
	SchemaVersion    int    `json:"schema_version"`
	HostID           string `json:"host_id"`
	HostKind         string `json:"host_kind"`
	CarrierKind      string `json:"carrier_kind"`
	DeviceID         string `json:"device_id,omitempty"`
	ServerInstanceID string `json:"server_instance_id,omitempty"`
	UserPublicID     string `json:"user_public_id,omitempty"`
	CreatedAtUnixMs  int64  `json:"created_at_unix_ms"`
	LastSeenAtUnixMs int64  `json:"last_seen_at_unix_ms"`
}

type ConfigDocument struct {
	SchemaVersion      int                          `json:"schema_version"`
	Enabled            bool                         `json:"enabled"`
	CurrentModelID     string                       `json:"current_model_id"`
	ExecutionPolicy    *config.AIExecutionPolicy    `json:"execution_policy,omitempty"`
	TerminalExecPolicy *config.AITerminalExecPolicy `json:"terminal_exec_policy,omitempty"`
	Providers          []config.AIProvider          `json:"providers"`
}

type SettingsSnapshot struct {
	Config          ConfigDocument        `json:"config"`
	ProviderSecrets []ProviderSecretState `json:"provider_secrets"`
	TargetCache     TargetCache           `json:"target_cache"`
}

type SettingsDraft struct {
	Config ConfigDocument `json:"config"`
}

type ProviderSecretState struct {
	ProviderID                string `json:"provider_id"`
	ProviderAPIKeyConfigured  bool   `json:"provider_api_key_configured"`
	WebSearchAPIKeyConfigured bool   `json:"web_search_api_key_configured"`
}

type CarrierHealth struct {
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

type TargetCache struct {
	Version int                `json:"version"`
	Entries []TargetCacheEntry `json:"entries"`
}

type TargetCacheEntry struct {
	TargetID         string          `json:"target_id"`
	Label            string          `json:"label"`
	TargetURL        string          `json:"target_url"`
	LastSeenAtUnixMs int64           `json:"last_seen_at_unix_ms"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
}

const (
	TargetKindProviderEnvironment = "provider_environment"

	TargetConnectUnknown      = "unknown"
	TargetConnectConnectable  = "connectable"
	TargetConnectConnected    = "connected"
	TargetConnectUnreachable  = "unreachable"
	TargetConnectUnauthorized = "unauthorized"
	TargetConnectUnsupported  = "unsupported"

	TargetCapabilityFiles    = "files"
	TargetCapabilityTerminal = "terminal"
	TargetCapabilityGit      = "git"
	TargetCapabilityMonitor  = "monitor"
)

type FlowerTargetRef struct {
	TargetID              string              `json:"target_id"`
	TargetKind            string              `json:"target_kind"`
	ProviderOrigin        string              `json:"provider_origin,omitempty"`
	ProviderID            string              `json:"provider_id,omitempty"`
	EnvPublicID           string              `json:"env_public_id,omitempty"`
	NamespacePublicID     string              `json:"namespace_public_id,omitempty"`
	Label                 string              `json:"label"`
	RuntimeStatus         string              `json:"runtime_status,omitempty"`
	Capabilities          []string            `json:"capabilities"`
	ConnectState          string              `json:"connect_state"`
	LastConnectedAtUnixMs int64               `json:"last_connected_at_unix_ms,omitempty"`
	LastConnectError      *TargetConnectError `json:"last_connect_error,omitempty"`
	Metadata              map[string]any      `json:"metadata,omitempty"`
}

type TargetConnectError struct {
	Code     string `json:"code"`
	Message  string `json:"message"`
	AtUnixMs int64  `json:"at_unix_ms"`
}

type TargetSessionCapabilities struct {
	CanRead    bool `json:"can_read"`
	CanWrite   bool `json:"can_write"`
	CanExecute bool `json:"can_execute"`
}

type TargetSessionGrant struct {
	TargetID        string                      `json:"target_id"`
	ProviderOrigin  string                      `json:"provider_origin,omitempty"`
	EnvPublicID     string                      `json:"env_public_id"`
	GrantClient     *controlv1.ChannelInitGrant `json:"grant_client"`
	Capabilities    TargetSessionCapabilities   `json:"capabilities"`
	ExpiresAtUnixMs int64                       `json:"expires_at_unix_ms"`
}

type TargetToolCall struct {
	ToolCallID           string          `json:"tool_call_id"`
	TargetID             string          `json:"target_id"`
	ToolName             string          `json:"tool_name"`
	Arguments            json.RawMessage `json:"arguments"`
	RequiredCapabilities []string        `json:"required_capabilities"`
	ApprovalRef          string          `json:"approval_ref,omitempty"`
}

type TargetToolResult struct {
	ToolCallID string           `json:"tool_call_id"`
	TargetID   string           `json:"target_id"`
	ToolName   string           `json:"tool_name"`
	Result     json.RawMessage  `json:"result,omitempty"`
	Error      *TargetToolError `json:"error,omitempty"`
}

type TargetToolError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type FlowerTransferPlan struct {
	PlanID      string                   `json:"plan_id"`
	ThreadID    string                   `json:"thread_id"`
	Source      FlowerTransferEndpoint   `json:"source"`
	Destination FlowerTransferEndpoint   `json:"destination"`
	Manifest    FlowerTransferManifest   `json:"manifest"`
	Conflicts   []FlowerTransferConflict `json:"conflicts"`
	Approval    FlowerTransferApproval   `json:"approval"`
}

type FlowerTransferEndpoint struct {
	TargetID        string   `json:"target_id"`
	SourcePaths     []string `json:"source_paths,omitempty"`
	DestinationRoot string   `json:"destination_root,omitempty"`
}

type FlowerTransferManifest struct {
	FileCount      int   `json:"file_count"`
	DirectoryCount int   `json:"directory_count"`
	TotalBytes     int64 `json:"total_bytes"`
}

type FlowerTransferConflict struct {
	Path              string `json:"path"`
	Kind              string `json:"kind"`
	RecommendedAction string `json:"recommended_action"`
}

type FlowerTransferApproval struct {
	Required   bool   `json:"required"`
	State      string `json:"state"`
	ReasonCode string `json:"reason_code,omitempty"`
	PlanHash   string `json:"plan_hash"`
}

type FlowerHandoffEnvelope struct {
	HandoffID          string          `json:"handoff_id"`
	SourceHostID       string          `json:"source_host_id"`
	DestinationHostID  string          `json:"destination_host_id"`
	ThreadID           string          `json:"thread_id"`
	TranscriptSummary  string          `json:"transcript_summary"`
	ContextEnvelope    json.RawMessage `json:"context_envelope,omitempty"`
	TargetIDs          []string        `json:"target_ids"`
	PermissionSnapshot json.RawMessage `json:"permission_snapshot,omitempty"`
	ExpiresAtUnixMs    int64           `json:"expires_at_unix_ms"`
}

type HostPresence struct {
	SchemaVersion    int              `json:"schema_version"`
	HostID           string           `json:"host_id"`
	HostKind         string           `json:"host_kind"`
	CarrierKind      string           `json:"carrier_kind"`
	DisplayName      string           `json:"display_name"`
	State            string           `json:"state"`
	Endpoint         PresenceEndpoint `json:"endpoint"`
	Capabilities     []string         `json:"capabilities"`
	LastSeenAtUnixMs int64            `json:"last_seen_at_unix_ms"`
}

type PresenceEndpoint struct {
	Visibility string `json:"visibility"`
	BaseURL    string `json:"base_url,omitempty"`
}

type HandlerRef struct {
	HandlerID           string   `json:"handler_id"`
	HandlerKind         string   `json:"handler_kind"`
	DisplayName         string   `json:"display_name"`
	CarrierKind         string   `json:"carrier_kind,omitempty"`
	State               string   `json:"state"`
	SelectionSource     string   `json:"selection_source,omitempty"`
	SupportsThreadKinds []string `json:"supports_thread_kinds"`
	AllowedTargetIDs    []string `json:"allowed_target_ids"`
}

type UnavailableHandler struct {
	HandlerID      string `json:"handler_id"`
	HandlerKind    string `json:"handler_kind"`
	DisplayName    string `json:"display_name"`
	CarrierKind    string `json:"carrier_kind,omitempty"`
	State          string `json:"state"`
	DisabledReason string `json:"disabled_reason"`
}

type HandlerSelection struct {
	CanSwitch                       bool    `json:"can_switch"`
	LockReason                      *string `json:"lock_reason"`
	RequiresUserVisibleConfirmation bool    `json:"requires_user_visible_confirmation"`
}

type DecisionScope struct {
	ThreadKind        string  `json:"thread_kind"`
	ContextEnvelopeID *string `json:"context_envelope_id"`
	ClientSurface     string  `json:"client_surface"`
	PrimaryTargetID   *string `json:"primary_target_id"`
}

type UIChip struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Tone  string `json:"tone"`
}

type DecisionBlocker struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type RouterDecision struct {
	DecisionID          string               `json:"decision_id"`
	DecisionRevision    int64                `json:"decision_revision"`
	Route               string               `json:"route"`
	ReasonCode          string               `json:"reason_code"`
	SelectedHandler     *HandlerRef          `json:"selected_handler"`
	AvailableHandlers   []HandlerRef         `json:"available_handlers"`
	UnavailableHandlers []UnavailableHandler `json:"unavailable_handlers"`
	HandlerSelection    HandlerSelection     `json:"handler_selection"`
	DecisionScope       DecisionScope        `json:"decision_scope"`
	HostPresence        HostPresence         `json:"host_presence"`
	CurrentTargetID     string               `json:"current_target_id,omitempty"`
	AllowedActions      []string             `json:"allowed_actions"`
	UIChips             []UIChip             `json:"ui_chips"`
	PrimaryMessage      string               `json:"primary_message,omitempty"`
	Blocker             *DecisionBlocker     `json:"blocker"`
	CreatedAtUnixMs     int64                `json:"created_at_unix_ms"`
}

type ResolveRequest struct {
	ThreadKind         string  `json:"thread_kind,omitempty"`
	ContextEnvelopeID  *string `json:"context_envelope_id,omitempty"`
	ClientSurface      string  `json:"client_surface,omitempty"`
	PrimaryTargetID    *string `json:"primary_target_id,omitempty"`
	RequestedHandlerID string  `json:"requested_handler_id,omitempty"`
}

type HandlerSwitchRequest struct {
	PreviousDecisionID       string        `json:"previous_decision_id"`
	PreviousDecisionRevision int64         `json:"previous_decision_revision"`
	RequestedHandlerID       string        `json:"requested_handler_id"`
	DecisionScope            DecisionScope `json:"decision_scope"`
}

type ThreadCreateRequest struct {
	RequestID         string                 `json:"request_id,omitempty"`
	DecisionID        string                 `json:"decision_id"`
	DecisionRevision  int64                  `json:"decision_revision"`
	SelectedHandlerID string                 `json:"selected_handler_id"`
	ThreadKind        string                 `json:"thread_kind"`
	PrimaryTargetID   *string                `json:"primary_target_id,omitempty"`
	InitialMessage    string                 `json:"initial_message"`
	ContextEnvelope   *ContextEnvelopeHeader `json:"context_envelope,omitempty"`
	ClientSurface     string                 `json:"client_surface"`
}

type ContextEnvelopeHeader struct {
	ID       string          `json:"id"`
	Provider string          `json:"provider,omitempty"`
	Raw      json.RawMessage `json:"raw,omitempty"`
}

type ThreadCreateFailure struct {
	Success       bool              `json:"success"`
	Error         ThreadCreateError `json:"error"`
	FreshDecision *RouterDecision   `json:"fresh_decision"`
	ThreadID      *string           `json:"thread_id"`
}

type ThreadCreateError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ChatSendRequest struct {
	ThreadID          string                 `json:"thread_id,omitempty"`
	Prompt            string                 `json:"prompt"`
	ReplyMode         string                 `json:"reply_mode,omitempty"`
	DecisionID        string                 `json:"decision_id,omitempty"`
	DecisionRevision  int64                  `json:"decision_revision,omitempty"`
	SelectedHandlerID string                 `json:"selected_handler_id,omitempty"`
	ThreadKind        string                 `json:"thread_kind,omitempty"`
	PrimaryTargetID   *string                `json:"primary_target_id,omitempty"`
	ContextEnvelope   *ContextEnvelopeHeader `json:"context_envelope,omitempty"`
	ClientSurface     string                 `json:"client_surface,omitempty"`
	ContextAction     json.RawMessage        `json:"context_action,omitempty"`
}

type ChatMessage struct {
	ID          string             `json:"id"`
	Role        string             `json:"role"`
	Content     string             `json:"content"`
	Status      string             `json:"status"`
	CreatedAtMs int64              `json:"created_at_ms"`
	Blocks      []ChatMessageBlock `json:"blocks,omitempty"`
}

type ChatMessageBlock struct {
	Type          string                       `json:"type"`
	Content       string                       `json:"content,omitempty"`
	SchemaVersion int                          `json:"schema_version,omitempty"`
	RunID         string                       `json:"run_id,omitempty"`
	ThreadID      string                       `json:"thread_id,omitempty"`
	TurnID        string                       `json:"turn_id,omitempty"`
	TraceID       string                       `json:"trace_id,omitempty"`
	Summary       *observation.ActivitySummary `json:"summary,omitempty"`
	Items         []observation.ActivityItem   `json:"items,omitempty"`
}

type ChatRunError struct {
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

type ChatTodoSnapshot struct {
	Version     int64           `json:"version"`
	UpdatedAtMs int64           `json:"updated_at_ms"`
	Summary     ChatTodoSummary `json:"summary"`
	Todos       []ChatTodoItem  `json:"todos"`
}

type ChatTodoSummary struct {
	Total      int `json:"total"`
	Pending    int `json:"pending"`
	InProgress int `json:"in_progress"`
	Completed  int `json:"completed"`
	Cancelled  int `json:"cancelled"`
}

type ChatTodoItem struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Status  string `json:"status"`
	Note    string `json:"note,omitempty"`
}

type ChatInputRequest struct {
	PromptID         string              `json:"prompt_id"`
	MessageID        string              `json:"message_id"`
	ToolID           string              `json:"tool_id"`
	ToolName         string              `json:"tool_name"`
	ReasonCode       string              `json:"reason_code,omitempty"`
	RequiredFromUser []string            `json:"required_from_user,omitempty"`
	EvidenceRefs     []string            `json:"evidence_refs,omitempty"`
	Questions        []ChatInputQuestion `json:"questions"`
	PublicSummary    string              `json:"public_summary,omitempty"`
	ContainsSecret   bool                `json:"contains_secret,omitempty"`
}

type ChatInputQuestion struct {
	ID                string            `json:"id"`
	Header            string            `json:"header"`
	Question          string            `json:"question"`
	IsSecret          bool              `json:"is_secret,omitempty"`
	ResponseMode      string            `json:"response_mode"`
	ChoicesExhaustive *bool             `json:"choices_exhaustive,omitempty"`
	WriteLabel        string            `json:"write_label,omitempty"`
	WritePlaceholder  string            `json:"write_placeholder,omitempty"`
	Choices           []ChatInputChoice `json:"choices,omitempty"`
}

type ChatInputChoice struct {
	ChoiceID         string            `json:"choice_id"`
	Label            string            `json:"label"`
	Description      string            `json:"description,omitempty"`
	Kind             string            `json:"kind"`
	InputPlaceholder string            `json:"input_placeholder,omitempty"`
	Actions          []ChatInputAction `json:"actions,omitempty"`
}

type ChatInputAction struct {
	Type string `json:"type"`
	Mode string `json:"mode,omitempty"`
}

type ChatInputAnswer struct {
	ChoiceID string `json:"choice_id,omitempty"`
	Text     string `json:"text,omitempty"`
}

type ChatSubmitInputRequest struct {
	ThreadID string                     `json:"thread_id"`
	PromptID string                     `json:"prompt_id"`
	Answers  map[string]ChatInputAnswer `json:"answers"`
}

type ThreadActivitySnapshot struct {
	ActivityRevision    int64  `json:"activity_revision"`
	LastMessageAtUnixMs int64  `json:"last_message_at_unix_ms"`
	ActivitySignature   string `json:"activity_signature"`
	WaitingPromptID     string `json:"waiting_prompt_id,omitempty"`
}

type ThreadReadState struct {
	LastSeenActivityRevision  int64  `json:"last_seen_activity_revision"`
	LastReadMessageAtUnixMs   int64  `json:"last_read_message_at_unix_ms"`
	LastSeenActivitySignature string `json:"last_seen_activity_signature"`
	LastSeenWaitingPromptID   string `json:"last_seen_waiting_prompt_id,omitempty"`
}

type ThreadReadStatus struct {
	IsUnread  bool                   `json:"is_unread"`
	Snapshot  ThreadActivitySnapshot `json:"snapshot"`
	ReadState ThreadReadState        `json:"read_state"`
}

type ThreadSnapshot struct {
	ThreadID         string             `json:"thread_id"`
	Title            string             `json:"title"`
	ModelID          string             `json:"model_id"`
	WorkingDir       string             `json:"working_dir"`
	PinnedAtMs       int64              `json:"pinned_at_ms,omitempty"`
	CreatedAtMs      int64              `json:"created_at_ms"`
	UpdatedAtMs      int64              `json:"updated_at_ms"`
	Status           string             `json:"status"`
	Messages         []ChatMessage      `json:"messages"`
	ActivityTimeline []ChatMessageBlock `json:"activity_timeline,omitempty"`
	TodoSnapshot     *ChatTodoSnapshot  `json:"todo_snapshot,omitempty"`
	InputRequest     *ChatInputRequest  `json:"input_request,omitempty"`
	Error            *ChatRunError      `json:"error,omitempty"`
	HomeHostID       string             `json:"home_host_id,omitempty"`
	HomeHostKind     string             `json:"home_host_kind,omitempty"`
	SourceLabel      string             `json:"source_label"`
	TargetLabels     []string           `json:"target_labels"`
	ReadStatus       ThreadReadStatus   `json:"read_status"`
}

type ListThreadsResponse struct {
	Threads []ThreadSnapshot `json:"threads"`
}

type SendChatResponse struct {
	Thread        *ThreadSnapshot      `json:"thread,omitempty"`
	CreateFailure *ThreadCreateFailure `json:"create_failure,omitempty"`
}

type SubmitChatInputResponse struct {
	Thread *ThreadSnapshot `json:"thread"`
}

type ThreadMutationRequest struct {
	Title  *string `json:"title,omitempty"`
	Pinned *bool   `json:"pinned,omitempty"`
}

type ForkThreadRequest struct {
	Title string `json:"title,omitempty"`
}

type ThreadMutationResponse struct {
	Thread ThreadSnapshot `json:"thread"`
}

type ThreadReadResponse struct {
	Thread ThreadSnapshot `json:"thread"`
}

type ThreadReadRequest struct {
	Snapshot ThreadActivitySnapshot `json:"snapshot"`
}

type ForkThreadResponse struct {
	Thread ThreadSnapshot `json:"thread"`
}

type StartupReport struct {
	Status          string   `json:"status"`
	HostID          string   `json:"host_id"`
	HostKind        string   `json:"host_kind"`
	CarrierKind     string   `json:"carrier_kind"`
	BaseURL         string   `json:"base_url"`
	Token           string   `json:"token"`
	PID             int      `json:"pid"`
	StartedAtUnixMs int64    `json:"started_at_unix_ms"`
	StateDir        string   `json:"state_dir"`
	ThreadstorePath string   `json:"threadstore_path"`
	ConfigPath      string   `json:"config_path"`
	Configured      bool     `json:"configured"`
	ModelCount      int      `json:"model_count"`
	Capabilities    []string `json:"capabilities"`
}

type LockMetadata struct {
	SchemaVersion   int    `json:"schema_version"`
	HostID          string `json:"host_id"`
	HostKind        string `json:"host_kind"`
	CarrierKind     string `json:"carrier_kind"`
	BaseURL         string `json:"base_url"`
	Token           string `json:"token"`
	PID             int    `json:"pid"`
	StartedAtUnixMs int64  `json:"started_at_unix_ms"`
	StateDir        string `json:"state_dir"`
	ThreadstorePath string `json:"threadstore_path"`
	ConfigPath      string `json:"config_path"`
}

type BlockedStartupReport struct {
	Status  string `json:"status"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func unixMs() int64 {
	return time.Now().UnixMilli()
}

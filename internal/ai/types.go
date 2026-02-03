package ai

// This package defines the Go-side implementation of the Env App AI feature.
//
// Design notes:
// - The browser talks to the agent via the existing local gateway (`/_redeven_proxy/api/ai/*`) over Flowersec E2EE proxy.
// - The agent enforces permissions using authoritative session_meta (direct control channel), not browser-claimed flags.
// - The LLM orchestration runs in a TS sidecar process; the Go agent is the only authority that can execute tools.

import "time"

type Model struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

// --- HTTP API types (snake_case, stable) ---

type ModelsResponse struct {
	DefaultModel string  `json:"default_model"`
	Models       []Model `json:"models"`
}

type RunRequest struct {
	Model   string          `json:"model"`
	History []RunHistoryMsg `json:"history"`
	Input   RunInput        `json:"input"`
	Options RunOptions      `json:"options"`
}

type RunHistoryMsg struct {
	Role string `json:"role"`
	Text string `json:"text"`
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

// Convenience helpers for tool-call blocks (MessageBlock).

type ToolCallStatus string

const (
	ToolCallStatusPending ToolCallStatus = "pending"
	ToolCallStatusRunning ToolCallStatus = "running"
	ToolCallStatusSuccess ToolCallStatus = "success"
	ToolCallStatusError   ToolCallStatus = "error"
)

type ToolCallBlock struct {
	Type             string         `json:"type"` // "tool-call"
	ToolName         string         `json:"toolName"`
	ToolID           string         `json:"toolId"`
	Args             map[string]any `json:"args"`
	RequiresApproval bool           `json:"requiresApproval,omitempty"`
	ApprovalState    string         `json:"approvalState,omitempty"` // "required"|"approved"|"rejected"
	Status           ToolCallStatus `json:"status"`
	Result           any            `json:"result,omitempty"`
	Error            string         `json:"error,omitempty"`
	Children         []any          `json:"children,omitempty"`
	Collapsed        *bool          `json:"collapsed,omitempty"`
	StartedAt        *time.Time     `json:"-"`
}

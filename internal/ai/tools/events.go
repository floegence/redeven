package tools

import "time"

// EventKind is a normalized tool lifecycle event type.
type EventKind string

const (
	EventKindBegin    EventKind = "tool.begin"
	EventKindEnd      EventKind = "tool.end"
	EventKindError    EventKind = "tool.error"
	EventKindRecovery EventKind = "tool.recovery"
)

// Event is emitted by the orchestrator and can be forwarded to runtime streams / storage.
type Event struct {
	Kind     EventKind      `json:"kind"`
	RunID    string         `json:"run_id"`
	ToolID   string         `json:"tool_id"`
	ToolName string         `json:"tool_name"`
	AtUnixMs int64          `json:"at_unix_ms"`
	Payload  map[string]any `json:"payload,omitempty"`
}

func NewEvent(kind EventKind, runID string, toolID string, toolName string, payload map[string]any) Event {
	return Event{
		Kind:     kind,
		RunID:    runID,
		ToolID:   toolID,
		ToolName: toolName,
		AtUnixMs: time.Now().UnixMilli(),
		Payload:  payload,
	}
}

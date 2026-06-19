package tools

import "strings"

// ResultStatus is the normalized status returned by the Go tool runtime.
type ResultStatus string

const (
	ResultStatusSuccess    ResultStatus = "success"
	ResultStatusError      ResultStatus = "error"
	ResultStatusRecovering ResultStatus = "recovering"
)

// ErrorCode is a stable, machine-readable tool error code.
type ErrorCode string

const (
	ErrorCodeNotFound          ErrorCode = "NOT_FOUND"
	ErrorCodeInvalidPath       ErrorCode = "INVALID_PATH"
	ErrorCodeInvalidArguments  ErrorCode = "INVALID_ARGUMENTS"
	ErrorCodePermissionDenied  ErrorCode = "PERMISSION_DENIED"
	ErrorCodeTargetRequired    ErrorCode = "TARGET_REQUIRED"
	ErrorCodeTargetUnavailable ErrorCode = "TARGET_UNAVAILABLE"
	ErrorCodeTimeout           ErrorCode = "TIMEOUT"
	ErrorCodeCanceled          ErrorCode = "CANCELED"
	ErrorCodeUnknown           ErrorCode = "UNKNOWN"
)

// ToolError carries structured tool failure metadata.
type ToolError struct {
	Code           ErrorCode      `json:"code"`
	Message        string         `json:"message"`
	Retryable      bool           `json:"retryable,omitempty"`
	SuggestedFixes []string       `json:"suggested_fixes,omitempty"`
	NormalizedArgs map[string]any `json:"normalized_args,omitempty"`
	Meta           map[string]any `json:"meta,omitempty"`
}

func (e *ToolError) Normalize() {
	if e == nil {
		return
	}
	e.Message = strings.TrimSpace(e.Message)
	if e.Message == "" {
		e.Message = "Tool failed"
	}
	if e.Code == "" {
		e.Code = ErrorCodeUnknown
	}
	if len(e.SuggestedFixes) > 0 {
		out := make([]string, 0, len(e.SuggestedFixes))
		seen := make(map[string]struct{}, len(e.SuggestedFixes))
		for _, it := range e.SuggestedFixes {
			v := strings.TrimSpace(it)
			if v == "" {
				continue
			}
			if _, ok := seen[v]; ok {
				continue
			}
			seen[v] = struct{}{}
			out = append(out, v)
		}
		e.SuggestedFixes = out
	}
	if len(e.NormalizedArgs) == 0 {
		e.NormalizedArgs = nil
	}
	if len(e.Meta) == 0 {
		e.Meta = nil
	}
}

// ToolResultEnvelope is the normalized payload for tool call completion.
type ToolResultEnvelope struct {
	RunID  string       `json:"run_id"`
	ToolID string       `json:"tool_id"`
	Status ResultStatus `json:"status"`
	Result any          `json:"result,omitempty"`
	Error  *ToolError   `json:"error,omitempty"`
}

func (e *ToolResultEnvelope) Normalize() {
	if e == nil {
		return
	}
	e.RunID = strings.TrimSpace(e.RunID)
	e.ToolID = strings.TrimSpace(e.ToolID)
	if e.Status == "" {
		e.Status = ResultStatusError
	}
	if e.Error != nil {
		e.Error.Normalize()
	}
}

// ToolPresentationKind classifies a tool for compact chat activity rendering.
type ToolPresentationKind string

const (
	ToolPresentationContext     ToolPresentationKind = "context"
	ToolPresentationCommand     ToolPresentationKind = "command"
	ToolPresentationMutation    ToolPresentationKind = "mutation"
	ToolPresentationResearch    ToolPresentationKind = "research"
	ToolPresentationTodo        ToolPresentationKind = "todo"
	ToolPresentationDelegation  ToolPresentationKind = "delegation"
	ToolPresentationInteraction ToolPresentationKind = "interaction"
	ToolPresentationSignal      ToolPresentationKind = "signal"
)

// ToolGroupingPolicy describes how adjacent tool activity can be grouped in chat.
type ToolGroupingPolicy struct {
	Enabled        bool     `json:"enabled"`
	GroupKey       string   `json:"group_key"`
	MergeWindowMS  int64    `json:"merge_window_ms,omitempty"`
	MaxInlineItems int      `json:"max_inline_items,omitempty"`
	TargetFields   []string `json:"target_fields,omitempty"`
}

// ToolRedactionSpec records which fields must stay out of compact activity payloads.
type ToolRedactionSpec struct {
	ArgFields    []string `json:"arg_fields,omitempty"`
	ResultFields []string `json:"result_fields,omitempty"`
}

// ToolPresentationSpec is the runtime-owned display contract consumed by the chat UI.
type ToolPresentationSpec struct {
	Kind                ToolPresentationKind `json:"kind"`
	Risk                string               `json:"risk"` // readonly|mutating|approval|blocking
	Renderer            string               `json:"renderer"`
	Grouping            ToolGroupingPolicy   `json:"grouping"`
	Operation           string               `json:"operation,omitempty"`
	ActivityLabelFields []string             `json:"activity_label_fields,omitempty"`
	CallLabelFallback   string               `json:"call_label_fallback,omitempty"`
	ResultLabelFallback string               `json:"result_label_fallback,omitempty"`
	CallPayloadFields   []string             `json:"call_payload_fields,omitempty"`
	ResultPayloadFields []string             `json:"result_payload_fields,omitempty"`
	ChipFields          []string             `json:"chip_fields,omitempty"`
	DetailKinds         []string             `json:"detail_kinds,omitempty"`
	Redaction           ToolRedactionSpec    `json:"redaction,omitempty"`
	SummaryVersion      int                  `json:"summary_version"`
}

// Definition describes built-in tool properties used by policies.
type Definition struct {
	Name             string
	Mutating         bool
	RequiresApproval bool
	Presentation     ToolPresentationSpec
}

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
	ErrorCodeNotFound         ErrorCode = "NOT_FOUND"
	ErrorCodeInvalidPath      ErrorCode = "INVALID_PATH"
	ErrorCodePermissionDenied ErrorCode = "PERMISSION_DENIED"
	ErrorCodeTimeout          ErrorCode = "TIMEOUT"
	ErrorCodeCanceled         ErrorCode = "CANCELED"
	ErrorCodeUnknown          ErrorCode = "UNKNOWN"
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

// Definition describes built-in tool properties used by policies.
type Definition struct {
	Name             string
	Mutating         bool
	RequiresApproval bool
}

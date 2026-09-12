package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

const (
	ToolTargetModeLocalRuntime   = "local_runtime"
	ToolTargetModeExplicitTarget = "explicit_target"
)

type ToolTargetPolicy struct {
	Mode             string   `json:"mode"`
	DefaultTargetID  string   `json:"default_target_id,omitempty"`
	AllowedTargetIDs []string `json:"allowed_target_ids,omitempty"`
}

// TargetDescriptor is the user-facing identity and capability snapshot for a
// computer-use target. The executor owns the actual target session; the
// registry only resolves logical aliases and prevents cross-target routing.
type TargetDescriptor struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	DisplayName     string   `json:"display_name"`
	Locality        string   `json:"locality"`
	Capabilities    []string `json:"capabilities,omitempty"`
	Ready           bool     `json:"ready"`
	PermissionState string   `json:"permission_state,omitempty"`
	CurrentURL      string   `json:"current_url,omitempty"`
	AppBundleID     string   `json:"app_bundle_id,omitempty"`
}

// TargetResolver maps the model-safe "current" alias to an executor target.
// It is deliberately separate from TargetToolExecutor so target selection is
// observable and testable without starting a browser or desktop helper.
type TargetResolver interface {
	ResolveTarget(ctx context.Context, alias string) (TargetDescriptor, error)
}

// InteractionSafetyDecision is the policy result immediately before a target
// action is executed. A safety gate may request user takeover, but it can
// never authorize an action that the existing permission policy rejected.
type InteractionSafetyDecision struct {
	ActionID          string   `json:"action_id"`
	Level             string   `json:"level"`
	ReasonCodes       []string `json:"reason_codes,omitempty"`
	Confidence        float64  `json:"confidence,omitempty"`
	SafeToCapture     bool     `json:"safe_to_capture"`
	SafeToSendToModel bool     `json:"safe_to_send_to_model"`
	ConfirmationScope string   `json:"confirmation_scope,omitempty"`
}

// InteractionSafetyGate is called for every computer/browser action. The
// default implementation is conservative for secrets and external side
// effects while allowing ordinary observation and navigation.
type InteractionSafetyGate interface {
	AssessInteraction(ctx context.Context, call TargetToolCall, target TargetDescriptor) (InteractionSafetyDecision, error)
}

var ErrInteractionTakeoverRequired = errors.New("interaction takeover required")

type defaultInteractionSafetyGate struct{}

func (defaultInteractionSafetyGate) AssessInteraction(_ context.Context, call TargetToolCall, target TargetDescriptor) (InteractionSafetyDecision, error) {
	decision := InteractionSafetyDecision{
		ActionID:          strings.TrimSpace(call.ToolCallID),
		Level:             "routine",
		Confidence:        1,
		SafeToCapture:     true,
		SafeToSendToModel: true,
	}
	if !target.Ready && strings.TrimSpace(target.ID) != "" {
		decision.Level = "block"
		decision.ReasonCodes = []string{"target_unavailable"}
		return decision, errors.New("target is unavailable")
	}
	pageSignal := strings.ToLower(strings.TrimSpace(target.CurrentURL))
	if call.ToolName != "computer.screenshot" && call.ToolName != "computer.wait" &&
		(strings.Contains(pageSignal, "login") || strings.Contains(pageSignal, "signin") || strings.Contains(pageSignal, "captcha") || strings.Contains(pageSignal, "challenge")) {
		decision.Level = "takeover"
		decision.ReasonCodes = []string{"login_or_captcha"}
		decision.SafeToCapture = false
		decision.SafeToSendToModel = false
		return decision, ErrInteractionTakeoverRequired
	}
	if call.ToolName == "computer.type" {
		var args map[string]any
		if json.Unmarshal(call.Arguments, &args) == nil {
			text := strings.ToLower(strings.TrimSpace(anyToString(args["text"])))
			if strings.Contains(text, "password") || strings.Contains(text, "one-time code") {
				decision.Level = "takeover"
				decision.ReasonCodes = []string{"secret_input"}
				decision.SafeToCapture = false
				decision.SafeToSendToModel = false
				return decision, ErrInteractionTakeoverRequired
			}
		}
	}
	return decision, nil
}

func normalizeToolTargetPolicy(in ToolTargetPolicy) ToolTargetPolicy {
	mode := strings.TrimSpace(strings.ToLower(in.Mode))
	switch mode {
	case "", ToolTargetModeLocalRuntime:
		mode = ToolTargetModeLocalRuntime
	case ToolTargetModeExplicitTarget:
	default:
		mode = ToolTargetModeExplicitTarget
	}
	defaultTargetID := strings.TrimSpace(in.DefaultTargetID)
	allowedTargetIDs := normalizedTargetIDs(in.AllowedTargetIDs)
	if defaultTargetID != "" && len(allowedTargetIDs) == 0 {
		allowedTargetIDs = []string{defaultTargetID}
	}
	return ToolTargetPolicy{
		Mode:             mode,
		DefaultTargetID:  defaultTargetID,
		AllowedTargetIDs: allowedTargetIDs,
	}
}

func (p ToolTargetPolicy) requiresExplicitTarget() bool {
	return normalizeToolTargetPolicy(p).Mode == ToolTargetModeExplicitTarget
}

type TargetToolExecutor interface {
	ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error)
}

// TargetToolAttachmentResolver expands opaque media references returned by a
// target executor. Bytes stay owned by the executor and are never persisted in
// tool results or provider state.
type TargetToolAttachmentResolver interface {
	ResolveTargetToolAttachment(ctx context.Context, resourceRef string) ([]byte, error)
}

type TargetToolCall struct {
	ToolCallID           string          `json:"tool_call_id"`
	TargetID             string          `json:"target_id"`
	ToolName             string          `json:"tool_name"`
	Arguments            json.RawMessage `json:"arguments"`
	RequiredCapabilities []string        `json:"required_capabilities"`
}

type TargetToolResult struct {
	TargetID          string                     `json:"target_id"`
	TargetName        string                     `json:"target_name,omitempty"`
	ExecutionLocation string                     `json:"execution_location,omitempty"`
	ActionSummary     string                     `json:"action_summary,omitempty"`
	Safety            *InteractionSafetyDecision `json:"safety,omitempty"`
	Result            any                        `json:"result,omitempty"`
	Attachments       []TargetToolAttachment     `json:"attachments,omitempty"`
}

type TargetToolAttachment struct {
	ResourceRef string `json:"resource_ref"`
	Name        string `json:"name,omitempty"`
	MIMEType    string `json:"mime_type"`
	SizeBytes   int64  `json:"size_bytes,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
}

func toolRequiresTarget(toolName string) bool {
	toolName = strings.TrimSpace(toolName)
	switch toolName {
	case "file.read", "read_file", "file.edit", "file.write", "apply_patch",
		"computer.screenshot", "computer.click", "computer.double_click", "computer.type", "computer.key", "computer.scroll", "computer.wait",
		"browser.navigate", "browser.back", "browser.reload":
		return true
	}
	return false
}

func isComputerUseTool(toolName string) bool {
	switch strings.TrimSpace(toolName) {
	case "computer.screenshot", "computer.click", "computer.double_click", "computer.type", "computer.key", "computer.scroll", "computer.wait", "browser.navigate", "browser.back", "browser.reload":
		return true
	default:
		return false
	}
}

func requiredTargetCapabilities(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "file.read", "read_file":
		return []string{"read"}
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}
	case "computer.screenshot":
		return []string{"observe"}
	case "computer.click", "computer.double_click", "computer.type", "computer.key", "computer.scroll", "computer.wait",
		"browser.navigate", "browser.back", "browser.reload":
		return []string{"interaction"}
	default:
		return nil
	}
}

func StripTargetToolArgs(args map[string]any) map[string]any {
	out := make(map[string]any, len(args))
	for key, value := range args {
		switch strings.TrimSpace(key) {
		case "target_id", "targetId":
			continue
		default:
			out[key] = value
		}
	}
	return out
}

func targetIDFromToolArgs(args map[string]any) string {
	for _, key := range []string{"target_id", "targetId"} {
		if raw, ok := args[key]; ok {
			if value := strings.TrimSpace(anyToString(raw)); value != "" {
				return value
			}
		}
	}
	return ""
}

func targetAllowedByPolicy(policy ToolTargetPolicy, targetID string) bool {
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return false
	}
	normalized := normalizeToolTargetPolicy(policy)
	if len(normalized.AllowedTargetIDs) == 0 {
		return true
	}
	for _, allowed := range normalized.AllowedTargetIDs {
		if strings.TrimSpace(allowed) == targetID {
			return true
		}
	}
	return false
}

func normalizedTargetIDs(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		seen := false
		for _, existing := range out {
			if existing == value {
				seen = true
				break
			}
		}
		if !seen {
			out = append(out, value)
		}
	}
	return out
}

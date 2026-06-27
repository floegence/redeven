package ai

import (
	"errors"
	"strings"
)

const ContextActionSchemaVersion = 2

var ErrInvalidContextAction = errors.New("invalid context action")

const (
	contextActionAskFlowerID       = "assistant.ask.flower"
	contextActionFlowerProvider    = "flower"
	contextActionLocalityAuto      = "auto"
	contextActionLocalityCurrent   = "current_runtime"
	contextActionLocalityRemote    = "remote_runtime"
	contextActionLocalityLocal     = "local_model_remote_target"
	contextActionRuntimeHintAuto   = "auto"
	contextActionRuntimeHintLocal  = "local_environment"
	contextActionRuntimeHintEnv    = "env_local"
	contextActionSessionLocal      = "local_runtime"
	contextActionSessionProvider   = "provider_environment"
	contextActionSessionSSH        = "ssh_environment"
	contextActionSessionExternal   = "external_local_ui"
	contextActionSessionGateway    = "runtime_gateway"
	contextActionSessionSandbox    = "region_sandbox"
	contextActionSurfaceWelcomeEnv = "desktop_welcome_environment_card"
	contextActionSurfaceFile       = "file_browser"
	contextActionSurfaceTerminal   = "terminal"
	contextActionSurfacePreview    = "file_preview"
	contextActionSurfaceMonitoring = "monitoring"
	contextActionSurfaceGit        = "git_browser"
	contextActionSurfaceEditor     = "editor_preview"
)

type ContextActionEnvelope struct {
	SchemaVersion       int                         `json:"schema_version"`
	ActionID            string                      `json:"action_id"`
	Provider            string                      `json:"provider,omitempty"`
	Target              ContextActionTarget         `json:"target"`
	Source              ContextActionSource         `json:"source"`
	ExecutionContext    *ContextActionExecutionHint `json:"execution_context,omitempty"`
	Context             []ContextActionContextItem  `json:"context"`
	Presentation        ContextActionPresentation   `json:"presentation"`
	SuggestedWorkingDir string                      `json:"suggested_working_dir_abs,omitempty"`
}

type ContextActionTarget struct {
	TargetID string `json:"target_id"`
	Locality string `json:"locality"`
}

type ContextActionSource struct {
	Surface   string `json:"surface"`
	SurfaceID string `json:"surface_id,omitempty"`
}

type ContextActionExecutionHint struct {
	CurrentTargetID   string `json:"current_target_id,omitempty"`
	SourceEnvPublicID string `json:"source_env_public_id,omitempty"`
	RuntimeHint       string `json:"runtime_hint,omitempty"`
	SessionSource     string `json:"session_source,omitempty"`
}

type ContextActionPresentation struct {
	Label          string `json:"label"`
	Priority       int    `json:"priority"`
	StatusLabel    string `json:"status_label,omitempty"`
	DisabledReason string `json:"disabled_reason,omitempty"`
}

type ContextActionContextItem struct {
	Kind           string  `json:"kind"`
	Path           string  `json:"path,omitempty"`
	IsDirectory    bool    `json:"is_directory,omitempty"`
	RootLabel      string  `json:"root_label,omitempty"`
	Selection      string  `json:"selection,omitempty"`
	SelectionChars int     `json:"selection_chars,omitempty"`
	WorkingDir     string  `json:"working_dir,omitempty"`
	PID            int     `json:"pid,omitempty"`
	Name           string  `json:"name,omitempty"`
	Username       string  `json:"username,omitempty"`
	CPUPercent     float64 `json:"cpu_percent,omitempty"`
	MemoryBytes    int64   `json:"memory_bytes,omitempty"`
	Platform       string  `json:"platform,omitempty"`
	CapturedAtMs   int64   `json:"captured_at_ms,omitempty"`
	Title          string  `json:"title,omitempty"`
	Detail         string  `json:"detail,omitempty"`
	Content        string  `json:"content,omitempty"`
}

func normalizeContextActionEnvelope(in *ContextActionEnvelope) *ContextActionEnvelope {
	if in == nil {
		return nil
	}
	out := *in
	out.SchemaVersion = ContextActionSchemaVersion
	out.ActionID = strings.TrimSpace(out.ActionID)
	out.Provider = strings.TrimSpace(out.Provider)
	out.Target = ContextActionTarget{
		TargetID: strings.TrimSpace(out.Target.TargetID),
		Locality: strings.TrimSpace(out.Target.Locality),
	}
	out.Source = ContextActionSource{
		Surface:   strings.TrimSpace(out.Source.Surface),
		SurfaceID: strings.TrimSpace(out.Source.SurfaceID),
	}
	if out.ExecutionContext != nil {
		hint := *out.ExecutionContext
		hint.CurrentTargetID = strings.TrimSpace(hint.CurrentTargetID)
		hint.SourceEnvPublicID = strings.TrimSpace(hint.SourceEnvPublicID)
		hint.RuntimeHint = strings.TrimSpace(hint.RuntimeHint)
		hint.SessionSource = strings.TrimSpace(hint.SessionSource)
		out.ExecutionContext = &hint
	}
	out.Presentation = ContextActionPresentation{
		Label:          strings.TrimSpace(out.Presentation.Label),
		Priority:       out.Presentation.Priority,
		StatusLabel:    strings.TrimSpace(out.Presentation.StatusLabel),
		DisabledReason: strings.TrimSpace(out.Presentation.DisabledReason),
	}
	out.SuggestedWorkingDir = strings.TrimSpace(out.SuggestedWorkingDir)
	out.Context = normalizeContextActionItems(out.Context)
	if out.ActionID == "" || out.Target.TargetID == "" || out.Target.Locality == "" || out.Source.Surface == "" {
		return nil
	}
	return &out
}

func normalizeAskFlowerContextActionEnvelope(in *ContextActionEnvelope) (*ContextActionEnvelope, error) {
	if in != nil && in.SchemaVersion != ContextActionSchemaVersion {
		return nil, ErrInvalidContextAction
	}
	out := normalizeContextActionEnvelope(in)
	if in == nil {
		return nil, nil
	}
	if out == nil {
		return nil, ErrInvalidContextAction
	}
	if out.ActionID != contextActionAskFlowerID ||
		out.Provider != contextActionFlowerProvider {
		return nil, ErrInvalidContextAction
	}
	switch out.Target.Locality {
	case contextActionLocalityAuto, contextActionLocalityCurrent, contextActionLocalityRemote, contextActionLocalityLocal:
	default:
		return nil, ErrInvalidContextAction
	}
	switch out.Source.Surface {
	case contextActionSurfaceWelcomeEnv,
		contextActionSurfaceFile,
		contextActionSurfaceTerminal,
		contextActionSurfacePreview,
		contextActionSurfaceMonitoring,
		contextActionSurfaceGit,
		contextActionSurfaceEditor:
	default:
		return nil, ErrInvalidContextAction
	}
	if out.ExecutionContext != nil {
		switch out.ExecutionContext.RuntimeHint {
		case "", contextActionRuntimeHintAuto, contextActionRuntimeHintLocal, contextActionRuntimeHintEnv:
		default:
			return nil, ErrInvalidContextAction
		}
		switch out.ExecutionContext.SessionSource {
		case "", contextActionSessionLocal, contextActionSessionProvider, contextActionSessionSSH, contextActionSessionExternal, contextActionSessionGateway, contextActionSessionSandbox:
		default:
			return nil, ErrInvalidContextAction
		}
	}
	return out, nil
}

func normalizeContextActionItems(items []ContextActionContextItem) []ContextActionContextItem {
	if len(items) == 0 {
		return nil
	}
	out := make([]ContextActionContextItem, 0, len(items))
	for _, item := range items {
		normalized := ContextActionContextItem{
			Kind:           strings.TrimSpace(item.Kind),
			Path:           strings.TrimSpace(item.Path),
			IsDirectory:    item.IsDirectory,
			RootLabel:      strings.TrimSpace(item.RootLabel),
			Selection:      item.Selection,
			SelectionChars: item.SelectionChars,
			WorkingDir:     strings.TrimSpace(item.WorkingDir),
			PID:            item.PID,
			Name:           strings.TrimSpace(item.Name),
			Username:       strings.TrimSpace(item.Username),
			CPUPercent:     item.CPUPercent,
			MemoryBytes:    item.MemoryBytes,
			Platform:       strings.TrimSpace(item.Platform),
			CapturedAtMs:   item.CapturedAtMs,
			Title:          strings.TrimSpace(item.Title),
			Detail:         strings.TrimSpace(item.Detail),
			Content:        item.Content,
		}
		if normalized.Kind == "" {
			continue
		}
		out = append(out, normalized)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func contextActionRunEventPayload(action *ContextActionEnvelope) map[string]any {
	var err error
	action, err = normalizeAskFlowerContextActionEnvelope(action)
	if err != nil || action == nil {
		return nil
	}
	payload := map[string]any{
		"schema_version":            action.SchemaVersion,
		"action_id":                 action.ActionID,
		"provider":                  action.Provider,
		"target_id":                 action.Target.TargetID,
		"locality":                  action.Target.Locality,
		"source_surface":            action.Source.Surface,
		"source_surface_id":         action.Source.SurfaceID,
		"context_item_count":        len(action.Context),
		"suggested_working_dir_abs": action.SuggestedWorkingDir,
	}
	if action.ExecutionContext != nil {
		payload["execution_context"] = map[string]any{
			"current_target_id":    action.ExecutionContext.CurrentTargetID,
			"source_env_public_id": action.ExecutionContext.SourceEnvPublicID,
			"runtime_hint":         action.ExecutionContext.RuntimeHint,
			"session_source":       action.ExecutionContext.SessionSource,
		}
	}
	return payload
}

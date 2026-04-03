package ai

import (
	"strings"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
)

type RunProtocolSurface string

const (
	RunProtocolSurfaceLegacySignals     RunProtocolSurface = "legacy_signals"
	RunProtocolSurfaceStructuredFileOps RunProtocolSurface = "structured_fileops"
)

type RunCompletionMode string

const (
	RunCompletionModeExplicitSignal  RunCompletionMode = "explicit_signal"
	RunCompletionModeRuntimeCloseout RunCompletionMode = "runtime_closeout"
)

type RunWaitingMode string

const (
	RunWaitingModeAskUser      RunWaitingMode = "ask_user"
	RunWaitingModeExitPlanMode RunWaitingMode = "exit_plan_mode"
)

type RunProtocolProfile struct {
	Surface          RunProtocolSurface `json:"surface"`
	CompletionMode   RunCompletionMode  `json:"completion_mode"`
	WaitingMode      RunWaitingMode     `json:"waiting_mode"`
	AllowPatchTool   bool               `json:"allow_patch_tool"`
	AllowSignalTools bool               `json:"allow_signal_tools"`
}

func normalizeRunProtocolProfile(profile RunProtocolProfile) RunProtocolProfile {
	out := profile
	switch strings.TrimSpace(string(out.Surface)) {
	case string(RunProtocolSurfaceStructuredFileOps):
		out.Surface = RunProtocolSurfaceStructuredFileOps
	default:
		out.Surface = RunProtocolSurfaceLegacySignals
	}
	switch strings.TrimSpace(string(out.CompletionMode)) {
	case string(RunCompletionModeRuntimeCloseout):
		out.CompletionMode = RunCompletionModeRuntimeCloseout
	default:
		out.CompletionMode = RunCompletionModeExplicitSignal
	}
	switch strings.TrimSpace(string(out.WaitingMode)) {
	case string(RunWaitingModeExitPlanMode):
		out.WaitingMode = RunWaitingModeExitPlanMode
	default:
		out.WaitingMode = RunWaitingModeAskUser
	}
	return out
}

func defaultLegacyProtocolProfile() RunProtocolProfile {
	return normalizeRunProtocolProfile(RunProtocolProfile{
		Surface:          RunProtocolSurfaceLegacySignals,
		CompletionMode:   RunCompletionModeExplicitSignal,
		WaitingMode:      RunWaitingModeAskUser,
		AllowPatchTool:   true,
		AllowSignalTools: true,
	})
}

func defaultStructuredProtocolProfile() RunProtocolProfile {
	return normalizeRunProtocolProfile(RunProtocolProfile{
		Surface:          RunProtocolSurfaceStructuredFileOps,
		CompletionMode:   RunCompletionModeRuntimeCloseout,
		WaitingMode:      RunWaitingModeExitPlanMode,
		AllowPatchTool:   true,
		AllowSignalTools: true,
	})
}

func resolveRunProtocolProfile(capability contextmodel.ModelCapability) RunProtocolProfile {
	capability = contextmodel.NormalizeCapability(capability)
	if !capability.SupportsTools {
		return defaultLegacyProtocolProfile()
	}
	return defaultStructuredProtocolProfile()
}

func (p RunProtocolProfile) eventPayload() map[string]any {
	normalized := normalizeRunProtocolProfile(p)
	return map[string]any{
		"surface":            normalized.Surface,
		"completion_mode":    normalized.CompletionMode,
		"waiting_mode":       normalized.WaitingMode,
		"allow_patch_tool":   normalized.AllowPatchTool,
		"allow_signal_tools": normalized.AllowSignalTools,
	}
}

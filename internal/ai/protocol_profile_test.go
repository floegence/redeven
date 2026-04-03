package ai

import (
	"testing"

	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
)

func TestResolveRunProtocolProfile_DefaultsToStructuredFileOps(t *testing.T) {
	t.Parallel()

	profile := resolveRunProtocolProfile(contextmodel.ModelCapability{
		SupportsTools: true,
	})
	if profile.Surface != RunProtocolSurfaceStructuredFileOps {
		t.Fatalf("surface=%q, want %q", profile.Surface, RunProtocolSurfaceStructuredFileOps)
	}
	if profile.CompletionMode != RunCompletionModeRuntimeCloseout {
		t.Fatalf("completion_mode=%q, want %q", profile.CompletionMode, RunCompletionModeRuntimeCloseout)
	}
	if profile.WaitingMode != RunWaitingModeExitPlanMode {
		t.Fatalf("waiting_mode=%q, want %q", profile.WaitingMode, RunWaitingModeExitPlanMode)
	}
	if !profile.AllowPatchTool || !profile.AllowSignalTools {
		t.Fatalf("expected compatibility tools to remain enabled: %+v", profile)
	}
}

func TestResolveRunProtocolProfile_FallsBackToLegacyWhenToolsUnavailable(t *testing.T) {
	t.Parallel()

	profile := resolveRunProtocolProfile(contextmodel.ModelCapability{
		SupportsTools: false,
	})
	if profile.Surface != RunProtocolSurfaceLegacySignals {
		t.Fatalf("surface=%q, want %q", profile.Surface, RunProtocolSurfaceLegacySignals)
	}
	if profile.CompletionMode != RunCompletionModeExplicitSignal {
		t.Fatalf("completion_mode=%q, want %q", profile.CompletionMode, RunCompletionModeExplicitSignal)
	}
	if profile.WaitingMode != RunWaitingModeAskUser {
		t.Fatalf("waiting_mode=%q, want %q", profile.WaitingMode, RunWaitingModeAskUser)
	}
}

func TestResolveRunCapabilityContract_StructuredInteractiveIncludesExitPlanMode(t *testing.T) {
	t.Parallel()

	profile := defaultStructuredProtocolProfile()
	contract := resolveRunCapabilityContract(&run{}, profile, []ToolDef{
		{Name: "file.read"},
		{Name: "file.write"},
		{Name: "task_complete"},
		{Name: "ask_user"},
		{Name: "exit_plan_mode"},
	}, false)

	if !contract.AllowUserInteraction {
		t.Fatalf("expected interactive contract")
	}
	for _, want := range []string{"task_complete", "ask_user", "exit_plan_mode"} {
		if !containsString(contract.AllowedSignals, want) {
			t.Fatalf("allowed_signals=%v, want %q", contract.AllowedSignals, want)
		}
	}
	if contract.ProtocolProfile.Surface != RunProtocolSurfaceStructuredFileOps {
		t.Fatalf("protocol surface=%q, want %q", contract.ProtocolProfile.Surface, RunProtocolSurfaceStructuredFileOps)
	}
	payload := contract.eventPayload()
	if got := payload["protocol_surface"]; got != RunProtocolSurfaceStructuredFileOps {
		t.Fatalf("event payload protocol_surface=%v, want %q", got, RunProtocolSurfaceStructuredFileOps)
	}
}

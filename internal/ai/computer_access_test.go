package ai

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestComputerFullAccessIncludesForegroundWithoutSeparateGrants(t *testing.T) {
	runtime, executor, store, _ := computerBindingFixture(t)
	call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}
	if _, err := runtime.ExecuteTargetTool(t.Context(), call); err != nil {
		t.Fatal(err)
	}
	if !executor.calls[0].allowForeground || !executor.calls[0].fullAccess {
		t.Fatal("full access still requires a separate foreground grant")
	}
	access, err := store.GetComputerAccess(t.Context(), call.ThreadID)
	if err != nil || len(access.Origins) != 0 || len(access.Apps) != 0 || access.AllowForeground {
		t.Fatalf("effective authorization must not create durable per-resource grants: %+v %v", access, err)
	}
}

func TestComputerAccessKeepsAdmittedModeAndRechecksResourceGrants(t *testing.T) {
	for _, admitted := range []string{"full_access", "approval_required", "readonly"} {
		t.Run(admitted, func(t *testing.T) {
			runtime, executor, store, _ := computerBindingFixture(t)
			seedComputerTurnAuthority(t, store, "thread-first", "admitted", admitted)
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "admitted", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}
			grants := ComputerAccess{Origins: []string{"https://example.test"}, Apps: []string{"dev.Notes"}}
			for _, mode := range []string{"full_access", "approval_required", "readonly"} {
				if err := store.UpdateThreadPermissionType(t.Context(), "env", call.ThreadID, mode); err != nil {
					t.Fatal(err)
				}
				for _, access := range []ComputerAccess{grants, {}} {
					if err := store.SetComputerAccess(t.Context(), call.ThreadID, access); err != nil {
						t.Fatal(err)
					}
					if _, err := runtime.ExecuteTargetTool(t.Context(), call); err != nil {
						t.Fatal(err)
					}
					got := executor.calls[len(executor.calls)-1]
					if got.fullAccess != (admitted == "full_access") || got.allowForeground != got.fullAccess {
						t.Fatalf("default %s changed admitted %s: %+v", mode, admitted, got)
					}
					if !got.fullAccess && (!reflect.DeepEqual(got.allowedOrigins, access.Origins) || !reflect.DeepEqual(got.allowedApps, access.Apps)) {
						t.Fatalf("resource grants were not rechecked: %+v", got)
					}
				}
			}
		})
	}
}

func TestComputerAccessRejectsMissingTurnAuthority(t *testing.T) {
	runtime, executor, _, _ := computerBindingFixture(t)
	if _, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: "thread-first", TurnID: "missing", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}); err == nil {
		t.Fatal("missing admitted authority accepted")
	}
	if len(executor.calls) != 0 {
		t.Fatal("rejected call reached adapter")
	}
}

func TestComputerFullAccessKeepsExecutionAndAuthorityChecks(t *testing.T) {
	runtime, executor, store, _ := computerBindingFixture(t)
	call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}
	denied := errors.New("invocation denied")
	call.revalidate = func(context.Context) error { return denied }
	if _, err := runtime.ExecuteTargetTool(t.Context(), call); !errors.Is(err, denied) {
		t.Fatalf("full access bypassed invocation authorization: %v", err)
	}
	call.revalidate = nil
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ExecuteTargetTool(t.Context(), call); err == nil {
		t.Fatal("missing task policy accepted")
	}
	if len(executor.calls) != 0 {
		t.Fatal("rejected call reached adapter")
	}
}

func TestComputerFullAccessRechecksAnExistingPermissionPause(t *testing.T) {
	for _, full := range []bool{false, true} {
		t.Run(map[bool]string{true: "full", false: "scoped"}[full], func(t *testing.T) {
			runtime, executor, store, _ := computerBindingFixture(t)
			turn := "turn"
			if !full {
				turn = "scoped-turn"
				seedComputerTurnAuthority(t, store, "thread-first", turn, "approval_required")
			}
			control := runtime.controlForTarget("browser-main")
			control.threadID, control.turnID, control.runID = "thread-first", turn, "run"
			control.pauseForUser()
			control.pause = &InteractionSafetyDecision{Level: "takeover", RequiredOrigin: "https://example.test", RequiredApp: "dev.Notes", ReasonCodes: []string{"foreground_permission"}}
			call := TargetToolCall{ThreadID: "thread-first", TurnID: turn, RunID: "run", TargetID: "browser-main", ToolName: "computer.screenshot", controlReturn: true}
			_, err := runtime.ExecuteTargetTool(t.Context(), call)
			if full {
				var unavailable *TargetStartupError
				if len(executor.calls) != 1 || !errors.As(err, &unavailable) || unavailable.Reason != "control_observation_unavailable" {
					t.Fatalf("full access must reach the adapter and still require a valid observation: %v", err)
				}
			} else if err == nil || len(executor.calls) != 0 {
				t.Fatal("scoped access bypassed missing grants")
			}
		})
	}
}

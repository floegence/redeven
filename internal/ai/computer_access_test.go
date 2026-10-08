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
	if _, err := runtime.ExecuteTargetTool(computerPermissionContext(t, "full_access"), call); err != nil {
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

func TestComputerAccessUsesInvocationSnapshotAndRechecksResourceGrants(t *testing.T) {
	for _, invocationMode := range []string{"full_access", "approval_required", "readonly"} {
		t.Run(invocationMode, func(t *testing.T) {
			runtime, executor, store, _ := computerBindingFixture(t)
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}
			grants := ComputerAccess{Origins: []string{"https://example.test"}, Apps: []string{"dev.Notes"}}
			for _, mode := range []string{"full_access", "approval_required", "readonly"} {
				if err := store.UpdateThreadPermissionType(t.Context(), "env", call.ThreadID, mode); err != nil {
					t.Fatal(err)
				}
				for _, access := range []ComputerAccess{grants, {}} {
					if err := store.SetComputerAccess(t.Context(), call.ThreadID, access); err != nil {
						t.Fatal(err)
					}
					if _, err := runtime.ExecuteTargetTool(computerPermissionContext(t, invocationMode), call); err != nil {
						t.Fatal(err)
					}
					got := executor.calls[len(executor.calls)-1]
					if got.fullAccess != (invocationMode == "full_access") || got.allowForeground != got.fullAccess {
						t.Fatalf("saved mode %s changed invocation snapshot %s: %+v", mode, invocationMode, got)
					}
					if !got.fullAccess && (!reflect.DeepEqual(got.allowedOrigins, access.Origins) || !reflect.DeepEqual(got.allowedApps, access.Apps)) {
						t.Fatalf("resource grants were not rechecked: %+v", got)
					}
				}
			}
		})
	}
}

func TestComputerAccessRejectsMissingInvocationSnapshot(t *testing.T) {
	runtime, executor, _, _ := computerBindingFixture(t)
	if _, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{ThreadID: "thread-first", TurnID: "missing", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}); err == nil {
		t.Fatal("missing invocation snapshot accepted")
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
	if _, err := runtime.ExecuteTargetTool(computerPermissionContext(t, "full_access"), call); !errors.Is(err, denied) {
		t.Fatalf("full access bypassed invocation authorization: %v", err)
	}
	call.revalidate = nil
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.ExecuteTargetTool(computerPermissionContext(t, "full_access"), call); err == nil {
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
				if err := store.UpdateThreadPermissionType(t.Context(), "env", "thread-first", "approval_required"); err != nil {
					t.Fatal(err)
				}
			}
			control := runtime.controlForTarget("browser-main")
			control.threadID, control.turnID, control.runID = "thread-first", turn, "run"
			control.pauseForUser()
			control.pause = &InteractionSafetyDecision{Level: "takeover", RequiredOrigin: "https://example.test", RequiredApp: "dev.Notes", ReasonCodes: []string{"foreground_permission"}}
			call := TargetToolCall{ThreadID: "thread-first", TurnID: turn, RunID: "run", TargetID: "browser-main", ToolName: "computer.screenshot", interactionID: "resolved-input"}
			runtime.resumeComputerControl(call, call.RunID)
			permissionType := "full_access"
			if !full {
				permissionType = "approval_required"
			}
			_, err := runtime.ExecuteTargetTool(computerPermissionContext(t, permissionType), call)
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

func computerPermissionContext(t *testing.T, mode string) context.Context {
	t.Helper()
	permission, err := parsePermissionType(mode)
	if err != nil {
		t.Fatal(err)
	}
	return contextWithToolAuthorizationSnapshot(t.Context(), buildPermissionSnapshot(permission, []ToolDef{{Name: "computer.observe", Visibility: ToolVisibilitySharedReadonly}}, nil))
}

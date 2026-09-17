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

func TestComputerAccessRechecksModeForEachOperation(t *testing.T) {
	runtime, executor, store, _ := computerBindingFixture(t)
	call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: "browser-main", ToolName: "computer.observe"}
	grants := ComputerAccess{Origins: []string{"https://example.test"}, Apps: []string{"dev.Notes"}}
	if err := store.SetComputerAccess(t.Context(), call.ThreadID, grants); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"full_access", "approval_required", "full_access", "readonly"} {
		if err := store.UpdateThreadPermissionType(t.Context(), "env", call.ThreadID, mode); err != nil {
			t.Fatal(err)
		}
		if _, err := runtime.ExecuteTargetTool(t.Context(), call); err != nil {
			t.Fatal(err)
		}
		got := executor.calls[len(executor.calls)-1]
		if got.fullAccess != (mode == "full_access") || got.allowForeground != got.fullAccess {
			t.Fatalf("incorrect authority for %s: %+v", mode, got)
		}
		if !got.fullAccess && (!reflect.DeepEqual(got.allowedOrigins, grants.Origins) || !reflect.DeepEqual(got.allowedApps, grants.Apps)) {
			t.Fatalf("lost scoped grants in %s", mode)
		}
	}
}

func TestComputerFullAccessKeepsExecutionAndSettingsChecks(t *testing.T) {
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
			if !full {
				if err := store.UpdateThreadPermissionType(t.Context(), "env", "thread-first", "approval_required"); err != nil {
					t.Fatal(err)
				}
			}
			control := runtime.controlForTarget("browser-main")
			control.threadID, control.turnID, control.runID, control.user = "thread-first", "turn", "run", true
			control.requiredOrigin, control.requiredApp, control.requireForeground = "https://example.test", "dev.Notes", true
			call := TargetToolCall{ThreadID: "thread-first", TurnID: "turn", RunID: "run", TargetID: "browser-main", ToolName: "computer.screenshot", controlReturn: true}
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

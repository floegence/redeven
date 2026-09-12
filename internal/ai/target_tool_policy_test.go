package ai

import (
	"context"
	"encoding/json"
	"testing"
)

type recordingTargetExecutor struct{ calls []TargetToolCall }

func (e *recordingTargetExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.calls = append(e.calls, call)
	return TargetToolResult{TargetID: call.TargetID, ExecutionLocation: "test", Result: map[string]any{"summary": "ok"}}, nil
}

type staticTargetResolver struct{ target TargetDescriptor }

func (r staticTargetResolver) ResolveTarget(_ context.Context, alias string) (TargetDescriptor, error) {
	if alias != "current" && alias != r.target.ID {
		return TargetDescriptor{}, context.Canceled
	}
	return r.target, nil
}

func TestComputerUseToolsAreTargetScopedAndRoute(t *testing.T) {
	for _, name := range []string{"computer.screenshot", "computer.click", "computer.type", "browser.navigate", "browser.reload"} {
		if !toolRequiresTarget(name) || !isComputerUseTool(name) {
			t.Fatalf("%s should be target scoped", name)
		}
	}
	if got := requiredTargetCapabilities("computer.screenshot"); len(got) != 1 || got[0] != "observe" {
		t.Fatalf("unexpected screenshot capabilities: %#v", got)
	}
	if got := requiredTargetCapabilities("browser.navigate"); len(got) != 1 || got[0] != "interaction" {
		t.Fatalf("unexpected browser capabilities: %#v", got)
	}
	defs := builtInToolDefinitions()
	seen := map[string]bool{}
	for _, def := range defs {
		seen[def.Name] = true
	}
	for _, name := range []string{"computer.screenshot", "computer.click", "browser.navigate"} {
		if !seen[name] {
			t.Fatalf("missing builtin definition %s", name)
		}
	}
}

func TestComputerUseUsesCurrentTargetWhenModelOmitsTarget(t *testing.T) {
	executor := &recordingTargetExecutor{}
	run := &run{
		toolTargetPolicy:   ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget},
		targetToolExecutor: executor,
		targetResolver:     staticTargetResolver{target: TargetDescriptor{ID: "browser-main", DisplayName: "Managed Browser", Ready: true}},
	}
	result, err := run.execTargetTool(context.Background(), "call-1", "computer.screenshot", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(executor.calls) != 1 || executor.calls[0].TargetID != "browser-main" {
		t.Fatalf("executor calls = %#v", executor.calls)
	}
	payload, ok := result.(targetToolExecution)
	if !ok {
		t.Fatalf("result type = %T", result)
	}
	if payload.Payload.(map[string]any)["target_name"] != "Managed Browser" {
		t.Fatalf("payload = %#v", payload.Payload)
	}
}

func TestComputerUseSchemasUseLogicalCurrentTarget(t *testing.T) {
	for _, def := range builtInComputerToolDefinitions() {
		var schema map[string]any
		if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
			t.Fatalf("%s schema: %v", def.Name, err)
		}
		properties, ok := schema["properties"].(map[string]any)
		if !ok {
			t.Fatalf("%s properties missing", def.Name)
		}
		if _, ok := properties["target"]; !ok {
			t.Fatalf("%s target alias missing", def.Name)
		}
		if _, ok := properties["target_id"]; ok {
			t.Fatalf("%s exposes internal target_id", def.Name)
		}
	}
}

func TestTargetReadinessErrorMetadata(t *testing.T) {
	target := TargetDescriptor{ID: "browser-main", Kind: "browser.managed", State: "setup_required"}
	if got := targetReadinessErrorCode(target); got != "target_setup_required" {
		t.Fatalf("readiness code = %q", got)
	}
	if got := targetRepairAction(target); got != "start_managed_browser" {
		t.Fatalf("repair action = %q", got)
	}
	permission := TargetDescriptor{State: "permission_required"}
	if got := targetReadinessErrorCode(permission); got != "target_permission_required" {
		t.Fatalf("permission code = %q", got)
	}
	if got := targetRepairAction(permission); got != "grant_target_permission" {
		t.Fatalf("permission repair = %q", got)
	}
}

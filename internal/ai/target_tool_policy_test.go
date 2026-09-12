package ai

import (
	"context"
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

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

func TestComputerUseToolsRequireExplicitTargetAndRoute(t *testing.T) {
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

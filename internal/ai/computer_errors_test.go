package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestComputerClosedFailureFactsDoNotBecomeUnknownEffects(t *testing.T) {
	call := TargetToolCall{ToolName: "browser.navigate", TargetID: "browser-main"}
	for _, code := range []string{"TARGET_ACTION_FAILED", "TARGET_CONNECTION_REQUIRED", "TARGET_CAPABILITY_UNAVAILABLE"} {
		result, err, valid := computerBrowserFailure(call, false, code, map[string]any{"action_executed": false}, "local")
		if !valid || errors.Is(err, errComputerEffectUnknown) || result.Result.(map[string]any)["action_executed"] != false {
			t.Fatalf("closed %s became uncertain: %+v %v", code, result, err)
		}
	}
	_, err, _ := computerBrowserFailure(call, false, "unexpected private exception", map[string]any{"action_executed": false}, "local")
	if !errors.Is(err, errComputerEffectUnknown) {
		t.Fatal("unsupported failure vocabulary established a false outcome")
	}
	_, err, _ = computerBrowserFailure(call, false, "TARGET_PERMISSION_REQUIRED", map[string]any{"action_executed": false, "permission_reason": "extension_file_access"}, "local")
	if !strings.Contains(err.Error(), "Allow access to file URLs") {
		t.Fatalf("missing Chrome permission diagnosis: %v", err)
	}
}

type failingComputerExecutor struct{ code string }

func (e failingComputerExecutor) ExecuteTargetTool(_ context.Context, call TargetToolCall) (TargetToolResult, error) {
	return TargetToolResult{}, computerTargetFailure(call, e.code)
}

func TestComputerFailurePreservesLayerAndReadiness(t *testing.T) {
	for _, test := range []struct {
		wire, code, state string
		ready             bool
	}{
		{"TARGET_OBSERVATION_UNAVAILABLE", "TARGET_OBSERVATION_UNAVAILABLE", "ready", true},
		{"FRAME_UNAVAILABLE", "FRAME_UNAVAILABLE", "ready", true},
		{"TAKEOVER_REQUIRED", "TAKEOVER_REQUIRED", "ready", true},
		{"TARGET_PERMISSION_REQUIRED", "TARGET_PERMISSION_REQUIRED", "permission_required", false},
		{"TARGET_CONNECTION_REQUIRED", "TARGET_CONNECTION_REQUIRED", "connection_required", false},
		{"INVALID_REQUEST", "INVALID_ARGUMENTS", "ready", true},
		{"Authorization: private-fixture-secret", "TARGET_ACTION_FAILED", "ready", true},
	} {
		t.Run(test.code, func(t *testing.T) {
			registry := NewTargetRegistry()
			if err := registry.Register(TargetDescriptor{ID: "target", Kind: "desktop.screen", State: "ready", Ready: true}); err != nil {
				t.Fatal(err)
			}
			runtime := NewComputerUseRuntime(registry, map[string]TargetToolExecutor{"target": failingComputerExecutor{code: test.wire}}, t.TempDir())
			t.Cleanup(func() { _ = runtime.Close() })
			_, err := runtime.ExecuteTargetTool(t.Context(), TargetToolCall{TargetID: "target", ToolName: "computer.screenshot"})
			failure := aitools.ClassifyError(aitools.Invocation{ToolName: "computer.screenshot"}, err)
			if failure == nil || string(failure.Code) != test.code || failure.Retryable || strings.Contains(failure.Message, "private-fixture-secret") {
				t.Fatalf("failure boundary: %+v", failure)
			}
			target, err := runtime.ResolveTarget(t.Context(), "target")
			if err != nil || target.State != test.state || target.Ready != test.ready {
				t.Fatalf("readiness changed across error layers: %+v %v", target, err)
			}
		})
	}
}

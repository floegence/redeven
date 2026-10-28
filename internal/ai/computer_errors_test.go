package ai

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"reflect"
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

func TestComputerProtocolDiagnosticRetainsOnlyCorrelatedFacts(t *testing.T) {
	for _, code := range []float64{-32000, -32601, 0, math.MinInt32, math.MaxInt32} {
		want := map[string]any{"phase": "protocol", "method": "Page.captureScreenshot", "code": code}
		raw := map[string]any{"phase": "protocol", "method": "Page.captureScreenshot", "code": code, "message": "private content", "url": "https://private.test/secret"}
		result, err := computerObservationFailure(TargetToolCall{ToolName: "computer.screenshot"}, map[string]any{"action_executed": false, "observation_stage": "capture", "diagnostic": raw}, "fixture")
		if err == nil || !reflect.DeepEqual(result.Result.(map[string]any)["diagnostic"], want) {
			t.Fatalf("lost facts: %+v %v", result, err)
		}
		body, _ := json.Marshal(result)
		if strings.Contains(string(body), "private") {
			t.Fatal("raw exception leaked")
		}
	}
	for _, raw := range []map[string]any{
		{"phase": "protocol", "method": "Page.captureScreenshot", "code": "-32000"},
		{"phase": "protocol", "method": "Page.captureScreenshot", "code": 1.5},
		{"phase": "protocol", "method": "Page.captureScreenshot", "code": math.Inf(1)},
		{"phase": "protocol", "method": "Page.captureScreenshot", "code": float64(math.MaxInt32) + 1},
		{"phase": "protocol", "method": "https://private.test/secret", "code": float64(-32000)},
		{"phase": "protocol", "method": "Page.captureScreenshot", "message": "code -32000"},
	} {
		if got := computerOperationDiagnostic(raw); got != nil {
			t.Fatalf("invented or unbounded diagnostic: %+v", got)
		}
	}
}

func TestComputerPauseFactsKeepExistingAssistancePath(t *testing.T) {
	for reason, want := range map[string]string{"user_control": "paused", "target_focus_changed": "paused", "input_monitor_unavailable": "paused", "secret_input": "private_input", "foreground_permission": "access", "app_permission": "inspection"} {
		if got := computerAssistanceKind(InteractionSafetyDecision{ReasonCodes: []string{reason}}); got != want {
			t.Fatalf("%s: %s != %s", reason, got, want)
		}
	}
}

func TestComputerProtocolFailureIsNotArgumentValidation(t *testing.T) {
	payload := map[string]any{"diagnostic": map[string]any{"phase": "protocol", "method": "Page.captureScreenshot", "code": float64(-32000)}}
	if computerActivityFailurePhase(payload) == "validation" {
		t.Fatal("protocol failure attributed to model arguments")
	}
	rows := computerActivityResultRows("computer.screenshot", payload)
	encoded, _ := json.Marshal(rows)
	if !strings.Contains(string(encoded), "-32000") || !strings.Contains(string(encoded), "Page.captureScreenshot") {
		t.Fatal("visible diagnostic dropped protocol facts")
	}
	for _, reason := range []string{"target_focus_changed", "input_monitor_unavailable"} {
		err := &targetToolPolicyError{code: "interaction_takeover_required", safety: &InteractionSafetyDecision{ReasonCodes: []string{reason}}}
		if strings.Contains(err.Error(), "user takeover") {
			t.Fatal("technical stop attributed to user intent")
		}
	}
}

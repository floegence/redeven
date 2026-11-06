package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestComputerScriptRetirementPreservesCancellationAtResultBoundary(t *testing.T) {
	entered, retired := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	rt, call := scriptRuntimeFixture(t, func(ctx context.Context, _ TargetToolCall) (TargetToolResult, error) {
		if calls.Add(1) == 1 {
			return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
		}
		close(entered)
		<-ctx.Done()
		<-retired // The response pipe has closed before the host read returns.
		return TargetToolResult{}, ctx.Err()
	})
	go func() {
		select {
		case <-entered:
			rt.releaseScripts(func(key computerScriptKey) bool { return key.thread == call.ThreadID })
		case <-time.After(5 * time.Second):
		}
		close(retired)
	}()
	result, err := executeTestScript(t.Context(), rt, call, `await ui.click(1,2); log('confirmed prefix'); await ui.ref('r').waitFor(); await ui.click(3,4);`)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("retirement replaced cancellation: %v", err)
	}
	payload := result.Result.(map[string]any)
	if payload["stop_reason"] != "cancelled" || payload["completed"] != false || payload["action_executed"] != true || payload["effect_outcome_unknown"] != false || calls.Load() != 2 {
		t.Fatalf("incorrect cancellation facts or replay: calls=%d payload=%#v", calls.Load(), payload)
	}
	if payload["failed_action"] != "wait" || payload["failed_operation_index"] != 1 || len(payload["completed_actions"].([]string)) != 1 || payload["context_reset"] != true {
		t.Fatalf("lost confirmed prefix: %#v", payload)
	}
	toolResult := ToolResult{ToolID: call.ToolCallID, ToolName: call.ToolName, Status: toolResultStatusError, Data: payload, Error: aitools.ClassifyError(err)}
	encoded, encodeErr := encodeModelToolResult(toolResult)
	if encodeErr != nil {
		t.Fatal(encodeErr)
	}
	var wire struct {
		Data  map[string]any     `json:"data"`
		Error *aitools.ToolError `json:"error"`
	}
	if err := json.Unmarshal(encoded.text, &wire); err != nil {
		t.Fatal(err)
	}
	if wire.Error == nil || wire.Error.Code != aitools.ErrorCodeCanceled || wire.Data["stop_reason"] != "cancelled" || !strings.Contains(string(encoded.text), "confirmed prefix") || strings.Contains(string(encoded.text), "file already closed") {
		t.Fatalf("model result lost cancellation: %s", encoded.text)
	}
	activity, activityErr := floretActivityForToolResult(nil, toolResult)
	if activityErr != nil || activity == nil {
		t.Fatalf("missing Activity result: %v", activityErr)
	}
	presentation := activity.Payload.(fltools.StructuredActivityPayload)
	if presentation.Error == nil || presentation.Error.Code != string(aitools.ErrorCodeCanceled) {
		t.Fatalf("Activity lost cancellation: %+v", presentation)
	}
	found := false
	for _, row := range presentation.Rows {
		found = found || row.Title == "stop_reason" && row.Content == "cancelled"
	}
	if !found {
		t.Fatalf("Activity omitted stop reason: %+v", presentation.Rows)
	}
}

func TestComputerScriptHostCancellationAndDeadlineRetainOutcome(t *testing.T) {
	for _, tc := range []struct {
		name, reason string
		cause        error
		unknown      bool
	}{
		{"cancelled_read", "cancelled", context.Canceled, false},
		{"expired_read", "deadline_exceeded", context.DeadlineExceeded, false},
		{"cancelled_unknown_input", "cancelled", context.Canceled, true},
		{"expired_unknown_input", "deadline_exceeded", context.DeadlineExceeded, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) {
				calls++
				if calls == 1 {
					return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
				}
				err := tc.cause
				if tc.unknown {
					err = errors.Join(errComputerEffectUnknown, err)
				}
				return TargetToolResult{}, err
			})
			op := `await ui.ref('r').waitFor();`
			if tc.unknown {
				op = `await ui.click(3,4);`
			}
			result, err := executeTestScript(t.Context(), rt, call, `await ui.click(1,2); log('confirmed prefix'); `+op+` await ui.click(5,6);`)
			payload := result.Result.(map[string]any)
			if !errors.Is(err, tc.cause) || errors.Is(err, errComputerEffectUnknown) != tc.unknown || payload["effect_outcome_unknown"] != tc.unknown || payload["stop_reason"] != tc.reason || calls != 2 {
				t.Fatalf("lost typed outcome or replayed input: calls=%d err=%v payload=%#v", calls, err, payload)
			}
			if payload["action_executed"] != true || len(payload["completed_actions"].([]string)) != 1 || payload["context_reset"] != true {
				t.Fatalf("lost confirmed prefix: %#v", payload)
			}
			if (payload["budget_exhausted"] == "time") != errors.Is(tc.cause, context.DeadlineExceeded) {
				t.Fatalf("incorrect budget facts: %#v", payload)
			}
		})
	}
}

func TestComputerScriptCancellationAfterConfirmedOperationRetainsCompletion(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	calls := 0
	rt, call := scriptRuntimeFixture(t, func(context.Context, TargetToolCall) (TargetToolResult, error) {
		calls++
		cancel()
		return TargetToolResult{Result: map[string]any{"action_executed": true}}, nil
	})
	result, err := executeTestScript(ctx, rt, call, `await ui.click(1,2); await ui.click(3,4);`)
	payload := result.Result.(map[string]any)
	if !errors.Is(err, context.Canceled) || calls != 1 || payload["action_executed"] != true || len(payload["completed_actions"].([]string)) != 1 {
		t.Fatalf("lost confirmed operation: calls=%d err=%v payload=%#v", calls, err, payload)
	}
	if payload["failed_operation_index"] != nil || payload["failed_action"] != nil || payload["effect_outcome_unknown"] != false {
		t.Fatalf("confirmed operation mislabeled as failed: %#v", payload)
	}
}

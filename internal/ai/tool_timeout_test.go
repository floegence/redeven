package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestToolFailureUsesClassifierAndPreservesPartialExecution(t *testing.T) {
	for _, scenario := range []struct {
		name, tool string
		failure    error
		completed  bool
	}{
		{"file_timeout", "file.write", fmt.Errorf("fixture: %w", context.DeadlineExceeded), false},
		{"computer_timeout", "computer.exec", fmt.Errorf("fixture: %w", context.DeadlineExceeded), false},
		{"file_multiline", "file.write", errors.New("fixture\nforged failure"), true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			name, failure := scenario.tool, scenario.failure
			executor := &partialComputerResultExecutor{failure: failure}
			var logs bytes.Buffer
			r := newRun(runOptions{SessionMeta: testSendTurnMeta(), Log: slog.New(slog.NewJSONHandler(&logs, nil))})
			r.toolTargetPolicy = ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "fixture"}
			r.targetResolver = staticTargetResolver{target: TargetDescriptor{ID: "fixture", Ready: true, Capabilities: []string{"observe", "interaction"}}}
			r.targetToolExecutor = executor
			bindTargetTestRun(t, r)
			snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
			snapshot.SnapshotID = "timeout-fixture"
			ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
			ctx = contextWithFloretToolExecutionAuthorization(ctx, "call", name, "attempt", snapshot, ApprovalDecisionAllow, true, nil)
			args := map[string]any{"target": "fixture"}
			outcome, err := r.handleToolCall(ctx, "call", name, args)
			if err != nil {
				t.Fatal(err)
			}
			want := aitools.ClassifyError(failure)
			if !reflect.DeepEqual(outcome.ToolError, want) {
				t.Errorf("execution error=%+v; classifier=%+v", outcome.ToolError, want)
			}
			var diagnostic struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(logs.Bytes(), &diagnostic); err != nil {
				t.Fatalf("decode tool failure log: %v: %s", err, logs.String())
			}
			if diagnostic.Error == "" || strings.ContainsAny(diagnostic.Error, "\r\n") {
				t.Fatalf("tool failure diagnostic must remain nonempty and single-line: %q", diagnostic.Error)
			}
			partial, err := json.Marshal(outcome.Result)
			if err != nil || !strings.Contains(string(partial), "prefix-confirmed") {
				t.Fatalf("partial execution lost: %s err=%v", partial, err)
			}
			if outcome.Success || outcome.executionFacts.completed != scenario.completed || outcome.effectUncertain || executor.calls.Load() != 1 {
				t.Fatalf("failure changed effect facts or replayed: %+v calls=%d", outcome, executor.calls.Load())
			}
		})
	}
}

func TestComputerTypedStartupAndUnknownEffectReachModel(t *testing.T) {
	for _, tc := range []struct {
		name      string
		err       error
		code      aitools.ErrorCode
		uncertain bool
	}{
		{"startup", &TargetStartupError{Code: "TARGET_CONNECTION_REQUIRED", Reason: "browser_connection_failed"}, aitools.ErrorCodeTargetConnectionRequired, false},
		{"unknown", errors.Join(errBrowserOutcomeUnknown, context.Canceled), aitools.ErrorCodeUnknown, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executor := &partialComputerResultExecutor{failure: tc.err}
			r := newRun(runOptions{SessionMeta: testSendTurnMeta()})
			r.toolTargetPolicy = ToolTargetPolicy{Mode: ToolTargetModeExplicitTarget, DefaultTargetID: "fixture"}
			r.targetResolver = staticTargetResolver{target: TargetDescriptor{ID: "fixture", Ready: true, Capabilities: []string{"observe", "interaction"}}}
			r.targetToolExecutor = executor
			bindTargetTestRun(t, r)
			snapshot := buildPermissionSnapshot(FlowerPermissionFullAccess, builtInToolDefinitions(), nil)
			snapshot.SnapshotID = "facts-fixture"
			ctx := contextWithToolAuthorizationSnapshot(t.Context(), snapshot)
			ctx = contextWithFloretToolExecutionAuthorization(ctx, "call", "computer.exec", "attempt", snapshot, ApprovalDecisionAllow, true, nil)
			outcome, err := r.handleToolCall(ctx, "call", "computer.exec", map[string]any{"target": "fixture"})
			if err != nil || outcome.ToolError.Code != tc.code || outcome.effectUncertain != tc.uncertain || executor.calls.Load() != 1 {
				t.Fatalf("unexpected execution: %+v, %v, calls=%d", outcome, err, executor.calls.Load())
			}
			result, err := floretToolResultFromFlower(r, ToolResult{ToolID: "call", ToolName: "computer.exec", Status: toolResultStatusError, Error: outcome.ToolError, Data: outcome.Result, effectUncertain: outcome.effectUncertain})
			if err != nil || !strings.Contains(result.Text, string(tc.code)) {
				t.Fatalf("model result: %+v, %v", result, err)
			}
		})
	}
}

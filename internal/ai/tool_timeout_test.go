package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestToolTimeoutUsesClassifierAndPreservesPartialExecution(t *testing.T) {
	for _, name := range []string{"file.write", "computer.exec"} {
		t.Run(name, func(t *testing.T) {
			failure := fmt.Errorf("fixture: %w", context.DeadlineExceeded)
			executor := &partialComputerResultExecutor{failure: failure}
			r := newRun(runOptions{SessionMeta: testSendTurnMeta()})
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
			want := aitools.ClassifyError(aitools.Invocation{ToolName: name, Args: args}, failure)
			if !reflect.DeepEqual(outcome.ToolError, want) {
				t.Errorf("execution error=%+v; classifier=%+v", outcome.ToolError, want)
			}
			partial, err := json.Marshal(outcome.Result)
			if err != nil || !strings.Contains(string(partial), "prefix-confirmed") {
				t.Fatalf("partial execution lost: %s err=%v", partial, err)
			}
			if outcome.Success || outcome.executionFacts.completed || outcome.effectUncertain || executor.calls.Load() != 1 {
				t.Fatalf("timeout changed effect facts or replayed: %+v calls=%d", outcome, executor.calls.Load())
			}
		})
	}
}

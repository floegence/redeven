package ai

import (
	"strings"
	"testing"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

func TestShouldRequireToolExecution(t *testing.T) {
	t.Parallel()

	if !shouldRequireToolExecution("帮我分析一下~/Downloads/code/redeven这个项目", []string{"分析", "scan"}) {
		t.Fatalf("expected tool-required intent for path + analyze request")
	}
	if shouldRequireToolExecution("请解释一下 Go interface 的设计", []string{"scan", "list dir"}) {
		t.Fatalf("unexpected tool-required intent for pure explanation request")
	}
}

func TestHasUnfulfilledActionCommitment(t *testing.T) {
	t.Parallel()

	text := "我先快速扫一遍项目结构和关键配置，然后给你结论。"
	if !hasUnfulfilledActionCommitment(text) {
		t.Fatalf("expected unfulfilled commitment for preamble text")
	}
	if hasUnfulfilledActionCommitment("结论如下：该项目采用 Go 单体架构。") {
		t.Fatalf("unexpected commitment detection for direct answer")
	}
}

func TestDecideTurnRecovery_MissingRequiredToolCalls(t *testing.T) {
	t.Parallel()

	cfg := turnRecoveryConfig{
		Enabled:                        true,
		MaxSteps:                       3,
		AllowPathRewrite:               true,
		AllowProbeTools:                true,
		FailOnRepeatedFailureSignature: true,
		RequiresTools:                  true,
	}
	state := turnRecoveryState{FailureSignatures: map[string]int{}}
	summary := turnAttemptSummary{
		AttemptIndex:  0,
		ToolCalls:     0,
		AssistantText: "我先快速扫一遍项目结构和关键配置，然后给你结论。",
	}

	decision := decideTurnRecovery(cfg, summary, &state, "帮我分析这个项目")
	if !decision.Continue {
		t.Fatalf("expected recovery continuation, got %+v", decision)
	}
	if decision.FailRun {
		t.Fatalf("unexpected fail decision: %+v", decision)
	}
	if decision.Action != recoveryActionForceToolCall {
		t.Fatalf("action=%q, want=%q", decision.Action, recoveryActionForceToolCall)
	}
	if state.RecoverySteps != 1 {
		t.Fatalf("recovery_steps=%d, want=1", state.RecoverySteps)
	}
	if !strings.Contains(decision.NextPrompt, "Do not output another preamble") {
		t.Fatalf("next_prompt missing anti-preamble rule: %q", decision.NextPrompt)
	}
}

func TestDecideTurnRecovery_ToolFailureTriggersContinuation(t *testing.T) {
	t.Parallel()

	cfg := turnRecoveryConfig{
		Enabled:                        true,
		MaxSteps:                       2,
		AllowPathRewrite:               true,
		AllowProbeTools:                true,
		FailOnRepeatedFailureSignature: true,
		RequiresTools:                  false,
	}
	state := turnRecoveryState{FailureSignatures: map[string]int{}}
	summary := turnAttemptSummary{
		AttemptIndex:  0,
		ToolCalls:     1,
		ToolSuccesses: 0,
		ToolFailures: []turnToolFailure{
			{
				ToolName: "fs.stat",
				Error: &aitools.ToolError{
					Code:      aitools.ErrorCodeNotFound,
					Message:   "not found",
					Retryable: false,
				},
			},
		},
	}

	decision := decideTurnRecovery(cfg, summary, &state, "检查文件")
	if !decision.Continue {
		t.Fatalf("expected continuation for first tool failure, got %+v", decision)
	}
	if decision.FailRun {
		t.Fatalf("unexpected fail decision: %+v", decision)
	}
	if decision.Action != recoveryActionProbeWorkspace {
		t.Fatalf("action=%q, want=%q", decision.Action, recoveryActionProbeWorkspace)
	}
	if state.RecoverySteps != 1 {
		t.Fatalf("recovery_steps=%d, want=1", state.RecoverySteps)
	}
}

func TestDecideTurnRecovery_RepeatedSignatureFailsFast(t *testing.T) {
	t.Parallel()

	cfg := turnRecoveryConfig{
		Enabled:                        true,
		MaxSteps:                       3,
		AllowPathRewrite:               true,
		AllowProbeTools:                true,
		FailOnRepeatedFailureSignature: true,
		RequiresTools:                  false,
	}
	f := turnToolFailure{
		ToolName: "fs.list_dir",
		Error: &aitools.ToolError{
			Code:      aitools.ErrorCodeNotFound,
			Message:   "not found",
			Retryable: false,
		},
		Args: map[string]any{"path": "/missing"},
	}
	sig := buildFailureSignature(f)
	state := turnRecoveryState{
		RecoverySteps:     1,
		FailureSignatures: map[string]int{sig: 1},
	}
	summary := turnAttemptSummary{
		AttemptIndex: 1,
		ToolCalls:    1,
		ToolFailures: []turnToolFailure{f},
	}

	decision := decideTurnRecovery(cfg, summary, &state, "读取目录")
	if decision.Continue {
		t.Fatalf("unexpected continuation for repeated signature: %+v", decision)
	}
	if !decision.FailRun {
		t.Fatalf("expected fail-fast decision: %+v", decision)
	}
	if decision.Action != recoveryActionStopAfterRepeatedErr {
		t.Fatalf("action=%q, want=%q", decision.Action, recoveryActionStopAfterRepeatedErr)
	}
}

func TestDecideTurnRecovery_CompleteAfterSuccessfulAttempt(t *testing.T) {
	t.Parallel()

	cfg := turnRecoveryConfig{
		Enabled:                        true,
		MaxSteps:                       3,
		AllowPathRewrite:               true,
		AllowProbeTools:                true,
		FailOnRepeatedFailureSignature: true,
		RequiresTools:                  true,
	}
	state := turnRecoveryState{FailureSignatures: map[string]int{}}
	summary := turnAttemptSummary{
		AttemptIndex:  1,
		ToolCalls:     1,
		ToolSuccesses: 1,
		AssistantText: "分析完成",
		ToolFailures:  nil,
	}

	decision := decideTurnRecovery(cfg, summary, &state, "帮我分析")
	if decision.Continue || decision.FailRun {
		t.Fatalf("expected complete decision, got %+v", decision)
	}
	if decision.Reason != "complete" {
		t.Fatalf("reason=%q, want=complete", decision.Reason)
	}
}

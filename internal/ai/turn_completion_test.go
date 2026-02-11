package ai

import "testing"

func TestDecideTurnCompletion_RespectsSynthesisOutcomeFromSidecar(t *testing.T) {
	t.Parallel()

	cfg := turnCompletionConfig{Enabled: true, MaxSteps: 2}
	state := &turnRecoveryState{}
	summary := turnAttemptSummary{
		ToolCalls:                     2,
		ToolSuccesses:                 2,
		ToolCallNames:                 []string{"fs.list_dir", "fs.read_file"},
		ToolSuccessNames:              []string{"fs.list_dir", "fs.read_file"},
		ToolCallSignatures:            []string{"fs.read_file|path=/workspace/README.md"},
		AssistantText:                 "Findings: this project uses Go. Evidence: /workspace/README.md. Next steps: inspect internal/ai.",
		OutcomeHasText:                true,
		OutcomeToolCalls:              2,
		OutcomeHasTextAfterToolsKnown: true,
		OutcomeHasTextAfterToolCalls:  true,
		OutcomeNeedsFollowUpHint:      false,
		OutcomeFinishReason:           "stop",
	}

	decision := decideTurnCompletion(cfg, summary, state, "analyze project")
	if decision.Continue || decision.FailRun {
		t.Fatalf("decision=%+v, want complete", decision)
	}
	if decision.Reason != "complete" {
		t.Fatalf("reason=%q, want complete", decision.Reason)
	}
}

func TestDecideTurnCompletion_ContinuesWhenOutcomeNeedsFollowUp(t *testing.T) {
	t.Parallel()

	cfg := turnCompletionConfig{Enabled: true, MaxSteps: 2}
	state := &turnRecoveryState{}
	summary := turnAttemptSummary{
		ToolCalls:                     1,
		ToolSuccesses:                 1,
		OutcomeHasText:                false,
		OutcomeToolCalls:              1,
		OutcomeHasTextAfterToolsKnown: true,
		OutcomeHasTextAfterToolCalls:  false,
		OutcomeNeedsFollowUpHint:      true,
		OutcomeFinishReason:           "tool-calls",
	}

	decision := decideTurnCompletion(cfg, summary, state, "Call fs.stat for '/'.")
	if !decision.Continue {
		t.Fatalf("decision=%+v, want continue", decision)
	}
	if decision.Reason != "needs_synthesis_after_tool_calls" {
		t.Fatalf("reason=%q, want needs_synthesis_after_tool_calls", decision.Reason)
	}
}

func TestDecideTurnCompletion_TrustsSidecarFollowUpHintForRawDump(t *testing.T) {
	t.Parallel()

	cfg := turnCompletionConfig{Enabled: true, MaxSteps: 2}
	state := &turnRecoveryState{}
	summary := turnAttemptSummary{
		ToolCalls:                     1,
		ToolSuccesses:                 1,
		ToolCallNames:                 []string{"fs.read_file"},
		ToolSuccessNames:              []string{"fs.read_file"},
		AssistantText:                 "File content:\n\n```\nservices:\n  app:\n    image: test\n    volumes:\n      - /home/node:/workspace\n```",
		OutcomeHasText:                true,
		OutcomeToolCalls:              1,
		OutcomeHasTextAfterToolsKnown: true,
		OutcomeHasTextAfterToolCalls:  true,
		OutcomeNeedsFollowUpHint:      false,
		OutcomeFinishReason:           "stop",
	}

	decision := decideTurnCompletion(cfg, summary, state, "请深度分析项目并给出风险与建议")
	if decision.Continue || decision.FailRun {
		t.Fatalf("decision=%+v, want complete", decision)
	}
	if decision.Reason != "complete" {
		t.Fatalf("reason=%q, want complete", decision.Reason)
	}
}

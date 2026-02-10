package ai

import (
	"strings"
	"testing"
)

func TestDecideTaskLoop_AnalysisRequiresEvidence(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("帮我分析一下~/Downloads/code/redeven这个项目")
	summary := turnAttemptSummary{
		AttemptIndex:       0,
		ToolCalls:          1,
		ToolSuccesses:      1,
		ToolCallNames:      []string{"fs.list_dir"},
		ToolCallSignatures: []string{"fs.list_dir|path=/"},
		AssistantText:      strings.Repeat("这是一个工程化很强的项目。", 20),
		OutcomeHasText:     true,
	}

	decision := decideTaskLoop(cfg, &state, summary, "帮我分析一下~/Downloads/code/redeven这个项目")
	if !decision.Continue {
		t.Fatalf("expected continue decision, got %+v", decision)
	}
	if decision.FailRun {
		t.Fatalf("unexpected fail decision: %+v", decision)
	}
	if decision.Reason != "analysis_requires_more_evidence" {
		t.Fatalf("reason=%q, want analysis_requires_more_evidence", decision.Reason)
	}
	if !strings.Contains(decision.NextPrompt, "fs.read_file") {
		t.Fatalf("next_prompt=%q, want fs.read_file requirement", decision.NextPrompt)
	}
}

func TestDecideTaskLoop_AnalysisRequiresSuccessfulEvidenceTool(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("帮我分析一下~/Downloads/code/redeven这个项目")
	summary := turnAttemptSummary{
		AttemptIndex:       0,
		ToolCalls:          1,
		ToolSuccesses:      0,
		ToolCallNames:      []string{"terminal.exec"},
		ToolCallSignatures: []string{"terminal.exec|command=pwd|cwd=/Users/tangjianyin"},
		AssistantText:      strings.Repeat("这是一个工程化很强的项目。", 20),
		OutcomeHasText:     true,
	}

	decision := decideTaskLoop(cfg, &state, summary, "帮我分析一下~/Downloads/code/redeven这个项目")
	if !decision.Continue {
		t.Fatalf("expected continue decision when evidence tool did not succeed, got %+v", decision)
	}
	if decision.FailRun {
		t.Fatalf("unexpected fail decision: %+v", decision)
	}
	if decision.Reason != "analysis_requires_more_evidence" {
		t.Fatalf("reason=%q, want analysis_requires_more_evidence", decision.Reason)
	}
}

func TestDecideTaskLoop_AnalysisMissingEvidenceCitation(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("帮我分析一下~/Downloads/code/redeven这个项目")
	summary := turnAttemptSummary{
		AttemptIndex:       1,
		ToolCalls:          2,
		ToolSuccesses:      2,
		ToolCallNames:      []string{"fs.list_dir", "fs.read_file"},
		ToolSuccessNames:   []string{"fs.list_dir", "fs.read_file"},
		ToolCallSignatures: []string{"fs.list_dir|path=/Users/tangjianyin/Downloads/code/redeven", "fs.read_file|path=/Users/tangjianyin/Downloads/code/redeven/README.md"},
		AssistantText:      "这个项目整体结构清晰，我先给你总体判断，再继续展开。",
		OutcomeHasText:     true,
	}

	decision := decideTaskLoop(cfg, &state, summary, "帮我分析一下~/Downloads/code/redeven这个项目")
	if !decision.Continue {
		t.Fatalf("expected continue decision, got %+v", decision)
	}
	if decision.Reason != "analysis_missing_evidence_citation" {
		t.Fatalf("reason=%q, want analysis_missing_evidence_citation", decision.Reason)
	}
	if !strings.Contains(decision.NextPrompt, "Evidence") {
		t.Fatalf("next_prompt=%q, want evidence citation hint", decision.NextPrompt)
	}
}

func TestDecideTaskLoop_AnalysisCitationSatisfiedCompletes(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("帮我分析一下~/Downloads/code/redeven这个项目")
	summary := turnAttemptSummary{
		AttemptIndex:       1,
		ToolCalls:          2,
		ToolSuccesses:      2,
		ToolCallNames:      []string{"fs.list_dir", "fs.read_file"},
		ToolSuccessNames:   []string{"fs.read_file"},
		ToolCallSignatures: []string{"fs.read_file|path=/Users/tangjianyin/Downloads/code/redeven/README.md"},
		AssistantText:      "Findings: 项目结构清晰。Evidence: /Users/tangjianyin/Downloads/code/redeven/README.md。Next steps: 深入 internal/ai。",
		OutcomeHasText:     true,
	}

	decision := decideTaskLoop(cfg, &state, summary, "帮我分析一下~/Downloads/code/redeven这个项目")
	if decision.Continue || decision.FailRun {
		t.Fatalf("expected completion decision, got %+v", decision)
	}
	if decision.Reason != "complete" {
		t.Fatalf("reason=%q, want complete", decision.Reason)
	}
}

func TestDecideTaskLoop_RepeatedSignatureFailsAfterNoProgress(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("Call fs.stat for '/'.")
	state.NoProgressTurn = 2
	state.LastDigest = "tc=1|ts=0|tf=0|txt=working"
	state.Signatures["fs.list_dir|path=/"] = 2

	summary := turnAttemptSummary{
		AttemptIndex:       2,
		ToolCalls:          1,
		ToolCallNames:      []string{"fs.list_dir"},
		ToolCallSignatures: []string{"fs.list_dir|path=/"},
		AssistantText:      "I am still checking the directory.",
	}

	decision := decideTaskLoop(cfg, &state, summary, "Call fs.stat for '/'.")
	if !decision.FailRun {
		t.Fatalf("expected fail decision, got %+v", decision)
	}
	if decision.Continue {
		t.Fatalf("unexpected continue decision: %+v", decision)
	}
	if decision.Reason != "loop_guard_repeated_signature" {
		t.Fatalf("reason=%q, want loop_guard_repeated_signature", decision.Reason)
	}
	if !strings.Contains(strings.ToLower(decision.FailureMessage), "repeated") {
		t.Fatalf("failure_message=%q, want repeated pattern hint", decision.FailureMessage)
	}
}

func TestDecideTaskLoop_OutcomeFollowUpHintContinues(t *testing.T) {
	t.Parallel()

	cfg := defaultTaskLoopConfig()
	state := newTaskLoopState("Call fs.stat for '/'. Then output whether it is directory.")
	summary := turnAttemptSummary{
		AttemptIndex:             0,
		ToolCalls:                1,
		ToolSuccesses:            1,
		ToolCallNames:            []string{"fs.stat"},
		ToolCallSignatures:       []string{"fs.stat|path=/"},
		AssistantText:            "",
		OutcomeNeedsFollowUpHint: true,
	}

	decision := decideTaskLoop(cfg, &state, summary, "Call fs.stat for '/'. Then output whether it is directory.")
	if !decision.Continue {
		t.Fatalf("expected continue decision, got %+v", decision)
	}
	if decision.Reason != "outcome_requires_followup" {
		t.Fatalf("reason=%q, want outcome_requires_followup", decision.Reason)
	}
}

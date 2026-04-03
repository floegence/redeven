package ai

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolFileRead_RespectsLineWindowAndScope(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "note.txt")
	if err := os.WriteFile(target, []byte("line-1\nline-2\nline-3\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	out, err := r.toolFileRead(context.Background(), FileReadArgs{
		FilePath: "note.txt",
		Offset:   2,
		Limit:    1,
	})
	if err != nil {
		t.Fatalf("toolFileRead: %v", err)
	}
	if strings.TrimSpace(out.Content) != "line-2" {
		t.Fatalf("content=%q, want %q", out.Content, "line-2")
	}
	if out.LineOffset != 2 || out.LineCount != 1 || out.TotalLines != 3 || !out.Truncated {
		t.Fatalf("unexpected window=%+v", out)
	}

	if _, err := r.toolFileRead(context.Background(), FileReadArgs{
		FilePath: filepath.Join(string(os.PathSeparator), "tmp", "outside.txt"),
	}); err == nil {
		t.Fatalf("expected out-of-scope read to fail")
	}
}

func TestToolFileEdit_ReplacesExactMatchAndRejectsAmbiguousMatch(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	target := filepath.Join(workspace, "edit.txt")
	if err := os.WriteFile(target, []byte("alpha\nbeta\nalpha\n"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	r := &run{agentHomeDir: workspace, workingDir: workspace}

	if _, err := r.toolFileEdit(context.Background(), FileEditArgs{
		FilePath:  "edit.txt",
		OldString: "alpha",
		NewString: "omega",
	}); err == nil || !strings.Contains(err.Error(), "replace_all=true") {
		t.Fatalf("expected ambiguous match error, got %v", err)
	}

	out, err := r.toolFileEdit(context.Background(), FileEditArgs{
		FilePath:   "edit.txt",
		OldString:  "alpha",
		NewString:  "omega",
		ReplaceAll: true,
	})
	if err != nil {
		t.Fatalf("toolFileEdit replace_all: %v", err)
	}
	if out.ChangeType != "update" || len(out.StructuredDiff) != 1 {
		t.Fatalf("unexpected mutation result=%+v", out)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read edited file: %v", err)
	}
	if strings.Count(string(got), "omega") != 2 {
		t.Fatalf("edited content=%q, want both replacements", string(got))
	}
}

func TestToolFileWrite_CreatesNoopsAndSupportsExitPlanPrompt(t *testing.T) {
	t.Parallel()

	workspace := t.TempDir()
	r := &run{agentHomeDir: workspace, workingDir: workspace, messageID: "msg_exit"}

	out, err := r.toolFileWrite(context.Background(), FileWriteArgs{
		FilePath: "nested/note.txt",
		Content:  "hello structured write\n",
	})
	if err != nil {
		t.Fatalf("toolFileWrite create: %v", err)
	}
	if out.ChangeType != "create" {
		t.Fatalf("change_type=%q, want create", out.ChangeType)
	}

	noop, err := r.toolFileWrite(context.Background(), FileWriteArgs{
		FilePath: "nested/note.txt",
		Content:  "hello structured write\n",
	})
	if err != nil {
		t.Fatalf("toolFileWrite noop: %v", err)
	}
	if noop.ChangeType != "noop" {
		t.Fatalf("change_type=%q, want noop", noop.ChangeType)
	}

	exitResult, err := r.toolExitPlanMode("tool_exit_plan", ExitPlanModeArgs{
		Summary: "Need to write files and run verification.",
	})
	if err != nil {
		t.Fatalf("toolExitPlanMode: %v", err)
	}
	if exitResult.WaitingPrompt == nil || len(exitResult.WaitingPrompt.Questions) != 1 {
		t.Fatalf("waiting prompt=%+v", exitResult.WaitingPrompt)
	}
	question := exitResult.WaitingPrompt.Questions[0]
	if question.ResponseMode != requestUserInputResponseModeSelect {
		t.Fatalf("response_mode=%q, want %q", question.ResponseMode, requestUserInputResponseModeSelect)
	}
	if len(question.Choices) != 2 {
		t.Fatalf("choices=%+v, want 2 choices", question.Choices)
	}
	if len(question.Choices[0].Actions) != 1 || question.Choices[0].Actions[0].Type != requestUserInputActionSetMode || question.Choices[0].Actions[0].Mode != "act" {
		t.Fatalf("first choice actions=%+v, want set_mode act", question.Choices[0].Actions)
	}

	block := ToolCallBlock{
		Type:     "tool-call",
		ToolName: "exit_plan_mode",
		ToolID:   "tool_exit_plan",
		Result: map[string]any{
			"waiting_prompt": exitResult.WaitingPrompt,
			"waiting_user":   true,
		},
	}
	prompt, waitingUser := extractAskUserPromptSnapshot(block, "msg_exit")
	if prompt == nil || !waitingUser {
		t.Fatalf("expected exit_plan_mode waiting prompt snapshot, got prompt=%+v waiting=%v", prompt, waitingUser)
	}
}

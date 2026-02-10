package ai

import (
	"strings"
	"testing"
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

func TestBuildGuardRetryPrompt(t *testing.T) {
	t.Parallel()

	prompt := buildGuardRetryPrompt("请分析这个项目", 1, true)
	if !strings.Contains(prompt, "Retry attempt: 2") {
		t.Fatalf("prompt missing attempt index: %q", prompt)
	}
	if !strings.Contains(prompt, "Original request:") {
		t.Fatalf("prompt missing original request: %q", prompt)
	}
	if !strings.Contains(prompt, "Do not output another preamble.") {
		t.Fatalf("prompt missing anti-preamble instruction: %q", prompt)
	}
}

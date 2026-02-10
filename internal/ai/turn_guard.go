package ai

import (
	"fmt"
	"strings"
)

var guardActionHints = []string{
	"analy",
	"scan",
	"inspect",
	"read",
	"list",
	"check",
	"execute",
	"run",
	"open",
	"explore",
	"diagnose",
	"debug",
	"summar",
	"目录",
	"文件",
	"项目",
	"代码",
	"分析",
	"扫描",
	"查看",
	"读取",
	"执行",
	"检查",
	"排查",
	"命令",
}

var commitmentPhrases = []string{
	"let me",
	"i will",
	"i'll",
	"i am going to",
	"i'm going to",
	"i can start by",
	"first i",
	"i should",
	"我先",
	"我会",
	"我将",
	"我来",
	"先",
	"开始",
	"先看",
	"先读取",
	"先扫描",
	"先分析",
}

func shouldRequireToolExecution(userInput string, intentHints []string) bool {
	text := strings.ToLower(strings.TrimSpace(userInput))
	if text == "" {
		return false
	}
	if containsAny(text, intentHints) {
		return true
	}
	if hasPathHint(text) && containsAny(text, guardActionHints) {
		return true
	}
	if containsAny(text, []string{"pwd", "ls", "cat ", "rg ", "grep ", "tree "}) {
		return true
	}
	return false
}

func hasUnfulfilledActionCommitment(text string) bool {
	normalized := strings.ToLower(strings.TrimSpace(text))
	if normalized == "" {
		return false
	}
	if !containsAny(normalized, commitmentPhrases) {
		return false
	}
	if containsAny(normalized, guardActionHints) {
		return true
	}
	if hasPathHint(normalized) {
		return true
	}
	return false
}

func buildGuardRetryPrompt(userInput string, attemptIdx int, requiresTools bool) string {
	attempt := attemptIdx + 1
	lines := []string{
		"System guard: your previous turn ended too early.",
		fmt.Sprintf("Retry attempt: %d.", attempt),
	}
	if requiresTools {
		lines = append(lines, "You must execute required tools before finishing this turn.")
	} else {
		lines = append(lines, "If inspection or command execution is needed, call tools first and then answer.")
	}
	lines = append(lines,
		"Do not output another preamble.",
		"Start tool calls immediately.",
		"If one tool fails, try an alternative path/tool and continue.",
		"After tool results, provide a concise final answer grounded in those results.",
	)
	if req := strings.TrimSpace(userInput); req != "" {
		lines = append(lines, "Original request: "+req)
	}
	return strings.Join(lines, "\n")
}

func containsAny(text string, hints []string) bool {
	if text == "" || len(hints) == 0 {
		return false
	}
	for _, hint := range hints {
		h := strings.ToLower(strings.TrimSpace(hint))
		if h == "" {
			continue
		}
		if strings.Contains(text, h) {
			return true
		}
	}
	return false
}

func hasPathHint(text string) bool {
	if text == "" {
		return false
	}
	if strings.Contains(text, "~/") || strings.Contains(text, "../") || strings.Contains(text, "./") {
		return true
	}
	if strings.Contains(text, "/") || strings.Contains(text, "\\") {
		return true
	}
	return containsAny(text, []string{"package.json", "go.mod", "readme", "dockerfile", ".go", ".ts", ".md", ".json", ".yaml", ".yml"})
}

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"unicode/utf8"
)

type messageLogEnvelope struct {
	OK   bool `json:"ok"`
	Data struct {
		Messages []logMessage `json:"messages"`
	} `json:"data"`
}

type logMessage struct {
	Role   string `json:"role"`
	Blocks []any  `json:"blocks"`
}

type replayReport struct {
	Status         string   `json:"status"`
	Reasons        []string `json:"reasons,omitempty"`
	AssistantChars int      `json:"assistant_chars"`
	ToolCalls      int      `json:"tool_calls"`
}

func main() {
	messageLogPath := flag.String("message-log", "", "message.log path")
	expect := flag.String("expect", "", "optional expectation: pass|fail")
	flag.Parse()

	if strings.TrimSpace(*messageLogPath) == "" {
		fatalf("--message-log is required")
	}

	report, err := runReplay(strings.TrimSpace(*messageLogPath))
	if err != nil {
		fatalf("replay failed: %v", err)
	}

	b, _ := json.MarshalIndent(report, "", "  ")
	fmt.Println(string(b))

	expected := strings.TrimSpace(strings.ToLower(*expect))
	if expected == "" {
		if report.Status != "pass" {
			os.Exit(2)
		}
		return
	}
	if expected != "pass" && expected != "fail" {
		fatalf("invalid --expect: %s", expected)
	}
	if report.Status != expected {
		os.Exit(3)
	}
}

func runReplay(path string) (replayReport, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return replayReport{}, err
	}
	var logData messageLogEnvelope
	if err := json.Unmarshal(data, &logData); err != nil {
		return replayReport{}, err
	}
	if len(logData.Data.Messages) == 0 {
		return replayReport{Status: "fail", Reasons: []string{"empty_messages"}}, nil
	}

	assistantText := ""
	toolCalls := 0
	for _, message := range logData.Data.Messages {
		if strings.TrimSpace(strings.ToLower(message.Role)) != "assistant" {
			continue
		}
		visibleParts := make([]string, 0, len(message.Blocks))
		for _, rawBlock := range message.Blocks {
			block, ok := rawBlock.(map[string]any)
			if !ok {
				continue
			}
			typeName := strings.TrimSpace(strings.ToLower(anyToString(block["type"])))
			switch typeName {
			case "activity-timeline":
				toolCalls += countActivityTimelineItems(block)
			case "markdown", "text", "thinking":
				content := strings.TrimSpace(anyToString(block["content"]))
				if content == "" {
					continue
				}
				visibleParts = append(visibleParts, content)
			}
		}
		if len(visibleParts) > 0 {
			assistantText = strings.Join(visibleParts, "\n\n")
		}
	}

	reasons := evaluateReplay(assistantText, toolCalls)
	report := replayReport{
		Status:         "pass",
		Reasons:        nil,
		AssistantChars: utf8.RuneCountInString(strings.TrimSpace(assistantText)),
		ToolCalls:      toolCalls,
	}
	if len(reasons) > 0 {
		report.Status = "fail"
		report.Reasons = reasons
	}
	return report, nil
}

func evaluateReplay(assistantText string, toolCalls int) []string {
	text := strings.TrimSpace(strings.ToLower(assistantText))
	reasons := make([]string, 0, 4)
	if text == "" {
		reasons = append(reasons, "empty_assistant_text")
	}
	fallbackPhrases := []string{
		"assistant finished without a visible response",
		"tool workflow failed",
		"no response",
	}
	for _, phrase := range fallbackPhrases {
		if strings.Contains(text, phrase) {
			reasons = append(reasons, "fallback_phrase:"+phrase)
			break
		}
	}
	if toolCalls > 0 && utf8.RuneCountInString(text) < 40 {
		reasons = append(reasons, "too_short_after_tool_calls")
	}
	if toolCalls >= 6 && !containsAny(text, []string{"conclusion", "result", "findings", "summary"}) {
		reasons = append(reasons, "many_tool_calls_without_conclusion")
	}
	return reasons
}

func containsAny(text string, hints []string) bool {
	for _, hint := range hints {
		if strings.Contains(text, strings.ToLower(strings.TrimSpace(hint))) {
			return true
		}
	}
	return false
}

func countActivityTimelineItems(block map[string]any) int {
	items, _ := block["items"].([]any)
	count := len(items)
	if count == 0 {
		summary, _ := block["summary"].(map[string]any)
		if total := intFromJSONNumber(summary["total_items"]); total > 0 {
			return total
		}
	}
	return count
}

func intFromJSONNumber(v any) int {
	switch x := v.(type) {
	case float64:
		if x > 0 {
			return int(x)
		}
	case int:
		if x > 0 {
			return x
		}
	}
	return 0
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return ""
	}
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[ai-loop-replay] "+format+"\n", args...)
	os.Exit(1)
}

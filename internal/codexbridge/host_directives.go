package codexbridge

import "strings"

type parsedAssistantText struct {
	Text       string
	Directives []hostDirective
}

type hostDirective struct {
	Name string
	Args string
	Raw  string
}

var knownHostDirectiveNames = map[string]struct{}{
	"archive":           {},
	"code-comment":      {},
	"git-commit":        {},
	"git-create-branch": {},
	"git-create-pr":     {},
	"git-push":          {},
	"git-stage":         {},
}

func parseAssistantHostDirectives(text string) parsedAssistantText {
	if text == "" {
		return parsedAssistantText{}
	}
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	kept := make([]string, 0, len(lines))
	directives := make([]hostDirective, 0)
	inFence := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if isMarkdownFenceLine(trimmed) {
			kept = append(kept, line)
			inFence = !inFence
			continue
		}
		if !inFence {
			if parsed, ok := parseHostDirectiveOnlyLine(trimmed); ok {
				directives = append(directives, parsed...)
				continue
			}
		}
		kept = append(kept, line)
	}
	return parsedAssistantText{
		Text:       strings.TrimSpace(strings.Join(kept, "\n")),
		Directives: directives,
	}
}

func cleanAssistantHostDirectiveText(text string) string {
	return parseAssistantHostDirectives(text).Text
}

func isMarkdownFenceLine(trimmed string) bool {
	return strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")
}

func parseHostDirectiveOnlyLine(line string) ([]hostDirective, bool) {
	if line == "" || !strings.HasPrefix(line, "::") {
		return nil, false
	}
	remaining := line
	directives := make([]hostDirective, 0, 1)
	for {
		remaining = strings.TrimSpace(remaining)
		if remaining == "" {
			return directives, len(directives) > 0
		}
		directive, rest, ok := parseKnownHostDirectivePrefix(remaining)
		if !ok {
			return nil, false
		}
		directives = append(directives, directive)
		remaining = rest
	}
}

func parseKnownHostDirectivePrefix(input string) (hostDirective, string, bool) {
	if !strings.HasPrefix(input, "::") {
		return hostDirective{}, input, false
	}
	cursor := len("::")
	for cursor < len(input) {
		ch := input[cursor]
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' {
			cursor++
			continue
		}
		break
	}
	name := input[len("::"):cursor]
	if _, ok := knownHostDirectiveNames[name]; !ok || name == "" {
		return hostDirective{}, input, false
	}
	if cursor >= len(input) || input[cursor] != '{' {
		return hostDirective{}, input, false
	}
	closeIndex := findDirectiveCloseBrace(input, cursor)
	if closeIndex < 0 {
		return hostDirective{}, input, false
	}
	raw := input[:closeIndex+1]
	return hostDirective{
		Name: name,
		Args: input[cursor+1 : closeIndex],
		Raw:  raw,
	}, input[closeIndex+1:], true
}

func findDirectiveCloseBrace(input string, openIndex int) int {
	inQuote := false
	escaped := false
	for index := openIndex + 1; index < len(input); index++ {
		ch := input[index]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' && inQuote {
			escaped = true
			continue
		}
		if ch == '"' {
			inQuote = !inQuote
			continue
		}
		if ch == '}' && !inQuote {
			return index
		}
	}
	return -1
}

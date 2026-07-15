package ai

import "strings"

const (
	subagentTaskNameMaxWords = 5
	subagentTaskNameMaxBytes = 48
)

var subagentTaskNameInitialisms = map[string]string{
	"ai":    "AI",
	"api":   "API",
	"cli":   "CLI",
	"cpu":   "CPU",
	"css":   "CSS",
	"gpu":   "GPU",
	"html":  "HTML",
	"http":  "HTTP",
	"https": "HTTPS",
	"id":    "ID",
	"json":  "JSON",
	"llm":   "LLM",
	"mcp":   "MCP",
	"okf":   "OKF",
	"oss":   "OSS",
	"rpc":   "RPC",
	"sdk":   "SDK",
	"sql":   "SQL",
	"ssh":   "SSH",
	"ui":    "UI",
	"url":   "URL",
	"ux":    "UX",
	"wasm":  "WASM",
}

func resolveSubagentTaskName(taskName, legacyTitle, taskDescription, message, objective, agentType string) string {
	raw := firstNonEmptyString(taskName, legacyTitle)
	fallback := firstNonEmptyString(taskDescription, message, objective)
	return normalizeSubagentTaskName(raw, fallback, agentType)
}

func normalizeSubagentTaskName(raw, fallback, agentType string) string {
	tokens := tokenizeSubagentTaskName(firstNonEmptyString(raw, fallback))
	if len(tokens) == 0 {
		return subagentTaskNameRoleFallback(agentType)
	}

	words := make([]string, 0, min(len(tokens), subagentTaskNameMaxWords))
	for _, token := range tokens {
		if len(words) >= subagentTaskNameMaxWords {
			break
		}
		word := formatSubagentTaskNameToken(token)
		if word == "" {
			continue
		}
		candidate := word
		if len(words) > 0 {
			candidate = strings.Join(words, " ") + " " + word
		}
		if len(candidate) > subagentTaskNameMaxBytes {
			if len(words) == 0 {
				words = append(words, word[:subagentTaskNameMaxBytes])
			}
			break
		}
		words = append(words, word)
	}
	if len(words) == 0 {
		return subagentTaskNameRoleFallback(agentType)
	}
	return strings.Join(words, " ")
}

func tokenizeSubagentTaskName(raw string) []string {
	runes := []rune(strings.TrimSpace(raw))
	tokens := make([]string, 0, subagentTaskNameMaxWords)
	current := make([]rune, 0, 16)
	flush := func() {
		if len(current) == 0 {
			return
		}
		tokens = append(tokens, string(current))
		current = current[:0]
	}

	for index, value := range runes {
		if !isASCIIAlphaNumeric(value) {
			flush()
			continue
		}
		if len(current) > 0 && isASCIIUpper(value) {
			previous := current[len(current)-1]
			nextIsLower := index+1 < len(runes) && isASCIILower(runes[index+1])
			if isASCIILower(previous) || isASCIIDigit(previous) || isASCIIUpper(previous) && nextIsLower {
				flush()
			}
		}
		current = append(current, value)
	}
	flush()
	return tokens
}

func formatSubagentTaskNameToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if initialism, ok := subagentTaskNameInitialisms[strings.ToLower(token)]; ok {
		return initialism
	}
	if isASCIIUpperWord(token) {
		return token
	}
	lower := strings.ToLower(token)
	return strings.ToUpper(lower[:1]) + lower[1:]
}

func subagentTaskNameRoleFallback(agentType string) string {
	switch normalizeSubagentAgentType(agentType) {
	case subagentAgentTypeWorker:
		return "Implementation Task"
	case subagentAgentTypeReviewer:
		return "Review Task"
	default:
		return "Research Task"
	}
}

func isASCIIAlphaNumeric(value rune) bool {
	return isASCIIUpper(value) || isASCIILower(value) || isASCIIDigit(value)
}

func isASCIIUpper(value rune) bool {
	return value >= 'A' && value <= 'Z'
}

func isASCIILower(value rune) bool {
	return value >= 'a' && value <= 'z'
}

func isASCIIDigit(value rune) bool {
	return value >= '0' && value <= '9'
}

func isASCIIUpperWord(value string) bool {
	hasLetter := false
	for _, char := range value {
		if isASCIILower(char) {
			return false
		}
		if isASCIIUpper(char) {
			hasLetter = true
		}
	}
	return hasLetter
}

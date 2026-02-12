package tools

import (
	"regexp"
	"strings"
	"unicode"
)

type TerminalCommandRisk string

const (
	TerminalCommandRiskReadonly  TerminalCommandRisk = "readonly"
	TerminalCommandRiskMutating  TerminalCommandRisk = "mutating"
	TerminalCommandRiskDangerous TerminalCommandRisk = "dangerous"
)

var dangerousCommandPatterns = []*regexp.Regexp{
	regexp.MustCompile(`:\(\)\s*\{\s*:\|:&\s*\};:`),
	regexp.MustCompile(`\brm\s+-rf\s+(?:--no-preserve-root\s+)?/\s*(?:$|[;&|])`),
	regexp.MustCompile(`\bmkfs(?:\.[a-z0-9_-]+)?\b`),
	regexp.MustCompile(`\bdd\b[^\n]*\bof=/dev/`),
	regexp.MustCompile(`\b(?:shutdown|reboot|poweroff|halt)\b`),
}

var readonlyVerbs = map[string]struct{}{
	"basename": {},
	"cat":      {},
	"cut":      {},
	"dirname":  {},
	"find":     {},
	"grep":     {},
	"head":     {},
	"ls":       {},
	"pwd":      {},
	"realpath": {},
	"rg":       {},
	"sort":     {},
	"stat":     {},
	"tail":     {},
	"test":     {},
	"uniq":     {},
	"wc":       {},
	"which":    {},
}

var readonlyGitSubcommands = map[string]struct{}{
	"branch":    {},
	"diff":      {},
	"grep":      {},
	"log":       {},
	"ls-files":  {},
	"remote":    {},
	"rev-parse": {},
	"show":      {},
	"status":    {},
	"tag":       {},
}

func ClassifyTerminalCommandRisk(command string) TerminalCommandRisk {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return TerminalCommandRiskMutating
	}
	lower := strings.ToLower(trimmed)
	for _, p := range dangerousCommandPatterns {
		if p.MatchString(lower) {
			return TerminalCommandRiskDangerous
		}
	}

	segments := splitShellSegments(trimmed)
	if len(segments) == 0 {
		return TerminalCommandRiskMutating
	}
	for _, seg := range segments {
		if !isReadonlyShellSegment(seg) {
			return TerminalCommandRiskMutating
		}
	}
	return TerminalCommandRiskReadonly
}

func commandFromArgs(args map[string]any) string {
	if args == nil {
		return ""
	}
	raw, ok := args["command"]
	if !ok {
		return ""
	}
	s, _ := raw.(string)
	return strings.TrimSpace(s)
}

func splitShellSegments(command string) []string {
	var out []string
	var sb strings.Builder
	var quote rune
	escaped := false
	runes := []rune(command)
	flush := func() {
		part := strings.TrimSpace(sb.String())
		if part != "" {
			out = append(out, part)
		}
		sb.Reset()
	}
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		if escaped {
			sb.WriteRune(ch)
			escaped = false
			continue
		}
		if quote == 0 && ch == '\\' {
			escaped = true
			sb.WriteRune(ch)
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			if quote == 0 {
				quote = ch
			} else if quote == ch {
				quote = 0
			}
			sb.WriteRune(ch)
			continue
		}
		if quote == 0 {
			if ch == '\n' || ch == ';' {
				flush()
				continue
			}
			if ch == '|' {
				flush()
				if i+1 < len(runes) && runes[i+1] == '|' {
					i++
				}
				continue
			}
			if ch == '&' && i+1 < len(runes) && runes[i+1] == '&' {
				flush()
				i++
				continue
			}
		}
		sb.WriteRune(ch)
	}
	flush()
	return out
}

func isReadonlyShellSegment(segment string) bool {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return false
	}
	if hasWriteRedirection(segment) {
		return false
	}
	fields := strings.Fields(segment)
	if len(fields) == 0 {
		return false
	}

	idx := 0
	for idx < len(fields) && isEnvAssignment(fields[idx]) {
		idx++
	}
	if idx >= len(fields) {
		return false
	}

	verb := strings.ToLower(strings.TrimSpace(fields[idx]))
	args := fields[idx+1:]

	if verb == "git" {
		sub := firstNonFlag(args)
		if sub == "" {
			return false
		}
		_, ok := readonlyGitSubcommands[strings.ToLower(sub)]
		return ok
	}
	if verb == "sed" {
		lower := strings.ToLower(segment)
		if strings.Contains(lower, " -i") || strings.HasPrefix(lower, "sed -i") {
			return false
		}
		return strings.Contains(lower, "-n")
	}

	_, ok := readonlyVerbs[verb]
	return ok
}

func hasWriteRedirection(segment string) bool {
	lower := strings.ToLower(segment)
	lower = strings.ReplaceAll(lower, "2>&1", "")
	lower = strings.ReplaceAll(lower, "1>&2", "")
	lower = strings.ReplaceAll(lower, ">/dev/null", "")
	lower = strings.ReplaceAll(lower, "2>/dev/null", "")
	return strings.Contains(lower, ">")
}

func isEnvAssignment(token string) bool {
	token = strings.TrimSpace(token)
	if token == "" {
		return false
	}
	eq := strings.IndexRune(token, '=')
	if eq <= 0 {
		return false
	}
	name := token[:eq]
	for i, ch := range name {
		if i == 0 {
			if !(ch == '_' || unicode.IsLetter(ch)) {
				return false
			}
			continue
		}
		if !(ch == '_' || unicode.IsLetter(ch) || unicode.IsDigit(ch)) {
			return false
		}
	}
	return true
}

func firstNonFlag(args []string) string {
	for _, arg := range args {
		item := strings.TrimSpace(arg)
		if item == "" {
			continue
		}
		if strings.HasPrefix(item, "-") {
			continue
		}
		return item
	}
	return ""
}

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

const (
	terminalCommandEffectLocalRead    = "local_read"
	terminalCommandEffectLocalWrite   = "local_write"
	terminalCommandEffectNetworkRead  = "network_read"
	terminalCommandEffectNetworkWrite = "network_write"
	terminalCommandEffectDangerous    = "dangerous"
)

type TerminalCommandProfile struct {
	Risk              TerminalCommandRisk
	NormalizedCommand string
	Effects           []string
	Reason            string
}

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
	"egrep":    {},
	"find":     {},
	"fgrep":    {},
	"grep":     {},
	"head":     {},
	"jq":       {},
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

func NormalizeTerminalCommand(command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return ""
	}
	current := trimmed
	for i := 0; i < 4; i++ {
		next, ok := unwrapShellCommandWrapper(current)
		if !ok {
			break
		}
		next = strings.TrimSpace(next)
		if next == "" || next == current {
			break
		}
		current = next
	}
	return strings.TrimSpace(current)
}

func ClassifyTerminalCommandRisk(command string) TerminalCommandRisk {
	return ProfileTerminalCommand(command).Risk
}

func ProfileTerminalCommand(command string) TerminalCommandProfile {
	normalized := NormalizeTerminalCommand(command)
	if normalized == "" {
		return TerminalCommandProfile{
			Risk:              TerminalCommandRiskMutating,
			NormalizedCommand: normalized,
			Reason:            "empty_command",
		}
	}

	lower := strings.ToLower(normalized)
	for _, p := range dangerousCommandPatterns {
		if p.MatchString(lower) {
			return TerminalCommandProfile{
				Risk:              TerminalCommandRiskDangerous,
				NormalizedCommand: normalized,
				Effects:           []string{terminalCommandEffectDangerous},
				Reason:            "dangerous_command_pattern",
			}
		}
	}

	segments := splitShellSegments(normalized)
	if len(segments) == 0 {
		return TerminalCommandProfile{
			Risk:              TerminalCommandRiskMutating,
			NormalizedCommand: normalized,
			Reason:            "empty_command_segments",
		}
	}

	mergedEffects := make([]string, 0, 4)
	firstMutatingReason := ""
	firstReadonlyReason := ""
	for _, seg := range segments {
		profile := classifyShellSegment(seg)
		mergedEffects = appendUniqueStrings(mergedEffects, profile.Effects...)
		if profile.Risk == TerminalCommandRiskReadonly && firstReadonlyReason == "" {
			firstReadonlyReason = strings.TrimSpace(profile.Reason)
		}
		if profile.Risk == TerminalCommandRiskDangerous {
			return TerminalCommandProfile{
				Risk:              TerminalCommandRiskDangerous,
				NormalizedCommand: normalized,
				Effects:           mergedEffects,
				Reason:            profile.Reason,
			}
		}
		if profile.Risk != TerminalCommandRiskReadonly && firstMutatingReason == "" {
			firstMutatingReason = profile.Reason
		}
	}

	risk := TerminalCommandRiskReadonly
	reason := firstReadonlyReason
	if reason == "" {
		reason = "readonly_command_chain"
	}
	if firstMutatingReason != "" {
		risk = TerminalCommandRiskMutating
		reason = firstMutatingReason
	}
	if len(mergedEffects) == 0 && risk == TerminalCommandRiskReadonly {
		mergedEffects = []string{terminalCommandEffectLocalRead}
	}
	return TerminalCommandProfile{
		Risk:              risk,
		NormalizedCommand: normalized,
		Effects:           mergedEffects,
		Reason:            reason,
	}
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

func unwrapShellCommandWrapper(command string) (string, bool) {
	fields := shellFields(command)
	if len(fields) < 3 {
		return "", false
	}
	idx := 0
	for idx < len(fields) && isEnvAssignment(fields[idx]) {
		idx++
	}
	if idx >= len(fields) {
		return "", false
	}

	binary := strings.ToLower(strings.TrimSpace(fields[idx]))
	switch binary {
	case "bash", "sh", "zsh", "dash":
	default:
		return "", false
	}
	idx++
	if idx >= len(fields) {
		return "", false
	}

	scriptIndex := -1
	for ; idx < len(fields); idx++ {
		flag := strings.ToLower(strings.TrimSpace(fields[idx]))
		switch flag {
		case "-c", "--command":
			scriptIndex = idx + 1
			idx = len(fields)
		case "-lc", "-cl":
			scriptIndex = idx + 1
			idx = len(fields)
		case "-l", "--login", "-i", "--interactive", "--norc", "--noprofile":
			continue
		default:
			return "", false
		}
	}
	if scriptIndex < 0 || scriptIndex >= len(fields) {
		return "", false
	}
	inner := strings.TrimSpace(fields[scriptIndex])
	if inner == "" {
		return "", false
	}
	return inner, true
}

func shellFields(command string) []string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return nil
	}
	out := make([]string, 0, 8)
	var sb strings.Builder
	var quote rune
	escaped := false
	flush := func() {
		if sb.Len() == 0 {
			return
		}
		out = append(out, sb.String())
		sb.Reset()
	}
	for _, ch := range trimmed {
		if escaped {
			sb.WriteRune(ch)
			escaped = false
			continue
		}
		if quote == 0 && ch == '\\' {
			escaped = true
			continue
		}
		if quote == 0 {
			switch ch {
			case '\'', '"':
				quote = ch
				continue
			case ' ', '\t', '\n':
				flush()
				continue
			}
		} else if ch == quote {
			quote = 0
			continue
		}
		sb.WriteRune(ch)
	}
	flush()
	return out
}

func classifyShellSegment(segment string) TerminalCommandProfile {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return TerminalCommandProfile{
			Risk:   TerminalCommandRiskMutating,
			Reason: "empty_segment",
		}
	}
	if hasWriteRedirection(segment) {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectLocalWrite},
			Reason:  "shell_write_redirection",
		}
	}

	fields := shellFields(segment)
	if len(fields) == 0 {
		return TerminalCommandProfile{
			Risk:   TerminalCommandRiskMutating,
			Reason: "empty_segment",
		}
	}

	idx := 0
	for idx < len(fields) && isEnvAssignment(fields[idx]) {
		idx++
	}
	if idx >= len(fields) {
		return TerminalCommandProfile{
			Risk:   TerminalCommandRiskMutating,
			Reason: "env_assignments_without_command",
		}
	}

	verb := strings.ToLower(strings.TrimSpace(fields[idx]))
	args := fields[idx+1:]

	if profile, ok := classifyNetworkFetchCommand(verb, args); ok {
		return profile
	}

	if verb == "git" {
		sub := firstNonFlag(args)
		if sub == "" {
			return TerminalCommandProfile{
				Risk:   TerminalCommandRiskMutating,
				Reason: "git_missing_subcommand",
			}
		}
		if _, ok := readonlyGitSubcommands[strings.ToLower(sub)]; ok {
			return TerminalCommandProfile{
				Risk:    TerminalCommandRiskReadonly,
				Effects: []string{terminalCommandEffectLocalRead},
				Reason:  "git_readonly_subcommand",
			}
		}
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectLocalWrite},
			Reason:  "git_mutating_or_unknown_subcommand",
		}
	}

	if verb == "sed" {
		lower := strings.ToLower(segment)
		if strings.Contains(lower, " -i") || strings.HasPrefix(lower, "sed -i") {
			return TerminalCommandProfile{
				Risk:    TerminalCommandRiskMutating,
				Effects: []string{terminalCommandEffectLocalWrite},
				Reason:  "sed_in_place",
			}
		}
		if strings.Contains(lower, "-n") {
			return TerminalCommandProfile{
				Risk:    TerminalCommandRiskReadonly,
				Effects: []string{terminalCommandEffectLocalRead},
				Reason:  "sed_print_only",
			}
		}
		return TerminalCommandProfile{
			Risk:   TerminalCommandRiskMutating,
			Reason: "sed_without_print_only",
		}
	}

	if _, ok := readonlyVerbs[verb]; ok {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskReadonly,
			Effects: []string{terminalCommandEffectLocalRead},
			Reason:  "readonly_verb",
		}
	}

	return TerminalCommandProfile{
		Risk:   TerminalCommandRiskMutating,
		Reason: "unknown_command",
	}
}

func classifyNetworkFetchCommand(verb string, args []string) (TerminalCommandProfile, bool) {
	switch strings.ToLower(strings.TrimSpace(verb)) {
	case "curl":
		return classifyCurlCommand(args), true
	case "wget":
		return classifyWgetCommand(args), true
	default:
		return TerminalCommandProfile{}, false
	}
}

func classifyCurlCommand(args []string) TerminalCommandProfile {
	hasBody := false
	forceGet := false
	headOnly := false
	explicitMethod := ""
	mutatingReason := ""
	mutatingEffects := []string(nil)

	setMutating := func(reason string, effects ...string) {
		if mutatingReason != "" {
			return
		}
		mutatingReason = strings.TrimSpace(reason)
		mutatingEffects = appendUniqueStrings(mutatingEffects, effects...)
	}

	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		if arg == "" {
			continue
		}
		if arg == "--" {
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			continue
		}
		if strings.HasPrefix(arg, "--") {
			name, value, hasValue := splitLongOption(arg)
			switch name {
			case "get":
				forceGet = true
			case "head":
				headOnly = true
			case "request":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				explicitMethod = strings.ToUpper(strings.TrimSpace(value))
			case "data", "data-ascii", "data-binary", "data-raw", "data-urlencode", "json":
				hasBody = true
			case "form", "form-string":
				hasBody = true
				setMutating("curl_form_body", terminalCommandEffectNetworkWrite)
			case "upload-file":
				setMutating("curl_upload_file", terminalCommandEffectNetworkWrite)
			case "output", "dump-header", "stderr", "trace", "trace-ascii":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					setMutating("curl_output_file", terminalCommandEffectLocalWrite)
				}
			case "remote-name", "remote-name-all":
				setMutating("curl_remote_name_output", terminalCommandEffectLocalWrite)
			case "cookie-jar", "hsts", "alt-svc":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					setMutating("curl_local_state_file", terminalCommandEffectLocalWrite)
				}
			}
			continue
		}

		short := arg[1:]
		for pos := 0; pos < len(short); pos++ {
			ch := short[pos]
			inlineValue := ""
			if pos+1 < len(short) {
				inlineValue = short[pos+1:]
			}
			switch ch {
			case 'G':
				forceGet = true
			case 'I':
				headOnly = true
			case 'O':
				setMutating("curl_remote_name_output", terminalCommandEffectLocalWrite)
			case 'o', 'D', 'c':
				value := inlineValue
				if value == "" {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					reason := "curl_output_file"
					if ch == 'c' {
						reason = "curl_local_state_file"
					}
					setMutating(reason, terminalCommandEffectLocalWrite)
				}
				pos = len(short)
			case 'X':
				value := inlineValue
				if value == "" {
					value, i = consumeNextArg(args, i)
				}
				explicitMethod = strings.ToUpper(strings.TrimSpace(value))
				pos = len(short)
			case 'd':
				hasBody = true
				pos = len(short)
			case 'F':
				hasBody = true
				setMutating("curl_form_body", terminalCommandEffectNetworkWrite)
				pos = len(short)
			case 'T':
				setMutating("curl_upload_file", terminalCommandEffectNetworkWrite)
				pos = len(short)
			default:
				if curlShortOptionConsumesValue(ch) {
					if inlineValue == "" {
						_, i = consumeNextArg(args, i)
					}
					pos = len(short)
				}
			}
		}
	}

	if mutatingReason != "" {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: mutatingEffects,
			Reason:  mutatingReason,
		}
	}

	if hasBody && !forceGet {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectNetworkWrite},
			Reason:  "curl_request_body",
		}
	}

	method := explicitMethod
	if forceGet {
		method = "GET"
	} else if method == "" && headOnly {
		method = "HEAD"
	}
	if method == "" {
		method = "GET"
	}
	if !isReadonlyHTTPMethod(method) {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectNetworkWrite},
			Reason:  "curl_explicit_mutating_method",
		}
	}

	return TerminalCommandProfile{
		Risk:    TerminalCommandRiskReadonly,
		Effects: []string{terminalCommandEffectNetworkRead},
		Reason:  "http_fetch_stdout_readonly",
	}
}

func classifyWgetCommand(args []string) TerminalCommandProfile {
	explicitMethod := ""
	hasBody := false
	spiderOnly := false
	mutatingReason := ""
	mutatingEffects := []string(nil)

	setMutating := func(reason string, effects ...string) {
		if mutatingReason != "" {
			return
		}
		mutatingReason = strings.TrimSpace(reason)
		mutatingEffects = appendUniqueStrings(mutatingEffects, effects...)
	}

	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		if arg == "" {
			continue
		}
		if arg == "--" {
			break
		}
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			continue
		}
		if strings.HasPrefix(arg, "--") {
			name, value, hasValue := splitLongOption(arg)
			switch name {
			case "spider":
				spiderOnly = true
			case "method":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				explicitMethod = strings.ToUpper(strings.TrimSpace(value))
			case "post-data", "post-file", "body-data", "body-file":
				hasBody = true
			case "output-document", "output-file", "append-output":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					setMutating("wget_output_file", terminalCommandEffectLocalWrite)
				}
			case "save-cookies":
				if !hasValue {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					setMutating("wget_local_state_file", terminalCommandEffectLocalWrite)
				}
			}
			continue
		}

		short := arg[1:]
		for pos := 0; pos < len(short); pos++ {
			ch := short[pos]
			inlineValue := ""
			if pos+1 < len(short) {
				inlineValue = short[pos+1:]
			}
			switch ch {
			case 'O', 'o', 'a':
				value := inlineValue
				if value == "" {
					value, i = consumeNextArg(args, i)
				}
				if !isNonPersistentOutputSink(value) {
					setMutating("wget_output_file", terminalCommandEffectLocalWrite)
				}
				pos = len(short)
			default:
				if wgetShortOptionConsumesValue(ch) {
					if inlineValue == "" {
						_, i = consumeNextArg(args, i)
					}
					pos = len(short)
				}
			}
		}
	}

	if mutatingReason != "" {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: mutatingEffects,
			Reason:  mutatingReason,
		}
	}
	if hasBody {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectNetworkWrite},
			Reason:  "wget_request_body",
		}
	}

	method := explicitMethod
	if method == "" && spiderOnly {
		method = "HEAD"
	}
	if method == "" {
		method = "GET"
	}
	if !isReadonlyHTTPMethod(method) {
		return TerminalCommandProfile{
			Risk:    TerminalCommandRiskMutating,
			Effects: []string{terminalCommandEffectNetworkWrite},
			Reason:  "wget_explicit_mutating_method",
		}
	}

	return TerminalCommandProfile{
		Risk:    TerminalCommandRiskReadonly,
		Effects: []string{terminalCommandEffectNetworkRead},
		Reason:  "http_fetch_stdout_readonly",
	}
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

func splitLongOption(arg string) (name string, value string, hasValue bool) {
	trimmed := strings.TrimSpace(arg)
	if !strings.HasPrefix(trimmed, "--") {
		return "", "", false
	}
	trimmed = strings.TrimPrefix(trimmed, "--")
	if idx := strings.Index(trimmed, "="); idx >= 0 {
		return strings.ToLower(strings.TrimSpace(trimmed[:idx])), strings.TrimSpace(trimmed[idx+1:]), true
	}
	return strings.ToLower(strings.TrimSpace(trimmed)), "", false
}

func consumeNextArg(args []string, index int) (string, int) {
	next := index + 1
	if next >= len(args) {
		return "", index
	}
	return strings.TrimSpace(args[next]), next
}

func appendUniqueStrings(base []string, values ...string) []string {
	if len(values) == 0 {
		return base
	}
	if base == nil {
		base = make([]string, 0, len(values))
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		exists := false
		for _, item := range base {
			if item == value {
				exists = true
				break
			}
		}
		if !exists {
			base = append(base, value)
		}
	}
	return base
}

func curlShortOptionConsumesValue(ch byte) bool {
	switch ch {
	case 'A', 'b', 'c', 'd', 'D', 'e', 'E', 'F', 'H', 'm', 'o', 'T', 'u', 'w', 'x', 'X', 'Y', 'y', 'z':
		return true
	default:
		return false
	}
}

func wgetShortOptionConsumesValue(ch byte) bool {
	switch ch {
	case 'O', 'o', 'a':
		return true
	default:
		return false
	}
}

func isReadonlyHTTPMethod(method string) bool {
	switch strings.ToUpper(strings.TrimSpace(method)) {
	case "GET", "HEAD":
		return true
	default:
		return false
	}
}

func isNonPersistentOutputSink(value string) bool {
	v := strings.ToLower(strings.TrimSpace(value))
	switch v {
	case "-", "/dev/null", "/dev/stdout", "/dev/stderr":
		return true
	default:
		return false
	}
}

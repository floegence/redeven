package ai

import "strings"

func cloneStringSlice(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func sanitizeReadonlyAllowlist(allowlist []string) []string {
	return sanitizeSubagentToolAllowlist(allowlist, defaultSubagentToolAllowlistReadonly(), true)
}

func sanitizeSubagentToolAllowlist(allowlist []string, fallback []string, readonlyOnly bool) []string {
	defByName := make(map[string]ToolDef)
	for _, def := range builtInModelCapabilityDefinitions() {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		defByName[name] = def
	}
	filter := func(source []string) []string {
		if len(source) == 0 {
			return nil
		}
		seen := make(map[string]struct{})
		out := make([]string, 0, len(source))
		for _, rawName := range source {
			name := strings.TrimSpace(rawName)
			if name == "" {
				continue
			}
			if isSubagentDisallowedTool(name) {
				continue
			}
			if def, ok := defByName[name]; ok && readonlyOnly && def.Mutating {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			out = append(out, name)
		}
		return out
	}
	source := allowlist
	if len(source) == 0 {
		source = append([]string(nil), fallback...)
	}
	out := filter(source)
	if len(out) == 0 && len(fallback) > 0 {
		out = filter(fallback)
	}
	return out
}

func isSubagentDisallowedTool(name string) bool {
	switch strings.TrimSpace(name) {
	case "subagents", "write_todos", "ask_user", "exit_plan_mode":
		return true
	default:
		return false
	}
}

func defaultSubagentToolAllowlistReadonly() []string {
	defs := builtInModelCapabilityDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		if def.Mutating {
			continue
		}
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}

func defaultSubagentToolAllowlistWorker() []string {
	defs := builtInModelCapabilityDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}

func parseBoolArg(args map[string]any, key string, fallback bool) bool {
	raw, ok := args[key]
	if !ok {
		return fallback
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "y", "on":
			return true
		case "0", "false", "no", "n", "off":
			return false
		default:
			return fallback
		}
	default:
		return fallback
	}
}

func collectInspectTargets(args map[string]any) []string {
	out := make([]string, 0, 4)
	seen := map[string]struct{}{}
	appendID := func(raw string) {
		id := strings.TrimSpace(raw)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	appendID(anyToString(args["target"]))
	for _, id := range extractStringSlice(args["ids"]) {
		appendID(id)
	}
	return out
}

func parseIntArg(args map[string]any, key string, fallback int) int {
	if len(args) == 0 {
		return fallback
	}
	if !strings.Contains(key, ".") {
		return parseIntRaw(args[key], fallback)
	}
	parts := strings.Split(key, ".")
	current := any(args)
	for _, part := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return fallback
		}
		current = m[part]
	}
	return parseIntRaw(current, fallback)
}

func parseIntRaw(v any, fallback int) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case float32:
		return int(x)
	default:
		return fallback
	}
}

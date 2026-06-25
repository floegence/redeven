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

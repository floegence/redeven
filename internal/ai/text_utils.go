package ai

import (
	"encoding/json"
	"strconv"
	"strings"
)

func truncateRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "\n... (truncated)"
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []byte:
		return string(x)
	default:
		return ""
	}
}

func anyToBool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true" || x == "TRUE" || x == "True"
	default:
		return false
	}
}

func readIntField(obj map[string]any, keys ...string) int {
	return int(readInt64Field(obj, keys...))
}

func readInt64Field(obj map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := obj[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case json.Number:
			if parsed, err := typed.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func readBoolField(obj map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := obj[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
			if err == nil {
				return parsed
			}
		case float64:
			return typed != 0
		case int:
			return typed != 0
		case int64:
			return typed != 0
		}
	}
	return false
}

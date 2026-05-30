package flowertransfer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func stableHash(value any) (string, error) {
	raw, err := stableJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func stableJSON(value any) ([]byte, error) {
	normalized := normalizeJSONValue(value)
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func normalizeJSONValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(v))
		for _, key := range keys {
			out[key] = normalizeJSONValue(v[key])
		}
		return out
	case map[string]string:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		out := make(map[string]string, len(v))
		for _, key := range keys {
			out[key] = strings.TrimSpace(v[key])
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i := range v {
			out[i] = normalizeJSONValue(v[i])
		}
		return out
	default:
		return v
	}
}

func mustStableHash(value any) string {
	hash, err := stableHash(value)
	if err != nil {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%+v", value)))
		return "sha256:" + hex.EncodeToString(sum[:])
	}
	return hash
}

func shortHashID(prefix string, hash string) string {
	hash = strings.TrimPrefix(strings.TrimSpace(hash), "sha256:")
	if len(hash) > 24 {
		hash = hash[:24]
	}
	if hash == "" {
		return ""
	}
	return prefix + hash
}

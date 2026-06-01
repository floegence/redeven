package flowerhost

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type TargetCatalog struct {
	store *ConfigStore
}

func NewTargetCatalog(store *ConfigStore) *TargetCatalog {
	return &TargetCatalog{store: store}
}

func (c *TargetCatalog) ListTargets(ctx context.Context) ([]FlowerTargetRef, error) {
	if c == nil || c.store == nil {
		return nil, errors.New("target catalog not initialized")
	}
	cache, err := c.store.LoadTargetCache(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]FlowerTargetRef, 0, len(cache.Entries))
	for _, entry := range cache.Entries {
		if target := targetRefFromCacheEntry(entry); target.TargetID != "" {
			out = append(out, target)
		}
	}
	return out, nil
}

func targetRefFromCacheEntry(entry TargetCacheEntry) FlowerTargetRef {
	metadata := decodeTargetMetadata(entry.Metadata)
	targetID := strings.TrimSpace(entry.TargetID)
	providerOrigin := compactMetadataString(metadata, "provider_origin")
	envPublicID := compactMetadataString(metadata, "env_public_id")
	label := strings.TrimSpace(entry.Label)
	if label == "" {
		label = envPublicID
	}
	if label == "" {
		label = targetID
	}
	runtimeStatus := compactMetadataString(metadata, "runtime_status")
	connectState := compactMetadataString(metadata, "connect_state")
	if connectState == "" {
		connectState = TargetConnectUnknown
	}
	capabilities := metadataStringSlice(metadata, "capabilities")
	var lastError *TargetConnectError
	if raw, ok := metadata["last_connect_error"].(map[string]any); ok {
		code := strings.TrimSpace(anyToString(raw["code"]))
		message := strings.TrimSpace(anyToString(raw["message"]))
		if code != "" || message != "" {
			lastError = &TargetConnectError{
				Code:     code,
				Message:  message,
				AtUnixMs: int64FromAny(raw["at_unix_ms"]),
			}
		}
	}
	return FlowerTargetRef{
		TargetID:              targetID,
		TargetKind:            firstNonEmpty(compactMetadataString(metadata, "target_kind"), TargetKindProviderEnvironment),
		ProviderOrigin:        providerOrigin,
		ProviderID:            compactMetadataString(metadata, "provider_id"),
		EnvPublicID:           envPublicID,
		NamespacePublicID:     compactMetadataString(metadata, "namespace_public_id"),
		Label:                 label,
		RuntimeStatus:         runtimeStatus,
		Capabilities:          capabilities,
		ConnectState:          connectState,
		LastConnectedAtUnixMs: int64FromAny(metadata["last_connected_at_unix_ms"]),
		LastConnectError:      lastError,
		Metadata:              metadata,
	}
}

func decodeTargetMetadata(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil || metadata == nil {
		return map[string]any{}
	}
	return metadata
}

func compactMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	return strings.TrimSpace(anyToString(metadata[key]))
}

func metadataStringSlice(metadata map[string]any, key string) []string {
	raw, ok := metadata[key]
	if !ok {
		return nil
	}
	switch values := raw.(type) {
	case []string:
		out := make([]string, 0, len(values))
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" {
				out = append(out, value)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(values))
		for _, value := range values {
			if s := strings.TrimSpace(anyToString(value)); s != "" {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

func int64FromAny(raw any) int64 {
	switch value := raw.(type) {
	case int64:
		return value
	case int:
		return int64(value)
	case float64:
		return int64(value)
	default:
		return 0
	}
}

func anyToString(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	case []byte:
		return string(value)
	default:
		return ""
	}
}

package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

const (
	floretTerminalSelectionInlineChars = 10_000
	floretTextSnapshotInlineChars      = 12_000
)

type floretSupplementalContextProjection struct {
	Items         []flruntime.TurnSupplementalContextItem
	RenderedChars int
	Truncated     bool
	ContextHash   string
}

func floretSupplementalContextForInput(input RunInput) (floretSupplementalContextProjection, error) {
	items := make([]flruntime.TurnSupplementalContextItem, 0, contextActionItemCount(input.ContextAction))
	contextItems, err := floretSupplementalContextActionItems(input.ContextAction)
	if err != nil {
		return floretSupplementalContextProjection{}, err
	}
	items = append(items, contextItems...)
	projection := floretSupplementalContextProjection{Items: items}
	if len(items) == 0 {
		return projection, nil
	}
	projection.RenderedChars = floretSupplementalRenderedChars(items)
	projection.Truncated = floretSupplementalHasTruncation(items)
	projection.ContextHash = floretSupplementalContextHash(items)
	return projection, nil
}

func contextActionItemCount(action *ContextActionEnvelope) int {
	if action == nil {
		return 0
	}
	return len(action.Context)
}

func floretSupplementalContextActionItems(action *ContextActionEnvelope) ([]flruntime.TurnSupplementalContextItem, error) {
	action, err := normalizeAskFlowerContextActionEnvelope(action)
	if err != nil {
		return nil, err
	}
	if action == nil {
		return nil, nil
	}
	items := make([]flruntime.TurnSupplementalContextItem, 0, len(action.Context))
	for _, item := range action.Context {
		switch strings.TrimSpace(item.Kind) {
		case contextActionKindFilePath:
			items = append(items, flruntime.TurnSupplementalContextItem{
				Kind:      contextActionKindFilePath,
				Title:     "Linked file path",
				Metadata:  contextActionFilePathMetadata(action, item),
				Sensitive: true,
			})
		case contextActionKindTerminal:
			items = append(items, floretTerminalSelectionSupplementalItem(action, item))
		case contextActionKindProcess:
			items = append(items, flruntime.TurnSupplementalContextItem{
				Kind:      contextActionKindProcess,
				Title:     nonEmptyString(item.Title, item.Name, "Linked process snapshot"),
				Metadata:  contextActionProcessMetadata(action, item),
				Sensitive: true,
			})
		case contextActionKindText:
			items = append(items, floretTextSnapshotSupplementalItem(action, item))
		default:
			return nil, ErrInvalidContextAction
		}
	}
	if len(items) != len(action.Context) {
		return nil, ErrInvalidContextAction
	}
	return items, nil
}

func floretTerminalSelectionSupplementalItem(action *ContextActionEnvelope, item ContextActionContextItem) flruntime.TurnSupplementalContextItem {
	selection := strings.TrimSpace(item.Selection)
	selectionChars := item.SelectionChars
	if selectionChars <= 0 {
		selectionChars = len([]rune(selection))
	}
	metadata := contextActionBaseMetadata(action)
	if workingDir := strings.TrimSpace(item.WorkingDir); workingDir != "" {
		metadata["working_dir"] = workingDir
	}
	if selectionChars > 0 {
		metadata["selection_chars"] = strconv.Itoa(selectionChars)
	}
	out := flruntime.TurnSupplementalContextItem{
		Kind:      contextActionKindTerminal,
		Title:     nonEmptyString(item.Title, "Linked terminal selection"),
		Metadata:  metadata,
		Sensitive: true,
	}
	if selection != "" && len([]rune(selection)) <= floretTerminalSelectionInlineChars {
		out.Text = selection
		return out
	}
	if selection != "" || selectionChars > floretTerminalSelectionInlineChars {
		out.Truncated = true
		metadata["selection_truncated"] = "true"
	}
	return out
}

func floretTextSnapshotSupplementalItem(action *ContextActionEnvelope, item ContextActionContextItem) flruntime.TurnSupplementalContextItem {
	text := strings.TrimSpace(item.Content)
	if text == "" {
		text = strings.TrimSpace(item.Detail)
	}
	truncated := false
	if len([]rune(text)) > floretTextSnapshotInlineChars {
		text = string([]rune(text)[:floretTextSnapshotInlineChars])
		truncated = true
	}
	metadata := contextActionBaseMetadata(action)
	if detail := strings.TrimSpace(item.Detail); detail != "" && detail != text {
		metadata["detail"] = detail
	}
	return flruntime.TurnSupplementalContextItem{
		Kind:      contextActionKindText,
		Title:     nonEmptyString(item.Title, "Linked text snapshot"),
		Text:      text,
		Metadata:  metadata,
		Truncated: truncated,
	}
}

func contextActionFilePathMetadata(action *ContextActionEnvelope, item ContextActionContextItem) map[string]string {
	metadata := contextActionBaseMetadata(action)
	metadata["path"] = strings.TrimSpace(item.Path)
	metadata["is_directory"] = strconv.FormatBool(item.IsDirectory)
	if rootLabel := strings.TrimSpace(item.RootLabel); rootLabel != "" {
		metadata["root_label"] = rootLabel
	}
	return metadata
}

func contextActionProcessMetadata(action *ContextActionEnvelope, item ContextActionContextItem) map[string]string {
	metadata := contextActionBaseMetadata(action)
	if item.PID > 0 {
		metadata["pid"] = strconv.Itoa(item.PID)
	}
	if name := strings.TrimSpace(item.Name); name != "" {
		metadata["name"] = name
	}
	if username := strings.TrimSpace(item.Username); username != "" {
		metadata["username"] = username
	}
	metadata["cpu_percent"] = strconv.FormatFloat(item.CPUPercent, 'f', 2, 64)
	metadata["memory_bytes"] = strconv.FormatInt(item.MemoryBytes, 10)
	if item.MemoryBytes > 0 {
		metadata["memory"] = formatContextActionBytes(item.MemoryBytes)
	}
	if platform := strings.TrimSpace(item.Platform); platform != "" {
		metadata["platform"] = platform
	}
	if item.CapturedAtMs > 0 {
		metadata["captured_at_ms"] = strconv.FormatInt(item.CapturedAtMs, 10)
		metadata["captured_at"] = time.UnixMilli(item.CapturedAtMs).UTC().Format(time.RFC3339)
	}
	return metadata
}

func contextActionBaseMetadata(action *ContextActionEnvelope) map[string]string {
	metadata := map[string]string{}
	if action == nil {
		return metadata
	}
	metadata["source_surface"] = strings.TrimSpace(action.Source.Surface)
	if sourceID := strings.TrimSpace(action.Source.SurfaceID); sourceID != "" {
		metadata["source_surface_id"] = sourceID
	}
	metadata["target_id"] = strings.TrimSpace(action.Target.TargetID)
	metadata["target_locality"] = strings.TrimSpace(action.Target.Locality)
	if dir := strings.TrimSpace(action.SuggestedWorkingDir); dir != "" {
		metadata["suggested_working_dir_abs"] = dir
	}
	return metadata
}

func floretContextActionInjectedEventPayload(action *ContextActionEnvelope, projection floretSupplementalContextProjection) map[string]any {
	if len(projection.Items) == 0 || action == nil {
		return nil
	}
	action, err := normalizeAskFlowerContextActionEnvelope(action)
	if err != nil || action == nil {
		return nil
	}
	return map[string]any{
		"schema_version":      action.SchemaVersion,
		"action_id":           action.ActionID,
		"provider":            action.Provider,
		"source_surface":      action.Source.Surface,
		"source_surface_id":   action.Source.SurfaceID,
		"target_id":           action.Target.TargetID,
		"target_locality":     action.Target.Locality,
		"supplemental_items":  len(projection.Items),
		"rendered_char_count": projection.RenderedChars,
		"truncated":           projection.Truncated,
		"context_hash":        projection.ContextHash,
	}
}

func floretSupplementalRenderedChars(items []flruntime.TurnSupplementalContextItem) int {
	total := 0
	for _, item := range items {
		total += len([]rune(item.Kind)) + len([]rune(item.Title)) + len([]rune(item.Text))
		for key, value := range item.Metadata {
			total += len([]rune(key)) + len([]rune(value))
		}
	}
	return total
}

func floretSupplementalHasTruncation(items []flruntime.TurnSupplementalContextItem) bool {
	for _, item := range items {
		if item.Truncated {
			return true
		}
	}
	return false
}

func floretSupplementalContextHash(items []flruntime.TurnSupplementalContextItem) string {
	if len(items) == 0 {
		return ""
	}
	raw, err := json.Marshal(items)
	if err != nil {
		raw = []byte(fmt.Sprintf("%+v", items))
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func formatContextActionBytes(n int64) string {
	if n <= 0 {
		return "0 B"
	}
	const unit = 1024
	if n < unit {
		return strconv.FormatInt(n, 10) + " B"
	}
	value := float64(n)
	for _, suffix := range []string{"KiB", "MiB", "GiB", "TiB"} {
		value /= unit
		if value < unit {
			return fmt.Sprintf("%.1f %s", value, suffix)
		}
	}
	return fmt.Sprintf("%.1f PiB", value/unit)
}

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

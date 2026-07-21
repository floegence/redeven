package ai

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

const (
	floretTerminalSelectionInlineChars = 10_000
	floretTextSnapshotInlineChars      = 12_000
)

type floretContextProjection struct {
	References    []flruntime.MessageReference
	Items         []flruntime.TurnSupplementalContextItem
	RenderedChars int
	Truncated     bool
	ContextHash   string
}

func cloneFlowerCanonicalReferenceTargetAuthority(in *flowerCanonicalReferenceTargetAuthority) *flowerCanonicalReferenceTargetAuthority {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func floretContextProjectionForInput(input RunInput) (floretContextProjection, error) {
	return floretContextProjectionForInputWithAuthority(input, nil)
}

func floretContextProjectionForInputWithAuthority(input RunInput, authority *flowerCanonicalReferenceTargetAuthority) (floretContextProjection, error) {
	references, items, err := floretContextActionItemsWithAuthority(input.ContextAction, authority)
	if err != nil {
		return floretContextProjection{}, err
	}
	projection := floretContextProjection{References: references, Items: items}
	if len(items) == 0 {
		return projection, nil
	}
	projection.RenderedChars = floretSupplementalRenderedChars(items)
	projection.Truncated = floretSupplementalHasTruncation(items)
	projection.ContextHash = floretSupplementalContextHash(items)
	return projection, nil
}

func floretContextActionItems(action *ContextActionEnvelope) ([]flruntime.MessageReference, []flruntime.TurnSupplementalContextItem, error) {
	return floretContextActionItemsWithAuthority(action, nil)
}

func floretContextActionItemsWithAuthority(action *ContextActionEnvelope, authority *flowerCanonicalReferenceTargetAuthority) ([]flruntime.MessageReference, []flruntime.TurnSupplementalContextItem, error) {
	action, err := normalizeAskFlowerContextActionEnvelope(action)
	if err != nil {
		return nil, nil, err
	}
	if action == nil {
		return nil, nil, nil
	}
	if authority != nil {
		if err := authorizeFlowerContextActionTarget(action, *authority); err != nil {
			return nil, nil, err
		}
		action = canonicalizeFlowerContextActionTarget(action, *authority)
	}
	references := make([]flruntime.MessageReference, 0, len(action.Context))
	items := make([]flruntime.TurnSupplementalContextItem, 0, len(action.Context))
	for index, item := range action.Context {
		var reference flruntime.MessageReference
		var supplemental flruntime.TurnSupplementalContextItem
		switch strings.TrimSpace(item.Kind) {
		case contextActionKindFilePath:
			reference, err = floretFilePathReferenceWithAuthority(action, item, index, authority)
			supplemental = flruntime.TurnSupplementalContextItem{
				Kind:      contextActionKindFilePath,
				Title:     "Linked file path",
				Metadata:  contextActionFilePathMetadata(action, item),
				Sensitive: true,
			}
		case contextActionKindTerminal:
			reference = floretTerminalSelectionReference(item, index)
			supplemental = floretTerminalSelectionSupplementalItem(action, item)
		case contextActionKindProcess:
			reference = floretProcessReference(item, index)
			supplemental = flruntime.TurnSupplementalContextItem{
				Kind:      contextActionKindProcess,
				Title:     nonEmptyString(item.Title, item.Name, "Linked process snapshot"),
				Metadata:  contextActionProcessMetadata(action, item),
				Sensitive: true,
			}
		case contextActionKindText:
			reference = floretTextSnapshotReference(item, index)
			supplemental = floretTextSnapshotSupplementalItem(action, item)
		default:
			return nil, nil, ErrInvalidContextAction
		}
		if err != nil {
			return nil, nil, err
		}
		if err := reference.Validate(); err != nil {
			return nil, nil, fmt.Errorf("context reference %d: %w", index, err)
		}
		references = append(references, reference)
		items = append(items, supplemental)
	}
	if len(references) != len(action.Context) || len(items) != len(action.Context) {
		return nil, nil, ErrInvalidContextAction
	}
	return references, items, nil
}

func floretFilePathReference(action *ContextActionEnvelope, item ContextActionContextItem, index int) (flruntime.MessageReference, error) {
	return floretFilePathReferenceWithAuthority(action, item, index, nil)
}

func floretFilePathReferenceWithAuthority(action *ContextActionEnvelope, item ContextActionContextItem, index int, authority *flowerCanonicalReferenceTargetAuthority) (flruntime.MessageReference, error) {
	kind := flruntime.MessageReferenceFile
	if item.IsDirectory {
		kind = flruntime.MessageReferenceDirectory
	}
	resourceRef, err := floretContextResourceRefWithAuthority(action, item, authority)
	if err != nil {
		return flruntime.MessageReference{}, err
	}
	cleanPath := strings.TrimSpace(item.Path)
	label := contextReferencePathLabel(cleanPath)
	if label == "" {
		label = nonEmptyString(item.RootLabel, "Linked path")
	}
	return flruntime.MessageReference{
		ReferenceID: floretContextReferenceID(index),
		Kind:        kind,
		Label:       label,
		Text:        cleanPath,
		ResourceRef: resourceRef,
	}, nil
}

func floretTerminalSelectionReference(item ContextActionContextItem, index int) flruntime.MessageReference {
	selection := strings.TrimSpace(item.Selection)
	truncated := false
	if selection == "" && item.SelectionChars > floretTerminalSelectionInlineChars {
		selection = fmt.Sprintf("%s characters selected; content is not embedded.", formatContextActionNumber(item.SelectionChars))
		truncated = true
	} else if selection == "" {
		selection = "Working directory: " + strings.TrimSpace(item.WorkingDir)
	}
	return flruntime.MessageReference{
		ReferenceID: floretContextReferenceID(index),
		Kind:        flruntime.MessageReferenceTerminal,
		Label:       nonEmptyString(item.Title, "Terminal selection"),
		Text:        selection,
		Truncated:   truncated,
	}
}

func floretProcessReference(item ContextActionContextItem, index int) flruntime.MessageReference {
	label := nonEmptyString(item.Title, item.Name, "Process snapshot")
	parts := make([]string, 0, 5)
	if name := strings.TrimSpace(item.Name); name != "" {
		parts = append(parts, name)
	}
	if item.PID > 0 {
		parts = append(parts, "PID "+strconv.Itoa(item.PID))
	}
	if username := strings.TrimSpace(item.Username); username != "" {
		parts = append(parts, "user "+username)
	}
	if item.CPUPercent > 0 {
		parts = append(parts, strconv.FormatFloat(item.CPUPercent, 'f', 2, 64)+"% CPU")
	}
	if item.MemoryBytes > 0 {
		parts = append(parts, formatContextActionBytes(item.MemoryBytes))
	}
	return flruntime.MessageReference{
		ReferenceID: floretContextReferenceID(index),
		Kind:        flruntime.MessageReferenceProcess,
		Label:       label,
		Text:        strings.Join(parts, ", "),
	}
}

func floretTextSnapshotReference(item ContextActionContextItem, index int) flruntime.MessageReference {
	text := strings.TrimSpace(item.Content)
	if text == "" {
		text = strings.TrimSpace(item.Detail)
	}
	text, truncated := truncateContextReferenceText(text)
	return flruntime.MessageReference{
		ReferenceID: floretContextReferenceID(index),
		Kind:        flruntime.MessageReferenceText,
		Label:       nonEmptyString(item.Title, "Quoted text"),
		Text:        text,
		Truncated:   truncated,
	}
}

func floretContextReferenceID(index int) string {
	return "context:" + strconv.Itoa(index)
}

func contextReferencePathLabel(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" {
		return ""
	}
	label := path.Base(strings.TrimSuffix(value, "/"))
	if label == "." || label == "/" {
		return value
	}
	return label
}

func truncateContextReferenceText(value string) (string, bool) {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= flruntime.MaxMessageReferenceTextRunes {
		return string(runes), false
	}
	return string(runes[:flruntime.MaxMessageReferenceTextRunes]), true
}

func floretContextResourceRef(action *ContextActionEnvelope, item ContextActionContextItem) (string, error) {
	return floretContextResourceRefWithAuthority(action, item, nil)
}

func floretContextResourceRefWithAuthority(action *ContextActionEnvelope, item ContextActionContextItem, authority *flowerCanonicalReferenceTargetAuthority) (string, error) {
	if action == nil {
		return "", ErrInvalidContextAction
	}
	if authority != nil {
		if err := authorizeFlowerContextActionTarget(action, *authority); err != nil {
			return "", err
		}
	} else {
		if action.ExecutionContext == nil || strings.TrimSpace(action.Target.TargetID) == "" || strings.TrimSpace(action.ExecutionContext.CurrentTargetID) == "" || strings.TrimSpace(action.ExecutionContext.SourceEnvPublicID) == "" || (strings.TrimSpace(action.Target.TargetID) != "current" && strings.TrimSpace(action.ExecutionContext.CurrentTargetID) != strings.TrimSpace(action.Target.TargetID)) {
			return "", ErrInvalidContextAction
		}
		switch strings.TrimSpace(action.Target.Locality) {
		case contextActionLocalityAuto, contextActionLocalityCurrent:
		default:
			return "", ErrInvalidContextAction
		}
	}
	payload := flowerCanonicalReferenceLocator{
		Version:        1,
		TargetID:       strings.TrimSpace(action.Target.TargetID),
		TargetLocality: strings.TrimSpace(action.Target.Locality),
		Path:           strings.TrimSpace(item.Path),
		Directory:      item.IsDirectory,
	}
	if authority != nil {
		payload.TargetID = authority.TargetID
		payload.TargetLocality = authority.TargetLocality
		payload.CurrentTargetID = authority.TargetID
		payload.SourceEnvPublicID = authority.SourceEnvPublicID
	}
	if action.ExecutionContext != nil {
		if authority == nil {
			payload.CurrentTargetID = strings.TrimSpace(action.ExecutionContext.CurrentTargetID)
			payload.SourceEnvPublicID = strings.TrimSpace(action.ExecutionContext.SourceEnvPublicID)
		}
	}
	if !flowerCanonicalReferenceLocatorBelongsToEndpoint(payload, payload.SourceEnvPublicID) {
		return "", ErrInvalidContextAction
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	resourceRef := "redeven-context:v1:" + base64.RawURLEncoding.EncodeToString(raw)
	if len([]byte(resourceRef)) > flruntime.MaxMessageReferenceResourceRefBytes {
		return "", errors.New("context resource locator exceeds Floret limit")
	}
	return resourceRef, nil
}

func formatContextActionNumber(value int) string {
	raw := strconv.Itoa(value)
	for index := len(raw) - 3; index > 0; index -= 3 {
		raw = raw[:index] + "," + raw[index:]
	}
	return raw
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

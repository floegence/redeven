package workbenchlayout

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

const (
	EventTypeLayoutReplaced      = "layout.replaced"
	EventTypeWidgetStateUpserted = "widget_state.upserted"

	WidgetTypeFiles    = "redeven.files"
	WidgetTypeTerminal = "redeven.terminal"
	WidgetTypePreview  = "redeven.preview"

	WidgetStateKindFiles    = "files"
	WidgetStateKindTerminal = "terminal"
	WidgetStateKindPreview  = "preview"

	TerminalMinFontSize = 10
	TerminalMaxFontSize = 20
)

type Snapshot struct {
	Seq             int64          `json:"seq"`
	Revision        int64          `json:"revision"`
	UpdatedAtUnixMs int64          `json:"updated_at_unix_ms"`
	Widgets         []WidgetLayout `json:"widgets"`
	WidgetStates    []WidgetState  `json:"widget_states"`
}

type WidgetLayout struct {
	WidgetID        string  `json:"widget_id"`
	WidgetType      string  `json:"widget_type"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	ZIndex          int     `json:"z_index"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
}

type Event struct {
	Seq             int64           `json:"seq"`
	Type            string          `json:"type"`
	CreatedAtUnixMs int64           `json:"created_at_unix_ms"`
	Payload         json.RawMessage `json:"payload"`
}

type PutLayoutRequest struct {
	BaseRevision int64          `json:"base_revision"`
	Widgets      []WidgetLayout `json:"widgets"`
}

type WidgetState struct {
	WidgetID        string          `json:"widget_id"`
	WidgetType      string          `json:"widget_type"`
	Revision        int64           `json:"revision"`
	UpdatedAtUnixMs int64           `json:"updated_at_unix_ms"`
	State           WidgetStateData `json:"state"`
}

type WidgetStateData struct {
	Kind         string       `json:"kind"`
	CurrentPath  string       `json:"current_path,omitempty"`
	SessionIDs   []string     `json:"session_ids,omitempty"`
	FontSize     *int         `json:"font_size,omitempty"`
	FontFamilyID string       `json:"font_family_id,omitempty"`
	Item         *PreviewItem `json:"item,omitempty"`
}

type PreviewItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Path string `json:"path"`
	Name string `json:"name"`
	Size *int64 `json:"size,omitempty"`
}

type PutWidgetStateRequest struct {
	BaseRevision int64           `json:"base_revision"`
	WidgetType   string          `json:"widget_type"`
	State        WidgetStateData `json:"state"`
}

type WidgetStateRevisionConflictError struct {
	WidgetID        string
	CurrentRevision int64
}

func (e *WidgetStateRevisionConflictError) Error() string {
	if e == nil {
		return "workbench widget state revision conflict"
	}
	return fmt.Sprintf("workbench widget state revision conflict (widget_id=%s current=%d)", e.WidgetID, e.CurrentRevision)
}

type WidgetNotFoundError struct {
	WidgetID string
}

func (e *WidgetNotFoundError) Error() string {
	if e == nil || strings.TrimSpace(e.WidgetID) == "" {
		return "workbench widget not found"
	}
	return fmt.Sprintf("workbench widget %q not found", strings.TrimSpace(e.WidgetID))
}

type WidgetTypeMismatchError struct {
	WidgetID     string
	ExpectedType string
	ActualType   string
}

func (e *WidgetTypeMismatchError) Error() string {
	if e == nil {
		return "workbench widget type mismatch"
	}
	return fmt.Sprintf(
		"workbench widget %q type mismatch (expected=%s actual=%s)",
		strings.TrimSpace(e.WidgetID),
		strings.TrimSpace(e.ExpectedType),
		strings.TrimSpace(e.ActualType),
	)
}

type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string {
	if e == nil || strings.TrimSpace(e.Message) == "" {
		return "invalid workbench layout"
	}
	return strings.TrimSpace(e.Message)
}

type RevisionConflictError struct {
	CurrentRevision int64
}

func (e *RevisionConflictError) Error() string {
	if e == nil {
		return "workbench layout revision conflict"
	}
	return fmt.Sprintf("workbench layout revision conflict (current=%d)", e.CurrentRevision)
}

func normalizePutLayoutRequest(req PutLayoutRequest, nowUnixMs int64) (PutLayoutRequest, error) {
	if req.BaseRevision < 0 {
		return PutLayoutRequest{}, &ValidationError{Message: "base_revision must be non-negative"}
	}
	widgets, err := normalizeWidgetLayouts(req.Widgets, nowUnixMs)
	if err != nil {
		return PutLayoutRequest{}, err
	}
	return PutLayoutRequest{
		BaseRevision: req.BaseRevision,
		Widgets:      widgets,
	}, nil
}

func normalizePutWidgetStateRequest(widgetID string, req PutWidgetStateRequest) (PutWidgetStateRequest, error) {
	if req.BaseRevision < 0 {
		return PutWidgetStateRequest{}, &ValidationError{Message: "base_revision must be non-negative"}
	}
	normalizedWidgetID, err := normalizeWidgetID(widgetID)
	if err != nil {
		return PutWidgetStateRequest{}, &ValidationError{Message: fmt.Sprintf("widget_id: %v", err)}
	}
	_ = normalizedWidgetID

	widgetType := strings.TrimSpace(req.WidgetType)
	if widgetType == "" {
		return PutWidgetStateRequest{}, &ValidationError{Message: "widget_type is required"}
	}
	state, err := normalizeWidgetStateData(widgetType, req.State)
	if err != nil {
		return PutWidgetStateRequest{}, err
	}
	return PutWidgetStateRequest{
		BaseRevision: req.BaseRevision,
		WidgetType:   widgetType,
		State:        state,
	}, nil
}

func normalizeWidgetLayouts(widgets []WidgetLayout, nowUnixMs int64) ([]WidgetLayout, error) {
	if len(widgets) == 0 {
		return []WidgetLayout{}, nil
	}

	seenIDs := make(map[string]struct{}, len(widgets))
	next := make([]WidgetLayout, 0, len(widgets))
	for index, widget := range widgets {
		normalized, err := normalizeWidgetLayout(widget, nowUnixMs)
		if err != nil {
			return nil, &ValidationError{Message: fmt.Sprintf("widgets[%d]: %v", index, err)}
		}
		if _, exists := seenIDs[normalized.WidgetID]; exists {
			return nil, &ValidationError{Message: fmt.Sprintf("widgets[%d]: duplicate widget_id %q", index, normalized.WidgetID)}
		}
		seenIDs[normalized.WidgetID] = struct{}{}
		next = append(next, normalized)
	}

	sort.Slice(next, func(left int, right int) bool {
		if next[left].ZIndex != next[right].ZIndex {
			return next[left].ZIndex < next[right].ZIndex
		}
		if next[left].CreatedAtUnixMs != next[right].CreatedAtUnixMs {
			return next[left].CreatedAtUnixMs < next[right].CreatedAtUnixMs
		}
		return next[left].WidgetID < next[right].WidgetID
	})

	return next, nil
}

func normalizeWidgetLayout(widget WidgetLayout, nowUnixMs int64) (WidgetLayout, error) {
	id, err := normalizeWidgetID(widget.WidgetID)
	if err != nil {
		return WidgetLayout{}, err
	}

	widgetType := strings.TrimSpace(widget.WidgetType)
	if widgetType == "" {
		return WidgetLayout{}, errors.New("missing widget_type")
	}
	if len(widgetType) > 96 {
		return WidgetLayout{}, fmt.Errorf("widget_type %q is too long", widgetType)
	}

	if !isFinite(widget.X) {
		return WidgetLayout{}, errors.New("x must be finite")
	}
	if !isFinite(widget.Y) {
		return WidgetLayout{}, errors.New("y must be finite")
	}
	if !isFinite(widget.Width) || widget.Width <= 0 {
		return WidgetLayout{}, errors.New("width must be finite and positive")
	}
	if !isFinite(widget.Height) || widget.Height <= 0 {
		return WidgetLayout{}, errors.New("height must be finite and positive")
	}
	if widget.ZIndex < 0 {
		return WidgetLayout{}, errors.New("z_index must be non-negative")
	}
	createdAt := widget.CreatedAtUnixMs
	if createdAt <= 0 {
		createdAt = nowUnixMs
	}

	return WidgetLayout{
		WidgetID:        id,
		WidgetType:      widgetType,
		X:               widget.X,
		Y:               widget.Y,
		Width:           widget.Width,
		Height:          widget.Height,
		ZIndex:          widget.ZIndex,
		CreatedAtUnixMs: createdAt,
	}, nil
}

func normalizeWidgetID(value string) (string, error) {
	id := strings.TrimSpace(value)
	if id == "" {
		return "", errors.New("missing widget_id")
	}
	if len(id) > 128 {
		return "", fmt.Errorf("widget_id %q is too long", id)
	}
	return id, nil
}

func widgetStateKindForType(widgetType string) (string, bool) {
	switch strings.TrimSpace(widgetType) {
	case WidgetTypeFiles:
		return WidgetStateKindFiles, true
	case WidgetTypeTerminal:
		return WidgetStateKindTerminal, true
	case WidgetTypePreview:
		return WidgetStateKindPreview, true
	default:
		return "", false
	}
}

func normalizeWidgetStateData(widgetType string, state WidgetStateData) (WidgetStateData, error) {
	kind, ok := widgetStateKindForType(widgetType)
	if !ok {
		return WidgetStateData{}, &ValidationError{Message: fmt.Sprintf("unsupported widget_type %q", strings.TrimSpace(widgetType))}
	}
	if strings.TrimSpace(state.Kind) != "" && strings.TrimSpace(state.Kind) != kind {
		return WidgetStateData{}, &ValidationError{Message: fmt.Sprintf("state.kind must be %q", kind)}
	}

	switch kind {
	case WidgetStateKindFiles:
		path := normalizeAbsolutePath(state.CurrentPath)
		if path == "" {
			return WidgetStateData{}, &ValidationError{Message: "state.current_path is required"}
		}
		return WidgetStateData{Kind: kind, CurrentPath: path}, nil
	case WidgetStateKindTerminal:
		return WidgetStateData{
			Kind:         kind,
			SessionIDs:   normalizeSessionIDs(state.SessionIDs),
			FontSize:     normalizeTerminalFontSize(state.FontSize),
			FontFamilyID: normalizeTerminalFontFamilyID(state.FontFamilyID),
		}, nil
	case WidgetStateKindPreview:
		item, err := normalizePreviewItem(state.Item)
		if err != nil {
			return WidgetStateData{}, err
		}
		return WidgetStateData{Kind: kind, Item: item}, nil
	default:
		return WidgetStateData{}, &ValidationError{Message: "unsupported widget state kind"}
	}
}

func normalizeAbsolutePath(value string) string {
	path := strings.TrimSpace(value)
	if path == "" || !strings.HasPrefix(path, "/") {
		return ""
	}
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}
	if len(path) > 4096 {
		return ""
	}
	return path
}

func normalizeTerminalFontSize(value *int) *int {
	if value == nil {
		return nil
	}
	next := *value
	if next < TerminalMinFontSize {
		next = TerminalMinFontSize
	}
	if next > TerminalMaxFontSize {
		next = TerminalMaxFontSize
	}
	return &next
}

func normalizeTerminalFontFamilyID(value string) string {
	id := strings.TrimSpace(value)
	if id == "" || len(id) > 64 {
		return ""
	}
	for _, ch := range id {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			continue
		}
		return ""
	}
	return id
}

func terminalStateData(sessionIDs []string, current *WidgetStateData) WidgetStateData {
	next := WidgetStateData{
		Kind:       WidgetStateKindTerminal,
		SessionIDs: normalizeSessionIDs(sessionIDs),
	}
	if current == nil || current.Kind != WidgetStateKindTerminal {
		return next
	}
	next.FontSize = normalizeTerminalFontSize(current.FontSize)
	next.FontFamilyID = normalizeTerminalFontFamilyID(current.FontFamilyID)
	return next
}

func normalizeSessionIDs(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(values))
	next := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || len(id) > 128 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		next = append(next, id)
	}
	return next
}

func normalizePreviewItem(item *PreviewItem) (*PreviewItem, error) {
	if item == nil {
		return nil, nil
	}
	path := normalizeAbsolutePath(item.Path)
	if path == "" {
		return nil, &ValidationError{Message: "state.item.path is required"}
	}
	itemType := strings.TrimSpace(item.Type)
	if itemType == "" {
		itemType = "file"
	}
	if itemType != "file" {
		return nil, &ValidationError{Message: "state.item.type must be file"}
	}
	name := strings.TrimSpace(item.Name)
	if name == "" {
		name = basename(path)
	}
	if name == "" {
		name = "File"
	}
	id := strings.TrimSpace(item.ID)
	if id == "" {
		id = path
	}
	var size *int64
	if item.Size != nil && *item.Size >= 0 {
		value := *item.Size
		size = &value
	}
	return &PreviewItem{
		ID:   id,
		Type: "file",
		Path: path,
		Name: name,
		Size: size,
	}, nil
}

func basename(path string) string {
	path = strings.TrimRight(strings.TrimSpace(path), "/")
	if path == "" {
		return ""
	}
	idx := strings.LastIndex(path, "/")
	if idx >= 0 {
		return strings.TrimSpace(path[idx+1:])
	}
	return path
}

func snapshotsEqualWidgets(left Snapshot, right []WidgetLayout) bool {
	if len(left.Widgets) != len(right) {
		return false
	}
	for index := range left.Widgets {
		if left.Widgets[index] != right[index] {
			return false
		}
	}
	return true
}

func widgetStateDataEqual(left WidgetStateData, right WidgetStateData) bool {
	if left.Kind != right.Kind || left.CurrentPath != right.CurrentPath || left.FontFamilyID != right.FontFamilyID {
		return false
	}
	if !terminalFontSizesEqual(left.FontSize, right.FontSize) {
		return false
	}
	if len(left.SessionIDs) != len(right.SessionIDs) {
		return false
	}
	for index := range left.SessionIDs {
		if left.SessionIDs[index] != right.SessionIDs[index] {
			return false
		}
	}
	return previewItemsEqual(left.Item, right.Item)
}

func terminalFontSizesEqual(left *int, right *int) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

func previewItemsEqual(left *PreviewItem, right *PreviewItem) bool {
	if left == nil || right == nil {
		return left == right
	}
	leftSize := int64(-1)
	if left.Size != nil {
		leftSize = *left.Size
	}
	rightSize := int64(-1)
	if right.Size != nil {
		rightSize = *right.Size
	}
	return left.ID == right.ID &&
		left.Type == right.Type &&
		left.Path == right.Path &&
		left.Name == right.Name &&
		leftSize == rightSize
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

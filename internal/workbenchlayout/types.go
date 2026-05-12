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

	OpenPreviewStrategySameFileOrCreate    = "same_file_or_create"
	OpenPreviewStrategyFocusLatestOrCreate = "focus_latest_or_create"
	OpenPreviewStrategyCreateNew           = "create_new"

	DefaultPreviewWidgetWidth  = 900
	DefaultPreviewWidgetHeight = 620

	TerminalMinFontSize = 10
	TerminalMaxFontSize = 20

	StickyNoteKind         = "sticky_note"
	TextAnnotationKind     = "text"
	DefaultStickyNoteBody  = "Untitled note"
	DefaultStickyNoteColor = "amber"

	DefaultAnnotationText       = "Text"
	DefaultAnnotationFontFamily = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
	DefaultAnnotationFontWeight = 800
	DefaultAnnotationFontSize   = 45
	DefaultAnnotationColor      = "#6b7280"
	DefaultAnnotationAlign      = "left"

	DefaultBackgroundLayerName     = "Canvas region"
	DefaultBackgroundLayerFill     = "#9da8a1"
	DefaultBackgroundLayerOpacity  = 0.72
	DefaultBackgroundLayerMaterial = "dotted"
)

type Snapshot struct {
	Seq              int64             `json:"seq"`
	Revision         int64             `json:"revision"`
	UpdatedAtUnixMs  int64             `json:"updated_at_unix_ms"`
	Widgets          []WidgetLayout    `json:"widgets"`
	StickyNotes      []StickyNote      `json:"sticky_notes"`
	Annotations      []TextAnnotation  `json:"annotations"`
	BackgroundLayers []BackgroundLayer `json:"background_layers"`
	WidgetStates     []WidgetState     `json:"widget_states"`
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
	BaseRevision     int64             `json:"base_revision"`
	Widgets          []WidgetLayout    `json:"widgets"`
	StickyNotes      []StickyNote      `json:"sticky_notes"`
	Annotations      []TextAnnotation  `json:"annotations"`
	BackgroundLayers []BackgroundLayer `json:"background_layers"`
}

type StickyNote struct {
	ID              string  `json:"id"`
	Kind            string  `json:"kind"`
	Body            string  `json:"body"`
	Color           string  `json:"color"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	ZIndex          int     `json:"z_index"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64   `json:"updated_at_unix_ms"`
}

type TextAnnotation struct {
	ID              string  `json:"id"`
	Kind            string  `json:"kind"`
	Text            string  `json:"text"`
	FontFamily      string  `json:"font_family"`
	FontSize        int     `json:"font_size"`
	FontWeight      int     `json:"font_weight"`
	Color           string  `json:"color"`
	Align           string  `json:"align"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	ZIndex          int     `json:"z_index"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64   `json:"updated_at_unix_ms"`
}

type BackgroundLayer struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Fill            string  `json:"fill"`
	Opacity         float64 `json:"opacity"`
	Material        string  `json:"material"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	Width           float64 `json:"width"`
	Height          float64 `json:"height"`
	ZIndex          int     `json:"z_index"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64   `json:"updated_at_unix_ms"`
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

type OpenPreviewRequest struct {
	RequestID    string                  `json:"request_id,omitempty"`
	Item         PreviewItem             `json:"item"`
	OpenStrategy string                  `json:"open_strategy,omitempty"`
	Viewport     OpenPreviewViewportHint `json:"viewport,omitempty"`
}

type OpenPreviewViewportHint struct {
	CenterX       *float64 `json:"center_x,omitempty"`
	CenterY       *float64 `json:"center_y,omitempty"`
	DefaultWidth  float64  `json:"default_width,omitempty"`
	DefaultHeight float64  `json:"default_height,omitempty"`
}

type OpenPreviewResponse struct {
	RequestID   string      `json:"request_id,omitempty"`
	WidgetID    string      `json:"widget_id"`
	Created     bool        `json:"created"`
	Snapshot    Snapshot    `json:"snapshot"`
	WidgetState WidgetState `json:"widget_state"`
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
	stickyNotes, err := normalizeStickyNotes(req.StickyNotes, nowUnixMs)
	if err != nil {
		return PutLayoutRequest{}, err
	}
	annotations, err := normalizeTextAnnotations(req.Annotations, nowUnixMs)
	if err != nil {
		return PutLayoutRequest{}, err
	}
	backgroundLayers, err := normalizeBackgroundLayers(req.BackgroundLayers, nowUnixMs)
	if err != nil {
		return PutLayoutRequest{}, err
	}
	return PutLayoutRequest{
		BaseRevision:     req.BaseRevision,
		Widgets:          widgets,
		StickyNotes:      stickyNotes,
		Annotations:      annotations,
		BackgroundLayers: backgroundLayers,
	}, nil
}

func normalizePutWidgetStateRequest(widgetID string, req PutWidgetStateRequest) (PutWidgetStateRequest, error) {
	if req.BaseRevision < 0 {
		return PutWidgetStateRequest{}, &ValidationError{Message: "base_revision must be non-negative"}
	}
	if _, err := normalizeWidgetID(widgetID); err != nil {
		return PutWidgetStateRequest{}, &ValidationError{Message: fmt.Sprintf("widget_id: %v", err)}
	}

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

func normalizeOpenPreviewRequest(req OpenPreviewRequest, nowUnixMs int64) (OpenPreviewRequest, error) {
	requestID := strings.TrimSpace(req.RequestID)
	if len(requestID) > 128 {
		return OpenPreviewRequest{}, &ValidationError{Message: "request_id is too long"}
	}
	item, err := normalizePreviewItem(&req.Item)
	if err != nil {
		return OpenPreviewRequest{}, err
	}
	if item == nil {
		return OpenPreviewRequest{}, &ValidationError{Message: "item is required"}
	}
	strategy := strings.TrimSpace(req.OpenStrategy)
	if strategy == "" {
		strategy = OpenPreviewStrategySameFileOrCreate
	}
	switch strategy {
	case OpenPreviewStrategySameFileOrCreate, OpenPreviewStrategyFocusLatestOrCreate, OpenPreviewStrategyCreateNew:
	default:
		return OpenPreviewRequest{}, &ValidationError{Message: "unsupported open_strategy"}
	}
	viewport, err := normalizeOpenPreviewViewportHint(req.Viewport, nowUnixMs)
	if err != nil {
		return OpenPreviewRequest{}, err
	}
	return OpenPreviewRequest{
		RequestID:    requestID,
		Item:         *item,
		OpenStrategy: strategy,
		Viewport:     viewport,
	}, nil
}

func normalizeOpenPreviewViewportHint(hint OpenPreviewViewportHint, nowUnixMs int64) (OpenPreviewViewportHint, error) {
	var centerX *float64
	if hint.CenterX != nil {
		if !isFinite(*hint.CenterX) {
			return OpenPreviewViewportHint{}, &ValidationError{Message: "viewport.center_x must be finite"}
		}
		value := *hint.CenterX
		centerX = &value
	}
	var centerY *float64
	if hint.CenterY != nil {
		if !isFinite(*hint.CenterY) {
			return OpenPreviewViewportHint{}, &ValidationError{Message: "viewport.center_y must be finite"}
		}
		value := *hint.CenterY
		centerY = &value
	}
	width := normalizePositiveFloat(hint.DefaultWidth, DefaultPreviewWidgetWidth)
	height := normalizePositiveFloat(hint.DefaultHeight, DefaultPreviewWidgetHeight)
	return OpenPreviewViewportHint{
		CenterX:       centerX,
		CenterY:       centerY,
		DefaultWidth:  width,
		DefaultHeight: height,
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
	return normalizeLayoutObjectID(value, "widget_id")
}

func normalizeLayoutObjectID(value string, fieldName string) (string, error) {
	id := strings.TrimSpace(value)
	if id == "" {
		return "", fmt.Errorf("missing %s", fieldName)
	}
	if len(id) > 128 {
		return "", fmt.Errorf("%s %q is too long", fieldName, id)
	}
	return id, nil
}

func normalizeStickyNotes(notes []StickyNote, nowUnixMs int64) ([]StickyNote, error) {
	if len(notes) == 0 {
		return []StickyNote{}, nil
	}
	seenIDs := make(map[string]struct{}, len(notes))
	next := make([]StickyNote, 0, len(notes))
	for index, note := range notes {
		normalized, err := normalizeStickyNote(note, nowUnixMs)
		if err != nil {
			return nil, &ValidationError{Message: fmt.Sprintf("sticky_notes[%d]: %v", index, err)}
		}
		if _, exists := seenIDs[normalized.ID]; exists {
			return nil, &ValidationError{Message: fmt.Sprintf("sticky_notes[%d]: duplicate id %q", index, normalized.ID)}
		}
		seenIDs[normalized.ID] = struct{}{}
		next = append(next, normalized)
	}
	sortLayoutObjects(next, func(value StickyNote) (int, int64, string) {
		return value.ZIndex, value.CreatedAtUnixMs, value.ID
	})
	return next, nil
}

func normalizeStickyNote(note StickyNote, nowUnixMs int64) (StickyNote, error) {
	id, err := normalizeLayoutObjectID(note.ID, "id")
	if err != nil {
		return StickyNote{}, err
	}
	kind := strings.TrimSpace(note.Kind)
	if kind == "" {
		kind = StickyNoteKind
	}
	if kind != StickyNoteKind {
		return StickyNote{}, fmt.Errorf("kind must be %q", StickyNoteKind)
	}
	if !isFinite(note.X) {
		return StickyNote{}, errors.New("x must be finite")
	}
	if !isFinite(note.Y) {
		return StickyNote{}, errors.New("y must be finite")
	}
	createdAt, updatedAt := normalizeTimestamps(note.CreatedAtUnixMs, note.UpdatedAtUnixMs, nowUnixMs)
	return StickyNote{
		ID:              id,
		Kind:            StickyNoteKind,
		Body:            normalizeBoundedText(note.Body, DefaultStickyNoteBody, 20_000),
		Color:           normalizeEnum(note.Color, stickyNoteColors(), DefaultStickyNoteColor),
		X:               note.X,
		Y:               note.Y,
		Width:           normalizePositiveFloat(note.Width, 260),
		Height:          normalizePositiveFloat(note.Height, 190),
		ZIndex:          normalizeNonNegativeInt(note.ZIndex),
		CreatedAtUnixMs: createdAt,
		UpdatedAtUnixMs: updatedAt,
	}, nil
}

func normalizeTextAnnotations(annotations []TextAnnotation, nowUnixMs int64) ([]TextAnnotation, error) {
	if len(annotations) == 0 {
		return []TextAnnotation{}, nil
	}
	seenIDs := make(map[string]struct{}, len(annotations))
	next := make([]TextAnnotation, 0, len(annotations))
	for index, annotation := range annotations {
		normalized, err := normalizeTextAnnotation(annotation, nowUnixMs)
		if err != nil {
			return nil, &ValidationError{Message: fmt.Sprintf("annotations[%d]: %v", index, err)}
		}
		if _, exists := seenIDs[normalized.ID]; exists {
			return nil, &ValidationError{Message: fmt.Sprintf("annotations[%d]: duplicate id %q", index, normalized.ID)}
		}
		seenIDs[normalized.ID] = struct{}{}
		next = append(next, normalized)
	}
	sortLayoutObjects(next, func(value TextAnnotation) (int, int64, string) {
		return value.ZIndex, value.CreatedAtUnixMs, value.ID
	})
	return next, nil
}

func normalizeTextAnnotation(annotation TextAnnotation, nowUnixMs int64) (TextAnnotation, error) {
	id, err := normalizeLayoutObjectID(annotation.ID, "id")
	if err != nil {
		return TextAnnotation{}, err
	}
	kind := strings.TrimSpace(annotation.Kind)
	if kind == "" {
		kind = TextAnnotationKind
	}
	if kind != TextAnnotationKind {
		return TextAnnotation{}, fmt.Errorf("kind must be %q", TextAnnotationKind)
	}
	if !isFinite(annotation.X) {
		return TextAnnotation{}, errors.New("x must be finite")
	}
	if !isFinite(annotation.Y) {
		return TextAnnotation{}, errors.New("y must be finite")
	}
	fontFamily, fontWeight := normalizeAnnotationFont(annotation.FontFamily, annotation.FontWeight)
	createdAt, updatedAt := normalizeTimestamps(annotation.CreatedAtUnixMs, annotation.UpdatedAtUnixMs, nowUnixMs)
	return TextAnnotation{
		ID:              id,
		Kind:            TextAnnotationKind,
		Text:            normalizeBoundedText(annotation.Text, DefaultAnnotationText, 20_000),
		FontFamily:      fontFamily,
		FontSize:        normalizeIntRange(annotation.FontSize, 8, 160, DefaultAnnotationFontSize),
		FontWeight:      fontWeight,
		Color:           normalizeEnum(annotation.Color, annotationColors(), DefaultAnnotationColor),
		Align:           normalizeEnum(annotation.Align, annotationAlignments(), DefaultAnnotationAlign),
		X:               annotation.X,
		Y:               annotation.Y,
		Width:           normalizePositiveFloat(annotation.Width, 460),
		Height:          normalizePositiveFloat(annotation.Height, 96),
		ZIndex:          normalizeNonNegativeInt(annotation.ZIndex),
		CreatedAtUnixMs: createdAt,
		UpdatedAtUnixMs: updatedAt,
	}, nil
}

func normalizeBackgroundLayers(layers []BackgroundLayer, nowUnixMs int64) ([]BackgroundLayer, error) {
	if len(layers) == 0 {
		return []BackgroundLayer{}, nil
	}
	seenIDs := make(map[string]struct{}, len(layers))
	next := make([]BackgroundLayer, 0, len(layers))
	for index, layer := range layers {
		normalized, err := normalizeBackgroundLayer(layer, nowUnixMs)
		if err != nil {
			return nil, &ValidationError{Message: fmt.Sprintf("background_layers[%d]: %v", index, err)}
		}
		if _, exists := seenIDs[normalized.ID]; exists {
			return nil, &ValidationError{Message: fmt.Sprintf("background_layers[%d]: duplicate id %q", index, normalized.ID)}
		}
		seenIDs[normalized.ID] = struct{}{}
		next = append(next, normalized)
	}
	sortLayoutObjects(next, func(value BackgroundLayer) (int, int64, string) {
		return value.ZIndex, value.CreatedAtUnixMs, value.ID
	})
	return next, nil
}

func normalizeBackgroundLayer(layer BackgroundLayer, nowUnixMs int64) (BackgroundLayer, error) {
	id, err := normalizeLayoutObjectID(layer.ID, "id")
	if err != nil {
		return BackgroundLayer{}, err
	}
	if !isFinite(layer.X) {
		return BackgroundLayer{}, errors.New("x must be finite")
	}
	if !isFinite(layer.Y) {
		return BackgroundLayer{}, errors.New("y must be finite")
	}
	createdAt, updatedAt := normalizeTimestamps(layer.CreatedAtUnixMs, layer.UpdatedAtUnixMs, nowUnixMs)
	return BackgroundLayer{
		ID:              id,
		Name:            normalizeBoundedText(layer.Name, DefaultBackgroundLayerName, 256),
		Fill:            normalizeEnum(layer.Fill, backgroundLayerFills(), DefaultBackgroundLayerFill),
		Opacity:         normalizeFloatRange(layer.Opacity, 0.08, 1, DefaultBackgroundLayerOpacity),
		Material:        normalizeEnum(layer.Material, backgroundLayerMaterials(), DefaultBackgroundLayerMaterial),
		X:               layer.X,
		Y:               layer.Y,
		Width:           normalizePositiveFloat(layer.Width, 560),
		Height:          normalizePositiveFloat(layer.Height, 360),
		ZIndex:          normalizeNonNegativeInt(layer.ZIndex),
		CreatedAtUnixMs: createdAt,
		UpdatedAtUnixMs: updatedAt,
	}, nil
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

func snapshotsEqualLayout(left Snapshot, right PutLayoutRequest) bool {
	return widgetLayoutsEqual(left.Widgets, right.Widgets) &&
		stickyNotesEqual(left.StickyNotes, right.StickyNotes) &&
		textAnnotationsEqual(left.Annotations, right.Annotations) &&
		backgroundLayersEqual(left.BackgroundLayers, right.BackgroundLayers)
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func normalizeTimestamps(createdAt int64, updatedAt int64, nowUnixMs int64) (int64, int64) {
	if createdAt <= 0 {
		createdAt = nowUnixMs
	}
	if updatedAt <= 0 {
		updatedAt = createdAt
	}
	return createdAt, updatedAt
}

func normalizeBoundedText(value string, fallback string, maxLen int) string {
	next := strings.TrimSpace(value)
	if next == "" {
		next = fallback
	}
	if maxLen > 0 && len(next) > maxLen {
		next = next[:maxLen]
	}
	return next
}

func normalizePositiveFloat(value float64, fallback float64) float64 {
	if !isFinite(value) || value <= 0 {
		return fallback
	}
	return value
}

func normalizeFloatRange(value float64, min float64, max float64, fallback float64) float64 {
	if !isFinite(value) {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func normalizeNonNegativeInt(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func normalizeIntRange(value int, min int, max int, fallback int) int {
	if value <= 0 {
		value = fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func normalizeEnum(value string, allowed map[string]struct{}, fallback string) string {
	next := strings.TrimSpace(value)
	if _, ok := allowed[next]; ok {
		return next
	}
	return fallback
}

func normalizeAnnotationFont(fontFamily string, fontWeight int) (string, int) {
	switch strings.TrimSpace(fontFamily) {
	case DefaultAnnotationFontFamily:
		return DefaultAnnotationFontFamily, DefaultAnnotationFontWeight
	case "ui-serif, Georgia, serif":
		return "ui-serif, Georgia, serif", 760
	case `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", ui-sans-serif, sans-serif`:
		return `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", ui-sans-serif, sans-serif`, 800
	case `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`:
		return `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`, 800
	case `Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`:
		return `Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif`, 700
	default:
		if fontWeight >= 100 && fontWeight <= 1000 {
			return DefaultAnnotationFontFamily, fontWeight
		}
		return DefaultAnnotationFontFamily, DefaultAnnotationFontWeight
	}
}

func stickyNoteColors() map[string]struct{} {
	return map[string]struct{}{
		"sage":  {},
		"amber": {},
		"azure": {},
		"coral": {},
		"rose":  {},
	}
}

func annotationColors() map[string]struct{} {
	return map[string]struct{}{
		"#6b7280": {},
		"#64748b": {},
		"#71717a": {},
		"#78716c": {},
		"#7770a0": {},
		"#8a6b6b": {},
	}
}

func annotationAlignments() map[string]struct{} {
	return map[string]struct{}{
		"left":   {},
		"center": {},
		"right":  {},
	}
}

func backgroundLayerFills() map[string]struct{} {
	return map[string]struct{}{
		"#9da8a1": {},
		"#a79d8e": {},
		"#8fa1aa": {},
		"#a78f86": {},
		"#9ca184": {},
		"#9993a7": {},
	}
}

func backgroundLayerMaterials() map[string]struct{} {
	return map[string]struct{}{
		"solid":   {},
		"dotted":  {},
		"grid":    {},
		"hatched": {},
		"glass":   {},
	}
}

func sortLayoutObjects[T any](values []T, keys func(T) (int, int64, string)) {
	sort.Slice(values, func(left int, right int) bool {
		leftZ, leftCreated, leftID := keys(values[left])
		rightZ, rightCreated, rightID := keys(values[right])
		if leftZ != rightZ {
			return leftZ < rightZ
		}
		if leftCreated != rightCreated {
			return leftCreated < rightCreated
		}
		return leftID < rightID
	})
}

func widgetLayoutsEqual(left []WidgetLayout, right []WidgetLayout) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func stickyNotesEqual(left []StickyNote, right []StickyNote) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func textAnnotationsEqual(left []TextAnnotation, right []TextAnnotation) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func backgroundLayersEqual(left []BackgroundLayer, right []BackgroundLayer) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

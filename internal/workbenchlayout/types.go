package workbenchlayout

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

const EventTypeLayoutReplaced = "layout.replaced"

type Snapshot struct {
	Seq             int64          `json:"seq"`
	Revision        int64          `json:"revision"`
	UpdatedAtUnixMs int64          `json:"updated_at_unix_ms"`
	Widgets         []WidgetLayout `json:"widgets"`
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
	id := strings.TrimSpace(widget.WidgetID)
	if id == "" {
		return WidgetLayout{}, errors.New("missing widget_id")
	}
	if len(id) > 128 {
		return WidgetLayout{}, fmt.Errorf("widget_id %q is too long", id)
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

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

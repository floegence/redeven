package notes

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	RetentionHours         = 72
	DefaultStyleVersion    = "note/v1"
	DefaultPreviewMaxRunes = 120
)

var (
	ErrTopicNotFound    = errors.New("topic not found")
	ErrNoteNotFound     = errors.New("note not found")
	ErrInvalidTopicName = errors.New("invalid topic name")
	ErrInvalidNoteTitle = errors.New("invalid note title")
	ErrInvalidNoteBody  = errors.New("invalid note body")
	ErrInvalidColor     = errors.New("invalid note color")
	ErrInvalidNoteID    = errors.New("invalid note id")
	ErrInvalidTopicID   = errors.New("invalid topic id")
)

type Topic struct {
	TopicID         string `json:"topic_id"`
	Name            string `json:"name"`
	IconKey         string `json:"icon_key"`
	IconAccent      string `json:"icon_accent"`
	SortOrder       int    `json:"sort_order"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64  `json:"updated_at_unix_ms"`
	DeletedAtUnixMs int64  `json:"deleted_at_unix_ms"`
}

type Item struct {
	NoteID          string  `json:"note_id"`
	TopicID         string  `json:"topic_id"`
	Title           string  `json:"title"`
	Headline        string  `json:"headline,omitempty"`
	Body            string  `json:"body"`
	PreviewText     string  `json:"preview_text"`
	CharacterCount  int     `json:"character_count"`
	SizeBucket      int     `json:"size_bucket"`
	StyleVersion    string  `json:"style_version"`
	ColorToken      string  `json:"color_token"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	ZIndex          int     `json:"z_index"`
	CreatedAtUnixMs int64   `json:"created_at_unix_ms"`
	UpdatedAtUnixMs int64   `json:"updated_at_unix_ms"`
}

type TrashItem struct {
	Item
	TopicName       string `json:"topic_name"`
	TopicIconKey    string `json:"topic_icon_key"`
	TopicIconAccent string `json:"topic_icon_accent"`
	TopicSortOrder  int    `json:"topic_sort_order"`
	DeletedAtUnixMs int64  `json:"deleted_at_unix_ms"`
}

type Snapshot struct {
	Seq            int64       `json:"seq"`
	RetentionHours int         `json:"retention_hours"`
	Topics         []Topic     `json:"topics"`
	Items          []Item      `json:"items"`
	TrashItems     []TrashItem `json:"trash_items"`
}

type Event struct {
	Seq             int64           `json:"seq"`
	Type            string          `json:"type"`
	EntityKind      string          `json:"entity_kind"`
	EntityID        string          `json:"entity_id"`
	TopicID         string          `json:"topic_id,omitempty"`
	CreatedAtUnixMs int64           `json:"created_at_unix_ms"`
	Payload         json.RawMessage `json:"payload"`
}

type deletedSnapshot struct {
	TopicID         string  `json:"topic_id"`
	TopicName       string  `json:"topic_name"`
	TopicIconKey    string  `json:"topic_icon_key"`
	TopicIconAccent string  `json:"topic_icon_accent"`
	TopicSortOrder  int     `json:"topic_sort_order"`
	X               float64 `json:"x"`
	Y               float64 `json:"y"`
	ZIndex          int     `json:"z_index"`
	StyleVersion    string  `json:"style_version"`
	ColorToken      string  `json:"color_token"`
	SizeBucket      int     `json:"size_bucket"`
}

type CreateTopicRequest struct {
	Name string `json:"name"`
}

type UpdateTopicRequest struct {
	TopicID string  `json:"-"`
	Name    *string `json:"name,omitempty"`
}

type CreateItemRequest struct {
	TopicID    string  `json:"topic_id"`
	Headline   *string `json:"headline,omitempty"`
	Title      *string `json:"title,omitempty"`
	Body       string  `json:"body"`
	ColorToken *string `json:"color_token,omitempty"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
}

type UpdateItemRequest struct {
	NoteID     string   `json:"-"`
	Headline   *string  `json:"headline,omitempty"`
	Title      *string  `json:"title,omitempty"`
	Body       *string  `json:"body,omitempty"`
	ColorToken *string  `json:"color_token,omitempty"`
	X          *float64 `json:"x,omitempty"`
	Y          *float64 `json:"y,omitempty"`
}

var noteColorPalette = []string{
	"graphite",
	"sage",
	"amber",
	"azure",
	"coral",
	"rose",
}

var topicAnimalPalette = []string{
	"fox",
	"crane",
	"otter",
	"lynx",
	"whale",
	"hare",
}

var topicAccentPalette = []string{
	"ember",
	"sea",
	"moss",
	"ink",
	"gold",
	"berry",
}

func isAllowedColorToken(value string) bool {
	for _, candidate := range noteColorPalette {
		if candidate == value {
			return true
		}
	}
	return false
}

func normalizeTopicName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", ErrInvalidTopicName
	}
	if count := len([]rune(name)); count > 48 {
		return "", fmt.Errorf("%w: topic name is too long", ErrInvalidTopicName)
	}
	return name, nil
}

func normalizeOptionalColor(value *string) (string, bool, error) {
	if value == nil {
		return "", false, nil
	}
	color := strings.TrimSpace(*value)
	if color == "" {
		return "", false, nil
	}
	if !isAllowedColorToken(color) {
		return "", false, ErrInvalidColor
	}
	return color, true, nil
}

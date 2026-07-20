package ai

// persistedMessage and block helpers build transient Flower timeline JSON from
// Floret snapshots. Redeven does not persist these message projections.

type persistedMessage struct {
	ID            string                 `json:"id"`
	TurnID        string                 `json:"turn_id"`
	Role          string                 `json:"role"`
	Blocks        []any                  `json:"blocks"`
	Status        string                 `json:"status"`
	Timestamp     int64                  `json:"timestamp"`
	Error         string                 `json:"error,omitempty"`
	ContextAction *ContextActionEnvelope `json:"contextAction,omitempty"`
}

type persistedMarkdownBlock struct {
	Type    string `json:"type"` // "markdown"
	Content string `json:"content"`
}

type persistedThinkingBlock struct {
	Type     string `json:"type"` // "thinking"
	Content  string `json:"content,omitempty"`
	Duration int64  `json:"duration,omitempty"`
}

type persistedTextBlock struct {
	Type    string `json:"type"` // "text"
	Content string `json:"content"`
}

type persistedImageBlock struct {
	Type string `json:"type"` // "image"
	Src  string `json:"src"`
	Alt  string `json:"alt,omitempty"`
}

type persistedFileBlock struct {
	Type     string `json:"type"` // "file"
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
	URL      string `json:"url,omitempty"`
}

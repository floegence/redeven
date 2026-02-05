package ai

// persistedMessage and block helpers are used for storing chat history in the local threads DB.
//
// The JSON shape is aligned with @floegence/floe-webapp-core/chat Message + MessageBlock types (camelCase).

type persistedMessage struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Blocks    []any  `json:"blocks"`
	Status    string `json:"status"`
	Timestamp int64  `json:"timestamp"`
	Error     string `json:"error,omitempty"`
}

type persistedMarkdownBlock struct {
	Type    string `json:"type"` // "markdown"
	Content string `json:"content"`
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

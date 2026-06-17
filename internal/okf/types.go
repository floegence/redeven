package okf

type Concept struct {
	Path        string         `json:"path"`
	ConceptID   string         `json:"concept_id"`
	Type        string         `json:"type"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Resource    string         `json:"resource,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	Timestamp   string         `json:"timestamp,omitempty"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	Body        string         `json:"body"`
	Snippet     string         `json:"snippet,omitempty"`
}

type RootIndex struct {
	Path        string         `json:"path"`
	OKFVersion  string         `json:"okf_version"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	Body        string         `json:"body"`
}

type Bundle struct {
	SchemaVersion int       `json:"schema_version"`
	OKFVersion    string    `json:"okf_version"`
	RootIndex     RootIndex `json:"root_index"`
	Concepts      []Concept `json:"concepts"`
	SourceSHA256  string    `json:"source_sha256"`
}

type BundleManifest struct {
	SchemaVersion int    `json:"schema_version"`
	OKFVersion    string `json:"okf_version"`
	ConceptCount  int    `json:"concept_count"`
	BundleSHA256  string `json:"bundle_sha256"`
	SourceSHA256  string `json:"source_sha256"`
}

type SearchMatch struct {
	ConceptID   string   `json:"concept_id"`
	Path        string   `json:"path"`
	Type        string   `json:"type"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Resource    string   `json:"resource,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Snippet     string   `json:"snippet,omitempty"`
	Score       int      `json:"score"`
}

type SearchResult struct {
	Query         string        `json:"query"`
	TotalConcepts int           `json:"total_concepts"`
	Matches       []SearchMatch `json:"matches"`
}

type SearchRequest struct {
	Query      string
	MaxResults int
	Tags       []string
}

const (
	SchemaVersion = 1
	OKFVersion    = "0.1"
)

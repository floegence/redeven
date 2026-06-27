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
	Links       []ConceptLink  `json:"links,omitempty"`
	Backlinks   []ConceptLink  `json:"backlinks,omitempty"`
}

type RootIndex struct {
	Path        string         `json:"path"`
	OKFVersion  string         `json:"okf_version"`
	Frontmatter map[string]any `json:"frontmatter,omitempty"`
	Body        string         `json:"body"`
	Sections    []IndexSection `json:"sections,omitempty"`
	Links       []ConceptLink  `json:"links,omitempty"`
}

type Bundle struct {
	SchemaVersion int       `json:"schema_version"`
	OKFVersion    string    `json:"okf_version"`
	RootIndex     RootIndex `json:"root_index"`
	Concepts      []Concept `json:"concepts"`
	SourceSHA256  string    `json:"source_sha256"`
}

type ConceptSummary struct {
	ConceptID   string   `json:"concept_id,omitempty"`
	Path        string   `json:"path"`
	Type        string   `json:"type,omitempty"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Resource    string   `json:"resource,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type ConceptLink struct {
	Label     string `json:"label"`
	Path      string `json:"path"`
	ConceptID string `json:"concept_id,omitempty"`
	Title     string `json:"title,omitempty"`
}

type IndexEntry struct {
	ConceptSummary
}

type IndexSection struct {
	Title   string       `json:"title"`
	Slug    string       `json:"slug"`
	Entries []IndexEntry `json:"entries"`
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
	Filters       SearchFilters `json:"filters,omitempty"`
	TotalConcepts int           `json:"total_concepts"`
	TotalMatches  int           `json:"total_matches"`
	MatchCount    int           `json:"match_count"`
	MaxResults    int           `json:"max_results"`
	HasMore       bool          `json:"has_more"`
	OmittedCount  int           `json:"omitted_count"`
	Matches       []SearchMatch `json:"matches"`
	Truncated     bool          `json:"truncated"`
}

type SearchRequest struct {
	Query      string
	MaxResults int
	Type       string
	Tags       []string
}

type SearchFilters struct {
	Type string   `json:"type,omitempty"`
	Tags []string `json:"tags,omitempty"`
}

type IndexRequest struct {
	Section string
}

type IndexResult struct {
	OKFVersion    string         `json:"okf_version"`
	TotalSections int            `json:"total_sections"`
	Sections      []IndexSection `json:"sections"`
	Truncated     bool           `json:"truncated"`
}

type OpenRequest struct {
	ConceptID  string
	Path       string
	BodyOffset int
	BodyLimit  int
}

type OpenResult struct {
	Concept            ConceptSummary `json:"concept"`
	Body               string         `json:"body"`
	BodyOffset         int            `json:"body_offset"`
	BodyLength         int            `json:"body_length"`
	ReturnedBodyLength int            `json:"returned_body_length"`
	Truncated          bool           `json:"truncated"`
	Links              []ConceptLink  `json:"links"`
	Backlinks          []ConceptLink  `json:"backlinks"`
}

const (
	SchemaVersion = 2
	OKFVersion    = "0.1"
)

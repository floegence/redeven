package knowledge

type EvidenceRef struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
	Line int    `json:"line"`
	Note string `json:"note,omitempty"`
}

type Card struct {
	ID                string        `json:"id"`
	Version           int           `json:"version"`
	Title             string        `json:"title"`
	Status            string        `json:"status"`
	Owners            []string      `json:"owners,omitempty"`
	Tags              []string      `json:"tags,omitempty"`
	Summary           string        `json:"summary"`
	Mechanism         string        `json:"mechanism"`
	Boundaries        string        `json:"boundaries"`
	InvalidConditions string        `json:"invalid_conditions"`
	Evidence          []EvidenceRef `json:"evidence"`
	SourceCardID      string        `json:"source_card_id,omitempty"`
}

type Indices struct {
	Topics    map[string][]string `json:"topics"`
	CodePaths map[string][]string `json:"code_paths"`
}

type SourceManifest struct {
	SchemaVersion int               `json:"schema_version" yaml:"schema_version"`
	KnowledgeID   string            `json:"knowledge_id" yaml:"knowledge_id"`
	KnowledgeName string            `json:"knowledge_name" yaml:"knowledge_name"`
	UpdatedAt     string            `json:"updated_at" yaml:"updated_at"`
	AllowedRepos  []string          `json:"allowed_repos" yaml:"allowed_repos"`
	SourceRefs    map[string]string `json:"source_refs,omitempty" yaml:"source_refs"`
}

type Bundle struct {
	SchemaVersion int               `json:"schema_version"`
	BuiltAt       string            `json:"built_at"`
	KnowledgeID   string            `json:"knowledge_id"`
	KnowledgeName string            `json:"knowledge_name"`
	AllowedRepos  []string          `json:"allowed_repos"`
	SourceRefs    map[string]string `json:"source_refs,omitempty"`
	SourceSHA256  string            `json:"source_sha256"`
	Cards         []Card            `json:"cards"`
	Indices       Indices           `json:"indices"`
}

type BundleManifest struct {
	SchemaVersion    int      `json:"schema_version"`
	BuiltAt          string   `json:"built_at"`
	KnowledgeID      string   `json:"knowledge_id"`
	AllowedRepos     []string `json:"allowed_repos"`
	CardCount        int      `json:"card_count"`
	BundleSHA256     string   `json:"bundle_sha256"`
	CardsSHA256      string   `json:"cards_sha256"`
	TopicIndexSHA256 string   `json:"topic_index_sha256"`
	CodeIndexSHA256  string   `json:"code_index_sha256"`
	SourceSHA256     string   `json:"source_sha256"`
}

const (
	SchemaVersion = 2
)

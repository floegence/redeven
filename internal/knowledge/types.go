package knowledge

type EvidenceRef struct {
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
	SourceCommit      string        `json:"source_commit,omitempty"`
}

type Indices struct {
	Topics    map[string][]string `json:"topics"`
	CodePaths map[string][]string `json:"code_paths"`
}

type Bundle struct {
	SchemaVersion int     `json:"schema_version"`
	GeneratedAt   string  `json:"generated_at"`
	SourceCommit  string  `json:"source_commit"`
	PromptVersion string  `json:"prompt_version,omitempty"`
	Cards         []Card  `json:"cards"`
	Indices       Indices `json:"indices"`
}

type BundleManifest struct {
	SchemaVersion    int    `json:"schema_version"`
	GeneratedAt      string `json:"generated_at"`
	SourceCommit     string `json:"source_commit"`
	CardCount        int    `json:"card_count"`
	BundleSHA256     string `json:"bundle_sha256"`
	CardsSHA256      string `json:"cards_sha256"`
	TopicIndexSHA256 string `json:"topic_index_sha256"`
	CodeIndexSHA256  string `json:"code_index_sha256"`
	LockSHA256       string `json:"lock_sha256"`
}

type LockFile struct {
	SchemaVersion       int    `json:"schema_version"`
	RedevenSourceCommit string `json:"redeven_source_commit"`
	Generator           struct {
		Engine        string `json:"engine"`
		ModelID       string `json:"model_id"`
		PromptVersion string `json:"prompt_version"`
	} `json:"generator"`
	GeneratedAt   string `json:"generated_at"`
	InputsSHA256  string `json:"inputs_sha256"`
	OutputsSHA256 string `json:"outputs_sha256"`
}

type GenerationReport struct {
	SchemaVersion int                    `json:"schema_version"`
	GeneratedAt   string                 `json:"generated_at"`
	ModelID       string                 `json:"model_id"`
	CardCount     int                    `json:"card_count"`
	Warnings      []string               `json:"warnings,omitempty"`
	Items         []GenerationReportItem `json:"items"`
}

type GenerationReportItem struct {
	CardID   string   `json:"card_id"`
	Status   string   `json:"status"`
	Warnings []string `json:"warnings,omitempty"`
}

const (
	SchemaVersion = 1
)

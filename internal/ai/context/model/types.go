package model

import "strings"

// ModelCapability defines model/runtime feature support for prompt adaptation.
type ModelCapability struct {
	ProviderID               string `json:"provider_id"`
	ModelName                string `json:"model_name"`
	SupportsTools            bool   `json:"supports_tools"`
	SupportsParallelTools    bool   `json:"supports_parallel_tools"`
	SupportsStrictJSONSchema bool   `json:"supports_strict_json_schema"`
	SupportsImageInput       bool   `json:"supports_image_input"`
	SupportsFileInput        bool   `json:"supports_file_input"`
	SupportsReasoningTokens  bool   `json:"supports_reasoning_tokens"`
	MaxContextTokens         int    `json:"max_context_tokens"`
	MaxOutputTokens          int    `json:"max_output_tokens"`
	PreferredToolSchemaMode  string `json:"preferred_tool_schema_mode"`
}

type MemoryScope string

const (
	MemoryScopeWorking  MemoryScope = "working"
	MemoryScopeEpisodic MemoryScope = "episodic"
	MemoryScopeLongTerm MemoryScope = "long_term"
)

type MemoryKind string

const (
	MemoryKindFact       MemoryKind = "fact"
	MemoryKindConstraint MemoryKind = "constraint"
	MemoryKindDecision   MemoryKind = "decision"
	MemoryKindTodo       MemoryKind = "todo"
	MemoryKindArtifact   MemoryKind = "artifact"
)

// MemoryItem is the runtime semantic memory shape.
type MemoryItem struct {
	MemoryID       string      `json:"memory_id"`
	ThreadID       string      `json:"thread_id"`
	Scope          MemoryScope `json:"scope"`
	Kind           MemoryKind  `json:"kind"`
	Content        string      `json:"content"`
	SourceRefsJSON string      `json:"source_refs_json"`
	Importance     float64     `json:"importance"`
	Freshness      float64     `json:"freshness"`
	Confidence     float64     `json:"confidence"`
	CreatedAtUnix  int64       `json:"created_at_unix_ms"`
	UpdatedAtUnix  int64       `json:"updated_at_unix_ms"`
}

// DialogueTurn stores the text view needed by packer and retriever.
type DialogueTurn struct {
	TurnID             string `json:"turn_id"`
	RunID              string `json:"run_id"`
	UserMessageID      string `json:"user_message_id"`
	AssistantMessageID string `json:"assistant_message_id"`
	UserText           string `json:"user_text"`
	AssistantText      string `json:"assistant_text"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
}

// ExecutionEvidence stores normalized spans for context retrieval.
type ExecutionEvidence struct {
	SpanID          string `json:"span_id"`
	RunID           string `json:"run_id"`
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Status          string `json:"status"`
	Summary         string `json:"summary"`
	PayloadJSON     string `json:"payload_json"`
	StartedAtUnixMs int64  `json:"started_at_unix_ms"`
	EndedAtUnixMs   int64  `json:"ended_at_unix_ms"`
}

// AttachmentManifest is the model-facing attachment summary.
type AttachmentManifest struct {
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
	URL      string `json:"url"`
	Mode     string `json:"mode"`
}

// PromptPack is the canonical model context envelope.
type PromptPack struct {
	ThreadID                  string               `json:"thread_id"`
	RunID                     string               `json:"run_id"`
	SystemContract            string               `json:"system_contract"`
	Objective                 string               `json:"objective"`
	ActiveConstraints         []string             `json:"active_constraints"`
	RecentDialogue            []DialogueTurn       `json:"recent_dialogue"`
	ExecutionEvidence         []ExecutionEvidence  `json:"execution_evidence"`
	PendingTodos              []MemoryItem         `json:"pending_todos"`
	RetrievedLongTermMemory   []MemoryItem         `json:"retrieved_long_term_memory"`
	AttachmentsManifest       []AttachmentManifest `json:"attachments_manifest"`
	ThreadSnapshot            string               `json:"thread_snapshot"`
	EstimatedInputTokens      int                  `json:"estimated_input_tokens"`
	CompressionSavingRatio    float64              `json:"compression_saving_ratio"`
	CompressionQualityPass    bool                 `json:"compression_quality_pass"`
	ContextSectionsTokenUsage map[string]int       `json:"context_sections_token_usage"`
}

func (p PromptPack) ApproxText() string {
	parts := []string{strings.TrimSpace(p.SystemContract), strings.TrimSpace(p.Objective), strings.TrimSpace(p.ThreadSnapshot)}
	parts = append(parts, p.ActiveConstraints...)
	for _, turn := range p.RecentDialogue {
		if txt := strings.TrimSpace(turn.UserText); txt != "" {
			parts = append(parts, txt)
		}
		if txt := strings.TrimSpace(turn.AssistantText); txt != "" {
			parts = append(parts, txt)
		}
	}
	for _, ev := range p.ExecutionEvidence {
		if txt := strings.TrimSpace(ev.Summary); txt != "" {
			parts = append(parts, txt)
		}
	}
	for _, mem := range p.PendingTodos {
		if txt := strings.TrimSpace(mem.Content); txt != "" {
			parts = append(parts, txt)
		}
	}
	for _, mem := range p.RetrievedLongTermMemory {
		if txt := strings.TrimSpace(mem.Content); txt != "" {
			parts = append(parts, txt)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func NormalizeCapability(in ModelCapability) ModelCapability {
	out := in
	if strings.TrimSpace(out.PreferredToolSchemaMode) == "" {
		out.PreferredToolSchemaMode = "json_schema"
	}
	if out.MaxContextTokens <= 0 {
		out.MaxContextTokens = 128000
	}
	if out.MaxOutputTokens <= 0 {
		out.MaxOutputTokens = 4096
	}
	return out
}

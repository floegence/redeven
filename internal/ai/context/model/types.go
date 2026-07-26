package model

import (
	"strings"

	"github.com/floegence/redeven/internal/config"
)

// ModelCapability defines provider/model feature support for runtime setup.
type ModelCapability struct {
	ProviderID                     string                       `json:"provider_id"`
	ProviderType                   string                       `json:"provider_type,omitempty"`
	ResolverVersion                int                          `json:"resolver_version,omitempty"`
	ModelName                      string                       `json:"model_name"`
	WireModelName                  string                       `json:"wire_model_name,omitempty"`
	SupportsTools                  bool                         `json:"supports_tools"`
	SupportsStrictJSONSchema       bool                         `json:"supports_strict_json_schema"`
	SupportsImageInput             bool                         `json:"supports_image_input"`
	SupportsFileInput              bool                         `json:"supports_file_input"`
	SupportsReasoningTokens        bool                         `json:"supports_reasoning_tokens"`
	ReasoningCapability            config.AIReasoningCapability `json:"reasoning_capability,omitempty"`
	SupportsAskUserQuestionBatches bool                         `json:"supports_ask_user_question_batches"`
	MaxContextTokens               int                          `json:"max_context_tokens"`
	MaxOutputTokens                int                          `json:"max_output_tokens"`
	PreferredToolSchemaMode        string                       `json:"preferred_tool_schema_mode"`
}

// AttachmentManifest is the attachment capability adaptation input.
type AttachmentManifest struct {
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
	URL      string `json:"url"`
	Mode     string `json:"mode"`
}

func NormalizeCapability(in ModelCapability) ModelCapability {
	out := in
	out.ProviderID = strings.TrimSpace(out.ProviderID)
	out.ModelName = strings.TrimSpace(out.ModelName)
	out.WireModelName = strings.TrimSpace(out.WireModelName)
	if out.WireModelName == "" {
		out.WireModelName = out.ModelName
	}
	out.ProviderType = strings.ToLower(strings.TrimSpace(out.ProviderType))
	out.ReasoningCapability = out.ReasoningCapability.Normalize()
	if out.ResolverVersion < 0 {
		out.ResolverVersion = 0
	}
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

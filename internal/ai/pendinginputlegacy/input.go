// Package pendinginputlegacy interprets the retired product queue format.
// Its wire fields, limits, defaults, and canonical projection are frozen at the
// compatibility baseline. Live request normalization and authorization belong
// to the caller, after this historical interpretation.
package pendinginputlegacy

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
)

type Session struct {
	ChannelID         string `json:"channel_id"`
	EndpointID        string `json:"endpoint_id"`
	FloeApp           string `json:"floe_app"`
	CodeSpaceID       string `json:"code_space_id,omitempty"`
	SessionKind       string `json:"session_kind,omitempty"`
	UserPublicID      string `json:"user_public_id"`
	UserEmail         string `json:"user_email"`
	NamespacePublicID string `json:"namespace_public_id"`
	CanRead           bool   `json:"can_read"`
	CanWrite          bool   `json:"can_write"`
	CanExecute        bool   `json:"can_execute"`
	// CanAdmin gates management actions on the data plane (e.g. codespace create/delete/rename).
	//
	// NOTE: this is the namespace-level "admin" bit computed service-side and delivered by the control plane.
	// It is NOT part of the local permission_policy RWX clamp.
	CanAdmin        bool  `json:"can_admin"`
	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
}

type Options struct {
	// ReasoningOnly relaxes tool-pressure heuristics while preserving the same Floret turn flow.
	ReasoningOnly bool `json:"reasoning_only,omitempty"`

	// NoUserInteraction prevents direct user-input prompts for autonomous runs.
	// Tool approval waits are governed by the explicit approver/delegation policy.
	NoUserInteraction bool `json:"no_user_interaction,omitempty"`

	// ToolAllowlist is an internal runtime guard that limits the visible tool surface
	// for the current run. It is intended for runtime-owned callers such as evals and
	// subagents rather than general user-facing requests.
	ToolAllowlist []string `json:"tool_allowlist,omitempty"`

	// PermissionType controls the run tool surface and approval policy.
	PermissionType string `json:"permission_type,omitempty"`

	// Provider controls.
	ReasoningSelection ReasoningSelection `json:"reasoning_selection,omitempty"`
	CacheControl       string             `json:"cache_control,omitempty"`
	ResponseFormat     string             `json:"response_format,omitempty"`
	Temperature        *float64           `json:"temperature,omitempty"`
	TopP               *float64           `json:"top_p,omitempty"`

	// Optional hard budgets (0 means unset). Input is cumulative across one run;
	// output is the maximum for each provider request.
	MaxInputTokens  int     `json:"max_input_tokens,omitempty"`
	MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
	MaxCostUSD      float64 `json:"max_cost_usd,omitempty"`

	// CompactionThreshold controls when runtime compaction is triggered.
	// Value is a fraction in range [0,1]. 0 means use runtime default.
	CompactionThreshold float64 `json:"compaction_threshold,omitempty"`
}

type ReasoningSelection struct {
	Level        string `json:"level,omitempty"`
	BudgetTokens int64  `json:"budget_tokens,omitempty"`
}
type Attachment struct {
	AttachmentID string `json:"attachment_id"`
}

type Upload struct {
	ID, Name, MIMEType, SHA256 string
	Size                       int64
	CodePoints, Lines          *int64
}

func DecodeSession(raw string) (Session, error) {
	var value Session
	if err := decodeStrictJSON(raw, &value); err != nil {
		return value, err
	}
	if strings.TrimSpace(value.EndpointID) == "" || strings.TrimSpace(value.ChannelID) == "" || strings.TrimSpace(value.UserPublicID) == "" {
		return value, errors.New("incomplete historical session identity")
	}
	if !value.CanRead || !value.CanWrite || !value.CanExecute {
		return value, errors.New("historical input was not admitted with read, write, and execute permissions")
	}
	return value, nil
}

func DecodeOptions(raw string) (Options, error) {
	var value Options
	err := decodeStrictJSON(raw, &value)
	return value, err
}

func DecodeAttachments(raw string) ([]Attachment, error) {
	var value []Attachment
	if err := decodeStrictJSON(raw, &value); err != nil {
		return nil, err
	}
	for _, item := range value {
		if !validUploadID(item.AttachmentID) {
			return nil, errors.New("invalid historical attachment ID")
		}
	}
	return value, nil
}

func DecodeContext(raw string) (*ContextActionEnvelope, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value ContextActionEnvelope
	if err := decodeStrictJSON(raw, &value); err != nil {
		return nil, err
	}
	return normalizeAskFlowerContextActionEnvelope(&value)
}

// Project derives identity from persisted routing only. Current runtime policy
// cannot change the canonical bytes committed by a retried migration.
func Project(action *ContextActionEnvelope, endpoint, primaryTarget string) ([]flruntime.MessageReference, []flruntime.TurnSupplementalContextItem, error) {
	var authority *flowerCanonicalReferenceTargetAuthority
	if flowerContextActionRequiresCanonicalReferenceAuthority(action) {
		target, locality := strings.TrimSpace(endpoint), contextActionLocalityCurrent
		if primary := strings.TrimSpace(primaryTarget); primary != "" && primary != target {
			target, locality = primary, contextActionLocalityRemote
		}
		authority = &flowerCanonicalReferenceTargetAuthority{TargetID: target, TargetLocality: locality, SourceEnvPublicID: strings.TrimSpace(endpoint)}
	}
	return floretContextActionItemsWithAuthority(action, authority)
}

func TurnInput(ctx context.Context, text string, attachments []Attachment, references []flruntime.MessageReference, load func(context.Context, string) (Upload, error)) (flruntime.TurnInput, error) {
	out := flruntime.TurnInput{Text: strings.TrimSpace(text), References: references}
	for _, attachment := range attachments {
		if !validUploadID(attachment.AttachmentID) {
			return out, errors.New("invalid historical attachment ID")
		}
		record, err := load(ctx, attachment.AttachmentID)
		if err != nil {
			return out, err
		}
		digest := strings.ToLower(strings.TrimSpace(record.SHA256))
		decoded, err := hex.DecodeString(digest)
		if err != nil || len(decoded) != 32 || record.ID != attachment.AttachmentID || record.Size < 0 || record.Size > 10<<20 {
			return out, errors.New("invalid historical attachment metadata")
		}
		item := flruntime.MessageAttachment{ResourceRef: "redeven-upload:v1:" + record.ID + ":sha256:" + digest, Name: strings.TrimSpace(record.Name), MIMEType: strings.TrimSpace(record.MIMEType), SizeBytes: record.Size}
		if record.CodePoints != nil && record.Lines != nil {
			item.TextStats = &flruntime.MessageAttachmentTextStats{UnicodeCodePointCount: *record.CodePoints, LogicalLineCount: *record.Lines}
		}
		out.Attachments = append(out.Attachments, item)
	}
	return out, out.Validate()
}

func validUploadID(id string) bool {
	if !strings.HasPrefix(id, "upl_") || len(id) != 28 {
		return false
	}
	for _, c := range id[4:] {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			continue
		}
		return false
	}
	return true
}

func decodeStrictJSON(raw string, out any) error {
	if strings.TrimSpace(raw) == "" {
		return errors.New("empty JSON payload")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errors.New("multiple JSON values")
		}
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return nil
}

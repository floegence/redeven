package threadstore

// This file parses only historical v6/v7 rows while upgrading to schema v8.
// No symbol here is a production composer or host-facing runtime contract.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"unicode/utf8"
)

const (
	legacyUploadRefKindDraft            = "draft"
	legacyUploadRefKindDraftPending     = "draft_pending"
	legacyComposerReferenceLimit        = 128
	legacyComposerReferencePathLimit    = 16 * 1024
	legacyComposerReferenceLocalIDLimit = 256
	legacyComposerReferenceLabelLimit   = 512
)

type composerDraftAdmissionValue struct {
	Text                         string                   `json:"text"`
	Mode                         string                   `json:"mode"`
	ProposedTurnID               string                   `json:"proposed_turn_id"`
	AdmissionStarted             bool                     `json:"admission_started"`
	ModelID                      string                   `json:"model_id"`
	PreparedLongTextAttachmentID string                   `json:"prepared_long_text_attachment_id"`
	TargetThreadID               string                   `json:"target_thread_id"`
	References                   []composerDraftReference `json:"references"`
	Attachments                  []struct {
		Staged *struct {
			AttachmentID string `json:"attachment_id"`
		} `json:"staged"`
	} `json:"attachments"`
}

type composerDraftReference struct {
	LocalID string `json:"local_id"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Path    string `json:"path"`
}

type composerReferenceAdmissionProjection struct {
	Path        string
	IsDirectory bool
}

func legacyComposerDraftUploadRefID(ownerUserHash string, scopeID string) string {
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	scopeID = strings.TrimSpace(scopeID)
	if len(ownerUserHash) != sha256.Size*2 || scopeID == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(ownerUserHash + "\x00" + scopeID))
	return "draft_ref_v1_" + hex.EncodeToString(digest[:])
}

func normalizeComposerDraftValue(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > 12<<20 {
		return nil, errors.New("invalid composer draft value")
	}
	var value map[string]any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&value); err != nil || value == nil {
		return nil, errors.New("invalid composer draft value")
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("invalid composer draft value")
	}
	text, textOK := value["text"].(string)
	attachments, attachmentsOK := value["attachments"].([]any)
	mode, modeOK := value["mode"].(string)
	if !textOK || !utf8.ValidString(text) || !attachmentsOK || len(attachments) > 20 || !modeOK {
		return nil, errors.New("invalid composer draft value")
	}
	switch mode {
	case "ordinary", "over_limit_editing", "preparing_long_text_submission", "admission_in_flight":
	default:
		return nil, errors.New("invalid composer draft mode")
	}
	for _, item := range attachments {
		if _, ok := item.(map[string]any); !ok {
			return nil, errors.New("invalid composer draft attachment")
		}
	}
	if _, err := normalizeComposerDraftReferences(value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

func normalizeComposerDraftReferences(value map[string]any) ([]composerDraftReference, error) {
	raw, exists := value["references"]
	if !exists {
		return nil, errors.New("invalid composer draft references")
	}
	items, ok := raw.([]any)
	if !ok || len(items) > legacyComposerReferenceLimit {
		return nil, errors.New("invalid composer draft references")
	}
	out := make([]composerDraftReference, 0, len(items))
	seenIDs := map[string]struct{}{}
	seenPaths := map[string]struct{}{}
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok || len(item) != 4 {
			return nil, errors.New("invalid composer draft reference")
		}
		localID, idOK := item["local_id"].(string)
		kind, kindOK := item["kind"].(string)
		label, labelOK := item["label"].(string)
		pathValue, pathOK := item["path"].(string)
		if !idOK || !kindOK || !labelOK || !pathOK || localID == "" || localID != strings.TrimSpace(localID) || len(localID) > legacyComposerReferenceLocalIDLimit || strings.ContainsAny(localID, "\r\n\x00") {
			return nil, errors.New("invalid composer draft reference")
		}
		if kind != "file" && kind != "directory" {
			return nil, errors.New("invalid composer draft reference kind")
		}
		if pathValue == "" || pathValue != strings.TrimSpace(pathValue) || len(pathValue) > legacyComposerReferencePathLimit || strings.ContainsAny(pathValue, "\r\n\x00") {
			return nil, errors.New("invalid composer draft reference path")
		}
		if label != path.Base(strings.TrimSuffix(strings.ReplaceAll(pathValue, "\\", "/"), "/")) || utf8.RuneCountInString(label) > legacyComposerReferenceLabelLimit {
			return nil, errors.New("invalid composer draft reference label")
		}
		semantic := kind + "\x00" + pathValue
		if _, exists := seenIDs[localID]; exists {
			return nil, errors.New("duplicate composer draft reference identity")
		}
		if _, exists := seenPaths[semantic]; exists {
			return nil, errors.New("duplicate composer draft reference path")
		}
		seenIDs[localID], seenPaths[semantic] = struct{}{}, struct{}{}
		out = append(out, composerDraftReference{LocalID: localID, Kind: kind, Label: label, Path: pathValue})
	}
	return out, nil
}

func composerDraftAttachmentIDs(value json.RawMessage) ([]string, error) {
	var record composerDraftAdmissionValue
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(record.Attachments))
	seen := map[string]struct{}{}
	for _, attachment := range record.Attachments {
		if attachment.Staged == nil {
			continue
		}
		id := strings.TrimSpace(attachment.Staged.AttachmentID)
		if id == "" || len(id) > 200 || strings.ContainsAny(id, "\r\n\x00") {
			return nil, errors.New("invalid composer draft attachment identity")
		}
		if _, exists := seen[id]; exists {
			return nil, errors.New("duplicate composer draft attachment identity")
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, nil
}

func validateComposerDraftReferenceAdmission(references []composerDraftReference, raw string) error {
	want := make([]composerReferenceAdmissionProjection, 0, len(references))
	for _, reference := range references {
		want = append(want, composerReferenceAdmissionProjection{Path: reference.Path, IsDirectory: reference.Kind == "directory"})
	}
	if strings.TrimSpace(raw) == "" {
		if len(want) == 0 {
			return nil
		}
		return errors.New("composer draft reference admission changed")
	}
	var envelope struct {
		Source struct {
			Surface string `json:"surface"`
		} `json:"source"`
		Context []struct {
			Kind        string `json:"kind"`
			Path        string `json:"path"`
			IsDirectory bool   `json:"is_directory"`
		} `json:"context"`
	}
	if err := json.Unmarshal([]byte(raw), &envelope); err != nil || strings.TrimSpace(envelope.Source.Surface) != "flower_composer" || len(envelope.Context) != len(want) {
		return errors.New("composer draft reference admission changed")
	}
	for index, item := range envelope.Context {
		if item.Kind != "file_path" || want[index] != (composerReferenceAdmissionProjection{Path: item.Path, IsDirectory: item.IsDirectory}) {
			return fmt.Errorf("composer draft reference admission changed at index %d", index)
		}
	}
	return nil
}

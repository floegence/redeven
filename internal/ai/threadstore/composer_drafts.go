package threadstore

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	ComposerDraftModeOrdinary                   = "ordinary"
	ComposerDraftModeOverLimitEditing           = "over_limit_editing"
	ComposerDraftModePreparingLongText          = "preparing_long_text_submission"
	ComposerDraftModeAdmissionInFlight          = "admission_in_flight"
	composerDraftRetention                      = 30 * 24 * time.Hour
	composerDraftLeaseDuration                  = 15 * time.Second
	composerDraftInlineTextCodePointLimit int64 = 50_000
	composerDraftNewThreadScopeID               = "__new_thread__"
	composerDraftReferenceLimit                 = 128
	composerDraftReferenceLocalIDLimit          = 200
	composerDraftReferencePathLimit             = 4_096
	composerDraftReferenceLabelRuneLimit        = 256
)

var (
	ErrComposerDraftRevisionConflict = errors.New("composer draft revision conflict")
	ErrComposerDraftLeaseLost        = errors.New("composer draft lease lost")
	ErrLongTextAttachmentRequired    = errors.New("long_text_attachment_required")
)

type ComposerDraftRecord struct {
	EndpointID           string          `json:"-"`
	OwnerUserHash        string          `json:"-"`
	ScopeID              string          `json:"scope_id"`
	Revision             int64           `json:"revision"`
	Value                json.RawMessage `json:"value"`
	UpdatedAtUnixMs      int64           `json:"updated_at_unix_ms"`
	ExpiresAtUnixMs      int64           `json:"expires_at_unix_ms"`
	LeaseID              string          `json:"lease_id,omitempty"`
	LeaseHolderID        string          `json:"lease_holder_id,omitempty"`
	LeaseExpiresAtUnixMs int64           `json:"lease_expires_at_unix_ms,omitempty"`
}

type ComposerDraftLeaseResult struct {
	State  string              `json:"state"`
	Draft  ComposerDraftRecord `json:"draft"`
	Holder string              `json:"holder_id,omitempty"`
}

type ComposerDraftMutation struct {
	EndpointID       string
	OwnerUserHash    string
	ScopeID          string
	HolderID         string
	LeaseID          string
	ExpectedRevision int64
	Value            json.RawMessage
	NowUnixMs        int64
}

type ComposerDraftSweepResult struct {
	DraftsDeleted   int64
	UploadsToDelete []UploadRecord
}

type ComposerDraftReconcileResult struct {
	Draft           *ComposerDraftRecord
	UploadsToDelete []UploadRecord
}

type ComposerDraftAdmissionCandidate struct {
	EndpointID      string
	OwnerUserHash   string
	ScopeID         string
	UpdatedAtUnixMs int64
}

type composerDraftAdmissionValue struct {
	Text                         string                   `json:"text"`
	Mode                         string                   `json:"mode"`
	ProposedTurnID               string                   `json:"proposed_turn_id"`
	AdmissionStarted             bool                     `json:"admission_started"`
	ModelID                      string                   `json:"model_id"`
	CapabilityRevision           string                   `json:"capability_revision"`
	PreparedLongTextAttachmentID string                   `json:"prepared_long_text_attachment_id"`
	TargetThreadID               string                   `json:"target_thread_id"`
	References                   []composerDraftReference `json:"references"`
	Attachments                  []struct {
		Source string `json:"source"`
		Staged *struct {
			AttachmentID       string `json:"attachment_id"`
			Name               string `json:"name"`
			MediaType          string `json:"mime_type"`
			SizeBytes          int64  `json:"size_bytes"`
			DigestSHA256       string `json:"digest_sha256"`
			Locator            string `json:"locator"`
			Source             string `json:"source"`
			CapabilityRevision string `json:"capability_revision"`
			TextStats          *struct {
				CodePoints int64 `json:"code_points"`
				Lines      int64 `json:"lines"`
			} `json:"text_stats"`
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

func NormalizeComposerReferencePath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > composerDraftReferencePathLimit || !utf8.ValidString(value) || strings.ContainsAny(value, "\r\n\x00") {
		return "", errors.New("invalid composer reference path")
	}
	return value, nil
}

func ComposerReferencePathLabel(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" {
		return ""
	}
	label := path.Base(strings.TrimSuffix(value, "/"))
	if label == "." || label == "/" {
		return value
	}
	return label
}

func normalizeComposerDraftReferences(value map[string]any) ([]composerDraftReference, error) {
	raw, exists := value["references"]
	if !exists {
		return nil, errors.New("invalid composer draft references")
	}
	items, ok := raw.([]any)
	if !ok || len(items) > composerDraftReferenceLimit {
		return nil, errors.New("invalid composer draft references")
	}
	references := make([]composerDraftReference, 0, len(items))
	seenLocalIDs := make(map[string]struct{}, len(items))
	seenPaths := make(map[string]struct{}, len(items))
	canonical := make([]any, 0, len(items))
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok || len(item) != 4 {
			return nil, errors.New("invalid composer draft reference")
		}
		localID, localIDOK := item["local_id"].(string)
		kind, kindOK := item["kind"].(string)
		label, labelOK := item["label"].(string)
		rawPath, pathOK := item["path"].(string)
		if !localIDOK || !kindOK || !labelOK || !pathOK {
			return nil, errors.New("invalid composer draft reference")
		}
		localID = strings.TrimSpace(localID)
		if localID == "" || localID != item["local_id"] || len(localID) > composerDraftReferenceLocalIDLimit || !utf8.ValidString(localID) || strings.ContainsAny(localID, "\r\n\x00") {
			return nil, errors.New("invalid composer draft reference identity")
		}
		if kind != "file" && kind != "directory" {
			return nil, errors.New("invalid composer draft reference kind")
		}
		normalizedPath, err := NormalizeComposerReferencePath(rawPath)
		if err != nil || normalizedPath != rawPath {
			return nil, errors.New("invalid composer draft reference path")
		}
		derivedLabel := ComposerReferencePathLabel(normalizedPath)
		if label == "" || label != strings.TrimSpace(label) || label != derivedLabel || utf8.RuneCountInString(label) > composerDraftReferenceLabelRuneLimit {
			return nil, errors.New("invalid composer draft reference label")
		}
		if _, duplicate := seenLocalIDs[localID]; duplicate {
			return nil, errors.New("duplicate composer draft reference identity")
		}
		semanticKey := kind + "\x00" + normalizedPath
		if _, duplicate := seenPaths[semanticKey]; duplicate {
			return nil, errors.New("duplicate composer draft reference path")
		}
		seenLocalIDs[localID] = struct{}{}
		seenPaths[semanticKey] = struct{}{}
		reference := composerDraftReference{LocalID: localID, Kind: kind, Label: label, Path: normalizedPath}
		references = append(references, reference)
		canonical = append(canonical, map[string]any{
			"local_id": reference.LocalID,
			"kind":     reference.Kind,
			"label":    reference.Label,
			"path":     reference.Path,
		})
	}
	value["references"] = canonical
	return references, nil
}

func composerDraftReferenceProjection(references []composerDraftReference) ([]composerReferenceAdmissionProjection, error) {
	if len(references) > composerDraftReferenceLimit {
		return nil, errors.New("invalid composer draft references")
	}
	projection := make([]composerReferenceAdmissionProjection, 0, len(references))
	seen := make(map[string]struct{}, len(references))
	for _, reference := range references {
		pathValue, err := NormalizeComposerReferencePath(reference.Path)
		if err != nil {
			return nil, errors.New("invalid composer draft reference path")
		}
		isDirectory := false
		switch strings.TrimSpace(reference.Kind) {
		case "file":
		case "directory":
			isDirectory = true
		default:
			return nil, errors.New("invalid composer draft reference kind")
		}
		key := pathValue + "\x00" + fmt.Sprint(isDirectory)
		if _, duplicate := seen[key]; duplicate {
			return nil, errors.New("duplicate composer draft reference path")
		}
		seen[key] = struct{}{}
		projection = append(projection, composerReferenceAdmissionProjection{Path: pathValue, IsDirectory: isDirectory})
	}
	return projection, nil
}

func composerContextActionReferenceProjection(raw string) ([]composerReferenceAdmissionProjection, bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, false, nil
	}
	var envelope struct {
		SchemaVersion int             `json:"schema_version"`
		ActionID      string          `json:"action_id"`
		Provider      string          `json:"provider"`
		Target        json.RawMessage `json:"target"`
		Source        struct {
			Surface   string `json:"surface"`
			SurfaceID string `json:"surface_id,omitempty"`
		} `json:"source"`
		ExecutionContext    json.RawMessage   `json:"execution_context,omitempty"`
		Context             []json.RawMessage `json:"context"`
		Presentation        json.RawMessage   `json:"presentation"`
		SuggestedWorkingDir string            `json:"suggested_working_dir_abs,omitempty"`
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return nil, false, errors.New("invalid composer context action")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, false, errors.New("invalid composer context action")
	}
	if strings.TrimSpace(envelope.Source.Surface) != "flower_composer" {
		return nil, false, nil
	}
	if envelope.SchemaVersion != 2 || strings.TrimSpace(envelope.ActionID) != "assistant.ask.flower" || strings.TrimSpace(envelope.Provider) != "flower" || len(envelope.Context) == 0 || len(envelope.Context) > composerDraftReferenceLimit {
		return nil, true, errors.New("invalid composer context action")
	}
	projection := make([]composerReferenceAdmissionProjection, 0, len(envelope.Context))
	seen := make(map[string]struct{}, len(envelope.Context))
	for _, rawItem := range envelope.Context {
		var item struct {
			Kind        string `json:"kind"`
			Path        string `json:"path"`
			IsDirectory bool   `json:"is_directory"`
		}
		itemDecoder := json.NewDecoder(strings.NewReader(string(rawItem)))
		itemDecoder.DisallowUnknownFields()
		if err := itemDecoder.Decode(&item); err != nil || strings.TrimSpace(item.Kind) != "file_path" {
			return nil, true, errors.New("invalid composer context action")
		}
		pathValue, err := NormalizeComposerReferencePath(item.Path)
		if err != nil || pathValue != item.Path {
			return nil, true, errors.New("invalid composer context action")
		}
		key := pathValue + "\x00" + fmt.Sprint(item.IsDirectory)
		if _, duplicate := seen[key]; duplicate {
			return nil, true, errors.New("duplicate composer context action reference")
		}
		seen[key] = struct{}{}
		projection = append(projection, composerReferenceAdmissionProjection{Path: pathValue, IsDirectory: item.IsDirectory})
	}
	return projection, true, nil
}

func validateComposerDraftReferenceAdmission(references []composerDraftReference, contextActionJSON string) error {
	draftProjection, err := composerDraftReferenceProjection(references)
	if err != nil {
		return err
	}
	actionProjection, composerAction, err := composerContextActionReferenceProjection(contextActionJSON)
	if err != nil {
		return err
	}
	if !composerAction {
		if len(draftProjection) == 0 {
			return nil
		}
		return errors.New("composer draft reference admission changed")
	}
	if len(draftProjection) != len(actionProjection) {
		return errors.New("composer draft reference admission changed")
	}
	for index := range draftProjection {
		if draftProjection[index] != actionProjection[index] {
			return errors.New("composer draft reference admission changed")
		}
	}
	return nil
}

func composerDraftTextStats(text string) (digest string, sizeBytes, codePoints, lines int64) {
	sum := sha256.Sum256([]byte(text))
	digest = hex.EncodeToString(sum[:])
	sizeBytes = int64(len(text))
	codePoints = int64(utf8.RuneCountInString(text))
	if text == "" {
		return digest, sizeBytes, codePoints, 0
	}
	lines = 1
	previousWasCR := false
	for _, r := range text {
		switch r {
		case '\r':
			lines++
			previousWasCR = true
		case '\n':
			if !previousWasCR {
				lines++
			}
			previousWasCR = false
		default:
			previousWasCR = false
		}
	}
	return digest, sizeBytes, codePoints, lines
}

func (s *Store) BindComposerDraftTargetThread(
	ctx context.Context,
	endpointID, ownerUserHash, scopeID string,
	expectedRevision int64,
	turnID, targetThreadID string,
	nowUnixMs int64,
) (ComposerDraftRecord, error) {
	if s == nil || s.db == nil {
		return ComposerDraftRecord{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	turnID = strings.TrimSpace(turnID)
	targetThreadID = strings.TrimSpace(targetThreadID)
	if expectedRevision < 0 || turnID == "" || targetThreadID == "" || len(targetThreadID) > 200 || strings.ContainsAny(targetThreadID, "\r\n\x00") {
		return ComposerDraftRecord{}, errors.New("invalid composer draft launch binding")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	draft, err := composerDraftQueryRow(ctx, tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	var value composerDraftAdmissionValue
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		return ComposerDraftRecord{}, err
	}
	if !value.AdmissionStarted || strings.TrimSpace(value.ProposedTurnID) != turnID {
		return ComposerDraftRecord{}, errors.New("composer draft admission identity changed")
	}
	if existing := strings.TrimSpace(value.TargetThreadID); existing != "" {
		if err := tx.Commit(); err != nil {
			return ComposerDraftRecord{}, err
		}
		return draft, nil
	}
	if draft.Revision != expectedRevision {
		return draft, ErrComposerDraftRevisionConflict
	}
	var raw map[string]any
	if err := json.Unmarshal(draft.Value, &raw); err != nil {
		return ComposerDraftRecord{}, err
	}
	raw["target_thread_id"] = targetThreadID
	nextValue, err := json.Marshal(raw)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	draft.Revision++
	draft.Value = nextValue
	draft.UpdatedAtUnixMs = nowUnixMs
	draft.ExpiresAtUnixMs = nowUnixMs + composerDraftRetention.Milliseconds()
	result, err := tx.ExecContext(ctx, `
UPDATE ai_composer_drafts
SET revision = ?, value_json = ?, updated_at_unix_ms = ?, expires_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
`, draft.Revision, string(draft.Value), draft.UpdatedAtUnixMs, draft.ExpiresAtUnixMs,
		endpointID, ownerUserHash, scopeID, expectedRevision)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ComposerDraftRecord{}, ErrComposerDraftRevisionConflict
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftRecord{}, err
	}
	return draft, nil
}

func validateComposerDraftAdmissionTx(
	ctx context.Context,
	tx *sql.Tx,
	endpointID, ownerUserHash, scopeID string,
	expectedRevision int64,
	turnID, modelID, text string,
	uploadIDs []string,
	admission ComposerDraftAdmission,
) error {
	draftRefID := composerDraftUploadRefID(ownerUserHash, scopeID)
	if draftRefID == "" {
		return errors.New("invalid composer draft identity")
	}
	draft, err := composerDraftQueryRow(ctx, tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return err
	}
	if draft.Revision != expectedRevision {
		return ErrComposerDraftRevisionConflict
	}
	var value composerDraftAdmissionValue
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		return err
	}
	if !value.AdmissionStarted || strings.TrimSpace(value.ProposedTurnID) != strings.TrimSpace(turnID) {
		return errors.New("composer draft admission identity changed")
	}
	if strings.TrimSpace(value.ModelID) != "" && strings.TrimSpace(modelID) != "" && strings.TrimSpace(value.ModelID) != strings.TrimSpace(modelID) {
		return errors.New("composer draft model changed")
	}
	if err := validateComposerDraftReferenceAdmission(value.References, admission.ContextActionJSON); err != nil {
		return err
	}
	if len(uploadIDs) > 0 && strings.TrimSpace(value.CapabilityRevision) != strings.TrimSpace(admission.Attachment.CapabilityRevision) {
		return errors.New("composer draft attachment capability changed")
	}
	if value.PreparedLongTextAttachmentID == "" {
		if utf8.RuneCountInString(value.Text) > int(composerDraftInlineTextCodePointLimit) {
			return ErrLongTextAttachmentRequired
		}
		if value.Text != text {
			return errors.New("composer draft text changed")
		}
	} else if text != "" || utf8.RuneCountInString(value.Text) <= int(composerDraftInlineTextCodePointLimit) {
		return errors.New("composer long text admission changed")
	}
	ordered := make([]string, 0, len(value.Attachments))
	var preparedLongText *struct {
		AttachmentID       string `json:"attachment_id"`
		Name               string `json:"name"`
		MediaType          string `json:"mime_type"`
		SizeBytes          int64  `json:"size_bytes"`
		DigestSHA256       string `json:"digest_sha256"`
		Locator            string `json:"locator"`
		Source             string `json:"source"`
		CapabilityRevision string `json:"capability_revision"`
		TextStats          *struct {
			CodePoints int64 `json:"code_points"`
			Lines      int64 `json:"lines"`
		} `json:"text_stats"`
	}
	for _, attachment := range value.Attachments {
		if attachment.Staged == nil || strings.TrimSpace(attachment.Staged.AttachmentID) == "" {
			return errors.New("composer draft attachment is not ready")
		}
		attachmentID := strings.TrimSpace(attachment.Staged.AttachmentID)
		ordered = append(ordered, attachmentID)
		if attachmentID == strings.TrimSpace(value.PreparedLongTextAttachmentID) && strings.TrimSpace(attachment.Source) == "long_text" {
			preparedLongText = attachment.Staged
		}
	}
	if value.PreparedLongTextAttachmentID != "" {
		if preparedLongText == nil {
			return ErrLongTextAttachmentRequired
		}
		var rec UploadRecord
		if err := scanUploadRow(tx.QueryRowContext(ctx, `
SELECT u.upload_id, u.endpoint_id, u.owner_scope_kind, u.owner_user_hash, u.storage_relpath, u.name,
       u.declared_media_type, u.detected_media_type, u.size_bytes, u.content_sha256,
       u.unicode_code_points, u.logical_line_count, u.source, u.state,
       u.created_at_unix_ms, u.claimed_at_unix_ms, u.delete_after_unix_ms
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE u.endpoint_id = ? AND u.owner_scope_kind = ? AND u.owner_user_hash = ?
  AND u.upload_id = ? AND u.state = ? AND u.source = ?
  AND r.ref_kind = ? AND r.ref_id = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, strings.TrimSpace(value.PreparedLongTextAttachmentID),
			UploadStateStaged, UploadSourceLongText, UploadRefKindDraft, draftRefID), &rec); err != nil {
			return ErrLongTextAttachmentRequired
		}
		digest, sizeBytes, codePoints, lines := composerDraftTextStats(value.Text)
		if rec.UnicodeCodePoints == nil || rec.LogicalLineCount == nil ||
			rec.ContentSHA256 != digest || rec.SizeBytes != sizeBytes || *rec.UnicodeCodePoints != codePoints || *rec.LogicalLineCount != lines ||
			strings.TrimSpace(rec.DetectedMediaType) != "text/plain; charset=utf-8" ||
			preparedLongText.Name != rec.Name || strings.TrimSpace(preparedLongText.MediaType) != rec.DetectedMediaType ||
			preparedLongText.SizeBytes != rec.SizeBytes || strings.ToLower(strings.TrimSpace(preparedLongText.DigestSHA256)) != rec.ContentSHA256 ||
			preparedLongText.Source != "long_text" || preparedLongText.TextStats == nil ||
			preparedLongText.TextStats.CodePoints != codePoints || preparedLongText.TextStats.Lines != lines ||
			strings.TrimSpace(preparedLongText.CapabilityRevision) != strings.TrimSpace(admission.Attachment.CapabilityRevision) ||
			preparedLongText.Locator != "attachment://v1/"+rec.UploadID+"/"+url.PathEscape(filepath.Base(rec.Name)) {
			return errors.New("composer prepared long text metadata changed")
		}
	}
	uploadIDs = dedupeNonEmptyStrings(uploadIDs)
	if len(ordered) != len(uploadIDs) {
		return errors.New("composer draft attachment order changed")
	}
	for index := range ordered {
		if ordered[index] != uploadIDs[index] {
			return errors.New("composer draft attachment order changed")
		}
	}
	return nil
}

func emptyComposerDraftValue() json.RawMessage {
	return json.RawMessage(`{"text":"","attachments":[],"references":[],"mode":"ordinary"}`)
}

func normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID string) (string, string, string, error) {
	endpointID = strings.TrimSpace(endpointID)
	ownerUserHash = strings.ToLower(strings.TrimSpace(ownerUserHash))
	scopeID = strings.TrimSpace(scopeID)
	if endpointID == "" || len(ownerUserHash) != 64 || scopeID == "" || len(scopeID) > 200 || strings.ContainsAny(scopeID, "\r\n\x00") {
		return "", "", "", errors.New("invalid composer draft identity")
	}
	return endpointID, ownerUserHash, scopeID, nil
}

func requireComposerDraftScopeWritableTx(ctx context.Context, tx *sql.Tx, endpointID, scopeID string) error {
	if strings.TrimSpace(scopeID) == composerDraftNewThreadScopeID {
		return nil
	}
	return requireThreadWritableTx(ctx, tx, endpointID, scopeID)
}

func normalizeComposerDraftHolder(holderID string) (string, error) {
	holderID = strings.TrimSpace(holderID)
	if holderID == "" || len(holderID) > 200 || strings.ContainsAny(holderID, "\r\n\x00") {
		return "", errors.New("invalid composer draft holder")
	}
	return holderID, nil
}

func newComposerDraftLeaseID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "flower_draft_lease_" + hex.EncodeToString(bytes[:]), nil
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
	case ComposerDraftModeOrdinary, ComposerDraftModeOverLimitEditing, ComposerDraftModePreparingLongText, ComposerDraftModeAdmissionInFlight:
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

func composerDraftAttachmentIDs(value json.RawMessage) ([]string, error) {
	var record struct {
		Attachments []struct {
			Staged *struct {
				AttachmentID string `json:"attachment_id"`
			} `json:"staged"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(record.Attachments))
	seen := make(map[string]struct{}, len(record.Attachments))
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

func canonicalizeComposerDraftAttachmentsTx(
	ctx context.Context,
	tx *sql.Tx,
	endpointID, ownerUserHash string,
	value json.RawMessage,
) (json.RawMessage, error) {
	var record map[string]any
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, err
	}
	attachments, _ := record["attachments"].([]any)
	capabilityRevision, _ := record["capability_revision"].(string)
	capabilityRevision = strings.TrimSpace(capabilityRevision)
	delete(record, "capability_revision")
	if capabilityRevision == "" {
		for _, raw := range attachments {
			attachment, _ := raw.(map[string]any)
			staged, _ := attachment["staged"].(map[string]any)
			candidate, _ := staged["capability_revision"].(string)
			if candidate = strings.TrimSpace(candidate); candidate != "" {
				capabilityRevision = candidate
				break
			}
		}
	}
	if capabilityRevision != "" {
		record["capability_revision"] = capabilityRevision
	}
	for _, raw := range attachments {
		attachment, _ := raw.(map[string]any)
		staged, _ := attachment["staged"].(map[string]any)
		if staged == nil {
			continue
		}
		uploadID := strings.TrimSpace(fmt.Sprint(staged["attachment_id"]))
		var rec UploadRecord
		if err := scanUploadRow(tx.QueryRowContext(ctx, `
SELECT upload_id, endpoint_id, owner_scope_kind, owner_user_hash, storage_relpath, name,
       declared_media_type, detected_media_type, size_bytes, content_sha256,
       unicode_code_points, logical_line_count, source, state,
       created_at_unix_ms, claimed_at_unix_ms, delete_after_unix_ms
FROM ai_uploads
WHERE endpoint_id = ? AND owner_scope_kind = ? AND owner_user_hash = ?
  AND upload_id = ? AND state = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID, UploadStateStaged), &rec); err != nil {
			return nil, err
		}
		source := "file"
		if rec.Source == UploadSourceLongText {
			source = "long_text"
		} else {
			candidate, _ := attachment["source"].(string)
			switch strings.TrimSpace(candidate) {
			case "file", "paste", "drop":
				source = strings.TrimSpace(candidate)
			}
		}
		attachment["source"] = source
		attachment["name"] = rec.Name
		attachment["mime_type"] = rec.DetectedMediaType
		attachment["size_bytes"] = rec.SizeBytes
		staged["attachment_id"] = rec.UploadID
		staged["name"] = rec.Name
		staged["mime_type"] = rec.DetectedMediaType
		delete(staged, "media_type")
		delete(staged, "detected_media_type")
		staged["size_bytes"] = rec.SizeBytes
		staged["digest_sha256"] = rec.ContentSHA256
		delete(staged, "content_sha256")
		staged["locator"] = "attachment://v1/" + rec.UploadID + "/" + url.PathEscape(filepath.Base(rec.Name))
		staged["source"] = source
		staged["created_at_unix_ms"] = rec.CreatedAtUnixMs
		if capabilityRevision != "" {
			staged["capability_revision"] = capabilityRevision
		} else {
			delete(staged, "capability_revision")
		}
		if rec.UnicodeCodePoints != nil && rec.LogicalLineCount != nil {
			staged["text_stats"] = map[string]any{
				"code_points": *rec.UnicodeCodePoints,
				"lines":       *rec.LogicalLineCount,
			}
		} else {
			delete(staged, "text_stats")
		}
	}
	return json.Marshal(record)
}

func reconcileComposerDraftUploadRefsTx(
	ctx context.Context,
	tx *sql.Tx,
	endpointID, ownerUserHash, scopeID string,
	desiredUploadIDs []string,
	nowUnixMs int64,
) error {
	desiredUploadIDs = dedupeNonEmptyStrings(desiredUploadIDs)
	draftRefID := composerDraftUploadRefID(ownerUserHash, scopeID)
	if draftRefID == "" {
		return errors.New("invalid composer draft identity")
	}
	desired := make(map[string]struct{}, len(desiredUploadIDs))
	for _, uploadID := range desiredUploadIDs {
		desired[uploadID] = struct{}{}
		var claimCount int
		if err := tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM ai_uploads u
JOIN ai_upload_refs r ON r.endpoint_id = u.endpoint_id AND r.upload_id = u.upload_id
WHERE u.endpoint_id = ? AND u.owner_scope_kind = ? AND u.owner_user_hash = ?
  AND u.upload_id = ? AND u.state = ? AND r.ref_kind IN (?, ?) AND r.ref_id = ?
`, endpointID, UploadOwnerScopeUser, ownerUserHash, uploadID, UploadStateStaged,
			UploadRefKindDraftPending, UploadRefKindDraft, draftRefID).Scan(&claimCount); err != nil {
			return err
		}
		if claimCount != 1 {
			return errors.New("composer draft attachment claim changed")
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO ai_upload_refs(endpoint_id, upload_id, thread_id, ref_kind, ref_id, created_at_unix_ms)
	VALUES(?, ?, ?, ?, ?, ?)
	ON CONFLICT(endpoint_id, upload_id, ref_kind, ref_id) DO NOTHING
	`, endpointID, uploadID, scopeID, UploadRefKindDraft, draftRefID, nowUnixMs); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind = ? AND ref_id = ?
	`, endpointID, uploadID, UploadRefKindDraftPending, draftRefID); err != nil {
			return err
		}
	}

	rows, err := tx.QueryContext(ctx, `
SELECT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
	`, endpointID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID)
	if err != nil {
		return err
	}
	var removed []string
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			_ = rows.Close()
			return err
		}
		if _, keep := desired[strings.TrimSpace(uploadID)]; !keep {
			removed = append(removed, strings.TrimSpace(uploadID))
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, uploadID := range dedupeNonEmptyStrings(removed) {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
		`, endpointID, uploadID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID); err != nil {
			return err
		}
	}
	_, err = collectUnreferencedUploadsTx(ctx, tx, endpointID, removed, nowUnixMs)
	return err
}

func scanComposerDraft(scan rowScanner, draft *ComposerDraftRecord) error {
	var value string
	if err := scan.Scan(
		&draft.EndpointID, &draft.OwnerUserHash, &draft.ScopeID, &draft.Revision, &value,
		&draft.LeaseID, &draft.LeaseHolderID, &draft.LeaseExpiresAtUnixMs,
		&draft.UpdatedAtUnixMs, &draft.ExpiresAtUnixMs,
	); err != nil {
		return err
	}
	draft.Value = json.RawMessage(value)
	return nil
}

func composerDraftQueryRow(ctx context.Context, q rowQueryer, endpointID, ownerUserHash, scopeID string) (ComposerDraftRecord, error) {
	var draft ComposerDraftRecord
	err := scanComposerDraft(q.QueryRowContext(ctx, `
SELECT endpoint_id, owner_user_hash, scope_id, revision, value_json,
       lease_id, lease_holder_id, lease_expires_at_unix_ms,
       updated_at_unix_ms, expires_at_unix_ms
FROM ai_composer_drafts
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?
`, endpointID, ownerUserHash, scopeID), &draft)
	return draft, err
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func defaultComposerDraft(endpointID, ownerUserHash, scopeID string, nowUnixMs int64) ComposerDraftRecord {
	return ComposerDraftRecord{
		EndpointID: endpointID, OwnerUserHash: ownerUserHash, ScopeID: scopeID,
		Value: emptyComposerDraftValue(), UpdatedAtUnixMs: nowUnixMs,
		ExpiresAtUnixMs: nowUnixMs + composerDraftRetention.Milliseconds(),
	}
}

func projectComposerDraftLease(draft ComposerDraftRecord, nowUnixMs int64) ComposerDraftRecord {
	if draft.LeaseExpiresAtUnixMs <= nowUnixMs {
		draft.LeaseID = ""
		draft.LeaseHolderID = ""
		draft.LeaseExpiresAtUnixMs = 0
	}
	return draft
}

func (s *Store) GetComposerDraft(ctx context.Context, endpointID, ownerUserHash, scopeID string, nowUnixMs int64) (ComposerDraftRecord, error) {
	if s == nil || s.db == nil {
		return ComposerDraftRecord{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	draft, err := composerDraftQueryRow(ctxOrBackground(ctx), s.db, endpointID, ownerUserHash, scopeID)
	if errors.Is(err, sql.ErrNoRows) {
		return defaultComposerDraft(endpointID, ownerUserHash, scopeID, nowUnixMs), nil
	}
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	return projectComposerDraftLease(draft, nowUnixMs), nil
}

func composerDraftAdmissionStarted(value json.RawMessage) (mode string, started bool, err error) {
	var record struct {
		Mode             string `json:"mode"`
		AdmissionStarted bool   `json:"admission_started"`
	}
	if err := json.Unmarshal(value, &record); err != nil {
		return "", false, err
	}
	return strings.TrimSpace(record.Mode), record.AdmissionStarted, nil
}

func resetStalePreAdmission(value json.RawMessage) (json.RawMessage, string, error) {
	var record map[string]any
	if err := json.Unmarshal(value, &record); err != nil {
		return nil, "", err
	}
	text, _ := record["text"].(string)
	if int64(utf8.RuneCountInString(text)) > composerDraftInlineTextCodePointLimit {
		record["mode"] = ComposerDraftModeOverLimitEditing
	} else {
		record["mode"] = ComposerDraftModeOrdinary
	}
	delete(record, "proposed_turn_id")
	delete(record, "admission_started")
	preparedAttachmentID := strings.TrimSpace(fmt.Sprint(record["prepared_long_text_attachment_id"]))
	preparedLocalID := strings.TrimSpace(fmt.Sprint(record["prepared_long_text_local_id"]))
	if attachments, ok := record["attachments"].([]any); ok && (preparedAttachmentID != "" || preparedLocalID != "") {
		retained := make([]any, 0, len(attachments))
		for _, rawAttachment := range attachments {
			attachment, _ := rawAttachment.(map[string]any)
			localID := strings.TrimSpace(fmt.Sprint(attachment["local_id"]))
			staged, _ := attachment["staged"].(map[string]any)
			attachmentID := strings.TrimSpace(fmt.Sprint(staged["attachment_id"]))
			if (preparedAttachmentID != "" && attachmentID == preparedAttachmentID) || (preparedLocalID != "" && localID == preparedLocalID) {
				continue
			}
			retained = append(retained, rawAttachment)
		}
		record["attachments"] = retained
	}
	delete(record, "prepared_long_text_local_id")
	delete(record, "prepared_long_text_attachment_id")
	normalized, err := json.Marshal(record)
	return normalized, preparedAttachmentID, err
}

func (s *Store) AcquireComposerDraftLease(ctx context.Context, endpointID, ownerUserHash, scopeID, holderID string, takeOver bool, nowUnixMs int64) (ComposerDraftLeaseResult, error) {
	if s == nil || s.db == nil {
		return ComposerDraftLeaseResult{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	draftRefID := composerDraftUploadRefID(ownerUserHash, scopeID)
	holderID, err = normalizeComposerDraftHolder(holderID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireComposerDraftScopeWritableTx(ctxOrBackground(ctx), tx, endpointID, scopeID); err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	initial := defaultComposerDraft(endpointID, ownerUserHash, scopeID, nowUnixMs)
	if _, err := tx.ExecContext(ctxOrBackground(ctx), `
INSERT INTO ai_composer_drafts(
  endpoint_id, owner_user_hash, scope_id, revision, value_json,
  created_at_unix_ms, updated_at_unix_ms, expires_at_unix_ms
) VALUES(?, ?, ?, 0, ?, ?, ?, ?)
ON CONFLICT(endpoint_id, owner_user_hash, scope_id) DO NOTHING
`, endpointID, ownerUserHash, scopeID, string(initial.Value), nowUnixMs, nowUnixMs, initial.ExpiresAtUnixMs); err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	draft, err := composerDraftQueryRow(ctxOrBackground(ctx), tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	active := draft.LeaseID != "" && draft.LeaseExpiresAtUnixMs > nowUnixMs
	if active && !takeOver {
		if err := tx.Commit(); err != nil {
			return ComposerDraftLeaseResult{}, err
		}
		return ComposerDraftLeaseResult{State: "conflict", Draft: draft, Holder: draft.LeaseHolderID}, nil
	}
	mode, admissionStarted, err := composerDraftAdmissionStarted(draft.Value)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	protected := mode == ComposerDraftModePreparingLongText || mode == ComposerDraftModeAdmissionInFlight
	if protected && admissionStarted {
		if err := tx.Commit(); err != nil {
			return ComposerDraftLeaseResult{}, err
		}
		return ComposerDraftLeaseResult{State: "conflict", Draft: projectComposerDraftLease(draft, nowUnixMs), Holder: "admission_reconciliation"}, nil
	}
	if protected {
		reset, abandonedAttachmentID, resetErr := resetStalePreAdmission(draft.Value)
		if resetErr != nil {
			return ComposerDraftLeaseResult{}, resetErr
		}
		draft.Value = reset
		draft.Revision++
		if abandonedAttachmentID != "" {
			if _, err := tx.ExecContext(ctxOrBackground(ctx), `
				DELETE FROM ai_upload_refs
				WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
					`, endpointID, abandonedAttachmentID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID); err != nil {
				return ComposerDraftLeaseResult{}, err
			}
			if _, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_uploads SET state = ?, delete_after_unix_ms = ?
WHERE endpoint_id = ? AND upload_id = ? AND state = ?
  AND NOT EXISTS (
    SELECT 1 FROM ai_upload_refs r
    WHERE r.endpoint_id = ai_uploads.endpoint_id AND r.upload_id = ai_uploads.upload_id
  )
`, UploadStateDeleting, nowUnixMs, endpointID, abandonedAttachmentID, UploadStateStaged); err != nil {
				return ComposerDraftLeaseResult{}, err
			}
		}
	}
	leaseID, err := newComposerDraftLeaseID()
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	draft.LeaseID = leaseID
	draft.LeaseHolderID = holderID
	draft.LeaseExpiresAtUnixMs = nowUnixMs + composerDraftLeaseDuration.Milliseconds()
	draft.UpdatedAtUnixMs = nowUnixMs
	draft.ExpiresAtUnixMs = nowUnixMs + composerDraftRetention.Milliseconds()
	result, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_composer_drafts
SET revision = ?, value_json = ?, lease_id = ?, lease_holder_id = ?, lease_expires_at_unix_ms = ?,
    updated_at_unix_ms = ?, expires_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?
`, draft.Revision, string(draft.Value), draft.LeaseID, draft.LeaseHolderID, draft.LeaseExpiresAtUnixMs,
		draft.UpdatedAtUnixMs, draft.ExpiresAtUnixMs, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return ComposerDraftLeaseResult{}, ErrComposerDraftLeaseLost
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	return ComposerDraftLeaseResult{State: "owned", Draft: draft}, nil
}

func (s *Store) RenewComposerDraftLease(ctx context.Context, endpointID, ownerUserHash, scopeID, holderID, leaseID string, nowUnixMs int64) (ComposerDraftLeaseResult, error) {
	if s == nil || s.db == nil {
		return ComposerDraftLeaseResult{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	holderID, err = normalizeComposerDraftHolder(holderID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireComposerDraftScopeWritableTx(ctx, tx, endpointID, scopeID); err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	draft, err := composerDraftQueryRow(ctx, tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	if draft.LeaseID != strings.TrimSpace(leaseID) || draft.LeaseHolderID != holderID {
		return ComposerDraftLeaseResult{State: "lost", Draft: draft}, nil
	}
	nextExpiry := nowUnixMs + composerDraftLeaseDuration.Milliseconds()
	result, err := tx.ExecContext(ctx, `
UPDATE ai_composer_drafts SET lease_expires_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ?
  AND lease_id = ? AND lease_holder_id = ? AND lease_expires_at_unix_ms > ?
`, nextExpiry, draft.EndpointID, draft.OwnerUserHash, draft.ScopeID, draft.LeaseID, holderID, nowUnixMs)
	if err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		latest, _ := composerDraftQueryRow(ctx, tx, endpointID, ownerUserHash, scopeID)
		return ComposerDraftLeaseResult{State: "lost", Draft: latest}, nil
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftLeaseResult{}, err
	}
	draft.LeaseExpiresAtUnixMs = nextExpiry
	return ComposerDraftLeaseResult{State: "owned", Draft: draft}, nil
}

func (s *Store) MutateComposerDraft(ctx context.Context, mutation ComposerDraftMutation) (ComposerDraftRecord, error) {
	if s == nil || s.db == nil {
		return ComposerDraftRecord{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(mutation.EndpointID, mutation.OwnerUserHash, mutation.ScopeID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	holderID, err := normalizeComposerDraftHolder(mutation.HolderID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	value, err := normalizeComposerDraftValue(mutation.Value)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if mutation.NowUnixMs <= 0 {
		mutation.NowUnixMs = time.Now().UnixMilli()
	}
	desiredUploadIDs, err := composerDraftAttachmentIDs(value)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	tx, err := s.db.BeginTx(ctxOrBackground(ctx), nil)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	observeStoreTransaction(ctx, "mutate_composer_draft")
	if err := requireComposerDraftScopeWritableTx(ctxOrBackground(ctx), tx, endpointID, scopeID); err != nil {
		return ComposerDraftRecord{}, err
	}
	current, err := composerDraftQueryRow(ctxOrBackground(ctx), tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if current.Revision != mutation.ExpectedRevision {
		return current, ErrComposerDraftRevisionConflict
	}
	if current.LeaseID != strings.TrimSpace(mutation.LeaseID) || current.LeaseHolderID != holderID || current.LeaseExpiresAtUnixMs <= mutation.NowUnixMs {
		return projectComposerDraftLease(current, mutation.NowUnixMs), ErrComposerDraftLeaseLost
	}
	value, err = canonicalizeComposerDraftAttachmentsTx(ctxOrBackground(ctx), tx, endpointID, ownerUserHash, value)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if err := reconcileComposerDraftUploadRefsTx(
		ctxOrBackground(ctx), tx, endpointID, ownerUserHash, scopeID, desiredUploadIDs, mutation.NowUnixMs,
	); err != nil {
		return ComposerDraftRecord{}, err
	}
	nextRevision := mutation.ExpectedRevision + 1
	nextLeaseExpiry := mutation.NowUnixMs + composerDraftLeaseDuration.Milliseconds()
	nextDraftExpiry := mutation.NowUnixMs + composerDraftRetention.Milliseconds()
	result, err := tx.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_composer_drafts
SET revision = ?, value_json = ?, lease_expires_at_unix_ms = ?, updated_at_unix_ms = ?, expires_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
  AND lease_id = ? AND lease_holder_id = ? AND lease_expires_at_unix_ms > ?
`, nextRevision, string(value), nextLeaseExpiry, mutation.NowUnixMs, nextDraftExpiry,
		endpointID, ownerUserHash, scopeID, mutation.ExpectedRevision,
		strings.TrimSpace(mutation.LeaseID), holderID, mutation.NowUnixMs)
	if err != nil {
		return ComposerDraftRecord{}, err
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return current, ErrComposerDraftLeaseLost
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftRecord{}, err
	}
	current.Revision = nextRevision
	current.Value = value
	current.LeaseExpiresAtUnixMs = nextLeaseExpiry
	current.UpdatedAtUnixMs = mutation.NowUnixMs
	current.ExpiresAtUnixMs = nextDraftExpiry
	return current, nil
}

func (s *Store) ReleaseComposerDraftLease(ctx context.Context, endpointID, ownerUserHash, scopeID, holderID, leaseID string) error {
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return err
	}
	holderID, err = normalizeComposerDraftHolder(holderID)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctxOrBackground(ctx), `
UPDATE ai_composer_drafts SET lease_id = '', lease_holder_id = '', lease_expires_at_unix_ms = 0
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND lease_id = ? AND lease_holder_id = ?
`, endpointID, ownerUserHash, scopeID, strings.TrimSpace(leaseID), holderID)
	return err
}

func (s *Store) SweepExpiredComposerDrafts(ctx context.Context, nowUnixMs int64, limit int) (ComposerDraftSweepResult, error) {
	if s == nil || s.db == nil {
		return ComposerDraftSweepResult{}, errors.New("store not initialized")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ComposerDraftSweepResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, owner_user_hash, scope_id, value_json
FROM ai_composer_drafts
WHERE expires_at_unix_ms <= ?
  AND json_valid(value_json)
  AND COALESCE(json_extract(value_json, '$.admission_started'), 0) <> 1
ORDER BY expires_at_unix_ms ASC, endpoint_id ASC, owner_user_hash ASC, scope_id ASC
LIMIT ?
`, nowUnixMs, limit)
	if err != nil {
		return ComposerDraftSweepResult{}, err
	}
	type expiredDraft struct {
		endpointID    string
		ownerUserHash string
		scopeID       string
		value         json.RawMessage
	}
	candidates := make([]expiredDraft, 0, limit)
	for rows.Next() {
		var endpointID, ownerUserHash, scopeID, value string
		if err := rows.Scan(&endpointID, &ownerUserHash, &scopeID, &value); err != nil {
			_ = rows.Close()
			return ComposerDraftSweepResult{}, err
		}
		candidates = append(candidates, expiredDraft{
			endpointID: endpointID, ownerUserHash: ownerUserHash, scopeID: scopeID, value: json.RawMessage(value),
		})
	}
	if err := rows.Close(); err != nil {
		return ComposerDraftSweepResult{}, err
	}
	result := ComposerDraftSweepResult{}
	for _, draft := range candidates {
		_, admissionStarted, err := composerDraftAdmissionStarted(draft.value)
		if err != nil {
			return ComposerDraftSweepResult{}, err
		}
		// An admission-in-flight draft must first be reconciled against the exact
		// canonical TurnID. Expiry never guesses that a turn was rejected.
		if admissionStarted {
			continue
		}
		uploadIDs, err := listComposerDraftUploadIDsTx(ctx, tx, draft.endpointID, draft.ownerUserHash, draft.scopeID)
		if err != nil {
			return ComposerDraftSweepResult{}, err
		}
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
		`, draft.endpointID, UploadRefKindDraft, UploadRefKindDraftPending, composerDraftUploadRefID(draft.ownerUserHash, draft.scopeID)); err != nil {
			return ComposerDraftSweepResult{}, err
		}
		deleted, err := tx.ExecContext(ctx, `
DELETE FROM ai_composer_drafts
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND expires_at_unix_ms <= ?
`, draft.endpointID, draft.ownerUserHash, draft.scopeID, nowUnixMs)
		if err != nil {
			return ComposerDraftSweepResult{}, err
		}
		if affected, _ := deleted.RowsAffected(); affected != 1 {
			return ComposerDraftSweepResult{}, ErrComposerDraftRevisionConflict
		}
		cleanup, err := collectUnreferencedUploadsTx(ctx, tx, draft.endpointID, uploadIDs, nowUnixMs)
		if err != nil {
			return ComposerDraftSweepResult{}, err
		}
		result.DraftsDeleted++
		result.UploadsToDelete = append(result.UploadsToDelete, cleanup...)
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftSweepResult{}, err
	}
	return result, nil
}

func (s *Store) ListStaleComposerDraftAdmissionsAfter(
	ctx context.Context,
	staleBeforeUnixMs, nowUnixMs int64,
	after *ComposerDraftAdmissionCandidate,
	limit int,
) ([]ComposerDraftAdmissionCandidate, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("store not initialized")
	}
	if staleBeforeUnixMs <= 0 || nowUnixMs <= 0 || staleBeforeUnixMs > nowUnixMs {
		return nil, errors.New("invalid composer draft admission cutoff")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	cursorClause := ""
	args := []any{staleBeforeUnixMs, nowUnixMs}
	if after != nil {
		cursorClause = `
  AND (
    updated_at_unix_ms > ?
    OR (updated_at_unix_ms = ? AND endpoint_id > ?)
    OR (updated_at_unix_ms = ? AND endpoint_id = ? AND owner_user_hash > ?)
    OR (updated_at_unix_ms = ? AND endpoint_id = ? AND owner_user_hash = ? AND scope_id > ?)
  )`
		args = append(args,
			after.UpdatedAtUnixMs,
			after.UpdatedAtUnixMs, after.EndpointID,
			after.UpdatedAtUnixMs, after.EndpointID, after.OwnerUserHash,
			after.UpdatedAtUnixMs, after.EndpointID, after.OwnerUserHash, after.ScopeID,
		)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctxOrBackground(ctx), `
SELECT endpoint_id, owner_user_hash, scope_id, updated_at_unix_ms
FROM ai_composer_drafts
WHERE updated_at_unix_ms <= ?
  AND lease_expires_at_unix_ms <= ?
  AND json_valid(value_json)
  AND COALESCE(json_extract(value_json, '$.admission_started'), 0) = 1
  AND TRIM(COALESCE(json_extract(value_json, '$.proposed_turn_id'), '')) <> ''
`+cursorClause+`
ORDER BY updated_at_unix_ms ASC, endpoint_id ASC, owner_user_hash ASC, scope_id ASC
LIMIT ?
`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	candidates := make([]ComposerDraftAdmissionCandidate, 0, limit)
	for rows.Next() {
		var candidate ComposerDraftAdmissionCandidate
		if err := rows.Scan(&candidate.EndpointID, &candidate.OwnerUserHash, &candidate.ScopeID, &candidate.UpdatedAtUnixMs); err != nil {
			return nil, err
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func (s *Store) HasPendingTurnID(ctx context.Context, endpointID, threadID, turnID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("store not initialized")
	}
	var exists int
	err := s.db.QueryRowContext(ctxOrBackground(ctx), `
SELECT 1 FROM ai_queued_turns
WHERE endpoint_id = ? AND thread_id = ? AND turn_id = ?
LIMIT 1
`, strings.TrimSpace(endpointID), strings.TrimSpace(threadID), strings.TrimSpace(turnID)).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil && exists == 1, err
}

func (s *Store) ReconcileComposerDraftAdmission(
	ctx context.Context,
	endpointID, ownerUserHash, scopeID, turnID string,
	accepted bool,
	nowUnixMs int64,
) (ComposerDraftReconcileResult, error) {
	if s == nil || s.db == nil {
		return ComposerDraftReconcileResult{}, errors.New("store not initialized")
	}
	endpointID, ownerUserHash, scopeID, err := normalizeComposerDraftIdentity(endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	turnID = strings.TrimSpace(turnID)
	if turnID == "" {
		return ComposerDraftReconcileResult{}, errors.New("invalid composer draft admission identity")
	}
	if nowUnixMs <= 0 {
		nowUnixMs = time.Now().UnixMilli()
	}
	ctx = ctxOrBackground(ctx)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireComposerDraftScopeWritableTx(ctx, tx, endpointID, scopeID); err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	draft, err := composerDraftQueryRow(ctx, tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	var value composerDraftAdmissionValue
	if err := json.Unmarshal(draft.Value, &value); err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	if !value.AdmissionStarted || strings.TrimSpace(value.ProposedTurnID) != turnID {
		return ComposerDraftReconcileResult{}, ErrComposerDraftRevisionConflict
	}
	draftRefID := composerDraftUploadRefID(ownerUserHash, scopeID)
	uploadIDs, err := listComposerDraftUploadIDsTx(ctx, tx, endpointID, ownerUserHash, scopeID)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	if accepted {
		if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs WHERE endpoint_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
	`, endpointID, UploadRefKindDraft, UploadRefKindDraftPending, draftRefID); err != nil {
			return ComposerDraftReconcileResult{}, err
		}
		deleted, err := tx.ExecContext(ctx, `
DELETE FROM ai_composer_drafts
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
		`, endpointID, ownerUserHash, scopeID, draft.Revision)
		if err != nil {
			return ComposerDraftReconcileResult{}, err
		}
		if affected, _ := deleted.RowsAffected(); affected != 1 {
			return ComposerDraftReconcileResult{}, ErrComposerDraftRevisionConflict
		}
		cleanup, err := collectUnreferencedUploadsTx(ctx, tx, endpointID, uploadIDs, nowUnixMs)
		if err != nil {
			return ComposerDraftReconcileResult{}, err
		}
		if err := tx.Commit(); err != nil {
			return ComposerDraftReconcileResult{}, err
		}
		return ComposerDraftReconcileResult{UploadsToDelete: cleanup}, nil
	}
	reset, _, err := resetStalePreAdmission(draft.Value)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	desiredIDs, err := composerDraftAttachmentIDs(reset)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	if err := reconcileComposerDraftUploadRefsTx(ctx, tx, endpointID, ownerUserHash, scopeID, desiredIDs, nowUnixMs); err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	previousRevision := draft.Revision
	draft.Revision++
	draft.Value = reset
	draft.LeaseID = ""
	draft.LeaseHolderID = ""
	draft.LeaseExpiresAtUnixMs = 0
	draft.UpdatedAtUnixMs = nowUnixMs
	draft.ExpiresAtUnixMs = nowUnixMs + composerDraftRetention.Milliseconds()
	updated, err := tx.ExecContext(ctx, `
UPDATE ai_composer_drafts
SET revision = ?, value_json = ?, lease_id = '', lease_holder_id = '', lease_expires_at_unix_ms = 0,
    updated_at_unix_ms = ?, expires_at_unix_ms = ?
WHERE endpoint_id = ? AND owner_user_hash = ? AND scope_id = ? AND revision = ?
`, draft.Revision, string(draft.Value), draft.UpdatedAtUnixMs, draft.ExpiresAtUnixMs,
		endpointID, ownerUserHash, scopeID, previousRevision)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	if affected, _ := updated.RowsAffected(); affected != 1 {
		return ComposerDraftReconcileResult{}, ErrComposerDraftRevisionConflict
	}
	cleanup, err := collectUnreferencedUploadsTx(ctx, tx, endpointID, uploadIDs, nowUnixMs)
	if err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return ComposerDraftReconcileResult{}, err
	}
	return ComposerDraftReconcileResult{Draft: &draft, UploadsToDelete: cleanup}, nil
}

func listComposerDraftUploadIDsTx(ctx context.Context, tx *sql.Tx, endpointID, ownerUserHash, scopeID string) ([]string, error) {
	draftRefID := composerDraftUploadRefID(ownerUserHash, scopeID)
	if draftRefID == "" {
		return nil, errors.New("invalid composer draft identity")
	}
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
	`, strings.TrimSpace(endpointID), UploadRefKindDraft, UploadRefKindDraftPending, draftRefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var uploadIDs []string
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			return nil, err
		}
		uploadIDs = append(uploadIDs, strings.TrimSpace(uploadID))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return dedupeNonEmptyStrings(uploadIDs), nil
}

func listComposerDraftUploadIDsForScopeTx(ctx context.Context, tx *sql.Tx, endpointID, scopeID string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT upload_id
FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind IN (?, ?)
`, strings.TrimSpace(endpointID), strings.TrimSpace(scopeID), UploadRefKindDraft, UploadRefKindDraftPending)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var uploadIDs []string
	for rows.Next() {
		var uploadID string
		if err := rows.Scan(&uploadID); err != nil {
			return nil, err
		}
		uploadIDs = append(uploadIDs, strings.TrimSpace(uploadID))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return dedupeNonEmptyStrings(uploadIDs), nil
}

func deleteComposerDraftsForScopeTx(ctx context.Context, tx *sql.Tx, endpointID, scopeID string, nowUnixMs int64) error {
	uploadIDs, err := listComposerDraftUploadIDsForScopeTx(ctx, tx, endpointID, scopeID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_upload_refs
WHERE endpoint_id = ? AND thread_id = ? AND ref_kind IN (?, ?)
	`, strings.TrimSpace(endpointID), strings.TrimSpace(scopeID), UploadRefKindDraft, UploadRefKindDraftPending); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
DELETE FROM ai_composer_drafts
WHERE endpoint_id = ? AND scope_id = ?
`, strings.TrimSpace(endpointID), strings.TrimSpace(scopeID)); err != nil {
		return err
	}
	_, err = collectUnreferencedUploadsTx(ctx, tx, endpointID, uploadIDs, nowUnixMs)
	return err
}

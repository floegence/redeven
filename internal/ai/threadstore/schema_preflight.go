package threadstore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type legacyComposerAdmissionDecisionRecord struct {
	Admission LegacyComposerAdmission
	Decision  LegacyComposerAdmissionDecision
	Queued    bool
}

type legacyComposerAdmissionDecisionSet map[string]legacyComposerAdmissionDecisionRecord

type legacyComposerPreflightRequest struct {
	admission       LegacyComposerAdmission
	storageRelPaths []string
	queued          bool
}

func legacyComposerAdmissionDecisionKey(endpointID, ownerUserHash, scopeID string) string {
	return strings.TrimSpace(endpointID) + "\x00" + strings.ToLower(strings.TrimSpace(ownerUserHash)) + "\x00" + strings.TrimSpace(scopeID)
}

type LegacyThreadTitle struct {
	EndpointID string
	ThreadID   string
	Title      string
}

func migrateLegacyThreadTitles(path string, migrate func(context.Context, LegacyThreadTitle) error) error {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}

	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(3000)")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	var hasMeta int
	if err := db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = '__redeven_db_meta'`).Scan(&hasMeta); err != nil {
		return err
	}
	if hasMeta == 0 {
		return nil
	}
	var kind string
	if err := db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		return err
	}
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	kind = strings.TrimSpace(kind)
	if kind != threadstoreSchemaKind {
		return fmt.Errorf("unsupported threadstore database kind %q version %d; only %q schemas v2 through v8 are supported", kind, version, threadstoreSchemaKind)
	}
	switch version {
	case threadstoreCurrentSchemaVersion:
		return nil
	case 2:
	case 3:
	case 4:
	case 5:
	case 6:
	case 7:
		return nil
	case 0:
		return errors.New("existing threadstore database has unsupported schema version 0; only v2 through v8 are supported")
	default:
		return fmt.Errorf("unsupported threadstore database kind %q version %d; only schemas v2 through v8 are supported", kind, version)
	}
	if version == 3 || version == 4 || version == 5 || version == 6 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	if err := verifyProductSchemaVersion(tx, 2); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("verify product threadstore v2 before title migration: %w", err)
	}
	if err := validateProductV2UploadRefs(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2PermissionSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2ForkOperationSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := validateProductV2DeleteOperationSnapshots(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	rows, err := tx.QueryContext(ctx, `
SELECT endpoint_id, thread_id, title
FROM ai_threads
WHERE TRIM(COALESCE(title, '')) <> ''
ORDER BY endpoint_id, thread_id
`)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("read legacy thread titles: %w", err)
	}
	var titles []LegacyThreadTitle
	for rows.Next() {
		var title LegacyThreadTitle
		if err := rows.Scan(&title.EndpointID, &title.ThreadID, &title.Title); err != nil {
			_ = rows.Close()
			_ = tx.Rollback()
			return err
		}
		title.EndpointID = strings.TrimSpace(title.EndpointID)
		title.ThreadID = strings.TrimSpace(title.ThreadID)
		title.Title = strings.TrimSpace(title.Title)
		if title.EndpointID == "" || title.ThreadID == "" || title.Title == "" {
			_ = rows.Close()
			_ = tx.Rollback()
			return errors.New("legacy thread title has incomplete identity")
		}
		titles = append(titles, title)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		_ = tx.Rollback()
		return err
	}
	if err := rows.Close(); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if len(titles) > 0 && migrate == nil {
		return errors.New("threadstore schema v2 contains titles but no Floret title migrator was configured")
	}
	for _, title := range titles {
		if err := migrate(ctx, title); err != nil {
			return fmt.Errorf("migrate title for thread %q: %w", title.ThreadID, err)
		}
	}
	return nil
}

func preflightLegacyComposerAdmissions(
	path string,
	uploadsDir string,
	preflight func(context.Context, LegacyComposerAdmission) (LegacyComposerAdmissionDecision, error),
) (legacyComposerAdmissionDecisionSet, error) {
	decisions := legacyComposerAdmissionDecisionSet{}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return decisions, nil
	} else if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(3000)")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	var hasMeta int
	if err := db.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = '__redeven_db_meta'`).Scan(&hasMeta); err != nil {
		return nil, err
	}
	if hasMeta == 0 {
		return decisions, nil
	}
	var kind string
	if err := db.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton = 1`).Scan(&kind); err != nil {
		return nil, err
	}
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return nil, err
	}
	if strings.TrimSpace(kind) != threadstoreSchemaKind {
		return nil, fmt.Errorf("unsupported threadstore database kind %q version %d; only %q schemas v2 through v8 are supported", strings.TrimSpace(kind), version, threadstoreSchemaKind)
	}
	if version != 6 && version != 7 {
		return decisions, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	if err := verifyProductSchemaVersion(tx, version); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("verify product threadstore v%d before composer admission preflight: %w", version, err)
	}
	requests, err := readLegacyComposerPreflightRequests(tx, version)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	requiresCanonicalPreflight := false
	for _, request := range requests {
		requiresCanonicalPreflight = requiresCanonicalPreflight || !request.queued
	}
	if requiresCanonicalPreflight && preflight == nil {
		return nil, errors.New("legacy composer admission preflight is required")
	}
	for _, request := range requests {
		if err := verifyLegacyComposerAttachmentBytes(uploadsDir, request); err != nil {
			return nil, fmt.Errorf("preflight legacy composer admission %s/%s: %w", request.admission.ThreadID, request.admission.TurnID, err)
		}
		key := legacyComposerAdmissionDecisionKey(request.admission.EndpointID, request.admission.OwnerUserHash, request.admission.ScopeID)
		if _, exists := decisions[key]; exists {
			return nil, errors.New("duplicate legacy composer admission decision")
		}
		if request.queued {
			decisions[key] = legacyComposerAdmissionDecisionRecord{Admission: request.admission, Queued: true}
			continue
		}
		decision, err := preflight(context.Background(), request.admission)
		if err != nil {
			return nil, fmt.Errorf("preflight legacy composer admission %s/%s: %w", request.admission.ThreadID, request.admission.TurnID, err)
		}
		if err := validateLegacyComposerAdmissionDecision(request.admission, decision); err != nil {
			return nil, fmt.Errorf("preflight legacy composer admission %s/%s: %w", request.admission.ThreadID, request.admission.TurnID, err)
		}
		decisions[key] = legacyComposerAdmissionDecisionRecord{Admission: request.admission, Decision: decision}
	}
	return decisions, nil
}

func readLegacyComposerPreflightRequests(tx *sql.Tx, version int) ([]legacyComposerPreflightRequest, error) {
	rows, err := tx.Query(`
SELECT endpoint_id, owner_user_hash, scope_id, value_json
FROM ai_composer_drafts
ORDER BY endpoint_id, owner_user_hash, scope_id
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type draftRow struct{ endpointID, ownerUserHash, scopeID, valueJSON string }
	var drafts []draftRow
	for rows.Next() {
		var draft draftRow
		if err := rows.Scan(&draft.endpointID, &draft.ownerUserHash, &draft.scopeID, &draft.valueJSON); err != nil {
			return nil, err
		}
		if version == 6 {
			draft.valueJSON, err = migrateComposerDraftValueV6ToV7(draft.valueJSON)
			if err != nil {
				return nil, fmt.Errorf("preflight legacy composer draft %q: %w", draft.scopeID, err)
			}
		}
		drafts = append(drafts, draft)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	requests := make([]legacyComposerPreflightRequest, 0)
	for _, draft := range drafts {
		var value composerDraftAdmissionValue
		if _, err := normalizeComposerDraftValue([]byte(draft.valueJSON)); err != nil {
			return nil, fmt.Errorf("preflight legacy composer draft %q: malformed value: %w", draft.scopeID, err)
		}
		if err := json.Unmarshal([]byte(draft.valueJSON), &value); err != nil {
			return nil, fmt.Errorf("preflight legacy composer draft %q: malformed value: %w", draft.scopeID, err)
		}
		if !value.AdmissionStarted {
			continue
		}
		turnID := strings.TrimSpace(value.ProposedTurnID)
		threadID := strings.TrimSpace(value.TargetThreadID)
		if threadID == "" && strings.TrimSpace(draft.scopeID) != "__new_thread__" {
			threadID = strings.TrimSpace(draft.scopeID)
		}
		if turnID == "" || threadID == "" {
			return nil, fmt.Errorf("preflight legacy composer draft %q: incomplete admission identity", draft.scopeID)
		}
		uploadIDs, err := composerDraftAttachmentIDs([]byte(draft.valueJSON))
		if err != nil {
			return nil, fmt.Errorf("preflight legacy composer draft %q attachments: %w", draft.scopeID, err)
		}
		queuedDraft := struct{ endpointID, ownerUserHash, scopeID, valueJSON string }{
			draft.endpointID, draft.ownerUserHash, draft.scopeID, draft.valueJSON,
		}
		_, queued, err := exactLegacyQueuedComposerAdmission(tx, queuedDraft, value, threadID, turnID, uploadIDs)
		if err != nil {
			return nil, err
		}
		attachments, storageRelPaths, err := readLegacyComposerAttachments(tx, draft.endpointID, draft.ownerUserHash, draft.scopeID, uploadIDs)
		if err != nil {
			return nil, err
		}
		requests = append(requests, legacyComposerPreflightRequest{
			admission: LegacyComposerAdmission{
				EndpointID: strings.TrimSpace(draft.endpointID), OwnerUserHash: strings.ToLower(strings.TrimSpace(draft.ownerUserHash)),
				ScopeID: strings.TrimSpace(draft.scopeID), ThreadID: threadID, TurnID: turnID, Attachments: attachments,
			},
			storageRelPaths: storageRelPaths,
			queued:          queued,
		})
	}
	return requests, nil
}

func readLegacyComposerAttachments(tx *sql.Tx, endpointID, ownerUserHash, scopeID string, uploadIDs []string) ([]LegacyComposerAttachment, []string, error) {
	attachments := make([]LegacyComposerAttachment, 0, len(uploadIDs))
	storageRelPaths := make([]string, 0, len(uploadIDs))
	draftRefID := legacyComposerDraftUploadRefID(ownerUserHash, scopeID)
	for _, uploadID := range uploadIDs {
		var ownerKind, storedOwner, storageRelPath, name, mediaType, digest, state string
		var sizeBytes int64
		err := tx.QueryRow(`
SELECT owner_scope_kind, COALESCE(owner_user_hash, ''), storage_relpath, name,
       detected_media_type, size_bytes, content_sha256, state
FROM ai_uploads
WHERE endpoint_id = ? AND upload_id = ?
`, endpointID, uploadID).Scan(&ownerKind, &storedOwner, &storageRelPath, &name, &mediaType, &sizeBytes, &digest, &state)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, fmt.Errorf("legacy composer attachment %q is missing", uploadID)
		}
		if err != nil {
			return nil, nil, err
		}
		if ownerKind != UploadOwnerScopeUser || !strings.EqualFold(strings.TrimSpace(storedOwner), strings.TrimSpace(ownerUserHash)) {
			return nil, nil, fmt.Errorf("legacy composer attachment %q owner mismatch", uploadID)
		}
		if state != UploadStateStaged && state != UploadStateLive {
			return nil, nil, fmt.Errorf("legacy composer attachment %q has invalid state %q", uploadID, state)
		}
		digest = strings.ToLower(strings.TrimSpace(digest))
		if len(digest) != sha256.Size*2 {
			return nil, nil, fmt.Errorf("legacy composer attachment %q has invalid digest", uploadID)
		}
		if _, err := hex.DecodeString(digest); err != nil {
			return nil, nil, fmt.Errorf("legacy composer attachment %q has invalid digest", uploadID)
		}
		var claimCount int
		if err := tx.QueryRow(`
SELECT COUNT(1) FROM ai_upload_refs
WHERE endpoint_id = ? AND upload_id = ? AND ref_kind IN (?, ?) AND ref_id = ?
`, endpointID, uploadID, legacyUploadRefKindDraft, legacyUploadRefKindDraftPending, draftRefID).Scan(&claimCount); err != nil || claimCount != 1 {
			return nil, nil, fmt.Errorf("legacy composer attachment %q does not have one exact draft claim", uploadID)
		}
		attachments = append(attachments, LegacyComposerAttachment{
			UploadID: strings.TrimSpace(uploadID), Name: strings.TrimSpace(name), DetectedMediaType: strings.TrimSpace(mediaType),
			SizeBytes: sizeBytes, ContentSHA256: digest,
		})
		storageRelPaths = append(storageRelPaths, strings.TrimSpace(storageRelPath))
	}
	return attachments, storageRelPaths, nil
}

func verifyLegacyComposerAttachmentBytes(uploadsDir string, request legacyComposerPreflightRequest) error {
	if len(request.admission.Attachments) == 0 {
		return nil
	}
	uploadsDir = strings.TrimSpace(uploadsDir)
	if uploadsDir == "" {
		return errors.New("legacy composer attachment directory is required")
	}
	for index, attachment := range request.admission.Attachments {
		storageRelPath := request.storageRelPaths[index]
		if storageRelPath == "" || filepath.Base(storageRelPath) != storageRelPath || storageRelPath == "." {
			return fmt.Errorf("legacy composer attachment %q has invalid storage path", attachment.UploadID)
		}
		filePath := filepath.Join(uploadsDir, storageRelPath)
		info, err := os.Lstat(filePath)
		if err != nil {
			return fmt.Errorf("legacy composer attachment %q bytes unavailable: %w", attachment.UploadID, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("legacy composer attachment %q bytes are not a regular file", attachment.UploadID)
		}
		file, err := os.Open(filePath)
		if err != nil {
			return fmt.Errorf("legacy composer attachment %q bytes unavailable: %w", attachment.UploadID, err)
		}
		hash := sha256.New()
		readBytes, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return fmt.Errorf("legacy composer attachment %q bytes unreadable: %w", attachment.UploadID, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("legacy composer attachment %q bytes close failed: %w", attachment.UploadID, closeErr)
		}
		actualDigest := hex.EncodeToString(hash.Sum(nil))
		if readBytes != attachment.SizeBytes || info.Size() != attachment.SizeBytes || actualDigest != attachment.ContentSHA256 {
			return fmt.Errorf("legacy composer attachment %q bytes do not match stored size and digest", attachment.UploadID)
		}
	}
	return nil
}

func validateLegacyComposerAdmissionDecision(admission LegacyComposerAdmission, decision LegacyComposerAdmissionDecision) error {
	switch decision.State {
	case LegacyComposerAdmissionMissing:
		if len(decision.Attachments) != 0 {
			return errors.New("missing canonical turn returned attachments")
		}
		return nil
	case LegacyComposerAdmissionAdmitted:
	default:
		return fmt.Errorf("returned invalid state %q", decision.State)
	}
	if len(decision.Attachments) != len(admission.Attachments) {
		return errors.New("canonical attachment membership changed")
	}
	for index, local := range admission.Attachments {
		canonical := decision.Attachments[index]
		if canonical.UploadID != local.UploadID || strings.TrimSpace(canonical.ResourceRef) == "" ||
			canonical.Name != local.Name || canonical.MIMEType != local.DetectedMediaType || canonical.SizeBytes != local.SizeBytes ||
			!strings.EqualFold(canonical.ContentSHA256, local.ContentSHA256) {
			return fmt.Errorf("canonical attachment membership changed at index %d", index)
		}
	}
	return nil
}
